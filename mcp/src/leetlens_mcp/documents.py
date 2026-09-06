"""The search-and-fetch view of the data: ranked hits and self-contained documents.

ChatGPT connectors name two tools, `search` and `fetch`, with fixed field
names (search -> {results: [{id, title, url}]}; fetch -> {id, title, text,
url, metadata}). Everything here is the pure part behind those tools.

Document ids are a problem's dir_key ("0001-two-sum") or "tag:<tag>".
"""

from __future__ import annotations

from collections import defaultdict

from . import stats

TAG_PREFIX = "tag:"

# Where a term matched, strongest first. A title hit says the user asked for
# this problem; a note hit only says they mentioned something like it.
TITLE_WEIGHT = 3
TAG_WEIGHT = 2
NOTE_WEIGHT = 1


def _by_problem(records: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        groups[rec["problem"]["dir_key"]].append(rec)
    return groups


def _problem_title(prob: dict) -> str:
    return f"{prob['frontend_id']}. {prob['title']} ({prob['difficulty']})"


def _term_score(term: str, title: str, tags: set[str], notes: str) -> int:
    if term in title:
        return TITLE_WEIGHT
    if any(term in tag for tag in tags):
        return TAG_WEIGHT
    if term in notes:
        return NOTE_WEIGHT
    return 0


def search_documents(records: list[dict], query: str, limit: int = 20) -> list[dict]:
    """Problems and tags matching every term of `query`, best first.

    Each whitespace-separated term must hit somewhere in a problem's title,
    slug, tags, logic ideas, or comments (AND semantics). A problem scores the
    sum of its best field per term, so a title hit outranks a tag hit, which
    outranks a note hit; ties go to the most recently attempted problem.
    Tags containing every term are appended as "tag:<tag>" hits.
    """
    terms = [t for t in query.lower().split() if t]
    if not terms:
        return []
    scored: list[tuple[int, str, dict]] = []
    for dir_key, rs in _by_problem(records).items():
        prob = rs[0]["problem"]
        title = f"{prob['title']} {prob['slug']} {dir_key}".lower()
        tags = {t for r in rs for t in r.get("tags", [])}
        notes = " ".join(f"{r.get('logic_idea', '')} {r.get('comments', '')}" for r in rs).lower()
        per_term = [_term_score(t, title, tags, notes) for t in terms]
        if all(per_term):
            scored.append(
                (sum(per_term), rs[-1]["started_at"],
                 {"id": dir_key, "title": _problem_title(prob), "url": prob["url"]})
            )
    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    results = [hit for _, _, hit in scored]
    for tag, st in stats.by_tag(records).items():
        if all(t in tag for t in terms):
            results.append(
                {
                    "id": TAG_PREFIX + tag,
                    "title": f"Tag: {tag} ({st['session_count']} sessions, {st['problem_count']} problems)",
                    "url": f"leetlens://tags/{tag}",
                }
            )
    return results[:limit]


def _duration(sec: int) -> str:
    minutes, seconds = divmod(int(sec), 60)
    return f"{minutes}m{seconds:02d}s" if minutes else f"{seconds}s"


def _session_lines(rec: dict, heading: str) -> list[str]:
    totals = rec["phase_totals_sec"]
    total = rec["total_active_sec"]
    debug_pct = round(100 * totals["debugging"] / total) if total else 0
    lines = [
        f"## {heading} — {rec['started_at'][:10]}, {rec['outcome']}, {_duration(total)} active",
        "Phases: " + " · ".join(f"{p} {_duration(totals[p])}" for p in stats.PHASES)
        + f" (debugging {debug_pct}%)",
        f"Runs: {rec['run_count']} ({rec['failed_run_count']} failed) · submits: {rec['submit_count']}",
    ]
    if rec.get("tags"):
        lines.append("Tags: " + ", ".join(rec["tags"]))
    if rec.get("logic_idea"):
        lines.append(f"Logic idea: {rec['logic_idea']}")
    if rec.get("comments"):
        lines.append(f"Comments: {rec['comments']}")
    return lines


def problem_document(records: list[dict], solution_source: str | None) -> dict:
    """One problem as a document: every attempt in order, then the committed solution.

    `records` are that problem's sessions, oldest first (the store's order).
    """
    prob = records[0]["problem"]
    accepted = sum(r["outcome"] == "accepted" for r in records)
    gave_up = sum(r["outcome"] == "gave_up" for r in records)
    tags = sorted({t for r in records for t in r.get("tags", [])})
    lines = [
        f"# {_problem_title(prob)}",
        prob["url"],
        f"Attempts: {len(records)} · accepted {accepted} · gave up {gave_up}"
        + (f" · tags: {', '.join(tags)}" if tags else ""),
    ]
    for rec in records:
        lines.append("")
        lines.extend(_session_lines(rec, f"Attempt {rec.get('attempt_number', 1)}"))
    if solution_source:
        language = records[-1].get("language", "")
        lines += ["", f"## Solution ({language})" if language else "## Solution",
                  f"```{language}", solution_source.rstrip("\n"), "```"]
    return {
        "id": prob["dir_key"],
        "title": _problem_title(prob),
        "text": "\n".join(lines),
        "url": prob["url"],
        "metadata": {
            "dir_key": prob["dir_key"],
            "difficulty": prob["difficulty"],
            "attempts": len(records),
            "accepted": accepted,
            "gave_up": gave_up,
            "solved": accepted > 0,
            "tags": tags,
            "last_session_at": records[-1]["started_at"],
            "has_solution": solution_source is not None,
        },
    }


def tag_document(records: list[dict], tag: str) -> dict | None:
    """One tag as a document: its aggregate stats, then every session carrying it."""
    tagged = [r for r in records if tag in r.get("tags", [])]
    if not tagged:
        return None
    st = stats.by_tag(tagged)[tag]
    lines = [
        f"# Tag: {tag}",
        f"Sessions: {st['session_count']} over {st['problem_count']} problems · "
        f"give-up rate {round(100 * st['give_up_rate'])}% · "
        f"avg {_duration(st['avg_total_sec'])} (median {_duration(st['median_total_sec'])}) · "
        f"avg runs {st['avg_run_count']} · last seen {st['last_seen']}",
    ]
    for rec in reversed(tagged):
        lines.append("")
        lines.extend(_session_lines(rec, f"{rec['problem']['title']} (attempt {rec.get('attempt_number', 1)})"))
    return {
        "id": TAG_PREFIX + tag,
        "title": f"Tag: {tag}",
        "text": "\n".join(lines),
        "url": f"leetlens://tags/{tag}",
        "metadata": {"tag": tag, **st},
    }
