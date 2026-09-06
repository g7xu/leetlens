# LeetLens 🔍

Track *how* you solve LeetCode problems, not just that you solved them.

LeetLens is a companion to [LeetHub-3.0](https://github.com/raphaelheinz/LeetHub-3.0): while LeetHub commits your accepted code, LeetLens records each solving **session** — timing broken into thinking / writing / reviewing / debugging phases, run counts, whether you gave up, your logic idea, tags, and comments — and commits it (plus the solution code) to **your own GitHub repo**. That repo gets a **dashboard** on GitHub Pages, and a Python **MCP server** lets Claude or ChatGPT analyze your weaknesses.

Like LeetHub, this repo is only the tool. Your data lives in a repo you own — new, or your existing LeetHub repo (the layouts are compatible).

Four pieces: the Chrome extension (`extension/`), the MCP server (`mcp/`), the dashboard (`dashboard/`), and the session schema (`data/schema/`) they all build against. How they fit together is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

### 1. Install the extension

Build it — needs [Node](https://nodejs.org/) 20+:

```bash
git clone https://github.com/g7xu/leetlens.git
cd leetlens
npm install
npm run build
```

Then `chrome://extensions` → enable Developer mode → **Load unpacked** → select the generated **`dist/`** folder.

> `dist/` is what Chrome loads; `extension/` holds the sources and has no manifest at its top level. If you previously loaded `extension/`, remove that entry first — Chrome keeps running the old copy otherwise.

Prefer not to build? Recent [releases](https://github.com/g7xu/leetlens/releases) attach a ready-to-load `leetlens-<version>.zip` — download, unzip, and load that folder instead. (Releases before v1.1.0 predate the build and have no zip.)

### 2. Create (or pick) your data repo

Any repo works: create an empty one (e.g. `leetcode-journal`), or reuse an existing LeetHub repo — LeetLens writes sessions to `data/sessions/` and solutions to the same `<id>-<slug>/` folders LeetHub uses.

> GitHub Pages requires a public repo on free plans. A public data repo makes everything in it public: your sessions, your solutions, and whatever you write in the thinking area. A private repo works too, but loses the dashboard and the hosted MCP server.

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

That's it. Open any LeetCode problem — the LeetLens panel appears, a *thinking area* block comment is added to the top of the editor for sketching your approach, and **Finish → Save to GitHub** commits the session + your code. Your dashboard lives at `https://<owner>.github.io/<repo>/` and rebuilds on every push.

Write as much as you like in the thinking area: it's a block comment, so it never affects your code, time spent there counts as *thinking* rather than *writing*, and its text is read when you finish and used to fill in the session's logic idea. It's stripped from the solution file that gets committed. Languages with no block-comment syntax (Erlang, Elixir, Bash) don't get one — use the logic-idea box on the save form instead.

Your data repo's workflow pins the LeetLens toolchain with `LEETLENS_REF: v1`, a moving major tag; pin an exact release tag instead if you prefer reproducibility. The tag policy is in [ARCHITECTURE.md](ARCHITECTURE.md#the-two-repo-model).

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

**No install at all: the hosted server.** One public endpoint serves any public data repo; put your owner and repo in the URL:

```bash
claude mcp add --transport http leetlens https://leetlens-mcp.vercel.app/<owner>/<your-data-repo>/mcp
```

The same URL works as a custom connector in Claude.ai (Settings → Connectors) and in ChatGPT (Settings → Connectors, developer mode); the `search` / `fetch` pair follows ChatGPT's connector contract, so deep research can use it too. The server reads your repo's generated `data/index.json`, so the repo must be public and set up with the extension (one push after **Set up repo** is enough). Private data repo? Run the server yourself against a local clone (above) or fetch from GitHub with a token:

```bash
LCP_SOURCE=github LCP_GITHUB_REPO=<owner>/<your-data-repo> LCP_GITHUB_TOKEN=<fine-grained PAT, Contents: read> \
  uv run --directory mcp leetlens-mcp --transport http --port 8765
```

<details>
<summary><b>Reference: tools, prompt, resources, env vars</b></summary>

| Tool | What it answers |
|---|---|
| `search` | Free-text search over problems and tags, every word must match; the ChatGPT connector contract |
| `fetch` | One document by id from `search`: a problem with every attempt + solution, or a tag with its stats |
| `list_sessions` | Sessions newest first, filterable by tag / difficulty / outcome / date |
| `get_problem_details` | Everything about one problem: all sessions + committed solution source |
| `get_stats` | Aggregates per tag, difficulty, week, or month |
| `get_trends` | A metric as a weekly/monthly time series |
| `get_weak_areas` | Tags ranked weakest-first, with the scoring components |
| `list_tags` | All tags with usage counts and last-seen date |
| `get_revenge_list` | Gave-up problems with no accepted session since |
| `get_stale_tags` | Tags not practiced in N days |
| `recommend_next` | "Solve these next" with reasons |
| `search_notes` | Text search over `logic_idea` and `comments` |
| `compare_periods` | This month vs last month (or any two periods), with deltas |
| `export_sessions` | Every full session record as JSONL or JSON, filterable by date and tag, so the model can run its own analysis |

Plus the `weekly_review` prompt and two resources: `leetlens://index` and `leetlens://sessions/{dir_key}`.

| Env var | Meaning |
|---|---|
| `LCP_REPO_PATH` | Local mode: path to a clone of your data repo |
| `LCP_SOURCE` | `local` (default) or `github` |
| `LCP_GITHUB_REPO` | `owner/repo` of your data repo (required in github mode) |
| `LCP_GITHUB_BRANCH` | Branch to read (default `main`) |
| `LCP_GITHUB_TOKEN` | Token for private data repos (Contents: read suffices) |

</details>

## Data model

One JSON file per attempt, described field by field in [`data/schema/session.schema.json`](data/schema/session.schema.json).

## Development

```bash
npm install            # once — esbuild is the only dependency
npm run watch          # rebuild dist/ on change; load dist/ as the extension
npm test               # extension tests (Node's built-in runner, no build needed)

# dashboard against a local data repo
uv run --directory mcp python -m leetlens_mcp.indexer /path/to/your-data-repo
python3 -m http.server -d /path/to/your-data-repo 8000
# then copy dashboard/* next to that data, or open the deployed Pages site
```

Contributions welcome: [CONTRIBUTING.md](CONTRIBUTING.md) has the workflow and the sharp edges.

## License

[MIT](LICENSE).
