// Receives finished sessions from the content script and commits them to
// GitHub. Failed commits are queued in storage and retried on startup.

import { getFileRaw, putFile, testConnection } from '../lib/github.js';

// Tag vocabulary from the repo's data/index.json, so suggestions work on a
// fresh browser profile. Cached with a TTL to avoid an API call per problem page.
const REPO_TAGS_TTL_MS = 60 * 60_000;

async function getRepoTags() {
  const { repoTagsCache } = await chrome.storage.local.get('repoTagsCache');
  if (repoTagsCache && Date.now() - repoTagsCache.fetchedAt < REPO_TAGS_TTL_MS) {
    return repoTagsCache.tags;
  }
  try {
    const raw = await getFileRaw('data/index.json');
    if (raw === null) return repoTagsCache?.tags ?? []; // unconfigured/missing: don't cache
    const tags = Object.keys(JSON.parse(raw).tags ?? {}).sort();
    await chrome.storage.local.set({ repoTagsCache: { tags, fetchedAt: Date.now() } });
    return tags;
  } catch {
    return repoTagsCache?.tags ?? [];
  }
}

function sessionPath(record) {
  const stamp = record.started_at.replace(/[:]/g, '-').replace(/\.\d+/, '');
  return `data/sessions/${record.problem.dir_key}/${stamp}_${record.session_id}.json`;
}

function commitMessage(record) {
  const mins = Math.round(record.total_active_sec / 60);
  return `session: ${record.problem.dir_key} (${record.outcome}, ${mins}m)`;
}

// LeetCode language slug -> file extension (LeetHub layout: <dir_key>/<dir_key>.<ext>).
const LANG_EXT = {
  python: 'py', python3: 'py', cpp: 'cpp', c: 'c', java: 'java',
  javascript: 'js', typescript: 'ts', golang: 'go', rust: 'rs',
  csharp: 'cs', kotlin: 'kt', swift: 'swift', ruby: 'rb', scala: 'scala',
  php: 'php', dart: 'dart', racket: 'rkt', erlang: 'erl', elixir: 'ex',
  mysql: 'sql', mssql: 'sql', oraclesql: 'sql', postgresql: 'sql',
};

function codePath(record, lang) {
  const ext = LANG_EXT[lang] ?? 'txt';
  return `${record.problem.dir_key}/${record.problem.dir_key}.${ext}`;
}

async function commitRecord(record) {
  return putFile(sessionPath(record), JSON.stringify(record, null, 2) + '\n', commitMessage(record));
}

async function commitCode(record, code) {
  const content = code.content.endsWith('\n') ? code.content : code.content + '\n';
  return putFile(codePath(record, code.lang), content,
    `solution: ${record.problem.dir_key} (${code.lang})`, { overwrite: true });
}

/**
 * Commit a queue entry: session JSON first, then the solution code if captured.
 * `sessionSaved` makes retries idempotent — a retry after a code-only failure
 * must not commit the session file twice.
 */
async function commitEntry(entry) {
  if (!entry.sessionSaved) {
    await commitRecord(entry.record);
    entry.sessionSaved = true;
  }
  if (entry.code) await commitCode(entry.record, entry.code);
}

async function enqueue(entry) {
  const { pendingCommits = [] } = await chrome.storage.local.get('pendingCommits');
  pendingCommits.push(entry);
  await chrome.storage.local.set({ pendingCommits });
}

async function flushQueue() {
  const { pendingCommits = [] } = await chrome.storage.local.get('pendingCommits');
  if (!pendingCommits.length) return { flushed: 0, remaining: 0 };
  const remaining = [];
  let flushed = 0;
  for (const item of pendingCommits) {
    // Entries queued before solution-code support were bare records.
    const entry = item.record ? item : { record: item, code: null, sessionSaved: false };
    try {
      await commitEntry(entry);
      flushed += 1;
    } catch {
      remaining.push(entry);
    }
  }
  await chrome.storage.local.set({ pendingCommits: remaining });
  return { flushed, remaining: remaining.length };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'COMMIT_SESSION': {
        const entry = { record: message.record, code: message.code ?? null, sessionSaved: false };
        try {
          await commitEntry(entry);
          sendResponse({ ok: true });
        } catch (err) {
          const text = String(err);
          // Config problems should surface to the user; transient/network
          // problems get queued for retry.
          if (text.includes('not configured') || text.includes('GitHub 401') ||
              text.includes('GitHub 403') || text.includes('GitHub 404')) {
            sendResponse({ ok: false, error: text });
          } else {
            await enqueue(entry);
            sendResponse({ ok: false, queued: true, error: text });
          }
        }
        break;
      }
      case 'GET_REPO_TAGS':
        sendResponse({ tags: await getRepoTags() });
        break;
      case 'TEST_CONNECTION':
        sendResponse(await testConnection(message.settings));
        break;
      case 'FLUSH_QUEUE':
        sendResponse(await flushQueue());
        break;
      default:
        sendResponse({ ok: false, error: `unknown message: ${message.type}` });
    }
  })();
  return true; // keep the channel open for the async response
});

chrome.runtime.onStartup.addListener(() => { flushQueue(); });
chrome.runtime.onInstalled.addListener(() => { flushQueue(); });
