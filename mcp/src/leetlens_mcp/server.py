"""LeetLens MCP server — lets an LLM analyze your LeetCode practice sessions."""

from __future__ import annotations

import argparse
from typing import Literal

from mcp.server.mcpserver import MCPServer

from . import stats
from .store import DataStore

mcp = MCPServer("LeetLens")
store = DataStore()


@mcp.tool()
def list_sessions(
    tag: str | None = None,
    difficulty: Literal["Easy", "Medium", "Hard"] | None = None,
    outcome: Literal["accepted", "gave_up", "abandoned"] | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 50,
) -> list[dict]:
    """List solving sessions (newest first), filterable by tag, difficulty, outcome, and date (YYYY-MM-DD)."""
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
    return sorted(rows, key=lambda r: r["started_at"], reverse=True)[:limit]


@mcp.tool()
def get_problem_details(slug_or_id: str) -> dict:
    """Full detail for one problem: every session record (phases, notes, tags) plus the committed solution source if present. Accepts a slug ('two-sum'), dir key ('0001-two-sum'), or frontend id ('1')."""
    records = store.load_sessions()
    matches = [
        r
        for r in records
        if slug_or_id in (r["problem"]["slug"], r["problem"]["dir_key"], r["problem"]["frontend_id"])
    ]
    if not matches:
        return {"error": f"no sessions found for {slug_or_id!r}"}
    dir_key = matches[0]["problem"]["dir_key"]
    return {
        "problem": matches[0]["problem"],
        "sessions": matches,
        "solution_source": store.load_solution(dir_key),
    }


@mcp.tool()
def get_stats(group_by: Literal["tag", "difficulty", "week", "month"] = "tag") -> dict:
    """Aggregate stats per group: session/problem counts, give-up rate, avg & median solve time, avg per-phase seconds, avg run counts."""
    return stats.grouped_stats(store.load_sessions(), group_by)


@mcp.tool()
def get_trends(
    metric: Literal["total_time", "debugging_share", "give_up_rate", "run_count"],
    window: Literal["week", "month"] = "week",
) -> list[dict]:
    """Time series of a metric per week or month, to spot improvement or regression."""
    return stats.trends(store.load_sessions(), metric, window)


@mcp.tool()
def get_weak_areas(min_sessions: int = 2, top_n: int = 5) -> list[dict]:
    """Tags ranked weakest-first. Score = 0.4*give_up_rate + 0.3*relative slowness + 0.2*debugging share + 0.1*run-count factor; every component is included so you can explain the ranking."""
    return stats.weak_areas(store.load_sessions(), min_sessions, top_n)


@mcp.tool()
def list_tags(prefix: str | None = None) -> list[dict]:
    """All user-created tags with usage counts and last-seen date."""
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


def main() -> None:
    parser = argparse.ArgumentParser(description="LeetLens MCP server")
    parser.add_argument("--transport", default="stdio", choices=["stdio", "streamable-http"])
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.transport == "streamable-http":
        mcp.run(transport="streamable-http", host="127.0.0.1", port=args.port)
    else:
        mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
