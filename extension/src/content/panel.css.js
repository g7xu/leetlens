// Panel styles, injected into the shadow root (no bundler, so CSS lives in JS).
export const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; }

.card {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  width: 300px; background: #1c1f26; color: #e8eaed;
  border: 1px solid #333a45; border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0,0,0,.45); font-size: 13px;
}
.card.collapsed .body { display: none; }

.header {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  cursor: pointer; user-select: none;
}
.header .logo { font-weight: 700; letter-spacing: .2px; }
.header .title {
  flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: #9aa3b2; font-size: 12px;
}
.header .chevron { color: #9aa3b2; }

.body { padding: 0 12px 12px; }

.timer-row { display: flex; align-items: baseline; gap: 10px; margin: 2px 0 10px; }
.timer { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
.phase-badge {
  padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600;
  text-transform: capitalize;
}
.phase-badge.thinking  { background: #2d3a55; color: #9db8ff; }
.phase-badge.writing   { background: #2c4436; color: #8fd9a8; }
.phase-badge.reviewing { background: #45402a; color: #e6cf7a; }
.phase-badge.debugging { background: #4a2f33; color: #f2a0a8; }
.phase-badge.paused    { background: #2b2f37; color: #9aa3b2; }

.spacer { flex: 1; }
.icon-btn {
  background: #262b34; color: #c7cdd6; border: 1px solid #333a45;
  border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 12px;
  line-height: 18px;
}
.icon-btn:hover { background: #2e3440; }

.phase-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; }
.phase-buttons button {
  padding: 7px 0; border-radius: 8px; border: 1px solid #333a45;
  background: #262b34; color: #c7cdd6; cursor: pointer; font-size: 12px;
  text-transform: capitalize;
}
.phase-buttons button:hover { background: #2e3440; }
.phase-buttons button.active { border-color: #7aa2ff; color: #fff; background: #2d3a55; }

.counters { display: flex; gap: 12px; color: #9aa3b2; font-size: 12px; margin-bottom: 10px; }
.counters b { color: #e8eaed; }

.actions { display: flex; gap: 6px; }
.actions button {
  flex: 1; padding: 8px 0; border-radius: 8px; border: none; cursor: pointer;
  font-weight: 600; font-size: 12px;
}
.btn-finish { background: #2f6b46; color: #fff; }
.btn-finish:hover { background: #37814f; }
.btn-giveup { background: #6b3038; color: #ffd9dc; }
.btn-giveup:hover { background: #7f3841; }
.btn-secondary { background: #262b34; color: #c7cdd6; border: 1px solid #333a45 !important; }

.save-form label { display: block; margin: 10px 0 4px; color: #9aa3b2; font-size: 11px;
  text-transform: uppercase; letter-spacing: .5px; }
.save-form textarea, .save-form input[type="text"] {
  width: 100%; background: #12151a; color: #e8eaed; border: 1px solid #333a45;
  border-radius: 8px; padding: 7px 9px; font-size: 13px; resize: vertical;
}
.save-form textarea:focus, .save-form input:focus { outline: none; border-color: #7aa2ff; }
.outcome { font-weight: 700; margin-top: 8px; }
.outcome.accepted { color: #8fd9a8; }
.outcome.gave_up { color: #f2a0a8; }

.totals-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.totals-grid .cell { display: flex; align-items: center; gap: 6px; }
.totals-grid input {
  width: 58px; background: #12151a; color: #e8eaed; border: 1px solid #333a45;
  border-radius: 6px; padding: 4px 6px; font-size: 12px;
}
.totals-grid span { color: #9aa3b2; font-size: 11px; text-transform: capitalize; }

.tag-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.chip {
  background: #2d3a55; color: #9db8ff; padding: 2px 8px; border-radius: 999px;
  font-size: 11px; cursor: pointer;
}
.chip:hover { background: #3a4a6b; }

.status { margin-top: 8px; font-size: 12px; min-height: 16px; }
.status.ok { color: #8fd9a8; }
.status.err { color: #f2a0a8; }
.status.warn { color: #e6cf7a; }

.resume-prompt p { margin: 8px 0; color: #c7cdd6; line-height: 1.4; }
.hidden { display: none !important; }
`;
