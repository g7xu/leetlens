import json

from leetlens_mcp.indexer import build_index
from leetlens_mcp.store import DataStore


def test_index_carries_full_records(data_repo, records):
    index = build_index(data_repo)
    assert set(index) == {
        "schema_version", "generated_at", "totals", "problems", "sessions", "tags", "daily", "records",
    }
    assert index["records"] == records  # same order, attempt_number included
    assert index["totals"]["sessions"] == len(records)
    # The dashboard's rows and the full records agree on identity and order.
    assert [s["session_id"] for s in index["sessions"]] == [r["session_id"] for r in index["records"]]
    assert all("phases" in r and "logic_idea" in r for r in index["records"])


def test_index_round_trips_through_a_remote_store(data_repo, records):
    index_json = json.dumps(build_index(data_repo))
    store = DataStore(mode="github", repo="o/r")
    store._cache["index_raw"] = (float("inf"), index_json)  # pretend it was fetched
    assert store.load_sessions() == records
