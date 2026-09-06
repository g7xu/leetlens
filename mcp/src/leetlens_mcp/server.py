"""LeetLens MCP server — lets an LLM analyze your LeetCode practice sessions.

Every tool is read-only and idempotent over the user's data repo; the
annotations say so, so clients need not confirm each call.
"""

from __future__ import annotations

import argparse
import functools
import json
from typing import Annotated, Literal, get_type_hints

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
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
    rows = [stats.session_summary(r) for r in store.load_sessions()]
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
        for r in store.load_sessions()
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
        "solution_source": store.load_solution(matches[0]["problem"]["dir_key"]),
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
    return {"results": documents.search_documents(store.load_sessions(), query)}


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
        doc = documents.tag_document(store.load_sessions(), id[len(documents.TAG_PREFIX):])
        if doc is None:
            raise ToolError(f"no sessions carry tag {id!r}; list_tags shows the vocabulary")
        return doc
    matches = _problem_sessions(id)
    return documents.problem_document(matches, store.load_solution(matches[0]["problem"]["dir_key"]))


@tool("Grouped stats")
def get_stats(
    group_by: Annotated[
        Literal["tag", "difficulty", "week", "month"],
        Field(description="What each group is: a user tag, a difficulty, an ISO week, or a calendar month"),
    ] = "tag",
) -> dict[str, models.GroupStats]:
    """Aggregate numbers per group: session and problem counts, give-up rate,
    average and median session length, average seconds per phase, average run
    counts. Keys are the group names.

    Use this for a table view. For a ranking of weak tags with the scoring
    exposed, use get_weak_areas; for change over time, get_trends.
    """
    return stats.grouped_stats(store.load_sessions(), group_by)


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
    return stats.trends(store.load_sessions(), metric, window)


@tool("Weak areas")
def get_weak_areas(
    min_sessions: Annotated[
        int, Field(description="Ignore tags with fewer sessions than this; guards against one bad day", ge=1)
    ] = 2,
    top_n: Annotated[int, Field(description="How many tags to return", ge=1)] = 5,
) -> list[models.WeakArea]:
    """Tags ranked weakest first. Score = 0.4*give_up_rate + 0.3*relative
    slowness + 0.2*debugging share + 0.1*run-count factor; every component is
    returned so the ranking can be explained, or re-weighted.

    Use this as the starting point for a diagnosis. To compute a different
    view of weakness from the raw data, use export_sessions.
    """
    return stats.weak_areas(store.load_sessions(), min_sessions, top_n)


@tool("List tags")
def list_tags(
    prefix: Annotated[str | None, Field(description="Only tags starting with this text")] = None,
) -> list[models.TagUsage]:
    """Every user-created tag with session and problem counts and the date it
    was last practised. Tags are free text chosen by the user, so this is the
    vocabulary to use in the tag filters of other tools.
    """
    rows = [
        {
            "tag": tag,
            "session_count": st["session_count"],
            "problem_count": st["problem_count"],
            "last_seen": st["last_seen"],
        }
        for tag, st in stats.by_tag(store.load_sessions()).items()
    ]
    if prefix:
        rows = [r for r in rows if r["tag"].startswith(prefix)]
    return rows


@tool("Revenge list")
def get_revenge_list() -> list[models.RevengeProblem]:
    """Problems the user gave up on and has not solved since, most recently
    tried first. The literal to-do list of unfinished fights.
    """
    return stats.revenge_list(store.load_sessions())


@tool("Stale tags")
def get_stale_tags(
    days: Annotated[int, Field(description="A tag is stale when not practised for this many days", ge=1)] = 30,
) -> list[models.StaleTag]:
    """Tags not practised recently, most stale first: the spaced-repetition
    signal for what is about to be forgotten.
    """
    return stats.stale_tags(store.load_sessions(), days)


@tool("Recommend next")
def recommend_next(
    count: Annotated[int, Field(description="How many suggestions to return", ge=1)] = 3,
) -> list[models.Recommendation]:
    """Concrete "solve this next" suggestions with the reason attached, drawn in
    turn from the revenge list, the weakest tags, and the stalest tags so one
    source cannot crowd out the others.

    Use this to end a review with a plan.
    """
    return stats.recommend_next(store.load_sessions(), count)


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
    return stats.search_notes(store.load_sessions(), query, limit)


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
        return stats.compare_periods(store.load_sessions(), period_a, period_b)
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
    rows = stats.filter_records(store.load_sessions(), date_from, date_to, tag)
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
    return store.load_index_raw()


@mcp.resource("leetlens://sessions/{dir_key}", mime_type="application/json")
def sessions_resource(dir_key: str) -> str:
    """Full session records for one problem, e.g. leetlens://sessions/0001-two-sum."""
    records = [r for r in store.load_sessions() if r["problem"]["dir_key"] == dir_key]
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
