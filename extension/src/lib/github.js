// Minimal GitHub Contents API client used by the service worker and options page.

export async function getSettings() {
  const { github = {} } = await chrome.storage.local.get('github');
  return { branch: 'main', ...github };
}

export function saveSettings(settings) {
  return chrome.storage.local.set({ github: settings });
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Create a new file. Paths are always new (timestamp+id), so no SHA dance. */
export async function putFile(path, content, message) {
  const { token, owner, repo, branch } = await getSettings();
  if (!token || !owner || !repo) {
    throw new Error('LeetLens is not configured — open the extension options first.');
  }
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({ message, branch, content: b64encode(content) }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`GitHub ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

/** Used by the options page "Test connection" button. */
export async function testConnection(settings) {
  const { token, owner, repo } = settings;
  const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: headers(token),
  });
  if (!resp.ok) return { ok: false, error: `repo lookup failed (${resp.status})` };
  const info = await resp.json();
  if (!info.permissions?.push) {
    return { ok: false, error: 'token cannot push — check Contents: Read and write' };
  }
  return { ok: true, repo: info.full_name };
}
