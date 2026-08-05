"""Aggregations over session records. Shared by the MCP server and the indexer."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
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


def revenge_list(records: list[dict]) -> list[dict]:
    """Problems with a gave_up session and no accepted session after it."""
    groups: dict[str, list[dict]] = defaultdict(list)
    for rec in records:  # records arrive sorted by started_at
        groups[rec["problem"]["dir_key"]].append(rec)
    out = []
    for dir_key, rs in groups.items():
        last_accepted = max((r["started_at"] for r in rs if r["outcome"] == "accepted"), default=None)
        last_gave_up = max((r["started_at"] for r in rs if r["outcome"] == "gave_up"), default=None)
        if last_gave_up and (last_accepted is None or last_accepted < last_gave_up):
            prob = rs[0]["problem"]
            out.append(
                {
                    "dir_key": dir_key,
                    "slug": prob["slug"],
                    "title": prob["title"],
                    "difficulty": prob["difficulty"],
                    "url": prob["url"],
                    "attempts": len(rs),
                    "gave_up_count": sum(r["outcome"] == "gave_up" for r in rs),
                    "last_tried": _date(rs[-1]),
                    "tags": sorted({t for r in rs for t in r.get("tags", [])}),
                }
            )
    out.sort(key=lambda r: r["last_tried"], reverse=True)
    return out


def stale_tags(records: list[dict], days: int = 30, today: date | None = None) -> list[dict]:
    """Tags not practiced in `days` days — the spaced-repetition signal."""
    today = today or date.today()
    cutoff = (today - timedelta(days=days)).isoformat()
    out = [
        {
            "tag": tag,
            "last_seen": st["last_seen"],
            "days_since": (today - date.fromisoformat(st["last_seen"])).days,
            "session_count": st["session_count"],
            "give_up_rate": st["give_up_rate"],
        }
        for tag, st in by_tag(records).items()
        if st["last_seen"] < cutoff
    ]
    out.sort(key=lambda r: r["last_seen"])
    return out


def search_notes(records: list[dict], query: str, limit: int = 20) -> list[dict]:
    """Case-insensitive substring search over logic_idea and comments, newest first."""
    q = query.lower()
    out = []
    for rec in reversed(records):
        matched = {
            field: text
            for field in ("logic_idea", "comments")
            if q in (text := rec.get(field, "")).lower()
        }
        if matched:
            out.append({**session_summary(rec), "matched": matched})
            if len(out) >= limit:
                break
    return out


def _period_bounds(spec: str, today: date) -> tuple[str, str]:
    """Resolve a period spec to inclusive [from, to] ISO dates."""
    if spec == "this_month":
        return today.replace(day=1).isoformat(), today.isoformat()
    if spec == "last_month":
        last_prev = today.replace(day=1) - timedelta(days=1)
        return last_prev.replace(day=1).isoformat(), last_prev.isoformat()
    if spec == "last_30d":
        return (today - timedelta(days=29)).isoformat(), today.isoformat()
    if spec == "prev_30d":
        return (today - timedelta(days=59)).isoformat(), (today - timedelta(days=30)).isoformat()
    if len(spec) == 7 and spec[4] == "-":  # YYYY-MM
        year, month = int(spec[:4]), int(spec[5:7])
        next_first = date(year + (month == 12), month % 12 + 1, 1)
        return f"{spec}-01", (next_first - timedelta(days=1)).isoformat()
    raise ValueError(
        f"unknown period {spec!r} — use this_month, last_month, last_30d, prev_30d, or YYYY-MM"
    )


def compare_periods(
    records: list[dict], period_a: str, period_b: str, today: date | None = None
) -> dict:
    """Side-by-side stats for two periods plus deltas (a minus b)."""
    today = today or date.today()

    def period(spec: str) -> dict:
        lo, hi = _period_bounds(spec, today)
        rs = [r for r in records if lo <= _date(r) <= hi]
        st = _group_stats(rs) if rs else {"session_count": 0}
        if rs:
            shares = [
                r["phase_totals_sec"]["debugging"] / r["total_active_sec"]
                for r in rs
                if r["total_active_sec"]
            ]
            st["debugging_share"] = round(mean(shares), 3) if shares else 0
        return {"spec": spec, "from": lo, "to": hi, **st}

    a, b = period(period_a), period(period_b)
    deltas = {
        key: round(a[key] - b[key], 3)
        for key in (
            "session_count", "give_up_rate", "avg_total_sec",
            "median_total_sec", "avg_run_count", "debugging_share",
        )
        if key in a and key in b
    }
    return {"period_a": a, "period_b": b, "delta_a_minus_b": deltas}


def recommend_next(records: list[dict], count: int = 3, today: date | None = None) -> list[dict]:
    """Concrete "solve this next" suggestions: revenge problems, weak tags, stale tags."""
    revenge = [
        {
            "type": "revenge",
            "action": f"Re-attempt {r['title']} ({r['difficulty']})",
            "target": r["url"],
            "reason": (
                f"Gave up {r['gave_up_count']}x (last tried {r['last_tried']}) "
                "with no accepted attempt since."
            ),
        }
        for r in revenge_list(records)
    ]
    weak = [
        {
            "type": "weak_tag",
            "action": f"Practice a fresh {w['tag']} problem",
            "target": w["tag"],
            "reason": (
                f"Weak area (score {w['score']}): {round(w['give_up_rate'] * 100)}% give-ups, "
                f"{w['avg_total_sec']}s avg vs {w['global_median_sec']}s global median, "
                f"{round(w['debugging_share'] * 100)}% of time debugging."
            ),
        }
        for w in weak_areas(records, top_n=count)
    ]
    stale = [
        {
            "type": "stale_tag",
            "action": f"Refresh {s['tag']}",
            "target": s["tag"],
            "reason": f"Not practiced in {s['days_since']} days ({s['session_count']} past sessions).",
        }
        for s in stale_tags(records, today=today)
    ]
    # Round-robin the three sources so one long list can't crowd out the others.
    suggestions: list[dict] = []
    seen_targets: set[str] = set()
    pools = [revenge, weak, stale]
    while len(suggestions) < count and any(pools):
        for pool in pools:
            while pool:
                item = pool.pop(0)
                if item["target"] not in seen_targets:
                    seen_targets.add(item["target"])
                    suggestions.append(item)
                    break
            if len(suggestions) >= count:
                break
    return suggestions


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
