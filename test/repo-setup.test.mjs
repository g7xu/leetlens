// The files "Set up repo" commits into a user's data repo are template
// literals; nothing else evaluates them before they land in someone's repo.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AGENTS_MD, CLAUDE_MD, MCP_JSON, WORKFLOW_YML } from '../extension/src/lib/repo-setup.js';

test('the workflow pins a toolchain ref and only ever commits index.json', () => {
  assert.match(WORKFLOW_YML, /LEETLENS_REF: v\d+/);
  assert.match(WORKFLOW_YML, /git add data\/index\.json/);
  assert.doesNotMatch(WORKFLOW_YML, /\$\{[A-Z_]+\}/, 'an interpolation was left unevaluated');
});

test('.mcp.json is valid JSON and installs the server from the pinned tag', () => {
  const cfg = JSON.parse(MCP_JSON);
  const { command, args } = cfg.mcpServers.leetlens;
  assert.equal(command, 'uvx');
  const ref = WORKFLOW_YML.match(/LEETLENS_REF: (\S+)/)[1];
  assert.deepEqual(args, ['--from', `git+https://github.com/g7xu/leetlens@${ref}#subdirectory=mcp`, 'leetlens-mcp']);
  assert.ok(MCP_JSON.endsWith('\n'));
});

test('AGENTS.md tells an agent where the data is and what it means', () => {
  for (const needle of [
    'data/sessions/<dir_key>/',
    'data/index.json',
    'session.schema.json',
    'gave_up',
    'phase_totals_sec',
    'attempt_number',
    '.mcp.json',
  ]) {
    assert.ok(AGENTS_MD.includes(needle), `AGENTS.md lacks ${needle}`);
  }
  assert.doesNotMatch(AGENTS_MD, /\$\{[A-Z_]+\}/);
});

test('CLAUDE.md is exactly an import of AGENTS.md', () => {
  assert.equal(CLAUDE_MD, '@AGENTS.md\n');
});
