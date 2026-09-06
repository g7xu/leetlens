// The layout the indexer globs and the MCP server reads back.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { attemptPath, codePath, sessionPath } from '../extension/src/lib/paths.js';

const record = {
  session_id: 'ab12cd34',
  started_at: '2026-08-20T10:04:05.123Z',
  problem: { dir_key: '0322-coin-change' },
};

test('a session file sorts by time within its problem folder', () => {
  assert.equal(sessionPath(record),
    'data/sessions/0322-coin-change/2026-08-20T10-04-05Z_ab12cd34.json');
});

test('the canonical solution path is LeetHub layout and ignores the attempt', () => {
  assert.equal(codePath(record, 'python3'), '0322-coin-change/0322-coin-change.py');
  assert.equal(codePath(record, 'golang'), '0322-coin-change/0322-coin-change.go');
  assert.equal(codePath(record, 'oraclesql'), '0322-coin-change/0322-coin-change.sql');
});

test('an unknown language still lands somewhere rather than being dropped', () => {
  assert.equal(codePath(record, 'brandnewlang'), '0322-coin-change/0322-coin-change.txt');
});

test('each attempt gets its own file beside the canonical one', () => {
  assert.equal(attemptPath(record, 'python3'),
    '0322-coin-change/attempts/2026-08-20T10-04-05Z_ab12cd34.py');
  // Two attempts at the same problem never collide.
  const later = { ...record, session_id: 'ff99ee88', started_at: '2026-08-21T11:00:00Z' };
  assert.notEqual(attemptPath(record, 'python3'), attemptPath(later, 'python3'));
  // The attempts folder is nested under the problem, so the canonical file is
  // still the only solution file directly in it.
  assert.ok(attemptPath(record, 'python3').startsWith('0322-coin-change/attempts/'));
});
