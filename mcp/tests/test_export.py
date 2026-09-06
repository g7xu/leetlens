import json

from leetlens_mcp import stats


def keys(rows):
    return [r["session_id"] for r in rows]


def test_filter_by_date_is_inclusive(records):
    rows = stats.filter_records(records, date_from="2026-08-03", date_to="2026-08-15")
    assert keys(rows) == ["aaaaaaa2", "aaaaaaa3", "aaaaaaa4"]


def test_filter_by_tag(records):
    assert keys(stats.filter_records(records, tag="dp")) == ["aaaaaaa4", "aaaaaaa5"]
    assert stats.filter_records(records, tag="nope") == []


def test_filter_combines_bounds_and_tag(records):
    rows = stats.filter_records(records, date_from="2026-08-16", tag="dp")
    assert keys(rows) == ["aaaaaaa5"]


def test_no_filters_returns_everything_untouched(records):
    assert stats.filter_records(records) == records


def test_export_tool_emits_full_records_newest_first(records, monkeypatch):
    from leetlens_mcp import server

    monkeypatch.setattr(server.store, "load_sessions", lambda: records)

    lines = server.export_sessions().splitlines()
    assert len(lines) == len(records)
    parsed = [json.loads(line) for line in lines]
    assert keys(parsed) == ["aaaaaaa6", "aaaaaaa5", "aaaaaaa4", "aaaaaaa3", "aaaaaaa2", "aaaaaaa1"]
    # Full records, not summaries: phases and attempt numbering survive.
    assert parsed[0]["phases"][0]["phase"] == "thinking"
    assert [p["attempt_number"] for p in parsed[:2]] == [1, 2]

    as_json = json.loads(server.export_sessions(tag="dp", format="json"))
    assert keys(as_json) == ["aaaaaaa5", "aaaaaaa4"]
