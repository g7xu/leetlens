// LeetCode's language slugs (what a Monaco model's getLanguageId() returns on
// leetcode.com: 'python3', 'golang', 'oraclesql', 'pythondata', …) and what
// each one implies for the files we write and the comment block we inject.

// Slug -> extension of the committed solution file (LeetHub layout).
export const LANG_EXT = {
  python: 'py', python3: 'py', pythondata: 'py', cpp: 'cpp', c: 'c', java: 'java',
  javascript: 'js', typescript: 'ts', golang: 'go', rust: 'rs',
  csharp: 'cs', kotlin: 'kt', swift: 'swift', ruby: 'rb', scala: 'scala',
  php: 'php', dart: 'dart', racket: 'rkt', erlang: 'erl', elixir: 'ex',
  bash: 'sh', shell: 'sh',
  mysql: 'sql', mssql: 'sql', oraclesql: 'sql', postgresql: 'sql',
};

// Languages with no block-comment form. They get no thinking area: a region
// that turns into code the moment Enter is pressed is worse than none.
export const NO_BLOCK_COMMENT = ['erlang', 'elixir', 'bash', 'shell'];

/** [opener, closer] of the thinking-area block for a language, or null. */
export function blockDelimiters(langId) {
  // r-string: a `\d` or a Windows path in the notes would otherwise raise
  // SyntaxWarning on Python 3.12+.
  if (['python', 'python3', 'pythondata'].includes(langId)) return ['r"""', '"""'];
  if (langId === 'ruby') return ['=begin', '=end']; // must stay at column 0
  if (langId === 'racket') return ['#|', '|#'];
  if (NO_BLOCK_COMMENT.includes(langId)) return null;
  return ['/*', '*/']; // C family, and every SQL dialect LeetCode offers
}
