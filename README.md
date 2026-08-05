# LeetLens 🔍

Track *how* you solve LeetCode problems, not just that you solved them.

LeetLens is a companion to [LeetHub-3.0](https://github.com/raphaelheinz/LeetHub-3.0): while LeetHub commits your accepted code, LeetLens records each solving **session** — timing broken into thinking / writing / reviewing / debugging phases, how many times you ran the code, whether you gave up, your logic idea, custom tags, and comments — and commits it as JSON to this repo. A Python **MCP server** lets Claude or ChatGPT analyze your weaknesses, and a **dashboard** on GitHub Pages visualizes your progress.

## Components

| Piece | Where | What it does |
|---|---|---|
| Chrome extension | `extension/` | Tracker panel on leetcode.com problem pages; commits session JSON via the GitHub API |
| Session data | `data/sessions/<problem>/<timestamp>_<id>.json` | One file per attempt; schema in `data/schema/session.schema.json` |
| Aggregate index | `data/index.json` | Rebuilt by GitHub Actions on every push — never edit by hand |
| MCP server | `mcp/` | Tools for LLMs: sessions, stats, trends, weak areas |
| Dashboard | `dashboard/` | Static site deployed to GitHub Pages, reads `index.json` |

## Setup

### 1. Chrome extension

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select the `extension/` folder.
2. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) — the two settings below are the ones that cause `403: Resource not accessible by personal access token` when missed:
   - **Repository access**: choose **Only select repositories** and pick this repo. If the repo is *private*, the default "Public repositories" option silently excludes it.
   - **Repository permissions**: in the *Select repository permissions* search box type **contents** (search by permission *name* — typing "read" finds nothing), click **Contents**, then set its *Access* dropdown to **Read and write**. "Metadata: Read-only" is added automatically — leave it.
   - Everything else stays at "No access". Set an expiration you're comfortable with (max 1 year); when it expires, commits start failing with 401 — just regenerate and re-paste.
3. Open the extension's Options page, fill owner / repo / branch, paste the token, and click **Test connection**. You want the green *"push access ✓"* — "repo lookup failed (404)" means the repo isn't granted to the token; "token cannot push" means Contents is still read-only.
4. Open any LeetCode problem — the LeetLens panel appears. The timer starts in *Thinking*; phase buttons override auto-detection; **⏸** pauses (typing or running auto-resumes), **↺** restarts a browse-only session; **Finish**/**Give up** opens the save form; **Save to GitHub** commits the session. If a save fails, the form (and your notes) stay put — fix the token and click save again.

### 2. MCP server (Claude Code / Claude Desktop / ChatGPT)

Requires [uv](https://docs.astral.sh/uv/).

Claude Code:

```bash
claude mcp add leetlens -- uv run --directory /path/to/leetlens/mcp leetlens-mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "leetlens": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/leetlens/mcp", "leetlens-mcp"]
    }
  }
}
```

By default the server reads the local clone. To run it without a clone (e.g. remote/ChatGPT), set `LCP_SOURCE=github` (and optionally `LCP_GITHUB_REPO=owner/repo`), then expose it over streamable HTTP:

```bash
LCP_SOURCE=github uv run --directory mcp leetlens-mcp --transport streamable-http --port 8765
```

and add it as a connector in ChatGPT → Settings → Connectors (developer mode), e.g. through an `ngrok http 8765` tunnel.

### 3. Dashboard

Deployed automatically to GitHub Pages by `.github/workflows/publish.yml` on every push to `main`. Locally: rebuild the index and serve:

```bash
uv run --directory mcp python -m leetlens_mcp.indexer
python3 -m http.server -d . 8000   # open http://localhost:8000/dashboard/
```

## Data model

Each session file records: problem metadata, `started_at`/`ended_at`, ordered phase segments (`thinking|writing|reviewing|debugging`, each `auto` or `manual`), per-phase totals, `run_count` / `failed_run_count` / `submit_count`, `outcome` (`accepted` / `gave_up` / `abandoned`), `logic_idea`, `tags`, `comments`. See `data/schema/session.schema.json` — the schema is the contract for every component.

> **Note:** `data/sessions/` currently contains generated sample data (marked `"sample": true`) for development; remove it once real sessions accumulate.
