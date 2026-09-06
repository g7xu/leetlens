// One-click data-repo setup (LeetHub-style): commits the publish workflow and
// the sessions folder into the user's configured repo, so any repo — brand-new
// or an existing LeetHub repo — becomes a working LeetLens data repo.

import { getSettings, putFile } from './github.js';

// The tool repo whose dashboard + indexer the data-repo workflow checks out.
const TOOL_REPO = 'g7xu/leetlens';

// Pinned major tag of the toolchain; the maintainer moves it for compatible
// updates. Users can pin an exact tag (e.g. v1.0.0) in their own repo.
const TOOL_REF = 'v1';

const WORKFLOW_PATH = '.github/workflows/publish.yml';

export const WORKFLOW_YML = `name: publish

on:
  push:
    branches: [main]
    # Index-only pushes need no rebuild; second layer of loop protection on
    # top of GITHUB_TOKEN pushes not retriggering workflows.
    paths-ignore: ['data/index.json']
  workflow_dispatch:

permissions:
  contents: write   # commit the rebuilt index back to this repo
  pages: write      # deploy to GitHub Pages
  id-token: write   # OIDC for deploy-pages

concurrency:
  group: pages
  cancel-in-progress: false

env:
  # Version of the LeetLens toolchain (indexer + dashboard) to build with.
  # '${TOOL_REF}' is a moving major tag; pin an exact tag if you prefer.
  LEETLENS_REF: ${TOOL_REF}

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      # This data repo (workspace root)
      - uses: actions/checkout@v4

      # The LeetLens toolchain, nested but never committed or deployed
      - uses: actions/checkout@v4
        with:
          repository: ${TOOL_REPO}
          ref: \${{ env.LEETLENS_REF }}
          path: .leetlens

      - uses: astral-sh/setup-uv@v5

      - name: Rebuild and commit data/index.json
        # The indexer reads and writes at the given root (this data repo)
        # while the code runs from the .leetlens checkout. Absolute path is
        # required: 'uv run --directory' changes cwd.
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          for attempt in 1 2 3; do
            uv run --directory .leetlens/mcp python -m leetlens_mcp.indexer "$GITHUB_WORKSPACE"
            git add data/index.json
            # --cached: works on the very first run, when index.json is
            # untracked (plain 'git diff' ignores untracked files and would
            # skip the commit). -I ignores timestamp-only diffs, so a run that
            # changes nothing — including one racing a run that already
            # published the same index — creates no commit.
            if git diff --cached -I'"generated_at"' --quiet; then
              echo "index already up to date"
              exit 0
            fi
            git commit -q -m "chore: rebuild data/index.json"
            git push && exit 0
            # The extension pushes a solution commit right after the session
            # commit that triggered this run, so main often moves while we
            # build. index.json is generated, never authored, so there is
            # nothing to merge: rebasing our copy onto theirs only conflicts
            # with itself. Take what landed and rebuild from it instead.
            echo "main moved while building — rebuilding on top of it"
            git fetch -q origin main
            git reset -q --hard origin/main
          done
          echo "::error::could not publish the rebuilt index after 3 attempts"
          exit 1

      - name: Assemble Pages artifact
        # Only dashboard source + the index — .leetlens is never deployed.
        run: |
          mkdir -p _site/data
          cp -r .leetlens/dashboard/* _site/
          cp data/index.json _site/data/

      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site

      - id: deployment
        uses: actions/deploy-pages@v4
`;

const GITIGNORE = `.leetlens/
_site/
`;

const SCHEMA_URL = `https://raw.githubusercontent.com/${TOOL_REPO}/${TOOL_REF}/data/schema/session.schema.json`;

// Read by agents that open the data repo as a folder (Claude Code, Codex CLI)
// with no MCP server: everything needed to answer questions from the JSON
// files alone. CLAUDE.md imports it so one document serves both ecosystems.
export const AGENTS_MD = `# LeetLens data repo

This repo is one person's LeetCode practice record, written by the
[LeetLens](https://github.com/${TOOL_REPO}) Chrome extension. Every attempt at a
problem is one **session** file; accepted solutions are committed next to them.
The goal of reading it is to diagnose *how* the person solves problems, not just
what they solved.

## Layout

- \`data/sessions/<dir_key>/<started_at>_<session_id>.json\` — one file per attempt.
  \`dir_key\` is the zero-padded problem number plus slug, e.g. \`0001-two-sum\`.
- \`<dir_key>/<dir_key>.<ext>\` — the most recent solution for that problem
  (LeetHub layout).
- \`data/index.json\` — generated by CI on every push, never edited by hand:
  totals, per-problem summaries, per-session summaries, per-tag stats, daily
  activity, and \`records\` (every session in full). Read this first; it is the
  whole repo in one file.
- Schema for a session file: ${SCHEMA_URL}

## What a session records

- \`outcome\`: \`accepted\` (solved), \`gave_up\` (explicit give-up), \`abandoned\`
  (left open, flushed later).
- \`phase_totals_sec\`: active seconds in \`thinking\` (sketching an approach before
  coding), \`writing\`, \`reviewing\` (re-reading before running), \`debugging\`
  (after a failed run). \`total_active_sec\` is their sum; pauses are excluded.
- \`run_count\` / \`failed_run_count\` / \`submit_count\`: how many tries it took.
- \`logic_idea\`: the person's own description of their approach, written before or
  while coding. \`comments\`: notes on the save form. \`tags\`: their own labels.
- \`attempt_number\` (in the index only): 1 for the first session on a problem, 2
  for the next, and so on. A problem with a \`gave_up\` session and no later
  \`accepted\` one is unfinished.

## Questions this data answers well

1. Which tags have the highest give-up rate, and is it a thinking problem (long
   thinking phase, then give up) or a debugging problem (many failed runs)?
2. On second attempts, does time drop and does the logic idea change?
3. Which topics has the person not touched in the last 30 days?
4. Where does debugging dominate the session, and what do the comments say
   went wrong there?
5. What should they solve next: unfinished problems first, then weakest tags,
   then stale ones?

## Tools

\`.mcp.json\` in this repo starts the LeetLens MCP server for Claude Code; it
exposes these questions as tools (\`get_weak_areas\`, \`get_revenge_list\`,
\`recommend_next\`, \`search\`, \`fetch\`, \`export_sessions\`, ...). Without it, the
JSON files above are enough: \`data/index.json\` has every record.
`;

export const CLAUDE_MD = `@AGENTS.md
`;

// Claude Code prompts to enable a project-scoped server on open. No PyPI
// release is needed: uvx installs straight from the tool repo at the same tag
// the workflow pins. uv caches the ref resolution; \`uvx --refresh\` picks up a
// moved tag.
export const MCP_JSON = `${JSON.stringify({
  mcpServers: {
    leetlens: {
      command: 'uvx',
      args: ['--from', `git+https://github.com/${TOOL_REPO}@${TOOL_REF}#subdirectory=mcp`, 'leetlens-mcp'],
    },
  },
}, null, 2)}
`;

/**
 * Best-effort: enable GitHub Pages with workflow builds. Succeeds only when
 * the PAT has the Pages permission; a 409 means Pages is already enabled.
 */
async function enablePages() {
  const { token, owner, repo } = await getSettings();
  const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/pages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ build_type: 'workflow' }),
  });
  return resp.ok || resp.status === 409;
}

/**
 * Make the configured repo a LeetLens data repo: the publish workflow, the
 * sessions folder, and the files that let a coding agent work in it. Idempotent:
 * existing files are overwritten with the current versions (SHA dance handled
 * by putFile).
 */
export async function setupRepo() {
  await putFile(WORKFLOW_PATH, WORKFLOW_YML,
    'leetlens: add dashboard publish workflow', { overwrite: true })
    .catch((err) => {
      // Writing under .github/workflows/ needs the token's separate "Workflows"
      // permission, and GitHub refuses without it as a 404 — indistinguishable
      // from a missing repo unless we say what it actually means.
      if (String(err).includes('404')) {
        throw new Error(
          'GitHub refused to write .github/workflows/publish.yml — add ' +
          '"Workflows: Read and write" to your token\'s repository permissions.');
      }
      throw err;
    });
  await putFile('data/sessions/.gitkeep', '',
    'leetlens: create sessions folder', { overwrite: true });
  await putFile('AGENTS.md', AGENTS_MD,
    'leetlens: describe the repo for coding agents', { overwrite: true });
  await putFile('CLAUDE.md', CLAUDE_MD,
    'leetlens: point Claude Code at AGENTS.md', { overwrite: true });
  await putFile('.mcp.json', MCP_JSON,
    'leetlens: project-scoped MCP server for Claude Code', { overwrite: true });
  await putFile('.gitignore', GITIGNORE,
    'leetlens: ignore local build folders', { overwrite: false }).catch(() => {
    /* repo already has a .gitignore — leave it alone */
  });
  let pagesEnabled = false;
  try {
    pagesEnabled = await enablePages();
  } catch {
    /* PAT without Pages permission — user enables it manually */
  }
  return { pagesEnabled };
}
