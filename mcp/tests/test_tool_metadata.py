"""Every tool must be fully described and its output must validate.

A tool with an undocumented parameter or no output schema is a regression in
what the model can see, even when the tool itself still works.
"""

import asyncio

import pytest

from leetlens_mcp import server
from leetlens_mcp.server import mcp
from mcp.server.mcpserver.exceptions import ToolError

# Arguments that exercise every tool against the fixture records; tools
# absent here are called with no arguments.
SAMPLE_ARGS = {
    "get_problem_details": [{"slug_or_id": "two-sum"}, {"slug_or_id": "322"}],
    "search": [{"query": "coin"}],
    "fetch": [{"id": "0322-coin-change"}, {"id": "tag:dp"}],
    "get_trends": [{"metric": "debugging_share"}, {"metric": "give_up_rate", "window": "month"}],
    "search_notes": [{"query": "window"}],
    "compare_periods": [{"period_a": "2026-08", "period_b": "2026-09"}],
    "export_sessions": [{}, {"tag": "dp", "format": "json"}],
}


def tools():
    return asyncio.run(mcp.list_tools())


def test_every_tool_is_read_only_and_titled():
    for t in tools():
        assert t.title, t.name
        assert t.description and len(t.description) > 60, t.name
        assert not any(line.startswith(" ") for line in t.description.splitlines()), t.name
        a = t.annotations
        assert a is not None, t.name
        assert (a.read_only_hint, a.destructive_hint, a.idempotent_hint, a.open_world_hint) == (
            True, False, True, False), t.name


def test_every_parameter_has_a_description():
    for t in tools():
        for name, prop in t.input_schema["properties"].items():
            assert prop.get("description"), f"{t.name}.{name}"


def test_every_tool_advertises_an_output_schema():
    for t in tools():
        assert t.output_schema is not None, t.name


@pytest.fixture
def served(records, monkeypatch):
    monkeypatch.setattr(server.store, "load_sessions", lambda: records)
    monkeypatch.setattr(server.store, "load_solution", lambda dir_key: f"# solution for {dir_key}\n")


def test_every_tool_output_validates(served):
    for t in tools():
        for args in SAMPLE_ARGS.get(t.name, [{}]):
            result = asyncio.run(mcp.call_tool(t.name, args))
            assert not result.is_error, (t.name, args)
            assert result.structured_content is not None, (t.name, args)


def test_missing_problem_is_a_tool_error(served):
    with pytest.raises(ToolError):
        asyncio.run(mcp.call_tool("get_problem_details", {"slug_or_id": "nope"}))
    with pytest.raises(ToolError):
        asyncio.run(mcp.call_tool("fetch", {"id": "tag:nope"}))
    with pytest.raises(ToolError):
        asyncio.run(mcp.call_tool("compare_periods", {"period_a": "yesterday"}))


def test_compare_periods_keeps_the_from_key(served):
    result = asyncio.run(mcp.call_tool("compare_periods", {"period_a": "2026-08", "period_b": "2026-09"}))
    assert result.structured_content["period_a"]["from"] == "2026-08-01"
    assert result.structured_content["period_b"]["session_count"] == 1
