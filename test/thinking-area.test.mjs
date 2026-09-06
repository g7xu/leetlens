// Contract between the block the injector writes and the block the content
// script peels back off. Both come from src/lib/thinking-area.js; the literal
// strings below pin the on-disk shape so a change to the writer is a visible
// change to the tests, not a silent drift.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LANG_EXT, NO_BLOCK_COMMENT, blockDelimiters } from '../extension/src/lib/languages.js';
import {
  THINK_HEADER_RE, extractThinkingArea, lineInThinkingArea, thinkingBlock,
} from '../extension/src/lib/thinking-area.js';

const PY_CODE = 'class Solution:\n    def twoSum(self, nums, target):\n        return []';
const CPP_CODE = 'class Solution {\npublic:\n    int f() { return 0; }\n};';

// --- injector output, verbatim ------------------------------------------

const pyBlock = (notes = '\n\n') => `r""" Thinking area\n${notes}\n"""\n\n${PY_CODE}`;
const cBlock = (notes = '\n\n') => `/* Thinking area\n${notes}\n*/\n\n${CPP_CODE}`;

test('python block with no notes yields empty notes and clean code', () => {
  assert.deepEqual(extractThinkingArea(pyBlock()), { notes: '', code: PY_CODE });
});

test('python block returns the notes and strips the block', () => {
  const { notes, code } = extractThinkingArea(pyBlock('two pointers\nsort first\nO(n log n)'));
  assert.equal(notes, 'two pointers\nsort first\nO(n log n)');
  assert.equal(code, PY_CODE);
});

test('c-style block with no notes yields empty notes and clean code', () => {
  assert.deepEqual(extractThinkingArea(cBlock()), { notes: '', code: CPP_CODE });
});

test('leading asterisks from monaco continuation are stripped', () => {
  const { notes, code } = extractThinkingArea(cBlock(' * two pointers\n * sort first'));
  assert.equal(notes, 'two pointers\nsort first');
  assert.equal(code, CPP_CODE);
});

test('a python note keeps its own # prefix', () => {
  const { notes } = extractThinkingArea(pyBlock('# TODO handle dupes'));
  assert.equal(notes, '# TODO handle dupes');
});

test('every language the injector writes for round-trips through the parser', () => {
  for (const lang of Object.keys(LANG_EXT)) {
    const block = thinkingBlock(lang);
    if (!block) {
      assert.ok(NO_BLOCK_COMMENT.includes(lang), `${lang}: no block only for languages without block comments`);
      continue;
    }
    assert.match(block, THINK_HEADER_RE, `${lang}: header must be recognised`);
    const [open, close] = blockDelimiters(lang);
    const src = `${open} Thinking area\nmy approach\n\n${close}\n\n${PY_CODE}`;
    const { notes, code } = extractThinkingArea(src);
    assert.equal(notes, 'my approach', `${lang}: notes`);
    assert.equal(code, PY_CODE, `${lang}: code`);
    assert.deepEqual(extractThinkingArea(block + PY_CODE), { notes: '', code: PY_CODE }, `${lang}: fresh block`);
  }
});

test('the caret check knows the block bounds', () => {
  const src = `\n/* Thinking area\nnote\n*/\n${CPP_CODE}`;
  assert.equal(lineInThinkingArea(src, 0, 'cpp'), false, 'blank line above the block');
  assert.equal(lineInThinkingArea(src, 1, 'cpp'), true, 'header');
  assert.equal(lineInThinkingArea(src, 2, 'cpp'), true, 'note');
  assert.equal(lineInThinkingArea(src, 3, 'cpp'), true, 'closer');
  assert.equal(lineInThinkingArea(src, 4, 'cpp'), false, 'code');
  assert.equal(lineInThinkingArea(CPP_CODE, 0, 'cpp'), false, 'no block');
  assert.equal(lineInThinkingArea(src, 2, 'bash'), false, 'language without blocks');
});

test('a whole editor buffer with a restored block is detected', () => {
  assert.match(`\n\n${cBlock('x')}`, THINK_HEADER_RE);
  assert.doesNotMatch(`/**\n * ListNode\n */\n${CPP_CODE}`, THINK_HEADER_RE);
});

// --- backward compatibility with blocks already committed ---------------

test('legacy ruler block with bare note lines still parses', () => {
  const legacy = `# Thinking area\n##################\nbare note\nanother\n##################\n\n${PY_CODE}`;
  const { notes, code } = extractThinkingArea(legacy);
  assert.equal(notes, 'bare note\nanother');
  assert.equal(code, PY_CODE);
});

test('legacy ruler block with commented note lines still parses', () => {
  const legacy = `// Thinking area\n//////////////////\n// bfs from root\n//////////////////\n\n${CPP_CODE}`;
  const { notes, code } = extractThinkingArea(legacy);
  assert.equal(notes, 'bfs from root');
  assert.equal(code, CPP_CODE);
});

// --- code that must never be touched ------------------------------------

test('code with no thinking area passes through byte-identical', () => {
  const { notes, code } = extractThinkingArea(PY_CODE);
  assert.equal(notes, '');
  assert.equal(code, PY_CODE);
});

test("leetcode's own /** ListNode */ docblock is not mistaken for a block", () => {
  const withDocblock = `/**\n * Definition for singly-linked list.\n * struct ListNode {\n *     int val;\n * };\n */\n${CPP_CODE}`;
  const { notes, code } = extractThinkingArea(withDocblock);
  assert.equal(notes, '');
  assert.equal(code, withDocblock, 'template docblock must survive untouched');
});

test('unterminated block leaves the code alone', () => {
  const broken = `r""" Thinking area\nnotes but no closer\n\n${PY_CODE}`;
  assert.deepEqual(extractThinkingArea(broken), { notes: '', code: broken });
});

test('a note containing the closer inline does not end the block early', () => {
  // Matching `*/` as a substring would cut the block at the note and strand
  // 'more notes' plus a dangling `*/` into the committed solution file.
  const src = `/* Thinking area\ncareful: */ ends a comment\nmore notes\n*/\n\n${CPP_CODE}`;
  const { notes, code } = extractThinkingArea(src);
  assert.equal(notes, 'careful: */ ends a comment\nmore notes');
  assert.equal(code, CPP_CODE, 'note text must never leak into the code');
});

test('a python note containing triple quotes does not end the block early', () => {
  const src = `r""" Thinking area\nuse """ for docstrings\nmore notes\n"""\n\n${PY_CODE}`;
  const { notes, code } = extractThinkingArea(src);
  assert.equal(notes, 'use """ for docstrings\nmore notes');
  assert.equal(code, PY_CODE);
});

test('an inline closer with no closing line bails instead of corrupting', () => {
  // The user deleted the closing line. There is no line that is only `*/`, so
  // there is no trustworthy end — committing 'more notes' as code would be
  // silent data loss on both sides.
  const src = `/* Thinking area\nnote with */ inline\nmore notes\n\n${CPP_CODE}`;
  const { notes, code } = extractThinkingArea(src);
  assert.equal(notes, '');
  assert.equal(code, src, 'must bail rather than write note text as code');
});

test('a stray closer directly after the block bails', () => {
  const src = `/* Thinking area\nnotes\n*/\n*/\n\n${CPP_CODE}`;
  assert.deepEqual(extractThinkingArea(src), { notes: '', code: src });
});

// --- input hygiene -------------------------------------------------------

test('non-string and empty input are handled', () => {
  assert.deepEqual(extractThinkingArea(''), { notes: '', code: '' });
  assert.deepEqual(extractThinkingArea(null), { notes: '', code: '' });
  assert.deepEqual(extractThinkingArea(undefined), { notes: '', code: '' });
});
