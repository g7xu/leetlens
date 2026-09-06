"""A small, deterministic set of session records shared by the MCP tests.

Built the way DataStore.load_sessions hands records to the tools: sorted by
started_at with attempt_number filled in. Four problems, six sessions, with
enough variety (repeat attempts, give-ups, tags, notes) that filters and
rankings have something to distinguish.
"""

from __future__ import annotations

import pytest

PHASES = ("thinking", "writing", "reviewing", "debugging")


def make_record(
    *,
    session_id: str,
    dir_key: str,
    title: str,
    difficulty: str,
    started: str,
    outcome: str,
    phases: dict[str, int],
    run_count: int = 1,
    failed_run_count: int = 0,
    submit_count: int = 1,
    tags: tuple[str, ...] = (),
    logic_idea: str = "",
    comments: str = "",
) -> dict:
    number, slug = dir_key.split("-", 1)
    totals = {p: phases.get(p, 0) for p in PHASES}
    total = sum(totals.values())
    return {
        "schema_version": 1,
        "session_id": session_id,
        "problem": {
            "frontend_id": str(int(number)),
            "dir_key": dir_key,
            "slug": slug,
            "title": title,
            "difficulty": difficulty,
            "url": f"https://leetcode.com/problems/{slug}/",
        },
        "language": "python3",
        "started_at": f"{started}T10:00:00Z",
        "ended_at": f"{started}T10:{total // 60:02d}:{total % 60:02d}Z",
        "outcome": outcome,
        "phases": [
            {"phase": p, "start": f"{started}T10:00:00Z", "end": f"{started}T10:00:00Z", "source": "auto"}
            for p in PHASES
            if totals[p]
        ],
        "phase_totals_sec": totals,
        "total_active_sec": total,
        "run_count": run_count,
        "failed_run_count": failed_run_count,
        "submit_count": submit_count,
        "logic_idea": logic_idea,
        "tags": list(tags),
        "comments": comments,
    }


def number_attempts(records: list[dict]) -> list[dict]:
    """Sort by started_at and add attempt_number, mirroring DataStore."""
    records = sorted(records, key=lambda r: r["started_at"])
    seen: dict[str, int] = {}
    for rec in records:
        key = rec["problem"]["dir_key"]
        seen[key] = seen.get(key, 0) + 1
        rec["attempt_number"] = seen[key]
    return records


@pytest.fixture
def records() -> list[dict]:
    return number_attempts(
        [
            make_record(
                session_id="aaaaaaa1",
                dir_key="0001-two-sum",
                title="Two Sum",
                difficulty="Easy",
                started="2026-08-01",
                outcome="accepted",
                phases={"thinking": 60, "writing": 120, "reviewing": 30},
                tags=("hash-map", "array"),
                logic_idea="one pass with a hash map from value to index",
            ),
            make_record(
                session_id="aaaaaaa2",
                dir_key="0003-longest-substring-without-repeating-characters",
                title="Longest Substring Without Repeating Characters",
                difficulty="Medium",
                started="2026-08-03",
                outcome="gave_up",
                phases={"thinking": 300, "writing": 400, "debugging": 900},
                run_count=6,
                failed_run_count=5,
                submit_count=0,
                tags=("sliding-window", "hash-map"),
                comments="kept getting the window bounds off by one",
            ),
            make_record(
                session_id="aaaaaaa3",
                dir_key="0003-longest-substring-without-repeating-characters",
                title="Longest Substring Without Repeating Characters",
                difficulty="Medium",
                started="2026-08-10",
                outcome="accepted",
                phases={"thinking": 120, "writing": 300, "reviewing": 60, "debugging": 120},
                run_count=2,
                tags=("sliding-window",),
                logic_idea="two pointers; move left past the last seen index",
            ),
            make_record(
                session_id="aaaaaaa4",
                dir_key="0322-coin-change",
                title="Coin Change",
                difficulty="Medium",
                started="2026-08-15",
                outcome="gave_up",
                phases={"thinking": 600, "writing": 300, "debugging": 600},
                run_count=4,
                failed_run_count=4,
                submit_count=0,
                tags=("dp",),
                logic_idea="greedy by largest coin fails; needs dp over amounts",
            ),
            make_record(
                session_id="aaaaaaa5",
                dir_key="0322-coin-change",
                title="Coin Change",
                difficulty="Medium",
                started="2026-08-20",
                outcome="gave_up",
                phases={"thinking": 200, "writing": 400, "debugging": 1200},
                run_count=8,
                failed_run_count=7,
                submit_count=1,
                tags=("dp",),
                comments="dp table right but forgot the -1 for unreachable amounts",
            ),
            make_record(
                session_id="aaaaaaa6",
                dir_key="0200-number-of-islands",
                title="Number of Islands",
                difficulty="Medium",
                started="2026-09-01",
                outcome="accepted",
                phases={"thinking": 90, "writing": 240, "reviewing": 30},
                tags=("bfs", "grid"),
                logic_idea="flood fill each unvisited land cell",
            ),
        ]
    )
