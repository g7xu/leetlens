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
  let currentTopicTags = []; // LeetCode's own topic tags for the current problem

  async function getKnownTags() {
    try {
      const { knownTags = [] } = await chrome.storage.local.get('knownTags');
      return knownTags;
    } catch {
      return []; // orphaned context — suggestions just come up empty
    }
  }

  /** Save-form suggestions: locally used tags, then the repo's tag vocabulary
   *  (works on a fresh profile), then LeetCode's topic tags for this problem. */
  async function getSuggestedTags() {
    const local = await getKnownTags();
    let repoTags = [];
    try {
      repoTags = (await chrome.runtime.sendMessage({ type: 'GET_REPO_TAGS' }))?.tags ?? [];
    } catch {
      /* service worker unavailable — local suggestions still work */
    }
    return [...new Set([...local, ...repoTags, ...currentTopicTags])];
  }

  async function rememberTags(tags) {
    const known = await getKnownTags();
    const merged = [...new Set([...tags, ...known])].slice(0, 200);
    await chrome.storage.local.set({ knownTags: merged });
  }

  /** False once the extension is reloaded/updated: this script is then an
   *  orphan and every chrome.* call throws "Extension context invalidated". */
  function contextAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  /** Shut down quietly instead of throwing from an orphaned script. The new
   *  extension version only injects into pages loaded after the reload, so
   *  tracking resumes on the next page refresh (state is in storage). */
  function orphanTeardown() {
    stopLoops();
    panel?.destroy();
    panel = null;
    machine = null;
    console.info('LeetLens: extension was reloaded — refresh this page to keep tracking.');
  }

  function persist() {
    if (!machine || !currentSlug) return;
    if (!contextAlive()) {
      orphanTeardown();
      return;
    }
    chrome.storage.local
      .set({ [storageKey(currentSlug)]: machine.snapshot() })
      .catch(() => {}); // context can die between the check and the call
  }

  function clearStored(slug) {
    if (!contextAlive()) return Promise.resolve();
    return chrome.storage.local.remove(storageKey(slug)).catch(() => {});
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

  /** Peel the thinking-area block off captured code: the block text becomes
   *  the logic-idea draft, and the committed solution file stays clean. */
  function captureCodeAndNotes(payload) {
    const { notes, code } = endpoints.extractThinkingArea(payload.code ?? '');
    machine.captureCode(code, payload.lang);
    if (notes) machine.notes = notes;
  }

  /**
   * Ask the MAIN world for the editor's current contents. Run/submit bodies
   * only tell us what the code was at the last run, so notes written (or
   * revised) afterwards — and every give-up with no run at all — would
   * otherwise never be recorded.
   *
   * Uses its own listener rather than the dispatcher below, which drops
   * messages once the session has ended. Resolves null if the MAIN world
   * doesn't answer, so finishing never hangs on a missing injector.
   */
  function requestEditorCode(timeoutMs = 250) {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(value);
      };
      const onMessage = (event) => {
        if (event.source !== window || event.data?.source !== 'leetlens') return;
        if (event.data.type !== 'EDITOR_CODE' || event.data.payload?.id !== id) return;
        finish(event.data.payload);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      window.addEventListener('message', onMessage);
      window.postMessage(
        { source: 'leetlens-req', type: 'GET_EDITOR_CODE', id },
        window.location.origin,
      );
    });
  }

  let ending = false;

  async function endSession(outcome) {
    if (!machine || machine.ended || ending) return;
    if (!contextAlive()) {
      orphanTeardown();
      return;
    }
    // Guards above are synchronous; the await below opens a window in which a
    // second Finish click or an accepted SUBMIT_RESULT could re-enter.
    ending = true;
    try {
      const live = await requestEditorCode();
      // teardown() or an orphaned context can null the machine mid-await.
      if (!machine || machine.ended) return;
      if (live?.code != null) {
        const { notes, code } = endpoints.extractThinkingArea(live.code);
        // The editor is authoritative here, so clearing the notes counts too —
        // unlike the run/submit path, which must not clobber with empty.
        machine.notes = notes;
        // Only fill a gap: a session with no run has no captured code at all
        // and would commit no solution file. Never overwrite code that earned
        // an Accepted with whatever happens to be in the editor now.
        if (!machine.typedCode) machine.captureCode(code, live.lang);
      }
      machine.end(outcome);
      machine.language = endpoints.detectLanguage();
      persist();
      panel.showSaveForm(machine, await getSuggestedTags());
    } finally {
      ending = false;
    }
  }

  function freshSession(problem) {
    machine = new SessionMachine(problem);
    // The save form keeps whatever the last session left in it, and its
    // prefill refuses to overwrite a non-empty box — so without this the
    // second problem solved in one tab silently inherits the first's notes.
    panel.resetSaveForm();
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
      if (resp?.ok || resp?.queued) {
        await rememberTags(values.tags);
        await clearStored(currentSlug);
        const problem = machine.problem;
        // Null the machine so navigating away can't re-persist the already
        // saved session as "ended but never saved".
        machine = null;
        panel.setStatus(
          resp.ok ? 'Saved to GitHub ✓' : 'Offline — queued, will retry automatically',
          resp.ok ? 'ok' : 'warn',
        );
        // The user usually wants to go back to where they came from (problem
        // list, study plan). Offer it instead of navigating automatically.
        if (window.history.length > 1) {
          panel.showSavedActions({
            canGoBack: true,
            onBack: () => window.history.back(),
            onNewSession: () => freshSession(problem),
          });
        } else {
          setTimeout(() => { if (!machine) freshSession(problem); }, 1500);
        }
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
      const meta = await endpoints.fetchProblemMeta(slug);
      problem = meta.problem;
      currentTopicTags = meta.topic_tags;
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
      onReset: async () => { await clearStored(currentSlug); freshSession(machine?.problem ?? problem); },
      onFinish: () => endSession('accepted'),
      onGiveUp: () => endSession('gave_up'),
      onSave: (values) => saveSession(values),
      onDiscard: async () => { await clearStored(currentSlug); freshSession(machine?.problem ?? problem); },
      onResume: () => { panel.showLiveView(); startLoops(); },
      // Routed through endSession so an abandoned session gets the same
      // editor read as Finish and Give up.
      onResumeAbandon: () => endSession('abandoned'),
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
      panel.showSaveForm(machine, await getSuggestedTags());
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
    if (!contextAlive()) {
      orphanTeardown();
      return;
    }
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
        captureCodeAndNotes(payload);
        break;
      case 'RUN_RESULT': machine.runResult(payload.passed); break;
      case 'SUBMIT_STARTED':
        machine.submitStarted();
        captureCodeAndNotes(payload);
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

  // First keystroke in the editor flips thinking -> writing — but only when it
  // lands in the code. Typing in the thinking area is still thinking, and
  // counting it as writing would zero out the phase the tool exists to measure.
  let caretProbeInFlight = false;

  document.addEventListener(
    'input',
    (event) => {
      if (!machine || machine.ended) return;
      if (!(event.target?.closest?.(endpoints.EDITOR_SELECTOR) ||
            event.target?.classList?.contains('inputarea'))) return;
      // Typing is activity wherever it lands, so un-pausing must not depend on
      // the caret check below.
      machine.resume();
      // The flip happens once. After it, editorInput() can no longer change
      // the phase, so skip asking the MAIN world where the caret is.
      if (machine.hasWritten || machine.currentPhase !== 'thinking') {
        machine.editorInput();
        panel?.update(machine);
        return;
      }
      // At most one probe outstanding: this fires per keystroke while the user
      // is still in the thinking phase.
      if (caretProbeInFlight) return;
      caretProbeInFlight = true;
      requestEditorCode().then((live) => {
        caretProbeInFlight = false;
        // No answer means no injector — fall back to the old behaviour rather
        // than never leaving the thinking phase.
        if (!machine || machine.ended || live?.cursorInNotes) return;
        machine.editorInput();
        panel?.update(machine);
      });
    },
    true,
  );

  const slug = endpoints.slugFromPath(window.location.pathname);
  if (slug) init(slug);
})();
