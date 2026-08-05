// Shadow-DOM tracker panel. Renders state, forwards user intent via callbacks;
// owns no session logic.

import { PANEL_CSS } from './panel.css.js';
import { PHASES } from '../state/session-machine.js';

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

function fmtClock(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export class Panel {
  /**
   * @param callbacks {{ onPhase, onFinish, onGiveUp, onSave, onDiscard,
   *                     onResume, onResumeDiscard, onResumeAbandon }}
   */
  constructor(callbacks) {
    this.cb = callbacks;
    this.host = el('div');
    this.host.id = 'leetlens-root';
    const shadow = this.host.attachShadow({ mode: 'closed' });
    shadow.append(el('style', { textContent: PANEL_CSS }));
    this.card = el('div', { className: 'card' });
    shadow.append(this.card);
    this._build();
    document.body.append(this.host);
  }

  destroy() {
    this.host.remove();
  }

  _build() {
    this.title = el('span', { className: 'title' });
    const chevron = el('span', { className: 'chevron', textContent: '▾' });
    const header = el('div', { className: 'header' }, [
      el('span', { className: 'logo', textContent: '🔍 LeetLens' }),
      this.title,
      chevron,
    ]);
    header.addEventListener('click', () => {
      this.card.classList.toggle('collapsed');
      chevron.textContent = this.card.classList.contains('collapsed') ? '▸' : '▾';
    });

    // live view -------------------------------------------------------
    this.timer = el('span', { className: 'timer', textContent: '00:00' });
    this.badge = el('span', { className: 'phase-badge thinking', textContent: 'thinking' });
    this.pauseBtn = el('button', { className: 'icon-btn', textContent: '⏸', title: 'Pause timer' });
    this.pauseBtn.addEventListener('click', () => this.cb.onPauseToggle());
    this.resetBtn = el('button', { className: 'icon-btn', textContent: '↺', title: 'Restart session' });
    this.resetBtn.addEventListener('click', () => {
      if (this.resetBtn.dataset.armed) {
        delete this.resetBtn.dataset.armed;
        this.resetBtn.textContent = '↺';
        this.cb.onReset();
      } else {
        this.resetBtn.dataset.armed = '1';
        this.resetBtn.textContent = 'sure?';
        setTimeout(() => {
          delete this.resetBtn.dataset.armed;
          this.resetBtn.textContent = '↺';
        }, 3000);
      }
    });
    this.phaseButtons = {};
    const phaseGrid = el('div', { className: 'phase-buttons' });
    for (const phase of PHASES) {
      const btn = el('button', { textContent: phase });
      btn.addEventListener('click', () => this.cb.onPhase(phase));
      this.phaseButtons[phase] = btn;
      phaseGrid.append(btn);
    }
    this.counters = el('div', { className: 'counters' });
    const finishBtn = el('button', { className: 'btn-finish', textContent: '✓ Finish' });
    finishBtn.addEventListener('click', () => this.cb.onFinish());
    const giveUpBtn = el('button', { className: 'btn-giveup', textContent: 'Give up' });
    giveUpBtn.addEventListener('click', () => this.cb.onGiveUp());
    this.liveView = el('div', {}, [
      el('div', { className: 'timer-row' }, [
        this.timer, this.badge,
        el('span', { className: 'spacer' }),
        this.pauseBtn, this.resetBtn,
      ]),
      phaseGrid,
      this.counters,
      el('div', { className: 'actions' }, [finishBtn, giveUpBtn]),
    ]);

    // save form ---------------------------------------------------------
    this.outcomeLabel = el('div', { className: 'outcome' });
    this.totalInputs = {};
    const totalsGrid = el('div', { className: 'totals-grid' });
    for (const phase of PHASES) {
      const input = el('input', { type: 'number', min: '0', step: '0.5' });
      this.totalInputs[phase] = input;
      totalsGrid.append(
        el('div', { className: 'cell' }, [input, el('span', { textContent: `${phase} min` })]),
      );
    }
    this.logicIdea = el('textarea', { rows: 3, placeholder: 'How did you approach it?' });
    this.tagInput = el('input', {
      type: 'text',
      placeholder: 'add tag, press Enter (kebab-case)',
    });
    this.tagChips = el('div', { className: 'tag-chips' });
    this.tags = [];
    this.tagInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this._addTag(this.tagInput.value);
      this.tagInput.value = '';
    });
    this.suggestions = el('div', { className: 'tag-chips' });
    this.comments = el('textarea', { rows: 2, placeholder: 'anything to remember?' });
    const saveBtn = el('button', { className: 'btn-finish', textContent: 'Save to GitHub' });
    saveBtn.addEventListener('click', () => this.cb.onSave(this.formValues()));
    const discardBtn = el('button', { className: 'btn-secondary', textContent: 'Discard' });
    discardBtn.addEventListener('click', () => this.cb.onDiscard());
    this.status = el('div', { className: 'status' });
    this.saveBtn = saveBtn;
    this.saveForm = el('div', { className: 'save-form hidden' }, [
      this.outcomeLabel,
      el('label', { textContent: 'time per phase' }),
      totalsGrid,
      el('label', { textContent: 'logic idea' }),
      this.logicIdea,
      el('label', { textContent: 'tags' }),
      this.tagInput,
      this.tagChips,
      this.suggestions,
      el('label', { textContent: 'comments' }),
      this.comments,
      el('div', { className: 'actions', style: 'margin-top:10px' }, [saveBtn, discardBtn]),
      this.status,
    ]);

    // resume prompt -------------------------------------------------------
    this.resumePrompt = el('div', { className: 'resume-prompt hidden' });

    this.card.append(header, el('div', { className: 'body' }, [
      this.liveView, this.saveForm, this.resumePrompt,
    ]));
  }

  // -- live updates -----------------------------------------------------

  setProblem(title) {
    this.title.textContent = title;
  }

  update(machine, now = Date.now()) {
    this.timer.textContent = fmtClock(machine.elapsedSec(now));
    if (machine.paused) {
      this.badge.textContent = 'paused';
      this.badge.className = 'phase-badge paused';
      this.pauseBtn.textContent = '▶';
      this.pauseBtn.title = 'Resume timer';
    } else {
      this.badge.textContent = machine.currentPhase;
      this.badge.className = `phase-badge ${machine.currentPhase}`;
      this.pauseBtn.textContent = '⏸';
      this.pauseBtn.title = 'Pause timer';
    }
    for (const [phase, btn] of Object.entries(this.phaseButtons)) {
      btn.classList.toggle('active', !machine.paused && phase === machine.currentPhase);
    }
    this.counters.replaceChildren(
      el('span', {}, ['runs ', el('b', { textContent: machine.runCount })]),
      el('span', {}, ['failed ', el('b', { textContent: machine.failedRunCount })]),
      el('span', {}, ['submits ', el('b', { textContent: machine.submitCount })]),
    );
  }

  // -- mode switching -----------------------------------------------------

  showSaveForm(machine, knownTags) {
    this.card.classList.remove('collapsed');
    this.liveView.classList.add('hidden');
    this.resumePrompt.classList.add('hidden');
    this.saveForm.classList.remove('hidden');
    this.outcomeLabel.textContent =
      machine.outcome === 'accepted' ? '✓ Accepted' :
      machine.outcome === 'gave_up' ? 'Gave up — logging it is still a win' : machine.outcome;
    this.outcomeLabel.className = `outcome ${machine.outcome}`;
    const totals = machine.phaseTotalsSec(machine.endedAt);
    for (const phase of PHASES) {
      this.totalInputs[phase].value = (totals[phase] / 60).toFixed(1);
    }
    this.suggestions.replaceChildren(
      ...knownTags.filter((t) => !this.tags.includes(t)).slice(0, 12).map((tag) => {
        const chip = el('span', { className: 'chip', textContent: `+ ${tag}` });
        chip.addEventListener('click', () => this._addTag(tag));
        return chip;
      }),
    );
  }

  showLiveView() {
    this.saveForm.classList.add('hidden');
    this.resumePrompt.classList.add('hidden');
    this.liveView.classList.remove('hidden');
  }

  showResumePrompt(ageMinutes) {
    this.card.classList.remove('collapsed');
    this.liveView.classList.add('hidden');
    this.saveForm.classList.add('hidden');
    this.resumePrompt.classList.remove('hidden');
    const mkBtn = (cls, text, cb) => {
      const b = el('button', { className: cls, textContent: text });
      b.addEventListener('click', cb);
      return b;
    };
    this.resumePrompt.replaceChildren(
      el('p', {
        textContent:
          `Found an unfinished session from ${Math.round(ageMinutes)} minutes ago. ` +
          'Resume it, save it as abandoned, or discard it?',
      }),
      el('div', { className: 'actions' }, [
        mkBtn('btn-finish', 'Resume', () => this.cb.onResume()),
        mkBtn('btn-secondary', 'Abandon', () => this.cb.onResumeAbandon()),
        mkBtn('btn-giveup', 'Discard', () => this.cb.onResumeDiscard()),
      ]),
    );
  }

  // -- form ------------------------------------------------------------

  _addTag(raw) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!tag || this.tags.includes(tag)) return;
    this.tags.push(tag);
    const chip = el('span', { className: 'chip', textContent: `${tag} ✕` });
    chip.addEventListener('click', () => {
      this.tags = this.tags.filter((t) => t !== tag);
      chip.remove();
    });
    this.tagChips.append(chip);
  }

  formValues() {
    const totals = {};
    for (const phase of PHASES) {
      totals[phase] = Math.max(0, Math.round(Number(this.totalInputs[phase].value || 0) * 60));
    }
    return {
      logicIdea: this.logicIdea.value.trim(),
      tags: [...this.tags],
      comments: this.comments.value.trim(),
      phaseTotalsOverride: totals,
    };
  }

  setStatus(text, kind = '') {
    this.status.textContent = text;
    this.status.className = `status ${kind}`;
  }

  setSaving(saving) {
    this.saveBtn.disabled = saving;
    this.saveBtn.textContent = saving ? 'Saving…' : 'Save to GitHub';
  }
}
