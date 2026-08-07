// Runs in the page's MAIN world at document_start. Observes LeetCode's own
// network traffic (never blocks or modifies it) and reports events to the
// content script via window.postMessage. Holds no state beyond pending ids.
//
// NOTE: this file cannot import modules (MAIN-world content script), so the
// LeetCode URL patterns live here; DOM selectors live in src/lib/leetcode-endpoints.js.
(() => {
  'use strict';

  const SOURCE = 'leetlens';
  const RUN_URL = /\/problems\/[^/]+\/interpret_solution\/?/;
  const SUBMIT_URL = /\/problems\/[^/]+\/submit\/?/;
  const CHECK_URL = /\/submissions\/detail\/([^/]+)\/check\/?/;

  const pendingRuns = new Set();
  const pendingSubmits = new Set();
  const reportedChecks = new Set();

  function emit(type, payload = {}) {
    window.postMessage({ source: SOURCE, type, payload }, window.location.origin);
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

  async function inspect(url, response, requestBody) {
    try {
      if (RUN_URL.test(url)) {
        const data = await response.clone().json();
        if (data.interpret_id) pendingRuns.add(data.interpret_id);
        emit('RUN_STARTED', codeFromBody(requestBody));
      } else if (SUBMIT_URL.test(url)) {
        const data = await response.clone().json();
        if (data.submission_id) pendingSubmits.add(String(data.submission_id));
        emit('SUBMIT_STARTED', codeFromBody(requestBody));
      } else {
        const m = url.match(CHECK_URL);
        if (m) handleCheckResponse(m[1], await response.clone().json());
      }
    } catch {
      /* never let observation break the page */
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (url) inspect(url, response, args[1]?.body);
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
      if (!url) return;
      try {
        if (RUN_URL.test(url)) {
          const data = JSON.parse(this.responseText);
          if (data.interpret_id) pendingRuns.add(data.interpret_id);
          emit('RUN_STARTED', codeFromBody(requestBody));
        } else if (SUBMIT_URL.test(url)) {
          const data = JSON.parse(this.responseText);
          if (data.submission_id) pendingSubmits.add(String(data.submission_id));
          emit('SUBMIT_STARTED', codeFromBody(requestBody));
        } else {
          const m = url.match(CHECK_URL);
          if (m) handleCheckResponse(m[1], JSON.parse(this.responseText));
        }
      } catch {
        /* ignore */
      }
    });
    return originalSend.apply(this, args);
  };

  // -- thinking area -----------------------------------------------------
  // Prepend a comment block to the top of the code editor so the approach
  // gets sketched where the user already is — in the editor — before coding.
  // The content script later strips this block from the captured code and
  // turns it into the session's logic-idea draft.

  // LeetCode registers Monaco languages under its own slugs (model
  // .getLanguageId() returns 'python3', 'golang', 'oraclesql', …), so match
  // those — not Monaco's standard ids.
  function commentToken(langId) {
    if (['python', 'python3', 'ruby', 'elixir', 'bash', 'shell'].includes(langId)) return '#';
    if (['sql', 'mysql', 'mssql', 'oraclesql', 'postgresql', 'pgsql'].includes(langId)) return '--';
    if (['racket', 'scheme', 'lisp'].includes(langId)) return ';';
    if (langId === 'erlang') return '%';
    return '//';
  }

  const THINK_HEADER_RE = /^\s*(?:#|\/\/|--|;|%)\s*Thinking area\b/im;
  const NON_CODE_LANGS = new Set(['plaintext', 'json', 'markdown']);
  const injectedKeys = new Set();

  function thinkingBlock(langId) {
    const token = commentToken(langId);
    const delim = token[0].repeat(18);
    return `${token} Thinking area\n${delim}\n\n\n\n${delim}\n\n`;
  }

  function ensureThinkingArea() {
    const models = window.monaco?.editor?.getModels?.();
    if (!models) return;
    const slug = (window.location.pathname.match(/^\/problems\/([^/]+)/) || [])[1];
    if (!slug) return;
    for (const model of models) {
      try {
        const lang = model.getLanguageId?.();
        if (!lang || NON_CODE_LANGS.has(lang)) continue;
        const key = `${slug}:${lang}`;
        if (injectedKeys.has(key)) continue; // once per problem+language: deleting it is respected
        const value = model.getValue();
        if (!value.trim()) continue; // template not loaded yet — retry next tick
        injectedKeys.add(key);
        if (THINK_HEADER_RE.test(value)) continue; // restored by LeetCode's own cloud save
        model.pushEditOperations(
          [],
          [{ range: new window.monaco.Range(1, 1, 1, 1), text: thinkingBlock(lang) }],
          () => null,
        );
      } catch {
        /* never let injection break the editor */
      }
    }
  }

  setInterval(ensureThinkingArea, 1000);

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
