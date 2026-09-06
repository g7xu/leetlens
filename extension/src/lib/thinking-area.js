// The thinking-area block: what main-world.js writes into the editor and what
// the content script peels back off the captured code. Both sides import
// this, so the block format has one definition; test/thinking-area.test.mjs
// pins the shapes. Why it must be a block comment: ARCHITECTURE.md.

import { blockDelimiters } from './languages.js';

// Openers thinkingBlock() writes, plus the line-comment tokens older blocks
// used. `#|` must precede `#`: the alternation is ordered and the captured
// opener selects the parsing branch. The trailing `[ \t]` (not `\s`) keeps the
// match on the header line and, after `/*`, is what stops LeetCode's own
// `/** …` ListNode docblock from being taken for a thinking area and stripped
// from the committed solution. Never loosen it to `\/\*+`. The `m` flag lets
// callers test a whole editor buffer for a restored block.
export const THINK_HEADER_RE = /^[ \t]*(r?"""|'''|\/\*|=begin|#\||#|\/\/|--|;|%)[ \t]*Thinking area\b/im;
const THINK_DELIM_RE = /^[#/;%-]{8,}$/;

// Block openers -> what terminates them. An opener absent here is a legacy
// line-comment header, whose region is fenced by THINK_DELIM_RE rulers.
const BLOCK_CLOSER = {
  'r"""': '"""', '"""': '"""', "'''": "'''",
  '/*': '*/', '=begin': '=end', '#|': '|#',
};

/** The block to prepend to a fresh editor for `langId`, or null. */
export function thinkingBlock(langId) {
  const block = blockDelimiters(langId);
  return block && `${block[0]} Thinking area\n\n\n\n${block[1]}\n\n`;
}

/**
 * Split the thinking-area block off the top of captured code. Returns the
 * notes written inside the block and the code with the block removed; code
 * passes through untouched when no block starts at the first non-blank line.
 */
export function extractThinkingArea(code) {
  if (typeof code !== 'string' || !code) return { notes: '', code: code ?? '' };
  const lines = code.split('\n');
  let head = 0;
  while (head < lines.length && !lines[head].trim()) head++;
  const opener = (lines[head] ?? '').match(THINK_HEADER_RE)?.[1];
  if (!opener) return { notes: '', code };

  const closer = BLOCK_CLOSER[opener.toLowerCase()];
  let open, close, strip;
  if (closer) {
    // The closer must be alone on its line, which is how we write it; matching
    // it as a substring would end the block early on a note that mentions it.
    open = head;
    close = lines.findIndex((l, i) => i > head && l.trim() === closer);
    // Monaco continues some block comments with ' * '; users also type bullets.
    strip = /^[ \t]*\*[ \t]?/;
  } else {
    // Legacy: a ruler opens the region and another closes it.
    open = head + 1;
    if (!THINK_DELIM_RE.test((lines[open] ?? '').trim())) return { notes: '', code };
    close = lines.findIndex((l, i) => i > open && THINK_DELIM_RE.test(l.trim()));
    strip = /^[ \t]*(#|\/\/|--|;|%)[ \t]?/;
  }
  if (close === -1) return { notes: '', code }; // unterminated: leave it alone

  let rest = close + 1;
  while (rest < lines.length && !lines[rest].trim()) rest++;
  const remaining = lines.slice(rest).join('\n');
  // A closer inside a note would strand the rest of that note at the top of the
  // committed solution; treat that as no block at all rather than corrupt code.
  if (closer && (lines[rest] ?? '').trim().includes(closer)) return { notes: '', code };

  const notes = lines
    .slice(open + 1, close)
    .map((line) => line.replace(strip, ''))
    .join('\n')
    .trim();
  return { notes, code: remaining };
}

/**
 * Whether 0-based `lineIndex` of `text` falls inside the thinking block at
 * its top, for the caret check that keeps note-taking in the thinking phase.
 */
export function lineInThinkingArea(text, lineIndex, langId) {
  const lines = text.split('\n');
  let head = 0;
  while (head < lines.length && !lines[head].trim()) head++;
  if (!THINK_HEADER_RE.test(lines[head] ?? '')) return false;
  const block = blockDelimiters(langId);
  if (!block) return false;
  const close = lines.findIndex((l, i) => i > head && l.trim() === block[1]);
  return close !== -1 && lineIndex >= head && lineIndex <= close;
}
