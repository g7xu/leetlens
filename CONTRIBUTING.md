# Contributing

Small repo, no build step anywhere: the extension is plain MV3 JavaScript, the MCP server is a small [uv](https://docs.astral.sh/uv/) project, the dashboard is a static page. Read [ARCHITECTURE.md](ARCHITECTURE.md) first — the extension's file split is forced by Chrome's world boundaries, and a few invariants are load-bearing.

## Working on the extension

`chrome://extensions` → Developer mode → **Load unpacked** → the `extension/` folder. Chrome runs whatever is in your working directory, so **reload the extension after switching branches** or your test session runs stale code.

You'll need a data repo to commit into — any scratch public repo works. Follow the README's token steps (Contents + Workflows, both Read and write).

## Tests

```bash
node --test 'test/*.test.mjs'
```

The quotes matter — a bare `test/` is resolved as a module path and fails.

No dependencies; `extension/package.json` exists only so Node can import the ESM source. The thinking-area tests pin the contract between the block that `main-world.js` writes and what `extractThinkingArea` parses back — those two files each carry a copy of `THINK_HEADER_RE` (a MAIN-world script cannot import), so **any change to the block format must update both files and the test fixtures together**.

CI runs the tests on every PR, plus two checks that have no other tripwire: the data-repo workflow embedded as a template string in `repo-setup.js` must still be valid YAML, and the Python sources must still compile.

## Working on the MCP server

```bash
LCP_REPO_PATH=/path/to/a/data-repo-clone uv run --directory mcp leetlens-mcp
```

Env vars: `LCP_REPO_PATH` (local mode root), or `LCP_SOURCE=github` with `LCP_GITHUB_REPO=<owner>/<repo>`, `LCP_GITHUB_BRANCH` (default `main`), and `LCP_GITHUB_TOKEN` for private repos. The server fails fast at startup when github mode has no repo configured.

## Conventions

- One branch + PR per issue, branched from up-to-date `main`.
- Match the surrounding code: no frameworks, no build tooling, comments explain *why* not *what*.
- `data/schema/session.schema.json` uses `additionalProperties: false` throughout — adding a session field means changing the schema, and that is a **breaking** change (see the tag policy below).

## Sharp edges

Hard-won; check here before debugging from scratch.

- Monaco models on leetcode.com report **LeetCode's own language slugs** (`python3`, `golang`, `oraclesql`, `pythondata` for Pandas), not Monaco's standard ids.
- Writing anything under `.github/workflows/` via the API is denied as **404, not 403**, when the token lacks the Workflows permission. A "repo not found" during repo setup usually means a missing permission, not a missing repo.
- A Contents API PUT **ignores the supplied `sha` when the path doesn't exist** and creates the file (201) — there is no safe dry-run write, which is why Test connection reports what it *cannot* verify instead of probing.
- The Contents API accepts an explicit `branch` on a repo with no commits and creates it. Empty data repos need no special handling.
- The extension pushes **two commits per save**, so the data-repo workflow must tolerate `main` moving mid-run. `data/index.json` is generated: recover by rebuilding on top of what landed, never `git pull --rebase` (it conflicts with itself every time).
- The thinking area must be a **block comment**; never let the header pattern match `/**` (it would swallow LeetCode's ListNode template docblock). See ARCHITECTURE.md.

## Maintainer notes

**Releases.** Tag `vX.Y.Z` on main, create a GitHub release, then move the major tag: `git tag -f v1 vX.Y.Z && git push -f origin v1`. Data repos consume `v1` via `LEETLENS_REF`; breaking changes get a new major tag instead of moving `v1`. Remember the workflow file itself is copied into data repos at setup — tag moves don't update it.

**Pages deploys.** Retry a failed deploy with a fresh `workflow_dispatch` run — never `gh run rerun`, which duplicates the `github-pages` artifact and the deploy step rejects it.
