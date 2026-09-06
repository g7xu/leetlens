"""LeetLens MCP server — lets an LLM analyze your LeetCode practice sessions.

Every tool is read-only and idempotent over the user's data repo; the
annotations say so, so clients need not confirm each call.
"""

from __future__ import annotations

import argparse
import functools
import json
import re
from collections import OrderedDict
from typing import Annotated, Literal, get_type_hints

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_request
import httpx
from pydantic import Field, TypeAdapter, ValidationError

from . import documents, models, stats
from .store import DataStore

mcp = FastMCP(
    "LeetLens",
    instructions=(
        "Practice-session records from one user's LeetCode data repo: per attempt, "
        "the time split into thinking / writing / reviewing / debugging, run and "
        "submit counts, outcome, the user's own logic idea and comments, and tags. "
        "Start a diagnosis with get_weak_areas or recommend_next; use search and "
        "fetch to read up on one problem; use export_sessions for raw records."
    ),
)
store = DataStore()

# One hosted process serves any public data repo: the repo is named in the
# URL (/{owner}/{repo}/mcp), so each request resolves its own store. Bounded
# so a scan of random owner/repo pairs cannot grow the process without limit.
REMOTE_STORE_LIMIT = 64
REPO_SEGMENT = re.compile(r"^(?!\.\.?$)[A-Za-z0-9_.-]{1,100}$")
_remote_stores: OrderedDict[str, DataStore] = OrderedDict()


def make_remote_store(owner: str, repo: str) -> DataStore:
    return DataStore(mode="github", repo=f"{owner}/{repo}", allow_tree_walk=False)


def current_store() -> DataStore:
    """The store for this call: per-repo when the request URL names one, else the process default."""
    try:
        params = get_http_request().path_params
    except RuntimeError:  # stdio, or an HTTP app mounted without path parameters
        return store
    owner, repo = params.get("owner"), params.get("repo")
    if not owner or not repo:
        return store
    if not (REPO_SEGMENT.match(owner) and REPO_SEGMENT.match(repo)):
        raise ToolError(f"{owner}/{repo} is not a GitHub owner/repo pair")
    key = f"{owner}/{repo}"
    if key in _remote_stores:
        _remote_stores.move_to_end(key)
        return _remote_stores[key]
    remote = make_remote_store(owner, repo)
    _remote_stores[key] = remote
    while len(_remote_stores) > REMOTE_STORE_LIMIT:
        _, evicted = _remote_stores.popitem(last=False)
        evicted.close()
    return remote


def load_sessions() -> list[dict]:
    """Sessions for this call, with data-source failures named for the user."""
    try:
        return current_store().load_sessions()
    except (RuntimeError, httpx.HTTPError, ValueError) as err:
        raise ToolError(f"could not read the data repo: {err}") from err


READ_ONLY = {
    "readOnlyHint": True,
    "destructiveHint": False,
    "idempotentHint": True,
    "openWorldHint": False,
}


def tool(title: str):
    """Register a read-only tool and hand back the plain callable.

    The return annotation becomes the advertised output schema, but FastMCP
    serialises a returned dict without checking it against that schema, so the
    value is validated here first: a tool whose output drifts from its model
    fails loudly instead of advertising fields it no longer sends.
    """

    def decorate(fn):
        adapter = TypeAdapter(get_type_hints(fn)["return"])

        @functools.wraps(fn)
        def validated(*args, **kwargs):
            result = fn(*args, **kwargs)
            try:
                return adapter.validate_python(result)
            except ValidationError as err:
                # Left to FastMCP, a ValidationError is reported as bad *input*.
                raise ToolError(f"{fn.__name__} returned data that does not match its output schema: {err}") from err

        mcp.tool(title=title, annotations=READ_ONLY)(validated)
        return validated

    return decorate


# Parameter types shared by several tools; the description travels with the type.
TagFilter = Annotated[
    str | None,
    Field(description="Only sessions carrying this user tag, e.g. 'sliding-window'; list_tags shows the vocabulary"),
]
LabelKind = Annotated[
    Literal["tag", "topic"],
    Field(description="Which vocabulary to rank: 'tag' is what the user typed themselves (may be sparse or absent), 'topic' is LeetCode's own, recorded for every problem"),
]
DateFrom = Annotated[str | None, Field(description="Earliest session date to include, YYYY-MM-DD, inclusive")]
DateTo = Annotated[str | None, Field(description="Latest session date to include, YYYY-MM-DD, inclusive")]
ProblemId = Annotated[
    str,
    Field(description="A problem's dir_key ('0001-two-sum'), slug ('two-sum'), or frontend id ('1')"),
]


@tool("List sessions")
def list_sessions(
    tag: TagFilter = None,
    difficulty: Annotated[models.Difficulty | None, Field(description="Only problems of this difficulty")] = None,
    outcome: Annotated[
        models.Outcome | None,
        Field(description="accepted, gave_up (explicit give-up), or abandoned (left open, flushed later)"),
    ] = None,
    date_from: DateFrom = None,
    date_to: DateTo = None,
    limit: Annotated[int, Field(description="Page size", ge=1, le=500)] = 50,
    offset: Annotated[int, Field(description="Rows to skip, for paging", ge=0)] = 0,
) -> list[models.SessionSummary]:
    """One summary row per solving session, newest first, with optional filters.

    Use this to see what was practised and when. For the full records (phases,
    notes) use export_sessions; for everything about one problem use
    get_problem_details.
    """
    rows = [stats.session_summary(r) for r in load_sessions()]
    if tag:
        rows = [r for r in rows if tag in r["tags"]]
    if difficulty:
        rows = [r for r in rows if r["difficulty"] == difficulty]
    if outcome:
        rows = [r for r in rows if r["outcome"] == outcome]
    if date_from:
        rows = [r for r in rows if r["date"] >= date_from]
    if date_to:
        rows = [r for r in rows if r["date"] <= date_to]
    rows.sort(key=lambda r: r["started_at"], reverse=True)
    return rows[offset : offset + limit]


def _problem_sessions(slug_or_id: str) -> list[dict]:
    """That problem's sessions, oldest first; matches slug, dir_key, or frontend id."""
    matches = [
        r
        for r in load_sessions()
        if slug_or_id in (r["problem"]["slug"], r["problem"]["dir_key"], r["problem"]["frontend_id"])
    ]
    if not matches:
        raise ToolError(f"no sessions found for {slug_or_id!r}; search or list_sessions shows what exists")
    return matches


@tool("Problem details")
def get_problem_details(slug_or_id: ProblemId) -> models.ProblemDetails:
    """Everything recorded about one problem: every attempt in full (phases,
    run counts, logic idea, comments, tags) plus the committed solution source.

    Use this to explain why a specific problem went well or badly. fetch
    returns the same material rendered as one readable document.
    """
    matches = _problem_sessions(slug_or_id)
    return {
        "problem": matches[0]["problem"],
        "sessions": matches,
        "solution_source": current_store().load_solution(matches[0]["problem"]["dir_key"]),
    }


@tool("Search")
def search(
    query: Annotated[
        str, Field(description="Free text; every whitespace-separated word must match somewhere")
    ],
) -> models.SearchResults:
    """Find problems and tags by free text over titles, slugs, tags, logic
    ideas, and comments. Title hits rank above tag hits, which rank above note
    hits. Each result id can be passed to fetch.

    Use this to locate something by name or topic. To search only the user's
    own notes and get the matching text back, use search_notes.
    """
    return {"results": documents.search_documents(load_sessions(), query)}


@tool("Fetch document")
def fetch(
    id: Annotated[
        str,
        Field(description="A result id from search: a problem dir_key / slug / frontend id, or 'tag:<tag>'"),
    ],
) -> models.Document:
    """One self-contained document. For a problem: every attempt with phase
    split, debugging share, runs, notes, then the committed solution. For a
    tag: its aggregate stats and every session carrying it.

    Use this after search, or whenever a readable write-up of one problem is
    more useful than the raw records from get_problem_details.
    """
    if id.startswith(documents.TAG_PREFIX):
        doc = documents.tag_document(load_sessions(), id[len(documents.TAG_PREFIX):])
        if doc is None:
            raise ToolError(f"no sessions carry tag {id!r}; list_tags shows the vocabulary")
        return doc
    matches = _problem_sessions(id)
    return documents.problem_document(matches, current_store().load_solution(matches[0]["problem"]["dir_key"]))


@tool("Grouped stats")
def get_stats(
    group_by: Annotated[
        Literal["tag", "topic", "difficulty", "week", "month"],
        Field(description="What each group is: a user tag, a LeetCode topic, a difficulty, an ISO week, or a calendar month"),
    ] = "tag",
) -> dict[str, models.GroupStats]:
    """Aggregate numbers per group: session and problem counts, give-up rate,
    average and median session length, average seconds per phase, average run
    counts. Keys are the group names.

    Use this for a table view. For a ranking of weak tags with the scoring
    exposed, use get_weak_areas; for change over time, get_trends.
    """
    return stats.grouped_stats(load_sessions(), group_by)


@tool("Trends")
def get_trends(
    metric: Annotated[
        Literal["total_time", "debugging_share", "give_up_rate", "run_count"],
        Field(
            description="total_time = mean active seconds; debugging_share = mean share of a session spent debugging (0..1); give_up_rate = gave_up / sessions (0..1); run_count = mean runs per session"
        ),
    ],
    window: Annotated[Literal["week", "month"], Field(description="Bucket size for the series")] = "week",
) -> list[models.TrendPoint]:
    """One metric as a time series, oldest period first, with the session count
    behind each point so thin periods can be discounted.

    Use this to say whether the user is improving. For two specific periods
    side by side with deltas, use compare_periods.
    """
    return stats.trends(load_sessions(), metric, window)


@tool("Weak areas")
def get_weak_areas(
    min_sessions: Annotated[
        int, Field(description="Ignore labels with fewer sessions than this; guards against one bad day", ge=1)
    ] = 2,
    top_n: Annotated[int, Field(description="How many labels to return", ge=1)] = 5,
    by: LabelKind = "topic",
) -> list[models.WeakArea]:
    """Tags or topics ranked weakest first. Score = 0.4*give_up_rate +
    0.3*relative slowness + 0.2*debugging share + 0.1*run-count factor; every
    component is returned so the ranking can be explained, or re-weighted.

    Use this as the starting point for a diagnosis. Topics are the default
    because LeetCode supplies them for every problem, so the ranking holds
    even when the user tags nothing; pass by='tag' for their own vocabulary.
    """
    return stats.weak_areas(load_sessions(), min_sessions, top_n, kind=by)


@tool("List tags")
def list_tags(
    prefix: Annotated[str | None, Field(description="Only labels starting with this text")] = None,
    kind: LabelKind = "tag",
) -> list[models.TagUsage]:
    """Every label of one kind with session and problem counts and the date it
    was last practised. This is the vocabulary the tag filters of other tools
    accept; an empty result for kind='tag' means the user tags nothing, and
    kind='topic' is the vocabulary to use instead.
    """
    rows = [
        {
            "label": label,
            "kind": kind,
            "session_count": st["session_count"],
            "problem_count": st["problem_count"],
            "last_seen": st["last_seen"],
        }
        for label, st in stats.by_label(load_sessions(), kind).items()
    ]
    if prefix:
        rows = [r for r in rows if r["label"].startswith(prefix)]
    return rows


@tool("Revenge list")
def get_revenge_list() -> list[models.RevengeProblem]:
    """Problems the user gave up on and has not solved since, most recently
    tried first. The literal to-do list of unfinished fights.
    """
    return stats.revenge_list(load_sessions())


@tool("Stale tags")
def get_stale_tags(
    days: Annotated[int, Field(description="A label is stale when not practised for this many days", ge=1)] = 30,
    by: LabelKind = "topic",
) -> list[models.StaleTag]:
    """Tags or topics not practised recently, most stale first: the
    spaced-repetition signal for what is about to be forgotten.
    """
    return stats.stale_tags(load_sessions(), days, kind=by)


@tool("Recommend next")
def recommend_next(
    count: Annotated[int, Field(description="How many suggestions to return", ge=1)] = 3,
) -> list[models.Recommendation]:
    """Concrete "solve this next" suggestions with the reason attached, drawn in
    turn from the revenge list, the weakest tags, and the stalest tags so one
    source cannot crowd out the others.

    Use this to end a review with a plan.
    """
    return stats.recommend_next(load_sessions(), count)


@tool("Search notes")
def search_notes(
    query: Annotated[str, Field(description="Case-insensitive substring to look for")],
    limit: Annotated[int, Field(description="Maximum sessions to return", ge=1)] = 20,
) -> list[models.NoteHit]:
    """Sessions whose logic idea or comments contain the text, newest first,
    with the matching field(s) returned in full.

    Use this to find what the user wrote about an idea or a mistake. To find
    problems by title or tag as well, use search.
    """
    return stats.search_notes(load_sessions(), query, limit)


PeriodSpec = Annotated[
    str,
    Field(description="this_month, last_month, last_30d, prev_30d, or a calendar month as YYYY-MM"),
]


@tool("Compare periods")
def compare_periods(period_a: PeriodSpec = "this_month", period_b: PeriodSpec = "last_month") -> models.PeriodComparison:
    """Two periods side by side (session counts, give-up rate, session length,
    run counts, debugging share) plus period_a minus period_b for each metric.

    Use this for "am I better than last month". For a longer series use
    get_trends.
    """
    try:
        return stats.compare_periods(load_sessions(), period_a, period_b)
    except ValueError as err:
        raise ToolError(str(err)) from err


@tool("Export sessions")
def export_sessions(
    date_from: DateFrom = None,
    date_to: DateTo = None,
    tag: TagFilter = None,
    format: Annotated[
        Literal["jsonl", "json"], Field(description="jsonl = one record per line; json = one array")
    ] = "jsonl",
) -> str:
    """Every matching session record in full (phases, per-phase seconds, run
    counts, notes, tags, attempt_number), newest first, as text. Nothing is
    summarised.

    Use this to run your own analysis instead of relying on the built-in
    scores, e.g. per-tag phase breakdowns or attempt-over-attempt comparisons.
    """
    rows = stats.filter_records(load_sessions(), date_from, date_to, tag)
    rows = sorted(rows, key=lambda r: r["started_at"], reverse=True)
    if format == "json":
        return json.dumps(rows)
    return "\n".join(json.dumps(r) for r in rows)


@mcp.prompt()
def weekly_review() -> str:
    """Weekly practice review: last 7 days, weak areas, and a plan for next week."""
    return (
        "Review my LeetCode practice using the LeetLens tools:\n"
        "1. Call list_sessions for the last 7 days and summarize what I worked on "
        "(problems, outcomes, time spent, phase balance).\n"
        "2. Call get_weak_areas and explain the top weaknesses using the score components, "
        "and get_trends(metric='debugging_share') to say whether I'm getting cleaner.\n"
        "3. Call get_revenge_list and get_stale_tags to find unfinished fights and rusty topics.\n"
        "4. End with a concrete plan for next week: 3-5 specific problems or tags "
        "(use recommend_next), each with a one-line reason."
    )


@mcp.resource("leetlens://index", mime_type="application/json")
def index_resource() -> str:
    """The aggregate index (totals, per-problem summaries, sessions, tags, daily activity)."""
    raw = current_store().load_index_raw()
    if raw is None:
        raise ToolError("this data repo has no data/index.json — set it up and push once")
    return raw


@mcp.resource("leetlens://sessions/{dir_key}", mime_type="application/json")
def sessions_resource(dir_key: str) -> str:
    """Full session records for one problem, e.g. leetlens://sessions/0001-two-sum."""
    records = [r for r in load_sessions() if r["problem"]["dir_key"] == dir_key]
    return json.dumps(records, indent=1)


def main() -> None:
    parser = argparse.ArgumentParser(description="LeetLens MCP server")
    parser.add_argument(
        "--transport", default="stdio", choices=["stdio", "http", "streamable-http"],
        help="streamable-http is an alias of http",
    )
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.transport == "stdio":
        mcp.run(transport="stdio", show_banner=False)
    else:
        mcp.run(transport="http", host="127.0.0.1", port=args.port, show_banner=False)


if __name__ == "__main__":
    main()
