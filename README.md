# LeetLens 🔍

Track *how* you solve LeetCode problems, not just that you solved them.

LeetLens is a companion to [LeetHub-3.0](https://github.com/raphaelheinz/LeetHub-3.0): while LeetHub commits your accepted code, LeetLens records each solving **session** — timing broken into thinking / writing / reviewing / debugging phases, run counts, whether you gave up, your logic idea, tags, and comments — and commits it (plus the solution code) to **your own GitHub repo**. That repo gets a **dashboard** on GitHub Pages, and a Python **MCP server** lets Claude or ChatGPT analyze your weaknesses.

Like LeetHub, this repo is only the tool. Your data lives in a repo you own — new, or your existing LeetHub repo (the layouts are compatible).

## Components

| Piece | Where | What it does |
|---|---|---|
| Chrome extension | `extension/` | Tracker panel on leetcode.com; commits sessions + solutions to *your* repo; one-click repo setup |
| Your data repo | `<owner>/<your-repo>` | `data/sessions/<problem>/<timestamp>_<id>.json` per attempt, solutions in LeetHub layout, dashboard on its GitHub Pages |
| MCP server | `mcp/` | Tools for LLMs: sessions, stats, trends, weak areas — pointed at your data repo |
| Dashboard | `dashboard/` | Static site; your data repo's workflow deploys it with your data |
| Session schema | `data/schema/session.schema.json` | The contract every component builds against |

## Setup

### 1. Install the extension

`chrome://extensions` → enable Developer mode → **Load unpacked** → select the `extension/` folder.

### 2. Create (or pick) your data repo

Any repo works: create an empty one (e.g. `leetcode-journal`), or reuse an existing LeetHub repo — LeetLens writes sessions to `data/sessions/` and solutions to the same `<id>-<slug>/` folders LeetHub uses.

> GitHub Pages requires a public repo on free plans.

### 3. Create a fine-grained personal access token

Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) — the two settings below are the ones that cause `403: Resource not accessible by personal access token` when missed:

- **Repository access**: choose **Only select repositories** and pick *your data repo*. If the repo is *private*, the default "Public repositories" option silently excludes it.
- **Repository permissions**: in the *Select repository permissions* search box type **contents** (search by permission *name* — typing "read" finds nothing), click **Contents**, then set its *Access* dropdown to **Read and write**. "Metadata: Read-only" is added automatically — leave it.
- **Workflows — Read and write.** Setup commits `.github/workflows/publish.yml`, and GitHub gates workflow files behind this separate permission. Without it the setup button fails with a **404** that looks like a missing repo.
- Optional: also grant **Pages — Read and write** so the setup button can enable your dashboard automatically.
- Everything else stays at "No access". When the token expires, commits start failing with 401 — regenerate and re-paste.

### 4. Connect and set up

Open the extension's Options page, fill owner / repo / branch, paste the token:

1. **Test connection** → you want the green *"sessions can be saved ✓"*. "repo lookup failed (404)" means the repo isn't granted to the token; "token cannot push" means Contents is still read-only. This step can't verify the Workflows permission — only step 2 exercises it.
2. **Set up repo for LeetLens** → commits the dashboard workflow and sessions folder into your repo. A 404 here means the token is missing **Workflows: Read and write** (GitHub reports that as "not found", not "forbidden"). If the button couldn't enable GitHub Pages itself, do the one manual step it links: repo *Settings → Pages → Source: **GitHub Actions***.

That's it. Open any LeetCode problem — the LeetLens panel appears, a *thinking area* comment block is added to the editor for sketching your approach, and **Finish → Save to GitHub** commits the session + your code. Your dashboard lives at `https://<owner>.github.io/<repo>/` and rebuilds on every push.

Your data repo's workflow pins the LeetLens toolchain with `LEETLENS_REF: v1` — a moving major tag that picks up compatible improvements automatically. Pin an exact release tag in your workflow file if you prefer reproducibility.

### 5. MCP server (Claude Code / Claude Desktop / ChatGPT)

Requires [uv](https://docs.astral.sh/uv/). Point it at a local clone of **your data repo**:

```bash
claude mcp add leetlens --env LCP_REPO_PATH=/path/to/your-data-repo \
  -- uv run --directory /path/to/leetlens/mcp leetlens-mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "leetlens": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/leetlens/mcp", "leetlens-mcp"],
      "env": { "LCP_REPO_PATH": "/path/to/your-data-repo" }
    }
  }
}
```

To run without a clone (e.g. remote/ChatGPT), fetch straight from GitHub over streamable HTTP:

```bash
LCP_SOURCE=github LCP_GITHUB_REPO=<owner>/<your-data-repo> \
  uv run --directory mcp leetlens-mcp --transport streamable-http --port 8765
```

and add it as a connector in ChatGPT → Settings → Connectors (developer mode), e.g. through an `ngrok http 8765` tunnel. Private data repo? Also set `LCP_GITHUB_TOKEN` (the same fine-grained PAT works — Contents: read is enough), which switches fetching from raw.githubusercontent.com to the authenticated Contents API.

## Data model

Each session file records: problem metadata, `started_at`/`ended_at`, ordered phase segments (`thinking|writing|reviewing|debugging`, each `auto` or `manual`), per-phase totals, `run_count` / `failed_run_count` / `submit_count`, `outcome` (`accepted` / `gave_up` / `abandoned`), `logic_idea`, `tags`, `comments`. See `data/schema/session.schema.json` — the schema is the contract for every component.

## Development

```bash
# dashboard against a local data repo
uv run --directory mcp python -m leetlens_mcp.indexer /path/to/your-data-repo
python3 -m http.server -d /path/to/your-data-repo 8000
# then copy dashboard/* next to that data, or open the deployed Pages site
```

Contributions welcome — the extension is plain MV3 JavaScript (no build step), the MCP server is a small uv project, and the dashboard is a static page.
