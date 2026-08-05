"""Aggregations over session records. Shared by the MCP server and the indexer."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from statistics import mean, median

PHASES = ("thinking", "writing", "reviewing", "debugging")


def _date(rec: dict) -> str:
    return rec["started_at"][:10]


def _week(rec: dict) -> str:
    year, week, _ = datetime.fromisoformat(rec["started_at"]).isocalendar()
    return f"{year}-W{week:02d}"


def _month(rec: dict) -> str:
    return rec["started_at"][:7]


GROUP_KEYS = {"difficulty": lambda r: r["problem"]["difficulty"], "week": _week, "month": _month}


def session_summary(rec: dict) -> dict:
    """Lightweight per-session row used by the index and list_sessions."""
    return {
        "session_id": rec["session_id"],
        "dir_key": rec["problem"]["dir_key"],
        "title": rec["problem"]["title"],
        "difficulty": rec["problem"]["difficulty"],
        "date": _date(rec),
        "started_at": rec["started_at"],
        "outcome": rec["outcome"],
        "attempt_number": rec.get("attempt_number", 1),
        "total_active_sec": rec["total_active_sec"],
        "phase_totals_sec": rec["phase_totals_sec"],
        "run_count": rec["run_count"],
        "failed_run_count": rec["failed_run_count"],
        "submit_count": rec["submit_count"],
        "tags": rec.get("tags", []),
    }


def _group_stats(records: list[dict]) -> dict:
    totals = [r["total_active_sec"] for r in records]
    gave_up = sum(r["outcome"] == "gave_up" for r in records)
    return {
        "session_count": len(records),
        "problem_count": len({r["problem"]["dir_key"] for r in records}),
        "accepted": sum(r["outcome"] == "accepted" for r in records),
        "gave_up": gave_up,
        "give_up_rate": round(gave_up / len(records), 3),
        "avg_total_sec": round(mean(totals)),
        "median_total_sec": round(median(totals)),
        "avg_phase_sec": {p: round(mean(r["phase_totals_sec"][p] for r in records)) for p in PHASES},
        "avg_run_count": round(mean(r["run_count"] for r in records), 1),
        "avg_failed_run_count": round(mean(r["failed_run_count"] for r in records), 1),
        "last_seen": max(_date(r) for r in records),
    }


def by_tag(records: list[dict]) -> dict[str, dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        for tag in rec.get("tags", []):
            groups[tag].append(rec)
    return {tag: _group_stats(rs) for tag, rs in sorted(groups.items())}


def grouped_stats(records: list[dict], group_by: str) -> dict[str, dict]:
    if group_by == "tag":
        return by_tag(records)
    key_fn = GROUP_KEYS[group_by]
    groups: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        groups[key_fn(rec)].append(rec)
    return {k: _group_stats(rs) for k, rs in sorted(groups.items())}


def trends(records: list[dict], metric: str, window: str = "week") -> list[dict]:
    key_fn = _week if window == "week" else _month
    groups: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        groups[key_fn(rec)].append(rec)
    out = []
    for period, rs in sorted(groups.items()):
        if metric == "total_time":
            value = round(mean(r["total_active_sec"] for r in rs))
        elif metric == "debugging_share":
            shares = [
                r["phase_totals_sec"]["debugging"] / r["total_active_sec"]
                for r in rs
                if r["total_active_sec"]
            ]
            value = round(mean(shares), 3) if shares else 0
        elif metric == "give_up_rate":
            value = round(sum(r["outcome"] == "gave_up" for r in rs) / len(rs), 3)
        elif metric == "run_count":
            value = round(mean(r["run_count"] for r in rs), 1)
        else:
            raise ValueError(f"unknown metric: {metric}")
        out.append({"period": period, "value": value, "sessions": len(rs)})
    return out


def weak_areas(records: list[dict], min_sessions: int = 2, top_n: int = 5) -> list[dict]:
    """Score tags by give-up rate, relative slowness, debugging share, and run count.

    Each component is normalized to 0..1; the returned breakdown lets an LLM
    explain *why* a tag scored high instead of just trusting the number.
    """
    if not records:
        return []
    global_median = median(r["total_active_sec"] for r in records) or 1
    global_runs = mean(r["run_count"] for r in records) or 1
    scored = []
    for tag, st in by_tag(records).items():
        if st["session_count"] < min_sessions:
            continue
        slowness = min(st["avg_total_sec"] / global_median, 2) / 2
        debug_share = st["avg_phase_sec"]["debugging"] / max(st["avg_total_sec"], 1)
        run_factor = min(st["avg_run_count"] / global_runs, 2) / 2
        score = (
            0.4 * st["give_up_rate"] + 0.3 * slowness + 0.2 * debug_share + 0.1 * run_factor
        )
        scored.append(
            {
                "tag": tag,
                "score": round(score, 3),
                "give_up_rate": st["give_up_rate"],
                "avg_total_sec": st["avg_total_sec"],
                "global_median_sec": round(global_median),
                "debugging_share": round(debug_share, 3),
                "avg_run_count": st["avg_run_count"],
                "session_count": st["session_count"],
                "problem_count": st["problem_count"],
                "last_seen": st["last_seen"],
            }
        )
    scored.sort(key=lambda s: s["score"], reverse=True)
    return scored[:top_n]


def problem_summaries(records: list[dict]) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        groups[rec["problem"]["dir_key"]].append(rec)
    out = []
    for dir_key, rs in sorted(groups.items()):
        prob = rs[0]["problem"]
        accepted = [r for r in rs if r["outcome"] == "accepted"]
        tags = sorted({t for r in rs for t in r.get("tags", [])})
        out.append(
            {
                "dir_key": dir_key,
                "slug": prob["slug"],
                "title": prob["title"],
                "difficulty": prob["difficulty"],
                "attempts": len(rs),
                "solved": bool(accepted),
                "gave_up_count": sum(r["outcome"] == "gave_up" for r in rs),
                "first_session_at": rs[0]["started_at"],
                "last_session_at": rs[-1]["started_at"],
                "best_total_sec": min((r["total_active_sec"] for r in accepted), default=None),
                "tags": tags,
            }
        )
    return out


def daily_activity(records: list[dict]) -> dict[str, dict]:
    days: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        days[_date(rec)].append(rec)
    return {
        day: {
            "sessions": len(rs),
            "accepted": sum(r["outcome"] == "accepted" for r in rs),
            "active_sec": sum(r["total_active_sec"] for r in rs),
        }
        for day, rs in sorted(days.items())
    }
