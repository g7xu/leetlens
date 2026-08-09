# Contributing

Small repo: the extension is plain MV3 JavaScript bundled with [esbuild](https://esbuild.github.io/), the MCP server is a small [uv](https://docs.astral.sh/uv/) project, the dashboard is a static page. Read [ARCHITECTURE.md](ARCHITECTURE.md) first — the extension's file split is forced by Chrome's world boundaries, and a few invariants are load-bearing.

## Working on the extension

```bash
npm install
npm run watch     # rebuilds dist/ on every save
```

Then `chrome://extensions` → Developer mode → **Load unpacked** → the generated **`dist/`** folder, not `extension/`.

`dist/` is build output: gitignored, and never edited by hand. Chrome does not re-read it on its own, so after a rebuild (or a branch switch) **hit reload on the extension card** or you're testing stale code. If Chrome reports a missing manifest, you probably loaded `extension/` — that folder holds sources now.

You'll need a data repo to commit into — any scratch public repo works. Follow the README's token steps (Contents + Workflows, both Read and write).

## Tests

```bash
npm test          # or: node --test 'test/*.test.mjs'
```

The quotes matter — a bare `test/` is resolved as a module path and fails.

Tests import from `extension/src` directly, never from `dist/`, so they run without a build. The thinking-area tests pin the contract between the block that `main-world.js` writes and what `extractThinkingArea` parses back — those two files each still carry a copy of `THINK_HEADER_RE`, so **any change to the block format must update both files and the test fixtures together**.

CI runs the tests on every PR, then builds and checks that no `import`/`export` survived into the two classic content scripts and that every path in `manifest.json` resolves. It also validates the data-repo workflow embedded as a template string in `repo-setup.js` (read from source, never the bundle — the text surgery it does would mangle bundled output) and compiles the Python.

## Working on the MCP server

```bash
LCP_REPO_PATH=/path/to/a/data-repo-clone uv run --directory mcp leetlens-mcp
```

Env vars: `LCP_REPO_PATH` (local mode root), or `LCP_SOURCE=github` with `LCP_GITHUB_REPO=<owner>/<repo>`, `LCP_GITHUB_BRANCH` (default `main`), and `LCP_GITHUB_TOKEN` for private repos. The server fails fast at startup when github mode has no repo configured.

## Conventions

- One branch + PR per issue, branched from up-to-date `main`.
- Match the surrounding code: no frameworks, esbuild is the only build dependency, comments explain *why* not *what*.
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

**Two version numbers, deliberately.** They track different things and will not match:

| Number | Where | Means |
|---|---|---|
| Repo tag `vX.Y.Z` (and the moving `v1`) | git tags | The **toolchain** version. Data repos pin it via `LEETLENS_REF` and check this repo out at that tag to get `dashboard/` and `mcp/`. |
| `version` in `extension/manifest.json` | manifest | The **extension** version Chrome shows. `package.json` deliberately has none, so there is one source of truth. |

The zip is named from the manifest version, so `leetlens-0.2.0.zip` can legitimately be attached to release `v1.1.0`. Say so in the release notes or people will assume it is a mistake.

**Cutting a release.** Bump `extension/manifest.json` if the extension itself changed, then from an up-to-date `main`:

```bash
npm run zip                                     # → leetlens-<manifest version>.zip
git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z leetlens-*.zip --title "..." --notes "..."
git tag -f v1 vX.Y.Z && git push -f origin v1   # compatible changes only
```

The zip is how people install the extension, so **a release without it leaves users with no way to get it** — that is exactly what happened with v1.0.0. Breaking changes (schema, index shape, dashboard data contract) get a new major tag instead of moving `v1`. Remember the data-repo workflow file is copied into each data repo at setup, so tag moves don't update it.

**Pages deploys.** Retry a failed deploy with a fresh `workflow_dispatch` run — never `gh run rerun`, which duplicates the `github-pages` artifact and the deploy step rejects it.
