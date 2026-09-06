// Minimal GitHub Contents API client used by the service worker and options page.

export async function getSettings() {
  const { github = {} } = await chrome.storage.local.get('github');
  return { branch: 'main', ...github };
}

export function saveSettings(settings) {
  return chrome.storage.local.set({ github: settings });
}

export function apiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// Slashes stay as separators; anything else a slug or a stamp might carry is escaped.
export function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Create or update a file. Session paths are always new (timestamp+id) so they
 * need no SHA; pass overwrite for stable paths (solution code on re-attempts),
 * where the Contents API requires the existing file's SHA.
 */
export async function putFile(path, content, message, { overwrite = false } = {}) {
  const { token, owner, repo, branch } = await getSettings();
  if (!token || !owner || !repo) {
    throw new Error('LeetLens is not configured — open the extension options first.');
  }
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(path)}`;
  const body = { message, branch, content: b64encode(content) };
  if (overwrite) {
    // Without the existing file's SHA the PUT fails as 422; a 404 here is the
    // one answer that legitimately means "no SHA needed".
    const existing = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, {
      headers: apiHeaders(token),
    });
    if (existing.ok) body.sha = (await existing.json()).sha;
    else if (existing.status !== 404) {
      throw new Error(`GitHub ${existing.status}: could not read ${path} before overwriting it`);
    }
  }
  const resp = await fetch(url, {
    method: 'PUT',
    headers: apiHeaders(token),
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const respBody = await resp.text();
    throw new Error(`GitHub ${resp.status}: ${respBody.slice(0, 200)}`);
  }
  return resp.json();
}

/**
 * Fetch a repo file's raw contents via the Contents API (works for private
 * repos, unlike raw.githubusercontent.com). Returns null when unconfigured or
 * the file doesn't exist; only a 404 counts as "doesn't exist", so a rate
 * limit can never be read as an empty repo by a caller about to overwrite.
 */
export async function getFileRaw(path) {
  const { token, owner, repo, branch } = await getSettings();
  if (!token || !owner || !repo) return null;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`;
  const resp = await fetch(url, {
    headers: { ...apiHeaders(token), Accept: 'application/vnd.github.raw+json' },
  });
  if (resp.ok) return resp.text();
  if (resp.status === 404) return null;
  throw new Error(`GitHub ${resp.status} reading ${path}`);
}

/** Used by the options page "Test connection" button. */
export async function testConnection(settings) {
  const { token, owner, repo } = settings;
  const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: apiHeaders(token),
  });
  if (!resp.ok) return { ok: false, error: `repo lookup failed (${resp.status})` };
  const info = await resp.json();
  if (!info.permissions?.push) {
    return { ok: false, error: 'token cannot push — check Contents: Read and write' };
  }
  return { ok: true, repo: info.full_name };
}
