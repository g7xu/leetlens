// Every LeetCode URL, DOM selector and API shape the extension depends on. If
// LeetCode changes their site, this file is the only place that needs fixing.

export const EDITOR_SELECTOR = '.monaco-editor';

export const PROBLEM_URL = /^\/problems\/([^/]+)/;
export const RUN_URL = /\/problems\/[^/]+\/interpret_solution\/?/;
export const SUBMIT_URL = /\/problems\/[^/]+\/submit\/?/;
export const CHECK_URL = /\/submissions\/detail\/([^/]+)\/check\/?/;
export const GRAPHQL_URL = 'https://leetcode.com/graphql/';

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

// topic_tags sits beside `problem`, not inside it: the session schema forbids
// extra properties on `problem`.
export async function fetchProblemMeta(slug) {
  const resp = await fetch(GRAPHQL_URL, {
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

/** The editor language LeetCode remembers for this browser, or null. localStorage is shared across worlds on this origin. */
export function storedLanguage() {
  try {
    const lang = localStorage.getItem('global_lang');
    if (lang) return JSON.parse(lang);
  } catch {
    /* fall through */
  }
  return null;
}

export function detectLanguage() {
  return storedLanguage() ?? 'unknown';
}
