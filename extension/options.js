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
