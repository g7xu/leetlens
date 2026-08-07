// LeetLens dashboard: loads data/index.json, applies filters, renders tiles,
// weak areas, the revenge list, charts (charts.js) and the sessions table.

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

// -- weak areas --------------------------------------------------------
// Same formula as the MCP server's get_weak_areas tool (mcp/…/stats.py), so
// the dashboard and Claude tell the same story:
//   score = 0.4*give_up_rate + 0.3*slowness + 0.2*debugging share + 0.1*run factor

function weakAreas(rows, minSessions = 2, topN = 5) {
  if (!rows.length) return [];
  const globalMedian = median(rows.map((s) => s.total_active_sec)) || 1;
  const globalRuns = rows.reduce((sum, s) => sum + s.run_count, 0) / rows.length || 1;
  const byTag = {};
  for (const s of rows) for (const tag of s.tags) (byTag[tag] ??= []).push(s);
  return Object.entries(byTag)
    .filter(([, list]) => list.length >= minSessions)
    .map(([tag, list]) => {
      const avg = (fn) => list.reduce((sum, s) => sum + fn(s), 0) / list.length;
      const avgTotal = avg((s) => s.total_active_sec);
      const giveUpRate = list.filter((s) => s.outcome === 'gave_up').length / list.length;
      const debugShare = avg((s) => s.phase_totals_sec.debugging) / Math.max(avgTotal, 1);
      const avgRuns = avg((s) => s.run_count);
      const score =
        0.4 * giveUpRate +
        0.3 * (Math.min(avgTotal / globalMedian, 2) / 2) +
        0.2 * debugShare +
        0.1 * (Math.min(avgRuns / globalRuns, 2) / 2);
      return {
        tag,
        score,
        giveUpRate,
        slowness: avgTotal / globalMedian,
        debugShare,
        avgRuns,
        sessions: list.length,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

function renderWeakAreas(rows) {
  const container = $('weakAreas');
  const areas = weakAreas(rows);
  if (!areas.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Not enough tagged sessions yet (needs 2+ sessions per tag).';
    container.replaceChildren(p);
    return;
  }
  const maxScore = areas[0].score || 1;
  container.replaceChildren(...areas.map((a) => {
    const row = document.createElement('div');
    row.className = 'ranked-row';
    const top = document.createElement('div');
    top.className = 'ranked-top';
    const name = document.createElement('span');
    name.className = 'tag-pill';
    name.textContent = a.tag;
    const score = document.createElement('span');
    score.className = 'ranked-score';
    score.textContent = a.score.toFixed(2);
    top.append(name, score);
    const bar = document.createElement('div');
    bar.className = 'score-bar';
    const fill = document.createElement('div');
    fill.style.width = `${(a.score / maxScore) * 100}%`;
    bar.append(fill);
    const detail = document.createElement('div');
    detail.className = 'ranked-detail';
    detail.textContent =
      `${Math.round(a.giveUpRate * 100)}% give-ups · ` +
      `${a.slowness.toFixed(1)}× median time · ` +
      `${Math.round(a.debugShare * 100)}% debugging · ` +
      `${a.avgRuns.toFixed(1)} runs · ${a.sessions} sessions`;
    row.append(top, bar, detail);
    return row;
  }));
}

// -- revenge list --------------------------------------------------------
// Problems with a gave_up session and no accepted session after it.

let slugByDirKey = {};

function revengeList(rows) {
  const byProblem = {};
  for (const s of rows) (byProblem[s.dir_key] ??= []).push(s);
  const out = [];
  for (const list of Object.values(byProblem)) {
    const sorted = [...list].sort((a, b) => a.started_at.localeCompare(b.started_at));
    const lastAccepted = sorted.findLast((s) => s.outcome === 'accepted');
    const lastGaveUp = sorted.findLast((s) => s.outcome === 'gave_up');
    if (lastGaveUp && (!lastAccepted || lastAccepted.started_at < lastGaveUp.started_at)) {
      out.push({
        dir_key: sorted[0].dir_key,
        title: sorted[0].title,
        difficulty: sorted[0].difficulty,
        attempts: sorted.length,
        lastTried: sorted.at(-1).date,
      });
    }
  }
  return out.sort((a, b) => b.lastTried.localeCompare(a.lastTried));
}

function renderRevengeList(rows) {
  const container = $('revengeList');
  const items = revengeList(rows);
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Nothing to avenge — every give-up has been beaten.';
    container.replaceChildren(p);
    return;
  }
  container.replaceChildren(...items.map((item) => {
    const row = document.createElement('div');
    row.className = 'ranked-row';
    const top = document.createElement('div');
    top.className = 'ranked-top';
    const slug = slugByDirKey[item.dir_key];
    const name = slug ? document.createElement('a') : document.createElement('span');
    if (slug) {
      name.href = `https://leetcode.com/problems/${slug}/`;
      name.target = '_blank';
      name.rel = 'noopener';
    }
    name.textContent = item.title;
    const diff = document.createElement('span');
    diff.className = 'ranked-score';
    diff.textContent = item.difficulty;
    top.append(name, diff);
    const detail = document.createElement('div');
    detail.className = 'ranked-detail';
    detail.textContent =
      `${item.attempts} attempt${item.attempts === 1 ? '' : 's'} · last tried ${item.lastTried}`;
    row.append(top, detail);
    return row;
  }));
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
  renderWeakAreas(rows);
  renderRevengeList(rows);
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
  slugByDirKey = Object.fromEntries(index.problems.map((p) => [p.dir_key, p.slug]));
  const tags = Object.keys(index.tags).sort();
  $('tagFilter').append(...tags.map((tag) => new Option(tag, tag)));
  for (const id of ['rangeFilter', 'difficultyFilter', 'tagFilter']) {
    $(id).addEventListener('change', render);
  }
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', render);
  render();
})();
