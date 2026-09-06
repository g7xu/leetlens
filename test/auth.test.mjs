// The credential lifecycle: device flow, refresh, and the migration from the
// token people pasted before the app existed.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { installFakeChrome, installFakeFetch } from './helpers/fake-chrome.mjs';

const auth = await import('../extension/src/lib/auth.js');

// The real client id is empty until the app is registered; tests drive the
// flow through the same code by supplying their own.
const FLOW = {
  deviceCode: 'dev-code', userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  intervalMs: 5000, expiresAt: Date.now() + 900_000,
};

test('a token saved before device flow existed becomes a pat credential', async () => {
  const store = installFakeChrome({ github: { owner: 'o', repo: 'r', token: 'ghp_old' } });
  assert.deepEqual(await auth.loadAuth(), { kind: 'pat', access_token: 'ghp_old' });
  // Moved out of `github`, so saving the settings form cannot wipe it.
  assert.equal(store.github.token, undefined);
  assert.deepEqual(store.github, { owner: 'o', repo: 'r' });
  assert.equal(await auth.getAccessToken(), 'ghp_old');
});

test('no credential at all reads as null rather than throwing', async () => {
  installFakeChrome({ github: { owner: 'o', repo: 'r' } });
  assert.equal(await auth.loadAuth(), null);
  assert.equal(await auth.getAccessToken(), null);
});

test('polling waits through authorization_pending and honours slow_down', async () => {
  installFakeChrome();
  const calls = installFakeFetch([
    { json: { error: 'authorization_pending' } },
    { json: { error: 'slow_down', interval: 10 } },
    { json: { access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28800 } },
  ]);
  const waits = [];
  let pending = 0;
  const saved = await auth.pollForToken(FLOW, {
    onPending: () => { pending += 1; },
    sleep: async (ms) => { waits.push(ms); },
  });
  assert.equal(pending, 1);
  assert.deepEqual(waits, [5000, 5000, 10_000], 'slow_down lengthens the interval');
  assert.equal(saved.kind, 'app');
  assert.equal(saved.access_token, 'ghu_new');
  assert.ok(saved.expires_at > Date.now());
  assert.equal(calls[0].body.grant_type, 'urn:ietf:params:oauth:grant-type:device_code');
  assert.equal(await auth.getAccessToken(), 'ghu_new');
});

test('a cancelled or expired authorisation says which', async () => {
  installFakeChrome();
  installFakeFetch([{ json: { error: 'access_denied' } }]);
  await assert.rejects(auth.pollForToken(FLOW, { sleep: async () => {} }), /cancelled/);

  installFakeFetch([{ json: { error: 'expired_token' } }]);
  await assert.rejects(auth.pollForToken(FLOW, { sleep: async () => {} }), /expired/);

  installFakeFetch([]);
  await assert.rejects(
    auth.pollForToken({ ...FLOW, expiresAt: Date.now() - 1 }, { sleep: async () => {} }),
    /expired/);
});

test('an expiring token is refreshed once, and the new pair is stored', async () => {
  const store = installFakeChrome({
    githubAuth: {
      kind: 'app', access_token: 'ghu_old', refresh_token: 'ghr_old',
      expires_at: Date.now() + 60_000, // inside the refresh margin
    },
  });
  const calls = installFakeFetch([
    { json: { access_token: 'ghu_fresh', refresh_token: 'ghr_fresh', expires_in: 28800 } },
  ]);
  assert.equal(await auth.getAccessToken(), 'ghu_fresh');
  assert.equal(calls[0].body.grant_type, 'refresh_token');
  assert.equal(calls[0].body.refresh_token, 'ghr_old');
  // The refresh token is single use: the replacement must be what is stored.
  assert.equal(store.githubAuth.refresh_token, 'ghr_fresh');
  // A second call is served from storage, not another refresh.
  assert.equal(await auth.getAccessToken(), 'ghu_fresh');
});

test('a healthy token is used as is', async () => {
  installFakeChrome({
    githubAuth: {
      kind: 'app', access_token: 'ghu_fine', refresh_token: 'r',
      expires_at: Date.now() + 7 * 3600_000,
    },
  });
  installFakeFetch([]); // any fetch here would throw
  assert.equal(await auth.getAccessToken(), 'ghu_fine');
});

test('a token with no expiry is never refreshed', async () => {
  installFakeChrome({ githubAuth: { kind: 'app', access_token: 'ghu_forever', refresh_token: null, expires_at: null } });
  installFakeFetch([]);
  assert.equal(await auth.getAccessToken(), 'ghu_forever');
});

test('a refusal to refresh signs the user out rather than looping', async () => {
  const store = installFakeChrome({
    githubAuth: {
      kind: 'app', access_token: 'ghu_old', refresh_token: 'ghr_dead',
      expires_at: Date.now() + 1000,
    },
  });
  installFakeFetch([{ json: { error: 'bad_refresh_token' } }]);
  await assert.rejects(auth.getAccessToken(), /sign in again/);
  assert.equal(store.githubAuth, undefined);
});

test('device flow is offered only once a client id is configured', () => {
  assert.equal(auth.deviceFlowAvailable(), Boolean(auth.CLIENT_ID));
});
