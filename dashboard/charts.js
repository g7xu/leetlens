// Chart.js chart builders. All colors come from the theme object (CSS custom
// properties), so light/dark swap in one place and stay validated.

const PHASES = ['thinking', 'writing', 'reviewing', 'debugging'];
const instances = [];

export function destroyCharts() {
  while (instances.length) instances.pop().destroy();
}

function baseOptions(t, { horizontal = false } = {}) {
  // Fresh objects per axis — Chart.js mutates these, and a shared ticks
  // object would leak an x-axis formatter onto the y axis.
  const axis = () => ({
    grid: { color: t.grid, drawTicks: false },
    border: { color: t.grid },
    ticks: { color: t.muted, font: { size: 11 } },
  });
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: {
        labels: { color: t.secondary, boxWidth: 10, boxHeight: 10, font: { size: 11 } },
      },
      tooltip: {
        backgroundColor: t.surface,
        titleColor: t.ink,
        bodyColor: t.secondary,
        borderColor: t.grid,
        borderWidth: 1,
      },
    },
    scales: { x: axis(), y: axis() },
  };
}

function make(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  instances.push(new Chart(canvas, config));
}

const toMin = (sec) => Math.round(sec / 6) / 10;

export function buildCharts(rows, t) {
  phasePerSession(rows, t);
  solveTrend(rows, t);
  tagMix(rows, t);
  giveUpByTag(rows, t);
  runHistogram(rows, t);
}

// Stacked bar: one bar per session, minutes per phase.
function phasePerSession(rows, t) {
  const recent = rows.slice(-30);
  const options = baseOptions(t);
  options.scales.x.stacked = true;
  options.scales.y.stacked = true;
  options.scales.y.title = { display: true, text: 'minutes', color: t.muted };
  make('phaseChart', {
    type: 'bar',
    data: {
      labels: recent.map((s) => `${s.date.slice(5)} ${s.title.slice(0, 14)}`),
      datasets: PHASES.map((phase) => ({
        label: phase,
        data: recent.map((s) => toMin(s.phase_totals_sec[phase])),
        backgroundColor: t.phases[phase],
        borderColor: t.surface,
        borderWidth: 1,
        borderRadius: 3,
        maxBarThickness: 26,
      })),
    },
    options,
  });
}

// Line: accepted solve times + rolling median of 5.
function solveTrend(rows, t) {
  const accepted = rows.filter((s) => s.outcome === 'accepted');
  const times = accepted.map((s) => toMin(s.total_active_sec));
  const rolling = times.map((_, i) => {
    const win = times.slice(Math.max(0, i - 4), i + 1).sort((a, b) => a - b);
    return win[Math.floor(win.length / 2)];
  });
  const options = baseOptions(t);
  options.scales.y.title = { display: true, text: 'minutes', color: t.muted };
  make('trendChart', {
    type: 'line',
    data: {
      labels: accepted.map((s) => s.date.slice(5)),
      datasets: [
        {
          label: 'solve time',
          data: times,
          borderColor: t.phases.thinking,
          backgroundColor: t.phases.thinking,
          borderWidth: 2,
          pointRadius: 4,
          tension: 0.25,
        },
        {
          label: 'rolling median (5)',
          data: rolling,
          borderColor: t.phases.writing,
          backgroundColor: t.phases.writing,
          borderWidth: 2,
          pointRadius: 0,
          borderDash: [6, 4],
          tension: 0.25,
        },
      ],
    },
    options,
  });
}

function tagStats(rows) {
  const byTag = {};
  for (const s of rows) {
    for (const tag of s.tags) (byTag[tag] ??= []).push(s);
  }
  return Object.entries(byTag).map(([tag, list]) => {
    const phaseAvg = {};
    for (const phase of PHASES) {
      phaseAvg[phase] = list.reduce((sum, s) => sum + s.phase_totals_sec[phase], 0) / list.length;
    }
    const total = PHASES.reduce((sum, p) => sum + phaseAvg[p], 0) || 1;
    return {
      tag,
      count: list.length,
      phaseShare: Object.fromEntries(PHASES.map((p) => [p, phaseAvg[p] / total])),
      giveUpRate: list.filter((s) => s.outcome === 'gave_up').length / list.length,
    };
  });
}

// Horizontal 100% stacked: average phase share per tag.
function tagMix(rows, t) {
  const stats = tagStats(rows)
    .filter((s) => s.count >= 1)
    .sort((a, b) => b.phaseShare.debugging - a.phaseShare.debugging)
    .slice(0, 12);
  const options = baseOptions(t, { horizontal: true });
  options.scales.x.stacked = true;
  options.scales.y.stacked = true;
  options.scales.x.max = 100;
  options.scales.x.ticks.callback = (v) => `${v}%`;
  options.plugins.tooltip.callbacks = {
    label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.x.toFixed(0)}%`,
  };
  make('tagMixChart', {
    type: 'bar',
    data: {
      labels: stats.map((s) => s.tag),
      datasets: PHASES.map((phase) => ({
        label: phase,
        data: stats.map((s) => s.phaseShare[phase] * 100),
        backgroundColor: t.phases[phase],
        borderColor: t.surface,
        borderWidth: 1,
        borderRadius: 3,
        maxBarThickness: 18,
      })),
    },
    options,
  });
}

// Single-hue bar: give-up rate per tag (only tags seen >= 2 times).
function giveUpByTag(rows, t) {
  const stats = tagStats(rows)
    .filter((s) => s.count >= 2)
    .sort((a, b) => b.giveUpRate - a.giveUpRate)
    .slice(0, 12);
  const options = baseOptions(t, { horizontal: true });
  options.plugins.legend.display = false;
  options.scales.x.max = 100;
  options.scales.x.ticks.callback = (v) => `${v}%`;
  make('giveUpChart', {
    type: 'bar',
    data: {
      labels: stats.map((s) => `${s.tag} (${s.count})`),
      datasets: [{
        data: stats.map((s) => s.giveUpRate * 100),
        backgroundColor: t.accent,
        borderRadius: 3,
        maxBarThickness: 18,
      }],
    },
    options,
  });
}

// Histogram of run counts.
function runHistogram(rows, t) {
  const buckets = Array(11).fill(0);
  for (const s of rows) buckets[Math.min(s.run_count, 10)] += 1;
  const options = baseOptions(t);
  options.plugins.legend.display = false;
  options.scales.y.ticks.precision = 0;
  make('runChart', {
    type: 'bar',
    data: {
      labels: buckets.map((_, i) => (i === 10 ? '10+' : String(i))),
      datasets: [{
        data: buckets,
        backgroundColor: t.accent,
        borderRadius: 3,
        maxBarThickness: 26,
      }],
    },
    options,
  });
}
