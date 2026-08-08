// Every LeetCode DOM selector and API shape the isolated-world code depends on.
// If LeetCode changes their site, this file (plus the URL regexes at the top of
// src/inject/main-world.js) is the only place that needs fixing.

export const EDITOR_SELECTOR = '.monaco-editor';

export const PROBLEM_URL = /^\/problems\/([^/]+)/;

export function slugFromPath(pathname) {
  const m = pathname.match(PROBLEM_URL);
  return m ? m[1] : null;
}

const QUESTION_QUERY = `
  query leetlensQuestion($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionFrontendId
      title
      difficulty
      topicTags { slug }
    }
  }`;

/**
 * Problem metadata plus LeetCode's own topic tags. topic_tags is returned
 * alongside (not inside) the problem object because the session schema
 * forbids extra properties on `problem` — callers keep them separate.
 */
export async function fetchProblemMeta(slug) {
  const resp = await fetch('https://leetcode.com/graphql/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUESTION_QUERY, variables: { titleSlug: slug } }),
  });
  const q = (await resp.json())?.data?.question;
  if (!q) throw new Error(`LeetCode GraphQL returned no question for ${slug}`);
  const dirKey = `${String(q.questionFrontendId).padStart(4, '0')}-${slug}`;
  return {
    problem: {
      frontend_id: String(q.questionFrontendId),
      dir_key: dirKey,
      slug,
      title: q.title,
      difficulty: q.difficulty,
      url: `https://leetcode.com/problems/${slug}/`,
    },
    topic_tags: (q.topicTags ?? []).map((t) => t.slug),
  };
}

// Openers main-world.js writes, plus the line-comment tokens older blocks used.
// `#|` must precede `#`, since the captured opener is what selects the parsing
// branch below and the alternation is ordered.
//
// The trailing `[ \t]` (not `\s`) matters twice over: `\s` would match a
// newline and let the pattern run past the header line, and requiring a space
// or tab after `/*` is what stops LeetCode's own `/** Definition for ListNode
// … */` template docblock from being read as a thinking area and stripped out
// of the committed solution. Never loosen this to `\/\*+`.
//
// main-world.js carries its own copy of this pattern (it is a MAIN-world
// script and cannot import). Keep the two in sync; test/thinking-area.test.mjs
// pins the shapes both sides must agree on.
const THINK_HEADER_RE = /^[ \t]*(r?"""|'''|\/\*|=begin|#\||#|\/\/|--|;|%)[ \t]*Thinking area\b/i;
const THINK_DELIM_RE = /^[#/;%-]{8,}$/;

// Block openers -> what terminates them. An opener absent here is a legacy
// line-comment header, whose region is fenced by THINK_DELIM_RE rulers.
const BLOCK_CLOSER = {
  'r"""': '"""', '"""': '"""', "'''": "'''",
  '/*': '*/', '=begin': '=end', '#|': '|#',
};

/**
 * Split the thinking-area comment block (injected by main-world.js) off the
 * top of captured code. Returns the notes written inside the block and the
 * code with the block removed; code passes through untouched when no block
 * starts at the first non-blank line.
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
    // Notes start directly under the header. The closer must be alone on its
    // line — that is how we write it. Matching it as a substring instead would
    // end the block early on a note like `careful: */ ends a comment`, which
    // strands the rest of that note, and the orphaned closer, at the top of
    // the file we commit as the solution.
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
  // A note containing the closer splits the block early, which would strand the
  // rest of the note — and the orphaned closer — at the top of the file we
  // commit. Treat that as no block at all rather than write corrupted code.
  if (closer && (lines[rest] ?? '').trim().includes(closer)) return { notes: '', code };

  const notes = lines
    .slice(open + 1, close)
    .map((line) => line.replace(strip, ''))
    .join('\n')
    .trim();
  return { notes, code: remaining };
}

export function detectLanguage() {
  // LeetCode remembers the editor language here; best-effort only.
  try {
    const lang = localStorage.getItem('global_lang');
    if (lang) return JSON.parse(lang);
  } catch {
    /* fall through */
  }
  return 'unknown';
}
