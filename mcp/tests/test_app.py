"""The hosted entrypoint: one process, a repo per URL, nothing shared between them."""

import json
import threading
import time

import httpx
import pytest
import uvicorn
from fastmcp import Client
from fastmcp.exceptions import ToolError

from leetlens_mcp import server
from leetlens_mcp.indexer import build_index
from leetlens_mcp.store import DataStore

from test_store import FakeGitHub


@pytest.fixture(scope="module")
def hosted():
    import app as hosted_app

    config = uvicorn.Config(hosted_app.app, host="127.0.0.1", port=8790, log_level="error")
    srv = uvicorn.Server(config)
    threading.Thread(target=srv.run, daemon=True).start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.05)
    yield "http://127.0.0.1:8790"
    srv.should_exit = True


@pytest.fixture
def two_repos(data_repo, monkeypatch):
    """o/full has an index with records; o/old has a pre-records index; o/none has nothing."""
    files = {str(p.relative_to(data_repo)): p.read_text() for p in data_repo.rglob("*") if p.is_file()}
    hubs = {
        "o/full": FakeGitHub({**files, "data/index.json": json.dumps(build_index(data_repo))}),
        "o/old": FakeGitHub({**files, "data/index.json": json.dumps({"schema_version": 1})}),
        "o/none": FakeGitHub({}),
    }

    def factory(owner, repo):
        gh = hubs.setdefault(f"{owner}/{repo}", FakeGitHub({}))
        return DataStore(
            mode="github", repo=f"{owner}/{repo}", allow_tree_walk=False,
            client=httpx.Client(transport=httpx.MockTransport(gh.handler)),
        )

    monkeypatch.setattr(server, "make_remote_store", factory)
    server._remote_stores.clear()
    return hubs


def call(url, name, args=None, **kwargs):
    import asyncio

    async def go():
        async with Client(url) as c:
            return await c.call_tool(name, args or {}, **kwargs)

    return asyncio.run(go())


def test_root_explains_how_to_connect(hosted):
    body = httpx.get(hosted + "/").text
    assert "/<owner>/<repo>/mcp" in body or "/<github owner>/<data repo>/mcp" in body


def test_each_url_serves_its_own_repo(hosted, two_repos, records):
    full = call(hosted + "/o/full/mcp", "list_tags")
    assert [t["label"] for t in full.structured_content["result"]] == sorted({t for r in records for t in r["tags"]})
    assert two_repos["o/full"].requests == ["https://raw.githubusercontent.com/o/full/main/data/index.json"]

    # Each failure says which one it is, so the user knows what to do next.
    with pytest.raises(ToolError, match="predates session records"):
        call(hosted + "/o/old/mcp", "list_tags")
    with pytest.raises(ToolError, match="has no data/index.json"):
        call(hosted + "/o/none/mcp", "list_tags")
    # No tree walk was attempted for either.
    assert all("/git/trees/" not in u for hub in two_repos.values() for u in hub.requests)


def test_solution_source_is_fetched_per_repo(hosted, two_repos):
    doc = call(hosted + "/o/full/mcp", "fetch", {"id": "0322-coin-change"}).structured_content
    assert "def coinChange" in doc["text"]


def test_bad_repo_names_are_rejected_before_any_request(hosted, two_repos):
    # Starlette already refuses encoded slashes; this guards the characters it lets through.
    with pytest.raises(ToolError, match="not a GitHub owner/repo"):
        call(hosted + "/o/evil%24repo/mcp", "list_tags")
    assert all(not hub.requests for hub in two_repos.values())


def test_a_rate_limited_repo_is_not_reported_as_an_empty_one(hosted, two_repos):
    """A 403 must not be cached as "no index": the next call has to try again."""
    import httpx as _httpx

    gh = two_repos["o/none"]
    gh.handler = lambda request: _httpx.Response(403, text="rate limit exceeded")
    with pytest.raises(ToolError, match="403"):
        call(hosted + "/o/none/mcp", "list_tags")
    with pytest.raises(ToolError, match="403"):
        call(hosted + "/o/none/mcp", "list_tags")


def test_store_cache_is_bounded_and_evicted_stores_are_closed(hosted, two_repos, monkeypatch):
    monkeypatch.setattr(server, "REMOTE_STORE_LIMIT", 2)
    closed = []
    monkeypatch.setattr(DataStore, "close", lambda self: closed.append(self.repo))
    for repo in ("a", "b", "c"):
        with pytest.raises(ToolError):
            call(hosted + f"/o/{repo}/mcp", "list_tags")
    assert list(server._remote_stores) == ["o/b", "o/c"]
    assert closed == ["o/a"]
    call(hosted + "/o/full/mcp", "list_tags")  # o/full is fine, but "o/b" gets evicted for it
    assert closed == ["o/a", "o/b"]


def test_dot_segments_are_not_repo_names():
    # HTTP clients normalise "." and ".." away before the request leaves, so the
    # guard is only reachable directly; it must still say no.
    for bad in ("..", ".", "", "a/b", "x" * 101):
        assert server.REPO_SEGMENT.match(bad) is None, bad
    for good in ("g7xu", "leetcode-journal", "my.repo_1"):
        assert server.REPO_SEGMENT.match(good), good
