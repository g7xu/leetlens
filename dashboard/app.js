// LeetLens dashboard: loads data/index.json, applies filters, renders tiles,
// calendar, charts (charts.js) and the sessions table.

import { buildCharts, destroyCharts } from './charts.js';

const $ = (id) => document.getElementById(id);

async function loadIndex() {
  // ./data/ on GitHub Pages (the workflow copies index.json into the artifact);
  // ../data/ when served straight from the repo root during development.
  for (const path of ['./data/index.json', '../data/index.json']) {
    try {
      const resp = await fetch(path);
      if (resp.ok) return resp.json();
    } catch { /* try next */ }
  }
  throw new Error('could not load index.json');
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function theme() {
  return {
    surface: cssVar('--surface-1'),
    ink: cssVar('--text-primary'),
    secondary: cssVar('--text-secondary'),
    muted: cssVar('--muted'),
    grid: cssVar('--grid'),
    phases: {
      thinking: cssVar('--phase-thinking'),
      writing: cssVar('--phase-writing'),
      reviewing: cssVar('--phase-reviewing'),
      debugging: cssVar('--phase-debugging'),
    },
    accent: cssVar('--accent'),
    seq: [cssVar('--seq-1'), cssVar('--seq-2'), cssVar('--seq-3'), cssVar('--seq-4'), cssVar('--seq-5')],
  };
}

const fmtMin = (sec) => `${Math.round(sec / 60)}m`;

// -- filtering ---------------------------------------------------------

function applyFilters(sessions) {
  const range = $('rangeFilter').value;
  const difficulty = $('difficultyFilter').value;
  const tag = $('tagFilter').value;
  let rows = sessions;
  if (range !== 'all') {
    const cutoff = new Date(Date.now() - Number(range) * 86400_000)
      .toISOString().slice(0, 10);
    rows = rows.filter((s) => s.date >= cutoff);
  }
  if (difficulty) rows = rows.filter((s) => s.difficulty === difficulty);
  if (tag) rows = rows.filter((s) => s.tags.includes(tag));
  return rows;
}

// -- tiles -------------------------------------------------------------

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function streakDays(sessions) {
  const days = new Set(sessions.map((s) => s.date));
  if (!days.size) return 0;
  let day = new Date([...days].sort().at(-1));
  let streak = 0;
  while (days.has(day.toISOString().slice(0, 10))) {
    streak += 1;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

function renderTiles(rows) {
  const solved = new Set(rows.filter((s) => s.outcome === 'accepted').map((s) => s.dir_key)).size;
  const gaveUp = rows.filter((s) => s.outcome === 'gave_up').length;
  const rate = rows.length ? Math.round((gaveUp / rows.length) * 100) : 0;
  const med = median(rows.filter((s) => s.outcome === 'accepted').map((s) => s.total_active_sec));
  const tiles = [
    { label: 'problems solved', value: solved },
    { label: 'sessions', value: rows.length },
    { label: 'give-up rate', value: `${rate}%`, cls: rate > 25 ? 'bad' : '' },
    { label: 'median solve time', value: fmtMin(med) },
    { label: 'day streak', value: streakDays(rows), cls: 'good' },
  ];
  $('tiles').replaceChildren(...tiles.map(({ label, value, cls }) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    const valueEl = document.createElement('div');
    valueEl.className = `value ${cls ?? ''}`;
    valueEl.textContent = value;
    const labelEl = document.createElement('div');
    labelEl.className = 'label';
    labelEl.textContent = label;
    tile.append(valueEl, labelEl);
    return tile;
  }));
}

// -- calendar ----------------------------------------------------------

function renderCalendar(rows, t) {
  const byDay = {};
  for (const s of rows) byDay[s.date] = (byDay[s.date] ?? 0) + s.total_active_sec;
  const weeks = 26;
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks * 7 - 1) - today.getDay());
  const container = $('calendar');
  container.replaceChildren();
  const max = Math.max(...Object.values(byDay), 1);
  const day = new Date(start);
  for (let w = 0; w < weeks; w++) {
    const col = document.createElement('div');
    col.className = 'cal-week';
    for (let d = 0; d < 7; d++) {
      const key = day.toISOString().slice(0, 10);
      const cell = document.createElement('div');
      cell.className = 'cal-day';
      const sec = byDay[key];
      if (sec) {
        const step = Math.min(4, Math.floor((sec / max) * 4) + 1);
        cell.style.background = t.seq[step];
        cell.style.borderColor = 'transparent';
        cell.title = `${key}: ${fmtMin(sec)} active`;
      } else {
        cell.title = key;
      }
      col.append(cell);
      day.setDate(day.getDate() + 1);
    }
    container.append(col);
  }
  container.scrollLeft = container.scrollWidth;
}

// -- sessions table ------------------------------------------------------

function renderTable(rows) {
  const tbody = $('sessionTable').querySelector('tbody');
  tbody.replaceChildren(...[...rows].reverse().slice(0, 25).map((s) => {
    const tr = document.createElement('tr');
    const cells = [
      s.date,
      s.title + (s.attempt_number > 1 ? ` (#${s.attempt_number})` : ''),
      s.difficulty,
      s.outcome.replace('_', ' '),
      fmtMin(s.total_active_sec),
      s.run_count,
    ];
    for (const [i, text] of cells.entries()) {
      const td = document.createElement('td');
      td.textContent = text;
      if (i === 3) td.className = `outcome-${s.outcome}`;
      tr.append(td);
    }
    const tagTd = document.createElement('td');
    tagTd.replaceChildren(...s.tags.map((tag) => {
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.textContent = tag;
      return pill;
    }));
    tr.append(tagTd);
    return tr;
  }));
}

// -- boot ----------------------------------------------------------------

let index;

function render() {
  const rows = applyFilters(index.sessions);
  const t = theme();
  renderTiles(rows);
  renderCalendar(rows, t);
  renderTable(rows);
  destroyCharts();
  buildCharts(rows, t);
}

(async () => {
  try {
    index = await loadIndex();
  } catch (err) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = `Failed to load data: ${err.message}`;
    document.body.append(p);
    return;
  }
  $('generatedAt').textContent = `updated ${index.generated_at.slice(0, 10)}`;
  const tags = Object.keys(index.tags).sort();
  $('tagFilter').append(...tags.map((tag) => new Option(tag, tag)));
  for (const id of ['rangeFilter', 'difficultyFilter', 'tagFilter']) {
    $(id).addEventListener('change', render);
  }
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', render);
  render();
})();
