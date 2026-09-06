import json

import httpx
import pytest

from leetlens_mcp.indexer import build_index
from leetlens_mcp.store import DataStore, repo_root


class FakeGitHub:
    """Serves a data repo over raw.githubusercontent.com, the trees API, and the Contents API."""

    def __init__(self, files: dict[str, str]):
        self.files = files
        self.missing: set[str] = set()  # listed in the tree, 404 on fetch
        self.requests: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(str(request.url))
        host, path = request.url.host, request.url.path
        if host == "raw.githubusercontent.com":
            _, _owner, _repo, _branch, *rest = path.split("/")
            return self._file("/".join(rest))
        if host == "api.github.com" and "/git/trees/" in path:
            tree = [{"path": p, "type": "blob"} for p in self.files]
            return httpx.Response(200, json={"tree": tree})
        if host == "api.github.com" and "/contents/" in path:
            return self._file(path.split("/contents/", 1)[1])
        return httpx.Response(404)

    def _file(self, path: str) -> httpx.Response:
        if path in self.files and path not in self.missing:
            return httpx.Response(200, text=self.files[path])
        return httpx.Response(404, text="not found")


@pytest.fixture
def remote(data_repo):
    files = {
        str(p.relative_to(data_repo)): p.read_text() for p in data_repo.rglob("*") if p.is_file()
    }
    return FakeGitHub(files), data_repo


def make_store(gh: FakeGitHub, **kwargs) -> DataStore:
    return DataStore(
        mode="github", repo="o/r", client=httpx.Client(transport=httpx.MockTransport(gh.handler)), **kwargs
    )


def test_remote_store_needs_one_request_when_the_index_has_records(remote, records):
    gh, data_repo = remote
    gh.files["data/index.json"] = json.dumps(build_index(data_repo))
    store = make_store(gh, allow_tree_walk=False)
    assert store.load_sessions() == records
    assert gh.requests == ["https://raw.githubusercontent.com/o/r/main/data/index.json"]
    store.load_index_raw()  # served from the same cached fetch
    assert len(gh.requests) == 1


def test_remote_store_uses_the_contents_api_with_a_token(remote, records):
    gh, data_repo = remote
    gh.files["data/index.json"] = json.dumps(build_index(data_repo))
    store = make_store(gh, token="t", allow_tree_walk=False)
    assert store.load_sessions() == records
    assert gh.requests == ["https://api.github.com/repos/o/r/contents/data/index.json?ref=main"]


def test_remote_store_falls_back_to_the_tree_walk_for_old_indexes(remote, records, caplog):
    gh, _ = remote
    gh.files["data/index.json"] = json.dumps({"schema_version": 1, "sessions": []})
    store = make_store(gh)  # allow_tree_walk defaults on for local/CLI use
    assert store.load_sessions() == records
    assert "/git/trees/main" in gh.requests[1]
    assert len(gh.requests) == 2 + len(records)
    assert "older toolchain" in caplog.text


def test_remote_store_refuses_the_tree_walk_when_told_to(remote):
    gh, _ = remote
    gh.files.pop("data/index.json", None)
    store = make_store(gh, allow_tree_walk=False)
    with pytest.raises(RuntimeError, match="Set up repo"):
        store.load_sessions()
    assert len(gh.requests) == 1


def test_remote_store_reports_a_missing_session_file(remote):
    gh, _ = remote
    gh.files["data/index.json"] = "{}"
    victim = next(p for p in gh.files if p.startswith("data/sessions/"))
    gh.missing.add(victim)
    with pytest.raises(RuntimeError, match=victim):
        make_store(gh).load_sessions()


def test_local_store_reads_sessions_and_solutions(data_repo, records):
    store = DataStore(data_repo)
    assert store.load_sessions() == records
    assert store.load_solution("0322-coin-change") == "def coinChange(): ...\n"
    assert store.load_solution("0001-two-sum") is None


def test_the_attempts_folder_does_not_hide_the_canonical_solution(data_repo):
    attempts = data_repo / "0322-coin-change" / "attempts"
    attempts.mkdir()
    (attempts / "2026-08-15T10-00-00Z_aaaaaaa4.py").write_text("first try\n")
    store = DataStore(data_repo)
    # "attempts" sorts before the canonical file, but it is a directory.
    assert store.load_solution("0322-coin-change") == "def coinChange(): ...\n"
    assert store.load_solution(
        "0322-coin-change", path="0322-coin-change/attempts/2026-08-15T10-00-00Z_aaaaaaa4.py"
    ) == "first try\n"
    assert store.load_solution("0322-coin-change", path="0322-coin-change/attempts/nope.py") is None


def test_remote_store_reads_one_attempt_by_path(remote):
    gh, _ = remote
    gh.files["0322-coin-change/attempts/x.py"] = "first try\n"
    store = make_store(gh, allow_tree_walk=False)
    assert store.load_solution("0322-coin-change", path="0322-coin-change/attempts/x.py") == "first try\n"
    store.load_solution("0322-coin-change", path="0322-coin-change/attempts/x.py")
    assert len(gh.requests) == 1, "a re-read comes from the cache"


def test_repo_root_defaults_to_cwd(monkeypatch, tmp_path):
    monkeypatch.delenv("LCP_REPO_PATH", raising=False)
    monkeypatch.chdir(tmp_path)
    assert repo_root() == tmp_path
    monkeypatch.setenv("LCP_REPO_PATH", "~/elsewhere")
    assert repo_root().is_absolute()


def test_local_store_error_names_both_ways_to_point_at_a_repo(tmp_path):
    with pytest.raises(RuntimeError, match="LCP_REPO_PATH"):
        DataStore(tmp_path).load_sessions()
