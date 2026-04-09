// ═══════════════════════════════════════════════
// CHARTS — All Chart.js instances live here.
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { filterTimeSeries } from './timeSeries.js';
import { pct, colorPnl } from './utils.js';

export const COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444',
  '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316',
];

const TOOLTIP_DEFAULTS = {
  backgroundColor: '#1a1a1f',
  borderColor: 'rgba(255,255,255,0.1)',
  borderWidth: 1,
  titleColor: '#8a8a9a',
  bodyColor: '#f0f0f5',
  padding: 10,
};

const AXIS_DEFAULTS = {
  grid: { color: 'rgba(255,255,255,0.04)' },
  ticks: { color: '#55556a', font: { size: 11 } },
};

// ── Helpers ──────────────────────────────────────
function makeGrad(ctx, h, upColor, downColor) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, upColor);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  return grad;
}

function noDataMsg(container, msg = 'No data available') {
  container.innerHTML = `<div style="color:var(--text2);text-align:center;padding:2rem;font-size:13px;">${msg}</div>`;
}

// ── Portfolio history chart ───────────────────────
export function renderPortfolioChart(filter) {
  const series = filterTimeSeries(filter);
  const labels = series.map((p) => p.date);
  const values = series.map((p) => p.value);
  const isUp   = values.length > 1 && values[values.length - 1] >= values[0];
  const color  = isUp ? '#22c55e' : '#ef4444';

  if (state.portfolioChartInstance) state.portfolioChartInstance.destroy();

  const ctx  = document.getElementById('portfolioChart').getContext('2d');
  const grad = makeGrad(ctx, 300, isUp ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)', 'rgba(0,0,0,0)');

  state.portfolioChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ data: values, borderColor: color, borderWidth: 2,
      backgroundColor: grad, fill: true, pointRadius: 0, pointHoverRadius: 5,
      pointHoverBackgroundColor: color, tension: 0.3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP_DEFAULTS, mode: 'index', intersect: false,
          callbacks: { label: (c) => '  ₹' + c.parsed.y.toLocaleString('en-IN') } },
      },
      scales: {
        x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8 } },
        y: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks,
          callback: (v) => '₹' + v.toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 1 }) } },
      },
      interaction: { mode: 'index', intersect: false },
    },
  });
}

export function setTimeFilter(filter, btn) {
  state.currentFilter = filter;
  document.querySelectorAll('.tf-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  renderPortfolioChart(filter);
}

// ── Portfolio Day Chart (intraday 5-min) ──────────
export function renderPortfolioDayChart() {
  const wrap   = document.getElementById('portfolio-day-wrap');
  const canvas = document.getElementById('portfolioDayChart');
  if (!wrap || !canvas) return;

  // Aggregate 5-min intraday ticks across all holdings.
  // KEY FIX: stocks don't tick at the same timestamps. Naively summing only
  // stocks present at each slot causes wild swings as stocks drop in/out.
  // Solution: collect the union of all time slots, then for each stock
  // carry its last known price forward into any gap (forward-fill per stock).
  const holdings = Object.values(state.holdings);

  // Step 1 — collect union of all time slots
  const allTimesSet = new Set();
  holdings.forEach((h) => {
    const ticks = state.dayHistories[h.ticker];
    if (ticks && ticks.length) ticks.forEach(({ time }) => allTimesSet.add(time));
  });

  const sortedTimes = [...allTimesSet].sort();
  if (!sortedTimes.length) {
    noDataMsg(wrap, 'Intraday data unavailable for today');
    return;
  }

  // Step 2 — accumulate portfolio value per time slot with forward-fill per stock
  const values = new Array(sortedTimes.length).fill(0);

  holdings.forEach((h) => {
    const ticks = state.dayHistories[h.ticker];
    const fallbackPrice = state.livePrices[h.ticker] || h.avgBuy;

    if (!ticks || !ticks.length) {
      // No intraday data — use live/avgBuy as flat contribution
      sortedTimes.forEach((_, i) => { values[i] += fallbackPrice * h.totalQty; });
      return;
    }

    // Build tick lookup for this stock
    const tickMap = {};
    ticks.forEach(({ time, price }) => { tickMap[time] = price; });

    // Walk all slots, carrying last price forward so no slot is ever missing this stock
    let lastPrice = null;
    sortedTimes.forEach((t, i) => {
      if (tickMap[t] != null) lastPrice = tickMap[t];
      // Only start counting once we have a first tick for this stock
      if (lastPrice != null) values[i] += lastPrice * h.totalQty;
    });
  });

  const roundedValues = values.map(Math.round);
  const isUp   = roundedValues.length > 1 && roundedValues[roundedValues.length - 1] >= roundedValues[0];
  const color  = isUp ? '#22c55e' : '#ef4444';

  if (state.portfolioDayChartInstance) state.portfolioDayChartInstance.destroy();

  // Restore canvas if noDataMsg replaced it
  wrap.innerHTML = '<canvas id="portfolioDayChart" style="width:100%;height:100%"></canvas>';
  const ctx  = document.getElementById('portfolioDayChart').getContext('2d');
  const grad = makeGrad(ctx, 220, isUp ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', 'rgba(0,0,0,0)');

  state.portfolioDayChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels: sortedTimes, datasets: [{ data: roundedValues, borderColor: color,
      borderWidth: 2, backgroundColor: grad, fill: true,
      pointRadius: 0, pointHoverRadius: 4, tension: 0.2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP_DEFAULTS, mode: 'index', intersect: false,
          callbacks: { label: (c) => '  ₹' + c.parsed.y.toLocaleString('en-IN') } },
      },
      scales: {
        x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8 } },
        y: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks,
          callback: (v) => '₹' + v.toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 1 }) } },
      },
      interaction: { mode: 'index', intersect: false },
    },
  });
}

// ── Today P&L bar chart ───────────────────────────
export function renderTodayPnlChart(holdings) {
  const wrap   = document.getElementById('today-pnl-wrap');
  const canvas = document.getElementById('todayPnlChart');
  if (!wrap || !canvas) return;

  const filtered = holdings.filter((h) => {
    const lp = state.livePrices[h.ticker];
    const pc = state.prevClosePrices[h.ticker];
    return lp && pc && pc > 0;
  });

  if (!filtered.length) {
    noDataMsg(wrap, 'Today\'s P&L unavailable — prev close not loaded yet');
    return;
  }

  // Sort by today's % change descending
  const sorted = [...filtered].sort((a, b) => {
    const pa = ((state.livePrices[a.ticker] - state.prevClosePrices[a.ticker]) / state.prevClosePrices[a.ticker]) * 100;
    const pb = ((state.livePrices[b.ticker] - state.prevClosePrices[b.ticker]) / state.prevClosePrices[b.ticker]) * 100;
    return pb - pa;
  });

  const labels = sorted.map((h) => h.ticker);
  const data   = sorted.map((h) => {
    const lp = state.livePrices[h.ticker];
    const pc = state.prevClosePrices[h.ticker];
    return parseFloat(((lp - pc) / pc * 100).toFixed(2));
  });
  const colors = data.map((v) => v >= 0 ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.85)');

  if (state.todayPnlChartInstance) state.todayPnlChartInstance.destroy();

  // Restore canvas if noDataMsg replaced it
  wrap.innerHTML = '<canvas id="todayPnlChart" style="width:100%;height:100%"></canvas>';
  const ctx = document.getElementById('todayPnlChart').getContext('2d');

  state.todayPnlChartInstance = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP_DEFAULTS,
          callbacks: {
            label: (c) => {
              const h   = sorted[c.dataIndex];
              const lp  = state.livePrices[h.ticker];
              const pc  = state.prevClosePrices[h.ticker];
              const abs = (lp - pc) * h.totalQty;
              return [
                ` ${c.parsed.y >= 0 ? '+' : ''}${c.parsed.y.toFixed(2)}%`,
                ` ₹${abs >= 0 ? '+' : ''}${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
              ];
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#55556a', font: { size: 11 } } },
        y: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, callback: (v) => v + '%' } },
      },
    },
  });
}

// ── Allocation doughnut ──────────────────────────
export function renderPieChart(holdings, totalCurrent) {
  const filtered = holdings.filter((h) => (state.livePrices[h.ticker] || 0) > 0);
  const data     = filtered.map((h) => state.livePrices[h.ticker] * h.totalQty);
  const labels   = filtered.map((h) => h.ticker);
  const total    = data.reduce((a, b) => a + b, 0);

  if (state.pieChartInstance) state.pieChartInstance.destroy();

  const ctx = document.getElementById('pieChart').getContext('2d');
  state.pieChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data,
      backgroundColor: labels.map((_, i) => COLORS[i % COLORS.length]),
      borderWidth: 2, borderColor: '#141417', hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#8a8a9a', boxWidth: 10, padding: 12, font: { size: 11 } } },
        tooltip: { ...TOOLTIP_DEFAULTS,
          callbacks: { label: (c) => ` ${c.label}: ${((c.parsed / total) * 100).toFixed(1)}%` } },
      },
      cutout: '65%',
    },
  });
}

// ── Overall P&L bar chart ────────────────────────
export function renderPnlChart(holdings) {
  const sorted = holdings
    .filter((h) => state.livePrices[h.ticker])
    .sort((a, b) => {
      const pa = ((state.livePrices[a.ticker] - a.avgBuy) / a.avgBuy) * 100;
      const pb = ((state.livePrices[b.ticker] - b.avgBuy) / b.avgBuy) * 100;
      return pb - pa;
    });

  const labels = sorted.map((h) => h.ticker);
  const data   = sorted.map((h) =>
    parseFloat((((state.livePrices[h.ticker] - h.avgBuy) / h.avgBuy) * 100).toFixed(2))
  );
  const colors = data.map((v) => v >= 0 ? 'rgba(34,197,94,0.8)' : 'rgba(239,68,68,0.8)');

  if (state.pnlChartInstance) state.pnlChartInstance.destroy();

  const ctx = document.getElementById('pnlChart').getContext('2d');
  state.pnlChartInstance = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP_DEFAULTS,
          callbacks: { label: (c) => ` ${c.parsed.y >= 0 ? '+' : ''}${c.parsed.y.toFixed(2)}%` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#55556a', font: { size: 11 } } },
        y: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, callback: (v) => v + '%' } },
      },
    },
  });
}

// ── Drilldown: price history ──────────────────────
export function renderDrilldownChart(ticker, hist, buyDate) {
  const dates  = Object.keys(hist).sort();
  const prices = dates.map((d) => hist[d]);

  if (state.ddChartInstance) state.ddChartInstance.destroy();

  const ctx  = document.getElementById('ddChart').getContext('2d');
  const grad = makeGrad(ctx, 300, 'rgba(99,102,241,0.2)', 'rgba(0,0,0,0)');

  state.ddChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels: dates, datasets: [{ data: prices, borderColor: '#6366f1',
      borderWidth: 2, backgroundColor: grad, fill: true,
      pointRadius: 0, pointHoverRadius: 5, tension: 0.3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP_DEFAULTS, mode: 'index', intersect: false },
      },
      scales: {
        x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8 } },
        y: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, callback: (v) => v.toFixed(0) } },
      },
    },
  });
}

// ── Drilldown: intraday day chart ─────────────────
export function renderDrilldownDayChart(ticker) {
  const wrap   = document.getElementById('dd-day-wrap');
  const canvas = document.getElementById('ddDayChart');
  if (!wrap) return;

  const ticks = state.dayHistories[ticker];

  if (!ticks || !ticks.length) {
    noDataMsg(wrap, 'Intraday data unavailable for today');
    return;
  }

  const labels = ticks.map((d) => d.time);
  const prices = ticks.map((d) => d.price);
  const isUp   = prices.length > 1 && prices[prices.length - 1] >= prices[0];
  const color  = isUp ? '#22c55e' : '#ef4444';

  if (state.ddDayChartInstance) state.ddDayChartInstance.destroy();

  // Restore canvas
  wrap.innerHTML = '<canvas id="ddDayChart" style="width:100%;height:100%"></canvas>';
  const ctx  = document.getElementById('ddDayChart').getContext('2d');
  const grad = makeGrad(ctx, 220, isUp ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', 'rgba(0,0,0,0)');

  state.ddDayChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ data: prices, borderColor: color,
      borderWidth: 2, backgroundColor: grad, fill: true,
      pointRadius: 0, pointHoverRadius: 4, tension: 0.2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP_DEFAULTS, mode: 'index', intersect: false,
          callbacks: { label: (c) => ' ' + c.parsed.y.toFixed(2) } },
      },
      scales: {
        x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8 } },
        y: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, callback: (v) => v.toFixed(1) } },
      },
      interaction: { mode: 'index', intersect: false },
    },
  });
}

// ── Destroy all ──────────────────────────────────
export function destroyAllCharts() {
  ['portfolioChartInstance', 'pieChartInstance', 'pnlChartInstance',
   'portfolioDayChartInstance', 'todayPnlChartInstance'].forEach((key) => {
    if (state[key]) { state[key].destroy(); state[key] = null; }
  });
}
