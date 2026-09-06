// Runs in the page's MAIN world at document_start. Observes LeetCode's own
// network traffic (never blocks or modifies it) and reports events to the
// content script via window.postMessage. Holds no state beyond pending ids.
// No chrome.* here and no runtime imports: the build inlines everything.

import { CHECK_URL, RUN_URL, SUBMIT_URL, slugFromPath, storedLanguage } from '../lib/leetcode-endpoints.js';
import { EVENT_SOURCE, REQUEST_SOURCE } from '../lib/messages.js';
import { THINK_HEADER_RE, lineInThinkingArea, thinkingBlock } from '../lib/thinking-area.js';

(() => {
  'use strict';

  const pendingRuns = new Set();
  const pendingSubmits = new Set();
  const reportedChecks = new Set();

  function emit(type, payload = {}) {
    window.postMessage({ source: EVENT_SOURCE, type, payload }, window.location.origin);
  }

  // Run/submit request bodies carry the editor contents as typed_code — the
  // reliable way to capture the user's code without scraping Monaco.
  function codeFromBody(body) {
    if (typeof body !== 'string') return {};
    try {
      const data = JSON.parse(body);
      if (typeof data.typed_code === 'string' && data.typed_code.trim()) {
        return { code: data.typed_code, lang: data.lang ?? null };
      }
    } catch {
      /* not JSON */
    }
    return {};
  }

  function handleCheckResponse(id, data) {
    if (!data || data.state !== 'SUCCESS' || reportedChecks.has(id)) return;
    reportedChecks.add(id);
    if (pendingRuns.has(id) || String(id).startsWith('runcode_')) {
      pendingRuns.delete(id);
      // For test runs, "Accepted" only means it executed; correct_answer says
      // whether output matched the expected output (absent for custom input).
      const passed =
        data.run_success === true &&
        data.status_msg === 'Accepted' &&
        data.correct_answer !== false;
      emit('RUN_RESULT', { passed, statusMsg: data.status_msg });
    } else {
      pendingSubmits.delete(id);
      emit('SUBMIT_RESULT', {
        accepted: data.status_msg === 'Accepted',
        statusMsg: data.status_msg,
      });
    }
  }

  // Shared by the fetch and XHR hooks: `data` is the parsed response body.
  function observe(url, data, requestBody) {
    if (!data || typeof data !== 'object') return;
    if (RUN_URL.test(url)) {
      if (data.interpret_id) pendingRuns.add(data.interpret_id);
      emit('RUN_STARTED', codeFromBody(requestBody));
    } else if (SUBMIT_URL.test(url)) {
      if (data.submission_id) pendingSubmits.add(String(data.submission_id));
      emit('SUBMIT_STARTED', codeFromBody(requestBody));
    } else {
      const m = url.match(CHECK_URL);
      if (m) handleCheckResponse(m[1], data);
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (url && (RUN_URL.test(url) || SUBMIT_URL.test(url) || CHECK_URL.test(url))) {
      // Detached from the response the page is awaiting, so nothing here can
      // delay or break it. A body that is not the JSON we expect is skipped.
      response.clone().json()
        .then((data) => observe(url, data, args[1]?.body))
        .catch((err) => console.debug('LeetLens: skipped a response', err));
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__leetlensUrl = String(url);
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const requestBody = args[0];
    this.addEventListener('load', () => {
      const url = this.__leetlensUrl;
      if (!url || !(RUN_URL.test(url) || SUBMIT_URL.test(url) || CHECK_URL.test(url))) return;
      let data;
      try {
        data = JSON.parse(this.responseText); // responseText throws for blob/arraybuffer
      } catch {
        return;
      }
      observe(url, data, requestBody);
    });
    return originalSend.apply(this, args);
  };

  // -- thinking area -----------------------------------------------------
  // A comment block prepended to the editor for sketching the approach; the
  // content script strips it from captured code and keeps the text as the
  // logic-idea draft (src/lib/thinking-area.js owns the format).
  const NON_CODE_LANGS = new Set(['plaintext', 'json', 'markdown']);
  const injectedKeys = new Set();

  /**
   * The model the user is actually solving in. getModels() also returns the
   * editorial and solution playgrounds LeetCode mounts on the same page, and
   * its order is unspecified, so injecting into all of them (or trusting the
   * first) puts thinking areas in the wrong editors.
   */
  function pickEditorModel() {
    const models = window.monaco?.editor?.getModels?.() ?? [];
    const usable = models.filter((m) => {
      const lang = m.getLanguageId?.();
      return lang && !NON_CODE_LANGS.has(lang);
    });
    if (usable.length <= 1) return usable[0] ?? null;
    // Playgrounds are read-only; the solve editor is not.
    const editors = window.monaco?.editor?.getEditors?.() ?? [];
    const writable = editors.filter((e) => {
      try {
        return e.getContainerDomNode?.()?.isConnected &&
          !e.getOption?.(window.monaco.editor.EditorOption.readOnly);
      } catch {
        return false;
      }
    });
    const focused = writable.find((e) => e.hasTextFocus?.())?.getModel?.();
    if (focused && usable.includes(focused)) return focused;
    const writableModel = writable.map((e) => e.getModel?.()).find((m) => usable.includes(m));
    if (writableModel) return writableModel;
    const selected = storedLanguage();
    const byLang = selected && usable.find((m) => m.getLanguageId?.() === selected);
    if (byLang) return byLang;
    return usable.find((m) => THINK_HEADER_RE.test(m.getValue())) ?? usable[0];
  }

  function ensureThinkingArea() {
    const slug = slugFromPath(window.location.pathname);
    if (!slug) return;
    try {
      const model = pickEditorModel();
      const lang = model?.getLanguageId?.();
      if (!lang) return;
      const key = `${slug}:${lang}`;
      if (injectedKeys.has(key)) return; // once per problem+language: deleting it is respected
      const value = model.getValue();
      if (!value.trim()) return; // template not loaded yet — retry next tick
      const block = thinkingBlock(lang);
      if (!block) return; // language has no safe block-comment form
      injectedKeys.add(key);
      if (THINK_HEADER_RE.test(value)) return; // restored by LeetCode's own cloud save
      model.pushEditOperations(
        [],
        [{ range: new window.monaco.Range(1, 1, 1, 1), text: block }],
        () => null,
      );
    } catch {
      /* never let injection break the editor */
    }
  }

  setInterval(ensureThinkingArea, 1000);

  /**
   * Where the caret sits relative to the thinking block, so the content script
   * can tell note-taking apart from coding — otherwise the first keystroke in
   * the block flips the session from the thinking phase to writing, and using
   * the feature zeroes out the metric it exists to measure.
   */
  function cursorInThinkingArea() {
    try {
      const editor = (window.monaco?.editor?.getEditors?.() ?? [])
        .find((e) => e.hasTextFocus?.());
      const model = editor?.getModel?.();
      const line = editor?.getPosition?.()?.lineNumber; // 1-based
      if (!model || !line) return false;
      return lineInThinkingArea(model.getValue(), line - 1, model.getLanguageId?.());
    } catch {
      return false;
    }
  }

  // -- requests from the content script ----------------------------------
  // The content script pulls the editor contents when the user finishes a
  // session. Requests carry their own source tag so this listener never sees
  // its own emit() traffic, and content.js's dispatcher ignores the request.
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const { source, type, id } = event.data ?? {};
    if (source !== REQUEST_SOURCE || type !== 'GET_EDITOR_CODE') return;
    let payload = { id, code: null, lang: null, cursorInNotes: false };
    try {
      const model = pickEditorModel();
      if (model) {
        payload = {
          id,
          code: model.getValue(),
          lang: model.getLanguageId?.() ?? null,
          cursorInNotes: cursorInThinkingArea(),
        };
      }
    } catch {
      /* reply with nulls: the caller treats it as "no reading available" */
    }
    emit('EDITOR_CODE', payload);
  });

  // LeetCode is a SPA: surface URL changes so the tracker can switch problems.
  const emitUrlChange = () => emit('URL_CHANGED', { href: window.location.href });
  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    const result = originalPushState.apply(this, args);
    emitUrlChange();
    return result;
  };
  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);
    emitUrlChange();
    return result;
  };
  window.addEventListener('popstate', emitUrlChange);
})();
