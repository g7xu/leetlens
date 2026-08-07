import { getSettings, saveSettings } from './src/lib/github.js';

const $ = (id) => document.getElementById(id);
const status = (text, cls = '') => {
  $('status').textContent = text;
  $('status').className = cls;
};

function formSettings() {
  return {
    owner: $('owner').value.trim(),
    repo: $('repo').value.trim(),
    branch: $('branch').value.trim() || 'main',
    token: $('token').value.trim(),
  };
}

async function refreshQueueCount() {
  const { pendingCommits = [] } = await chrome.storage.local.get('pendingCommits');
  $('queueCount').textContent = pendingCommits.length;
}

$('save').addEventListener('click', async () => {
  await saveSettings(formSettings());
  status('Saved.', 'ok');
});

$('test').addEventListener('click', async () => {
  status('Testing…');
  const resp = await chrome.runtime.sendMessage({
    type: 'TEST_CONNECTION',
    settings: formSettings(),
  });
  if (resp?.ok) status(`Connected to ${resp.repo} with push access ✓`, 'ok');
  else status(resp?.error ?? 'Connection failed', 'err');
});

$('setup').addEventListener('click', async () => {
  await saveSettings(formSettings()); // set up what's on screen, not stale storage
  status('Setting up repo…');
  const resp = await chrome.runtime.sendMessage({ type: 'SETUP_REPO' });
  if (!resp?.ok) {
    status(resp?.error ?? 'Setup failed', 'err');
    return;
  }
  if (resp.pagesEnabled) {
    status('Repo is ready — workflow committed, GitHub Pages enabled ✓', 'ok');
  } else {
    const { owner, repo } = formSettings();
    $('status').className = 'ok';
    $('status').replaceChildren(
      'Workflow committed ✓ — final step: enable Pages at ',
      Object.assign(document.createElement('a'), {
        href: `https://github.com/${owner}/${repo}/settings/pages`,
        target: '_blank',
        textContent: 'Settings → Pages',
      }),
      ' → Source: GitHub Actions.',
    );
  }
});

$('flush').addEventListener('click', async () => {
  const resp = await chrome.runtime.sendMessage({ type: 'FLUSH_QUEUE' });
  status(`Retried: ${resp.flushed} committed, ${resp.remaining} still queued.`,
    resp.remaining ? 'err' : 'ok');
  refreshQueueCount();
});

(async () => {
  const settings = await getSettings();
  $('owner').value = settings.owner ?? '';
  $('repo').value = settings.repo ?? '';
  $('branch').value = settings.branch ?? 'main';
  $('token').value = settings.token ?? '';
  refreshQueueCount();
})();
