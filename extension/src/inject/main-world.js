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
  //
  // It must be a *block* comment. Monaco does not re-insert a line-comment
  // token when the user presses Enter, so a `#`-prefixed region only protects
  // the lines we pre-write — the next line of notes would be parsed as code.
  //
  // LeetCode registers Monaco languages under its own slugs (model
  // .getLanguageId() returns 'python3', 'golang', 'oraclesql', …), so match
  // those — not Monaco's standard ids.
  function blockDelimiters(langId) {
    // r-string: notes containing \d or a Windows path would otherwise raise
    // SyntaxWarning on Python 3.12+.
    if (['python', 'python3', 'pythondata'].includes(langId)) return ['r"""', '"""'];
    if (langId === 'ruby') return ['=begin', '=end']; // must stay at column 0
    if (langId === 'racket') return ['#|', '|#'];
    // No block-comment form exists in these, and a region that breaks the
    // moment you press Enter is worse than none — those users still have the
    // logic-idea box on the save form.
    if (['erlang', 'elixir', 'bash', 'shell'].includes(langId)) return null;
    return ['/*', '*/']; // C family, and every SQL dialect LeetCode offers
  }

  // Must accept every opener blockDelimiters can write, or a block restored by
  // LeetCode's cloud save goes unrecognised and a second one is prepended on
  // every reload. Mirrors THINK_HEADER_RE in src/lib/leetcode-endpoints.js —
  // keep the two in sync; test/thinking-area.test.mjs pins the shapes.
  const THINK_HEADER_RE =
    /^[ \t]*(?:r?"""|'''|\/\*|=begin|#\||#|\/\/|--|;|%)[ \t]*Thinking area\b/im;
  const NON_CODE_LANGS = new Set(['plaintext', 'json', 'markdown']);
  const injectedKeys = new Set();

  function thinkingBlock(langId) {
    const block = blockDelimiters(langId);
    return block && `${block[0]} Thinking area\n\n\n\n${block[1]}\n\n`;
  }

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
    // LeetCode's own record of the selected editor language; localStorage is
    // shared across worlds on this origin.
    try {
      const selected = JSON.parse(window.localStorage.getItem('global_lang') ?? '""');
      const byLang = usable.find((m) => m.getLanguageId?.() === selected);
      if (byLang) return byLang;
    } catch {
      /* fall through */
    }
    return usable.find((m) => THINK_HEADER_RE.test(m.getValue())) ?? usable[0];
  }

  function ensureThinkingArea() {
    const slug = (window.location.pathname.match(/^\/problems\/([^/]+)/) || [])[1];
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
      const line = editor?.getPosition?.()?.lineNumber;
      if (!model || !line) return false;
      const lines = model.getValue().split('\n');
      let head = 0;
      while (head < lines.length && !lines[head].trim()) head++;
      if (!THINK_HEADER_RE.test(lines[head] ?? '')) return false;
      const block = blockDelimiters(model.getLanguageId?.());
      if (!block) return false;
      const close = lines.findIndex((l, i) => i > head && l.trim() === block[1]);
      // lineNumber is 1-based; head/close are 0-based indices.
      return close !== -1 && line - 1 >= head && line - 1 <= close;
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
    if (source !== `${SOURCE}-req` || type !== 'GET_EDITOR_CODE') return;
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
