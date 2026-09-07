# CLAUDE.md

Guidance for Claude Code in this repo. Contributor workflow and the full list of sharp edges live in [CONTRIBUTING.md](CONTRIBUTING.md); how the pieces fit in [ARCHITECTURE.md](ARCHITECTURE.md). Read both before changing the extension or the data-repo workflow.

## Rules

- Never `git commit` or `git push` without asking first; show what would be committed and wait for a go.
- One branch + PR per issue; branch from up-to-date `main`.
- Never edit or commit `dist/`; it is built by `npm run build` and gitignored.
- Retry a failed GitHub Pages deploy with a fresh `workflow_dispatch` run, never `gh run rerun` (it duplicates the `github-pages` artifact and the deploy step rejects it).

## Things that are easy to get wrong here

- Run the extension tests with `node --test 'test/*.test.mjs'`; the quotes matter (Node resolves a bare `test/` as a module path). MCP tests: `uv run --directory mcp --group dev pytest -q`.
- The data-repo workflow template in `extension/src/lib/repo-setup.js` is *copied* into every user's repo at setup time; moving the `v1` tag does not update it. Put logic in the toolchain (`mcp/`, `dashboard/`), never in the workflow, and keep in mind that `data/index.json` is the only generated file it commits and deploys.
- `data/schema/session.schema.json` has `additionalProperties: false` throughout, including on `problem`. A new field is a schema change and therefore a breaking change under the tag policy in ARCHITECTURE.md.
- The MCP server is on FastMCP, not the official SDK's `MCPServer`: it does not validate dict returns against the declared model (the `tool()` helper in `server.py` does), and it serialises by field name, ignoring pydantic aliases.
- GitHub reports a missing **Workflows** permission on a token as a **404**, not a 403. Plain `gh` needs `gh auth refresh -s workflow` to push workflow files.
