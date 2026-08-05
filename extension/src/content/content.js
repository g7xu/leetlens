// Isolated-world orchestrator: owns the session machine + panel lifecycle,
// bridges MAIN-world events, persists state, and hands finished sessions to
// the service worker for the GitHub commit.
(async () => {
  if (window.__leetlensLoaded) return;
  window.__leetlensLoaded = true;

  const [{ SessionMachine }, { Panel }, endpoints] = await Promise.all([
    import(chrome.runtime.getURL('src/state/session-machine.js')),
    import(chrome.runtime.getURL('src/content/panel.js')),
    import(chrome.runtime.getURL('src/lib/leetcode-endpoints.js')),
  ]);

  const HEARTBEAT_MS = 15_000;
  const STALE_AFTER_MS = 45 * 60_000;
  const VERSION = chrome.runtime.getManifest().version;

  let machine = null;
  let panel = null;
  let currentSlug = null;
  let tickerId = null;
  let heartbeatId = null;

  const storageKey = (slug) => `session:${slug}`;

  async function getKnownTags() {
    const { knownTags = [] } = await chrome.storage.local.get('knownTags');
    return knownTags;
  }

  async function rememberTags(tags) {
    const known = await getKnownTags();
    const merged = [...new Set([...tags, ...known])].slice(0, 200);
    await chrome.storage.local.set({ knownTags: merged });
  }

  function persist() {
    if (machine && currentSlug) {
      chrome.storage.local.set({ [storageKey(currentSlug)]: machine.snapshot() });
    }
  }

  function clearStored(slug) {
    return chrome.storage.local.remove(storageKey(slug));
  }

  function startLoops() {
    stopLoops();
    tickerId = setInterval(() => {
      if (machine && panel && !machine.ended) panel.update(machine);
    }, 1000);
    heartbeatId = setInterval(persist, HEARTBEAT_MS);
  }

  function stopLoops() {
    clearInterval(tickerId);
    clearInterval(heartbeatId);
  }

  async function endSession(outcome) {
    if (!machine || machine.ended) return;
    machine.end(outcome);
    machine.language = endpoints.detectLanguage();
    persist();
    panel.showSaveForm(machine, await getKnownTags());
  }

  function freshSession(problem) {
    machine = new SessionMachine(problem);
    persist();
    panel.showLiveView();
    panel.update(machine);
  }

  async function saveSession(values) {
    panel.setSaving(true);
    panel.setStatus('');
    const record = machine.toRecord({ ...values, extensionVersion: VERSION });
    const code = machine.typedCode
      ? { content: machine.typedCode, lang: machine.codeLang ?? machine.language ?? 'unknown' }
      : null;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'COMMIT_SESSION', record, code });
      if (resp?.ok) {
        await rememberTags(values.tags);
        await clearStored(currentSlug);
        panel.setStatus('Saved to GitHub ✓', 'ok');
        setTimeout(() => freshSession(machine.problem), 1500);
      } else if (resp?.queued) {
        await rememberTags(values.tags);
        await clearStored(currentSlug);
        panel.setStatus('Offline — queued, will retry automatically', 'warn');
      } else {
        panel.setStatus(resp?.error ?? 'Unknown error saving session', 'err');
      }
    } catch (err) {
      panel.setStatus(String(err), 'err');
    } finally {
      panel.setSaving(false);
    }
  }

  async function init(slug) {
    currentSlug = slug;
    let problem;
    try {
      problem = await endpoints.fetchProblemMeta(slug);
    } catch {
      return; // not a solvable problem page (or GraphQL changed) — stay out of the way
    }

    panel = new Panel({
      onPhase: (phase) => { machine?.setPhase(phase, 'manual'); persist(); panel.update(machine); },
      onPauseToggle: () => {
        if (!machine || machine.ended) return;
        machine.paused ? machine.resume() : machine.pause();
        persist();
        panel.update(machine);
      },
      onReset: async () => { await clearStored(currentSlug); freshSession(machine.problem); },
      onFinish: () => endSession('accepted'),
      onGiveUp: () => endSession('gave_up'),
      onSave: (values) => saveSession(values),
      onDiscard: async () => { await clearStored(currentSlug); freshSession(machine.problem); },
      onResume: () => { panel.showLiveView(); startLoops(); },
      onResumeAbandon: async () => {
        machine.end('abandoned');
        machine.language = endpoints.detectLanguage();
        panel.showSaveForm(machine, await getKnownTags());
      },
      onResumeDiscard: async () => { await clearStored(currentSlug); freshSession(problem); },
    });
    panel.setProblem(`${problem.frontend_id}. ${problem.title}`);

    const stored = (await chrome.storage.local.get(storageKey(slug)))[storageKey(slug)];
    if (stored && !stored.outcome) {
      machine = SessionMachine.fromSnapshot(stored);
      const age = Date.now() - (stored.heartbeat ?? stored.currentStart);
      if (age > STALE_AFTER_MS) {
        panel.update(machine);
        panel.showResumePrompt(age / 60_000);
      } else {
        panel.update(machine);
      }
    } else if (stored && stored.outcome) {
      // Ended but never saved (e.g. tab closed on the save form).
      machine = SessionMachine.fromSnapshot(stored);
      machine.outcome = stored.outcome;
      machine.endedAt = stored.endedAt ?? stored.heartbeat;
      panel.showSaveForm(machine, await getKnownTags());
    } else {
      machine = new SessionMachine(problem);
      persist();
      panel.update(machine);
    }
    startLoops();
  }

  function teardown() {
    persist();
    stopLoops();
    panel?.destroy();
    panel = null;
    machine = null;
    currentSlug = null;
  }

  // -- MAIN-world events -------------------------------------------------
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'leetlens') return;
    const { type, payload } = event.data;
    if (type === 'URL_CHANGED') {
      const slug = endpoints.slugFromPath(new URL(payload.href).pathname);
      if (slug !== currentSlug) {
        teardown();
        if (slug) init(slug);
      }
      return;
    }
    if (!machine || machine.ended) return;
    switch (type) {
      case 'RUN_STARTED':
        machine.runStarted();
        machine.captureCode(payload.code, payload.lang);
        break;
      case 'RUN_RESULT': machine.runResult(payload.passed); break;
      case 'SUBMIT_STARTED':
        machine.submitStarted();
        machine.captureCode(payload.code, payload.lang);
        break;
      case 'SUBMIT_RESULT':
        if (payload.accepted) { endSession('accepted'); return; }
        machine.submitResult(false);
        break;
      default: return;
    }
    persist();
    panel?.update(machine);
  });

  // First keystroke in the editor flips thinking -> writing.
  document.addEventListener(
    'input',
    (event) => {
      if (!machine || machine.ended) return;
      if (event.target?.closest?.(endpoints.EDITOR_SELECTOR) ||
          event.target?.classList?.contains('inputarea')) {
        machine.editorInput();
        panel?.update(machine);
      }
    },
    true,
  );

  const slug = endpoints.slugFromPath(window.location.pathname);
  if (slug) init(slug);
})();
