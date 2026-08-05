"""Load session data from a local clone (default) or from GitHub raw files.

Modes (env var LCP_SOURCE):
  local  - read data/ from the repo clone this package lives in (or LCP_REPO_PATH)
  github - fetch from raw.githubusercontent.com, no clone needed
           (LCP_GITHUB_REPO=owner/repo, LCP_GITHUB_BRANCH=main)
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import httpx

CACHE_TTL_SEC = 300


def repo_root() -> Path:
    if env := os.environ.get("LCP_REPO_PATH"):
        return Path(env).expanduser()
    # .../repo/mcp/src/leetlens_mcp/store.py -> repo
    return Path(__file__).resolve().parents[3]


class DataStore:
    def __init__(self) -> None:
        self.mode = os.environ.get("LCP_SOURCE", "local")
        self.repo = os.environ.get("LCP_GITHUB_REPO", "g7xu/leetlens")
        self.branch = os.environ.get("LCP_GITHUB_BRANCH", "main")
        self._cache: dict[str, tuple[float, object]] = {}

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
            for ext in ("py", "java", "cpp", "js", "ts", "go"):
                text = self._fetch_raw(f"{dir_key}/{dir_key}.{ext}")
                if text is not None:
                    return text
            return None
        folder = repo_root() / dir_key
        if folder.is_dir():
            for f in sorted(folder.iterdir()):
                if f.suffix in {".py", ".java", ".cpp", ".js", ".ts", ".go"}:
                    return f.read_text()
        return None

    # -- local mode ----------------------------------------------------
    def _load_sessions(self) -> list[dict]:
        if self.mode == "github":
            records = self._load_sessions_github()
        else:
            records = [
                json.loads(f.read_text())
                for f in sorted((repo_root() / "data" / "sessions").glob("*/*.json"))
            ]
        records.sort(key=lambda r: r["started_at"])
        by_problem: dict[str, int] = {}
        for rec in records:
            key = rec["problem"]["dir_key"]
            by_problem[key] = by_problem.get(key, 0) + 1
            rec["attempt_number"] = by_problem[key]
        return records

    # -- github mode ---------------------------------------------------
    def _load_sessions_github(self) -> list[dict]:
        tree_url = f"https://api.github.com/repos/{self.repo}/git/trees/{self.branch}?recursive=1"
        with httpx.Client(timeout=30) as client:
            tree = client.get(tree_url).raise_for_status().json()
            paths = [
                node["path"]
                for node in tree["tree"]
                if node["path"].startswith("data/sessions/") and node["path"].endswith(".json")
            ]
            return [
                client.get(self._raw_url(p)).raise_for_status().json() for p in paths
            ]

    def _raw_url(self, path: str) -> str:
        return f"https://raw.githubusercontent.com/{self.repo}/{self.branch}/{path}"

    def _fetch_raw(self, path: str) -> str | None:
        resp = httpx.get(self._raw_url(path), timeout=30)
        return resp.text if resp.status_code == 200 else None
