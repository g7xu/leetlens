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

const THINK_HEADER_RE = /^\s*(#|\/\/|--|;|%)\s*Thinking area\b/i;
const THINK_DELIM_RE = /^[#/;%-]{8,}$/;

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
  const open = head + 1;
  if (!THINK_HEADER_RE.test(lines[head] ?? '') ||
      !THINK_DELIM_RE.test((lines[open] ?? '').trim())) {
    return { notes: '', code };
  }
  let close = open + 1;
  while (close < lines.length && !THINK_DELIM_RE.test(lines[close].trim())) close++;
  if (close >= lines.length) return { notes: '', code };
  const notes = lines
    .slice(open + 1, close)
    .map((line) => line.replace(/^\s*(#|\/\/|--|;|%)\s?/, ''))
    .join('\n')
    .trim();
  let rest = close + 1;
  while (rest < lines.length && !lines[rest].trim()) rest++;
  return { notes, code: lines.slice(rest).join('\n') };
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
