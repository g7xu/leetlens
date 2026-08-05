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
    }
  }`;

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
    frontend_id: String(q.questionFrontendId),
    dir_key: dirKey,
    slug,
    title: q.title,
    difficulty: q.difficulty,
    url: `https://leetcode.com/problems/${slug}/`,
  };
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
