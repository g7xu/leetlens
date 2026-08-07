"""Build data/index.json — the aggregate the dashboard and quick tools consume.

Run from CI or locally:  python -m leetlens_mcp.indexer [repo_root]
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import stats
from .store import DataStore, repo_root


def build_index(root: Path) -> dict:
    store = DataStore(root)
    records = store.load_sessions()
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "totals": {
            "problems": len({r["problem"]["dir_key"] for r in records}),
            "sessions": len(records),
            "accepted": sum(r["outcome"] == "accepted" for r in records),
            "gave_up": sum(r["outcome"] == "gave_up" for r in records),
            "abandoned": sum(r["outcome"] == "abandoned" for r in records),
        },
        "problems": stats.problem_summaries(records),
        "sessions": [stats.session_summary(r) for r in records],
        "tags": stats.by_tag(records),
        "daily": stats.daily_activity(records),
    }


def main() -> None:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else repo_root()
    index = build_index(root)
    out = root / "data" / "index.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(index, indent=1) + "\n")
    print(
        f"wrote {out} — {index['totals']['sessions']} sessions, "
        f"{index['totals']['problems']} problems, {len(index['tags'])} tags"
    )


if __name__ == "__main__":
    main()
