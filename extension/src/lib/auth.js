// GitHub credentials. Two kinds, one interface: a fine-grained personal access
// token the user pastes, or a GitHub App user token obtained through the OAuth
// device flow. Device flow is what an extension can do safely — it needs only
// a client id, never a secret — and it replaces the three-permission token
// checklist that stops most people from finishing setup.

// The LeetLens GitHub App. Registering it is a maintainer step (docs/github-app.md);
// until this is filled in, the extension offers only the token path.
export const CLIENT_ID = '';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

// App user tokens last 8 hours. Refresh a little early so a save that starts
// just before the boundary does not fail on a token that expires mid-flight.
const REFRESH_MARGIN_MS = 5 * 60_000;
const AUTH_LOCK = 'leetlens-github-auth';

export function deviceFlowAvailable() {
  return Boolean(CLIENT_ID);
}

async function post(url, params) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(params),
  });
  if (!resp.ok) throw new Error(`GitHub ${resp.status} from ${new URL(url).pathname}`);
  return resp.json();
}

/**
 * Stored credentials, migrating a token saved before device flow existed.
 * Auth lives under its own key: the settings form replaces `github` wholesale,
 * which would otherwise sign the user out every time they edit the repo name.
 */
export async function loadAuth() {
  const { githubAuth, github = {} } = await chrome.storage.local.get(['githubAuth', 'github']);
  if (githubAuth) return githubAuth;
  if (github.token) {
    const migrated = { kind: 'pat', access_token: github.token };
    const { token, ...rest } = github;
    await chrome.storage.local.set({ githubAuth: migrated, github: rest });
    return migrated;
  }
  return null;
}

export async function saveAuth(auth) {
  await chrome.storage.local.set({ githubAuth: auth });
  return auth;
}

export async function signOut() {
  await chrome.storage.local.remove('githubAuth');
}

export async function savePersonalToken(token) {
  return saveAuth({ kind: 'pat', access_token: token });
}

/** Ask GitHub for a code, which the user types at verification_uri. */
export async function startDeviceFlow() {
  if (!deviceFlowAvailable()) {
    throw new Error('This build has no GitHub App client id — use a personal access token.');
  }
  const data = await post(DEVICE_CODE_URL, { client_id: CLIENT_ID });
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    intervalMs: (data.interval ?? 5) * 1000,
    expiresAt: Date.now() + (data.expires_in ?? 900) * 1000,
  };
}

function authFromTokenResponse(data) {
  return {
    kind: 'app',
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    // Tokens without an expiry (the app opted out) never need refreshing.
    expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
  };
}

/**
 * Poll until the user finishes authorising in their browser. GitHub dictates
 * the pace: polling faster than `interval` earns a slow_down, which adds five
 * seconds to it. Runs where a document keeps it alive — a service worker can
 * be evicted mid-wait.
 */
export async function pollForToken(flow, { onPending, sleep = defaultSleep } = {}) {
  let intervalMs = flow.intervalMs;
  while (Date.now() < flow.expiresAt) {
    await sleep(intervalMs);
    const data = await post(TOKEN_URL, {
      client_id: CLIENT_ID,
      device_code: flow.deviceCode,
      grant_type: GRANT_TYPE,
    });
    if (data.access_token) return saveAuth(authFromTokenResponse(data));
    switch (data.error) {
      case 'authorization_pending':
        onPending?.();
        break;
      case 'slow_down':
        intervalMs = (data.interval ?? intervalMs / 1000 + 5) * 1000;
        break;
      case 'access_denied':
        throw new Error('Authorisation was cancelled on GitHub.');
      case 'expired_token':
        throw new Error('The code expired before it was entered. Start again.');
      default:
        throw new Error(data.error_description ?? data.error ?? 'GitHub rejected the device code.');
    }
  }
  throw new Error('The code expired before it was entered. Start again.');
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function refresh(auth) {
  const data = await post(TOKEN_URL, {
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: auth.refresh_token,
  });
  if (!data.access_token) {
    await signOut();
    throw new Error('GitHub sign-in expired — open the LeetLens options and sign in again.');
  }
  return saveAuth(authFromTokenResponse(data));
}

function expiring(auth) {
  return auth.expires_at !== null && auth.expires_at - Date.now() < REFRESH_MARGIN_MS;
}

/**
 * A usable token, refreshing first if the stored one is about to expire.
 *
 * A refresh token is single use, so two contexts refreshing at once would
 * leave the loser holding a dead token: the Web Locks API serialises them
 * across the options page and the service worker, and the winner's result is
 * already in storage by the time the loser re-reads it.
 */
export async function getAccessToken() {
  const auth = await loadAuth();
  if (!auth) return null;
  if (auth.kind !== 'app' || !expiring(auth)) return auth.access_token;
  if (!auth.refresh_token) {
    await signOut();
    throw new Error('GitHub sign-in expired — open the LeetLens options and sign in again.');
  }
  return withLock(async () => {
    const current = await loadAuth();
    if (!current) return null;
    if (!expiring(current)) return current.access_token;
    return (await refresh(current)).access_token;
  });
}

function withLock(fn) {
  return navigator.locks?.request ? navigator.locks.request(AUTH_LOCK, fn) : fn();
}
