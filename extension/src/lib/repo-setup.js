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

const WORKFLOW_YML = `name: publish

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

      - name: Rebuild data/index.json
        # The indexer reads and writes at the given root (this data repo)
        # while the code runs from the .leetlens checkout. Absolute path is
        # required: 'uv run --directory' changes cwd.
        run: uv run --directory .leetlens/mcp python -m leetlens_mcp.indexer "$GITHUB_WORKSPACE"

      - name: Commit index if changed
        run: |
          git add data/index.json
          # --cached: works on the very first run, when index.json is untracked
          # (plain 'git diff' ignores untracked files and would skip the commit).
          # -I ignores timestamp-only diffs so no-op runs don't create commits.
          if ! git diff --cached -I'"generated_at"' --quiet; then
            git config user.name "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            git commit -m "chore: rebuild data/index.json"
            # The extension pushes a solution commit right after the session
            # commit that triggered this run, so main often moves while we
            # build. Rebase over whatever landed and retry; a racing commit
            # with new session data retriggers the workflow anyway.
            for attempt in 1 2 3; do
              git push && break
              git pull --rebase origin main || exit 1
            done
          fi

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
 * Make the configured repo a LeetLens data repo. Idempotent: existing files
 * are overwritten with the current versions (SHA dance handled by putFile).
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
