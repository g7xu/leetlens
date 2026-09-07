// Setup wizard. Three steps that must happen in order — you cannot test a repo
// before you have a credential, or set one up before you have named it — so the
// page shows where you are rather than a flat form with buttons that fail.
// Every network call except the device flow goes through the service worker,
// which owns the GitHub client; the flow polls here because a service worker
// can be evicted mid-wait.

import {
  deviceFlowAvailable, loadAuth, pollForToken, savePersonalToken, signOut, startDeviceFlow,
} from './src/lib/auth.js';
import { getSettings, saveSettings } from './src/lib/github.js';
import { HOSTED_MCP } from './src/lib/repo-setup.js';

const $ = (id) => document.getElementById(id);

function status(id, text, cls = 'muted') {
  $(id).textContent = text;
  $(id).className = `status ${cls}`;
}

const state = { connected: false, repoTested: false, setUp: false };

function repoFields() {
  return {
    owner: $('owner').value.trim(),
    repo: $('repo').value.trim(),
    branch: $('branch').value.trim() || 'main',
  };
}

/** The first unfinished step is the open one; finished ones collapse to a summary. */
function render() {
  const steps = [state.connected, state.repoTested, state.setUp];
  const current = steps.indexOf(false);
  steps.forEach((done, i) => {
    const el = $(`step${i + 1}`);
    el.dataset.state = done ? 'done' : i === current ? 'active' : '';
  });
  $('done').hidden = current !== -1;
  $('signout').hidden = !state.connected;
  if (current === -1) showDoneLinks();
}

function showDoneLinks() {
  const { owner, repo } = repoFields();
  const dash = `https://${owner}.github.io/${repo}/`;
  Object.assign($('dashLink'), { href: dash, textContent: dash });
  const url = `${HOSTED_MCP}/${owner}/${repo}/mcp`;
  $('mcpUrl').textContent = url;
  $('mcpCli').textContent = `claude mcp add --transport http leetlens ${url}`;
}

// -- step 1: credentials -------------------------------------------------

function showCredentialChoice(auth) {
  const hasDeviceFlow = deviceFlowAvailable();
  $('signinBlock').hidden = !hasDeviceFlow;
  $('tokenBlock').hidden = hasDeviceFlow;
  $('useSignin').hidden = !hasDeviceFlow;
  if (auth) {
    $('summary1').textContent = auth.kind === 'app' ? 'signed in' : 'using a token';
  }
}

$('useToken').addEventListener('click', () => {
  $('signinBlock').hidden = true;
  $('tokenBlock').hidden = false;
});

$('useSignin').addEventListener('click', () => {
  $('tokenBlock').hidden = true;
  $('signinBlock').hidden = false;
});

$('signin').addEventListener('click', async () => {
  $('signin').disabled = true;
  status('status1', 'Asking GitHub for a code…');
  try {
    const flow = await startDeviceFlow();
    $('userCode').textContent = flow.userCode;
    $('verifyLink').href = flow.verificationUri;
    $('deviceCode').hidden = false;
    window.open(flow.verificationUri, '_blank');
    status('status1', 'Waiting for you to authorise on GitHub…');
    await pollForToken(flow, {
      onPending: () => status('status1', 'Waiting for you to authorise on GitHub…'),
    });
    state.connected = true;
    $('deviceCode').hidden = true;
    $('summary1').textContent = 'signed in';
    status('status1', 'Connected ✓', 'ok');
    render();
  } catch (err) {
    status('status1', String(err.message ?? err), 'err');
  } finally {
    $('signin').disabled = false;
  }
});

$('saveToken').addEventListener('click', async () => {
  const token = $('token').value.trim();
  if (!token) return status('status1', 'Paste a token first.', 'err');
  await savePersonalToken(token);
  state.connected = true;
  $('summary1').textContent = 'using a token';
  status('status1', 'Token saved ✓', 'ok');
  render();
});

$('signout').addEventListener('click', async () => {
  await signOut();
  state.connected = false;
  state.repoTested = false;
  state.setUp = false;
  $('summary1').textContent = '';
  $('token').value = '';
  status('statusFooter', 'Disconnected.', 'muted');
  render();
});

// -- step 2: the repo ----------------------------------------------------

$('test').addEventListener('click', async () => {
  const settings = repoFields();
  if (!settings.owner || !settings.repo) {
    return status('status2', 'Fill in the owner and repository.', 'err');
  }
  await saveSettings(settings);
  status('status2', 'Testing…');
  const resp = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION', settings });
  if (resp?.ok) {
    state.repoTested = true;
    $('summary2').textContent = resp.repo;
    // Only write access is verifiable here; the permission "Set up repo" also
    // needs cannot be checked without writing a workflow file, so say so
    // rather than let a green check imply the next step will succeed.
    status('status2', `Connected to ${resp.repo} ✓ — sessions can be saved. `
      + 'Whether workflow files can be written shows in step 3.', 'ok');
    render();
  } else {
    $('installHint').hidden = !String(resp?.error ?? '').includes('install');
    $('installLink').href = `https://github.com/apps/leetlens/installations/new`;
    status('status2', resp?.error ?? 'Connection failed', 'err');
  }
});

// -- step 3: repo setup --------------------------------------------------

$('setup').addEventListener('click', async () => {
  await saveSettings(repoFields()); // set up what is on screen, not stale storage
  status('status3', 'Setting up…');
  const resp = await chrome.runtime.sendMessage({ type: 'SETUP_REPO' });
  if (!resp?.ok) return status('status3', resp?.error ?? 'Setup failed', 'err');
  state.setUp = true;
  $('summary3').textContent = 'ready';
  if (resp.pagesEnabled) {
    status('status3', 'Workflow committed, GitHub Pages enabled ✓', 'ok');
  } else {
    const { owner, repo } = repoFields();
    // Turning Pages on needs Administration as well as Pages write, which
    // GitHub only reveals in a response header. Most people will not have
    // granted it, so the manual step is the expected path, not a failure.
    const because = resp.pagesStatus === 403 || resp.pagesStatus === 404
      ? 'your token cannot change repo settings, so '
      : '';
    $('status3').className = 'status ok';
    $('status3').replaceChildren(
      `Workflow committed ✓ — ${because}one manual step is left. Open `,
      Object.assign(document.createElement('a'), {
        href: `https://github.com/${owner}/${repo}/settings/pages`,
        target: '_blank',
        textContent: 'Settings → Pages',
      }),
      ' and set Source to "GitHub Actions". Sessions save either way; this is '
      + 'only the dashboard.',
    );
  }
  render();
});

// -- footer --------------------------------------------------------------

async function refreshQueueCount() {
  const { pendingCommits = [] } = await chrome.storage.local.get('pendingCommits');
  $('queueCount').textContent = pendingCommits.length;
}

$('flush').addEventListener('click', async () => {
  const resp = await chrome.runtime.sendMessage({ type: 'FLUSH_QUEUE' });
  status('statusFooter',
    `Retried: ${resp.flushed} committed, ${resp.remaining} still queued.`
    + (resp.lastError ? ` Last error: ${resp.lastError}` : ''),
    resp.remaining ? 'err' : 'ok');
  refreshQueueCount();
});

// -- boot ----------------------------------------------------------------

(async () => {
  const [auth, settings] = await Promise.all([loadAuth(), getSettings()]);
  showCredentialChoice(auth);
  state.connected = Boolean(auth);
  $('owner').value = settings.owner ?? '';
  $('repo').value = settings.repo ?? '';
  $('branch').value = settings.branch ?? 'main';
  // A configured repo means an earlier run got at least this far; the steps
  // stay re-runnable, they just start collapsed.
  state.repoTested = Boolean(auth && settings.owner && settings.repo);
  if (state.repoTested) $('summary2').textContent = `${settings.owner}/${settings.repo}`;
  render();
  refreshQueueCount();
})();
