"""Load session data from a local clone (default) or from GitHub.

Modes (constructor argument, else env var LCP_SOURCE):
  local  - read data/ from LCP_REPO_PATH, else the current working directory
  github - fetch from GitHub, no clone needed (LCP_GITHUB_REPO=owner/repo,
           LCP_GITHUB_BRANCH=main). Set LCP_GITHUB_TOKEN for private repos:
           file contents are then fetched through the authenticated Contents
           API instead of raw.githubusercontent.com.

Remote mode reads the whole session set from the data repo's generated
data/index.json in one request. Walking the git tree and fetching every
session file is kept only as an opt-in fallback for repos indexed by a
toolchain that predates the `records` key: it costs one API call per session
and is rate-limited when unauthenticated, so a shared server never uses it.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

import httpx

CACHE_TTL_SEC = 300
SOLUTION_SUFFIXES = ("py", "java", "cpp", "js", "ts", "go")

log = logging.getLogger(__name__)


def repo_root() -> Path:
    if env := os.environ.get("LCP_REPO_PATH"):
        return Path(env).expanduser()
    return Path.cwd()


class DataStore:
    def __init__(
        self,
        root: Path | str | None = None,
        *,
        mode: str | None = None,
        repo: str | None = None,
        branch: str | None = None,
        token: str | None = None,
        client: httpx.Client | None = None,
        allow_tree_walk: bool = True,
    ) -> None:
        self.mode = mode or os.environ.get("LCP_SOURCE", "local")
        self.root = Path(root).expanduser().resolve() if root else repo_root()
        self.repo = repo or os.environ.get("LCP_GITHUB_REPO")
        self.branch = branch or os.environ.get("LCP_GITHUB_BRANCH", "main")
        self.token = token if token is not None else os.environ.get("LCP_GITHUB_TOKEN")
        self.allow_tree_walk = allow_tree_walk
        self._client = client
        if self.mode == "github" and not self.repo:
            raise RuntimeError(
                "LCP_SOURCE=github requires LCP_GITHUB_REPO=<owner>/<data-repo>"
            )
        self._cache: dict[str, tuple[float, object]] = {}

    @property
    def client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=30)
        return self._client

    def _api_headers(self) -> dict[str, str]:
        headers = {"X-GitHub-Api-Version": "2022-11-28"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    # -- caching -------------------------------------------------------
    def _cached(self, key: str, loader):
        hit = self._cache.get(key)
        if hit and time.time() - hit[0] < CACHE_TTL_SEC:
            return hit[1]
        value = loader()
        self._cache[key] = (time.time(), value)
        return value

    # -- public API ----------------------------------------------------
    def load_sessions(self) -> list[dict]:
        """All session records, sorted by started_at, with attempt_number added."""
        return self._cached("sessions", self._load_sessions)

    def load_solution(self, dir_key: str) -> str | None:
        """Solution source for a problem (LeetHub layout: <dir_key>/<dir_key>.py)."""
        if self.mode == "github":
            for ext in SOLUTION_SUFFIXES:
                text = self._fetch_raw(f"{dir_key}/{dir_key}.{ext}")
                if text is not None:
                    return text
            return None
        folder = self.root / dir_key
        if folder.is_dir():
            for f in sorted(folder.iterdir()):
                if f.suffix.lstrip(".") in SOLUTION_SUFFIXES:
                    return f.read_text()
        return None

    def load_index_raw(self) -> str:
        """The raw data/index.json text (for the MCP resource); "{}" when absent."""
        if self.mode == "github":
            return self._cached("index_raw", lambda: self._fetch_raw("data/index.json")) or "{}"
        path = self.root / "data" / "index.json"
        return path.read_text() if path.exists() else "{}"

    # -- loading -------------------------------------------------------
    def _load_sessions(self) -> list[dict]:
        if self.mode == "github":
            records = self._load_sessions_github()
        else:
            sessions_dir = self.root / "data" / "sessions"
            if not sessions_dir.is_dir():
                raise RuntimeError(
                    f"no data/sessions under {self.root} — run the server from a clone of "
                    "your LeetLens data repo, or point LCP_REPO_PATH at one"
                )
            records = [
                json.loads(f.read_text())
                for f in sorted(sessions_dir.glob("*/*.json"))
            ]
        records.sort(key=lambda r: r["started_at"])
        by_problem: dict[str, int] = {}
        for rec in records:
            key = rec["problem"]["dir_key"]
            by_problem[key] = by_problem.get(key, 0) + 1
            rec["attempt_number"] = by_problem[key]
        return records

    def _load_sessions_github(self) -> list[dict]:
        index_text = self.load_index_raw()
        records = json.loads(index_text).get("records")
        if records is not None:
            return records
        if not self.allow_tree_walk:
            raise RuntimeError(
                f"{self.repo} has no data/index.json with session records — run "
                "'Set up repo' in the extension, push once, and make sure the "
                "workflow's LEETLENS_REF is v1 or later"
            )
        log.warning(
            "%s: index.json has no records (built by an older toolchain); "
            "fetching every session file instead",
            self.repo,
        )
        tree_url = f"https://api.github.com/repos/{self.repo}/git/trees/{self.branch}?recursive=1"
        tree = self.client.get(tree_url, headers=self._api_headers()).raise_for_status().json()
        paths = [
            node["path"]
            for node in tree["tree"]
            if node["path"].startswith("data/sessions/") and node["path"].endswith(".json")
        ]
        out = []
        for path in paths:
            text = self._fetch_raw(path)
            if text is None:
                raise RuntimeError(f"{self.repo}: could not fetch {path} on {self.branch}")
            out.append(json.loads(text))
        return out

    def _fetch_raw(self, path: str) -> str | None:
        """File contents at `path` on the configured branch, or None if absent.

        With a token, goes through the Contents API (works for private repos);
        without one, raw.githubusercontent.com (public repos only).
        """
        if self.token:
            resp = self.client.get(
                f"https://api.github.com/repos/{self.repo}/contents/{path}",
                params={"ref": self.branch},
                headers={**self._api_headers(), "Accept": "application/vnd.github.raw+json"},
            )
        else:
            resp = self.client.get(
                f"https://raw.githubusercontent.com/{self.repo}/{self.branch}/{path}"
            )
        return resp.text if resp.status_code == 200 else None
