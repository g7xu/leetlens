# LeetLens 🔍

Track *how* you solve LeetCode problems, not just that you solved them.

LeetLens is a companion to [LeetHub-3.0](https://github.com/raphaelheinz/LeetHub-3.0): while LeetHub commits your accepted code, LeetLens records each solving **session** — timing broken into thinking / writing / reviewing / debugging phases, run counts, whether you gave up, your logic idea, tags, and comments — and commits it (plus the solution code) to **your own GitHub repo**. That repo gets a **dashboard** on GitHub Pages, and a Python **MCP server** lets Claude or ChatGPT analyze your weaknesses.

Like LeetHub, this repo is only the tool. Your data lives in a repo you own — new, or your existing LeetHub repo (the layouts are compatible).

Four pieces: the Chrome extension (`extension/`), the MCP server (`mcp/`), the dashboard (`dashboard/`), and the session schema (`data/schema/`) they all build against. How they fit together is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

Five steps, about ten minutes. You need a GitHub account and Chrome.

### 1. Install the extension

Download **`leetlens-<version>.zip`** from the [latest release](https://github.com/g7xu/leetlens/releases/latest) and unzip it.

Then open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, and select the unzipped folder.

<details>
<summary>Building it yourself instead</summary>

Needs [Node](https://nodejs.org/) 20+. `npm install && npm run build`, then load the generated **`dist/`** folder — not `extension/`, which holds the sources and has no manifest at its top level. If you previously loaded `extension/`, remove that entry first; Chrome keeps running the old copy otherwise.
</details>

### 2. Create (or pick) your data repo

Any repo works: an empty new one (`leetcode-journal`, say), or an existing LeetHub repo, since LeetLens writes solutions to the same `<id>-<slug>/` folders. Note the owner and name; you'll paste them in step 4.

> **Make it public.** GitHub Pages needs public on free plans, and so does the hosted analysis server. That means your sessions, your solutions, and anything you type in the thinking area are visible to anyone. A private repo works for saving sessions but loses the dashboard and the hosted server.

### 3. Create a fine-grained personal access token

Create one at [Settings → Fine-grained tokens](https://github.com/settings/personal-access-tokens/new).

**Repository access:** choose **Only select repositories** and pick your data repo. The default "Public repositories" option silently excludes a private one.

**Repository permissions:** search the box by permission *name* (typing "read" finds nothing), and set:

| Permission | Access | Why |
|---|---|---|
| Contents | Read and write | Committing your sessions and solutions |
| Workflows | Read and write | Step 4 commits a workflow file, which GitHub gates separately |

Metadata is added automatically; leave everything else at No access. Copy the token now, since GitHub shows it once.

> Skipping **Workflows** is the most common mistake, and GitHub reports it as a **404** that reads like "repo not found" rather than a permissions error.

**One extra click after step 4.** Turning on GitHub Pages through the API needs *Administration: read and write* — permission to change your repository's settings, delete it, and manage who can see it. That is far more than a session tracker should hold, so LeetLens does not ask for it. Instead, once per repo, open your repo's *Settings → Pages* and set **Source** to **GitHub Actions**. Everything else is automatic, and sessions save whether or not you do this; only the dashboard needs it.

### 4. Connect

Open the extension's options page: `chrome://extensions` → LeetLens → **Details** → **Extension options**. It walks you through three steps and each one collapses when it succeeds.

1. **Connect GitHub** — paste the token, press Save token.
2. **Choose the repo** — owner, repository, branch, then **Test connection**. A 404 here means the token wasn't granted that repo, or the name is wrong.
3. **Set up the repo** — commits the dashboard workflow, the sessions folder, and the files that let Claude Code read your repo. It then links the one manual step from step 3: your repo's *Settings → Pages → Source: **GitHub Actions***.

The last screen shows your dashboard link, your analysis connector URL, and a one-line command for Claude Code. Keep them.

### 5. Solve something

Open any LeetCode problem. The LeetLens panel appears, and a **thinking area** comment block is added at the top of the editor.

Sketch your approach there before you start coding. It's a block comment, so it never affects your code, time spent in it counts as *thinking* rather than *writing*, and its text becomes your session's logic idea. It's stripped out of the committed solution. Languages with no block-comment form (Erlang, Elixir, Bash) don't get one; use the logic-idea box on the save form.

When you're done, press **✓ Finish** (or **Give up** — those sessions are the interesting ones), fill in the save form, and press **Save to GitHub**.

Your repo now has a session record, your solution, and a copy of this attempt under `attempts/`. A minute later your dashboard is live at `https://<owner>.github.io/<repo>/`, and it rebuilds on every save.

## Analyzing your practice

Ask an AI what you're bad at. The hosted server serves any public data repo, with nothing to install — put your owner and repo in the URL:

```
https://leetlens-mcp.vercel.app/<owner>/<your-data-repo>/mcp
```

Add that as a custom connector in **Claude.ai** (Settings → Connectors) or **ChatGPT** (Settings → Connectors, developer mode). For Claude Code:

```bash
claude mcp add --transport http leetlens https://leetlens-mcp.vercel.app/<owner>/<your-data-repo>/mcp
```

Then ask things like *"what are my weakest topics and why"*, *"what should I practice next"*, or *"show me what changed between my failed attempt at Coin Change and the one that passed"*.

Your data repo also gets an `AGENTS.md` and a `.mcp.json`, so opening it as a folder in Claude Code or Codex works with no configuration at all.

<details>
<summary>Running the server yourself (private repos, or offline)</summary>

Requires [uv](https://docs.astral.sh/uv/). Against a local clone of your data repo:

```bash
claude mcp add leetlens --env LCP_REPO_PATH=/path/to/your-data-repo \
  -- uv run --directory /path/to/leetlens/mcp leetlens-mcp
```

Or fetch a private repo from GitHub directly:

```bash
LCP_SOURCE=github LCP_GITHUB_REPO=<owner>/<repo> LCP_GITHUB_TOKEN=<token, Contents: read> \
  uv run --directory mcp leetlens-mcp --transport http --port 8765
```
</details>

Your data repo's workflow pins the toolchain with `LEETLENS_REF: v2`, a moving major tag; pin an exact release tag instead if you prefer reproducibility. The policy is in [ARCHITECTURE.md](ARCHITECTURE.md#the-two-repo-model).

> **Upgrading from `v1`?** Sessions now record LeetCode's own topic tags, so weak-area analysis works even if you never tag anything yourself, and every attempt's code is kept rather than only the last. Change `LEETLENS_REF: v1` to `v2` in your data repo's `.github/workflows/publish.yml` and push. Old sessions keep working; they just have no topics. Staying on `v1` is fine.

<details>
<summary><b>Reference: tools, prompt, resources, env vars</b></summary>

| Tool | What it answers |
|---|---|
| `search` | Free-text search over problems and tags, every word must match; the ChatGPT connector contract |
| `fetch` | One document by id from `search`: a problem with every attempt + solution, or a tag with its stats |
| `list_sessions` | Sessions newest first, filterable by tag / difficulty / outcome / date |
| `get_problem_details` | Everything about one problem: every session, plus each attempt's code |
| `get_stats` | Aggregates per tag, topic, difficulty, week, or month |
| `get_trends` | A metric as a weekly/monthly time series |
| `get_weak_areas` | Topics (or your tags) ranked weakest-first, with every scoring component |
| `list_tags` | Your tags, or LeetCode's topics, with usage counts and last-seen date |
| `get_revenge_list` | Gave-up problems with no accepted session since |
| `get_stale_tags` | Topics or tags not practiced in N days |
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

## Privacy

LeetLens has no server and collects nothing. Sessions and solutions go from your browser to the GitHub repository you nominate, using your own credential; that credential and your in-progress session are stored in your browser profile's extension storage. The only hosts contacted are `leetcode.com` (the problem you are solving), `api.github.com` (your repo), and `github.com/login` (signing in).

The hosted analysis server reads your data repo the same way anyone can — it is public — and stores nothing.

**A public data repo is public.** Your sessions, your solutions, and anything you write in the thinking area are visible to anyone. A private repo keeps them to you but loses the dashboard and the hosted server; the MCP server still works locally against a clone.

## License

[MIT](LICENSE).
