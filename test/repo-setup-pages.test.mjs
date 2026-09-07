// Turning on GitHub Pages. The failure this guards against is silent: the
// repo reports success, and every dashboard deploy 404s afterwards.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { installFakeChrome, installFakeFetch } from './helpers/fake-chrome.mjs';

const { enablePages } = await import('../extension/src/lib/repo-setup.js');

function connected() {
  installFakeChrome({
    github: { owner: 'o', repo: 'r', branch: 'main' },
    githubAuth: { kind: 'pat', access_token: 't' },
  });
}

test('a repo with no Pages site gets one, built by the workflow', async () => {
  connected();
  const calls = installFakeFetch([{ status: 201, json: {} }]);
  assert.deepEqual(await enablePages(), { enabled: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { build_type: 'workflow' });
});

test('an existing site is switched to workflow builds, not assumed to be right', async () => {
  connected();
  // 409 means a site exists; it says nothing about how that site builds. A
  // repo on "deploy from a branch" answers 409 and then rejects every deploy.
  const calls = installFakeFetch([
    { status: 409, json: { message: 'already exists' } },
    { status: 200, json: {} },
  ]);
  assert.deepEqual(await enablePages(), { enabled: true });
  assert.equal(calls.length, 2, 'the update call is what fixes an existing site');
  assert.deepEqual(calls[1].body, { build_type: 'workflow' });
});

test('a token without the Pages permission reports the status rather than succeeding', async () => {
  connected();
  installFakeFetch([{ status: 403, json: { message: 'Resource not accessible' } }]);
  assert.deepEqual(await enablePages(), { enabled: false, status: 403 });
});

test('an existing site that cannot be updated is not reported as enabled', async () => {
  connected();
  installFakeFetch([{ status: 409, json: {} }, { status: 403, json: {} }]);
  assert.deepEqual(await enablePages(), { enabled: false, status: 403 });
});
