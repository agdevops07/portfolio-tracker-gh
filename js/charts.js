// ═══════════════════════════════════════════════
// CHARTS — All Chart.js instances live here.
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { filterTimeSeries } from './timeSeries.js';
import { pct, colorPnl } from './utils.js';

export const COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444',
  '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#06b6d4',
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

function makeGrad(ctx, h, upColor, downColor) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, upColor);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  return grad;
}

function noDataMsg(container, msg = 'No data available') {
  container.innerHTML = `<div style="color:var(--text2);text-align:center;padding:2rem;font-size:13px;">${msg}</div>`;
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ── Portfolio custom date state ──────────────────
const portCustom = { active: false, from: null, to: null };

function filterPortfolioCustom(from, to) {
  const all = state.fullTimeSeries;
  return all.filter(p => p.date >= from && p.date <= to);
}

function updatePortPeriodChg(series) {
  const el = document.getElementById('port-period-chg');
  if (!el) return;
  if (series.length >= 2) {
    const startVal = series[0].value;
    const endVal   = series[series.length - 1].value;
    const chg = ((endVal - startVal) / startVal) * 100;
    el.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% in period`;
    el.style.color = chg >= 0 ? 'var(--green)' : 'var(--red)';
  } else {
    el.textContent = '';
  }
}

// ── Portfolio history chart ───────────────────────
export function renderPortfolioChart(filter) {
  let series;
  if (filter === 'CUSTOM' && portCustom.from && portCustom.to) {
    series = filterPortfolioCustom(portCustom.from, portCustom.to);
  } else {
    series = filterTimeSeries(filter === 'CUSTOM' ? '1Y' : filter);
  }

  const rawDates = series.map(p => p.date);
  const labels   = rawDates.map(d => formatDateLabel(d));
  const values   = series.map(p => p.value);
  const isUp     = values.length > 1 && values[values.length - 1] >= values[0];
  const color    = isUp ? '#22c55e' : '#ef4444';

  updatePortPeriodChg(series);

  if (state.portfolioChartInstance) state.portfolioChartInstance.destroy();

  const ctx  = document.getElementById('portfolioChart').getContext('2d');
  const grad = makeGrad(ctx, 300, isUp ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)', 'rgba(0,0,0,0)');

  state.portfolioChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{ data: values, borderColor: color, borderWidth: 2,
        backgroundColor: grad, fill: true, pointRadius: 0, pointHoverRadius: 5,
        pointHoverBackgroundColor: color, tension: 0.3 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP_DEFAULTS, mode: 'index', intersect: false,
          callbacks: {
            title: (items) => rawDates[items[0].dataIndex] || items[0].label,
            label: (c) => '  ₹' + c.parsed.y.toLocaleString('en-IN'),
          },
        },
      },
      scales: {
        x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 10, maxRotation: 0 } },
        y: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks,
          callback: (v) => '₹' + v.toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 1 }) } },
      },
      interaction: { mode: 'index', intersect: false },
    },
  });
}

export function setTimeFilter(filter, btn) {
  state.currentFilter = filter;
  // Only clear portfolio chart filter buttons
  const portFilters = btn.closest('.time-filters');
  if (portFilters) portFilters.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const customWrap = document.getElementById('port-custom-wrap');
  if (filter === 'CUSTOM') {
    if (customWrap) customWrap.style.display = 'flex';
  } else {
    if (customWrap) customWrap.style.display = 'none';
    portCustom.active = false;
    renderPortfolioChart(filter);
  }
}

window.applyPortCustom = function() {
  const from = document.getElementById('port-from').value;
  const to   = document.getElementById('port-to').value;
  if (!from || !to) return;
  portCustom.active = true;
  portCustom.from = from;
  portCustom.to   = to;
  renderPortfolioChart('CUSTOM');
};

// ── Portfolio Day Chart (intraday 5-min) ──────────
export function renderPortfolioDayChart() {
  const wrap   = document.getElementById('portfolio-day-wrap');
  const canvas = document.getElementById('portfolioDayChart');
  if (!wrap || !canvas) return;

  const holdings = Object.values(state.holdings);
  const allTimesSet = new Set();
  holdings.forEach(h => {
    const ticks = state.dayHistories[h.ticker];
    if (ticks && ticks.length) ticks.forEach(({ time }) => allTimesSet.add(time));
  });

  const sortedTimes = [...allTimesSet].sort();
  if (!sortedTimes.length) { noDataMsg(wrap, 'Intraday data unavailable for today'); return; }

  const values = new Array(sortedTimes.length).fill(0);
  holdings.forEach(h => {
    const ticks = state.dayHistories[h.ticker];
    const seedPrice = state.livePrices[h.ticker] || h.avgBuy;
    if (!ticks || !ticks.length) {
      sortedTimes.forEach((_, i) => { values[i] += seedPrice * h.totalQty; });
      return;
    }
    const tickMap = {};
    ticks.forEach(({ time, price }) => { tickMap[time] = price; });
    let lastPrice = seedPrice;
    sortedTimes.forEach((t, i) => {
      if (tickMap[t] != null) lastPrice = tickMap[t];
      values[i] += lastPrice * h.totalQty;
    });
  });

  const roundedValues = values.map(Math.round);
  const isUp  = roundedValues.length > 1 && roundedValues[roundedValues.length - 1] >= roundedValues[0];
  const color = isUp ? '#22c55e' : '#ef4444';

  if (state.portfolioDayChartInstance) state.portfolioDayChartInstance.destroy();

  wrap.innerHTML = '<canvas id="portfolioDayChart" style="width:100%;height:100%"></canvas>';
  const ctx  = document.getElementById('portfolioDayChart').getContext('2d');
  const grad = makeGrad(ctx, 220, isUp ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', 'rgba(0,0,0,0)');

  state.portfolioDayChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels: sortedTimes, datasets: [{ data: roundedValues, borderColor: color,
      borderWidth: 2, backgroundColor: grad, fill: true, pointRadius: 0, pointHoverRadius: 4, tension: 0.2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP_DEFAULTS, mode: 'index', intersect: false,
          callbacks: { label: (c) => '  ₹' + c.parsed.y.toLocaleString('en-IN') } },
      },
      scales: {
        x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8, maxRotation: 0 } },
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

  const filtered = holdings.filter(h => {
    const lp = state.livePrices[h.ticker];
    const pc = state.prevClosePrices[h.ticker];
    return lp && pc && pc > 0;
  });

  if (!filtered.length) { noDataMsg(wrap, "Today's P&L unavailable — prev close not loaded yet"); return; }

  const sorted = [...filtered].sort((a, b) => {
    const pa = ((state.livePrices[a.ticker] - state.prevClosePrices[a.ticker]) / state.prevClosePrices[a.ticker]) * 100;
    const pb = ((state.livePrices[b.ticker] - state.prevClosePrices[b.ticker]) / state.prevClosePrices[b.ticker]) * 100;
    return pb - pa;
  });

  const labels = sorted.map(h => h.ticker.replace('.NS','').replace('.BO',''));
  const data   = sorted.map(h => {
    const lp = state.livePrices[h.ticker];
    const pc = state.prevClosePrices[h.ticker];
    return parseFloat(((lp - pc) / pc * 100).toFixed(2));
  });
  const colors = data.map(v => v >= 0 ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.85)');

  if (state.todayPnlChartInstance) state.todayPnlChartInstance.destroy();

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
        x: { grid: { display: false }, ticks: { color: '#55556a', font: { size: 10 }, maxRotation: 30 } },
        y: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, callback: (v) => v + '%' } },
      },
    },
  });
}

// ── Allocation: horizontal bar chart with labels ──
export function renderPieChart(holdings, totalCurrent) {
  const filtered = holdings
    .filter(h => (state.livePrices[h.ticker] || 0) > 0)
    .map((h, i) => ({
      ticker: h.ticker,
      label: h.ticker.replace('.NS','').replace('.BO',''),
      value: state.livePrices[h.ticker] * h.totalQty,
      color: COLORS[i % COLORS.length],
    }))
    .sort((a, b) => b.value - a.value);

  const total = filtered.reduce((s, h) => s + h.value, 0);
  const data   = filtered.map(h => parseFloat(((h.value / total) * 100).toFixed(2)));
  const labels = filtered.map(h => h.label);
  const bgColors = filtered.map(h => h.color);

  if (state.pieChartInstance) state.pieChartInstance.destroy();

  const ctx = document.getElementById('pieChart').getContext('2d');

  // Inline label plugin
  const inlineLabelPlugin = {
    id: 'inlineBarLabels',
    afterDraw(chart) {
      const { ctx: c, data: d } = chart;
      c.save();
      d.datasets.forEach((dataset, di) => {
        chart.getDatasetMeta(di).data.forEach((bar, idx) => {
          const val  = dataset.data[idx];
          const item = filtered[idx];
          const labelText = `${val.toFixed(1)}%  ₹${(item.value/1e5).toFixed(1)}L`;
          c.font = '600 10px system-ui, sans-serif';
          c.fillStyle = 'rgba(230,230,240,0.85)';
          c.textBaseline = 'middle';
          // Position: just to right of bar end
          const xPos = bar.x + 8;
          const yPos = bar.y;
          if (bar.width > 30) c.fillText(labelText, xPos, yPos);
        });
      });
      c.restore();
    },
  };

  const maxVal = Math.max(...data);

  state.pieChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: bgColors,
        borderRadius: 5,
        borderSkipped: false,
        barThickness: 20,
      }],
    },
    plugins: [inlineLabelPlugin],
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 110 } },
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP_DEFAULTS,
          callbacks: {
            label: (c) => {
              const item = filtered[c.dataIndex];
              return [
                ` Allocation: ${c.parsed.x.toFixed(2)}%`,
                ` Value: ₹${item.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          ...AXIS_DEFAULTS,
          max: Math.min(100, Math.ceil(maxVal * 1.3)),
          ticks: { ...AXIS_DEFAULTS.ticks, callback: v => v + '%' },
        },
        y: {
          grid: { display: false },
          ticks: { color: '#9a9ab0', font: { size: 11, weight: '600' } },
        },
      },
    },
  });
}

// ── Overall P&L bar chart ────────────────────────
export function renderPnlChart(holdings) {
  const sorted = holdings
    .filter(h => state.livePrices[h.ticker])
    .sort((a, b) => {
      const pa = ((state.livePrices[a.ticker] - a.avgBuy) / a.avgBuy) * 100;
      const pb = ((state.livePrices[b.ticker] - b.avgBuy) / b.avgBuy) * 100;
      return pb - pa;
    });

  const labels = sorted.map(h => h.ticker.replace('.NS','').replace('.BO',''));
  const data   = sorted.map(h =>
    parseFloat((((state.livePrices[h.ticker] - h.avgBuy) / h.avgBuy) * 100).toFixed(2))
  );
  const colors = data.map(v => v >= 0 ? 'rgba(34,197,94,0.8)' : 'rgba(239,68,68,0.8)');

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
        x: { grid: { display: false }, ticks: { color: '#55556a', font: { size: 10 }, maxRotation: 30 } },
        y: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, callback: (v) => v + '%' } },
      },
    },
  });
}

// ── Drilldown: price history ──────────────────────
export function renderDrilldownChart(ticker, hist, buyDate) {
  const dates  = Object.keys(hist).sort();
  const prices = dates.map(d => hist[d]);

  if (state.ddChartInstance) state.ddChartInstance.destroy();

  const ctx  = document.getElementById('ddChart').getContext('2d');
  const grad = makeGrad(ctx, 300, 'rgba(99,102,241,0.2)', 'rgba(0,0,0,0)');
  const displayLabels = dates.map(d => formatDateLabel(d));

  state.ddChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: displayLabels,
      datasets: [{ data: prices, borderColor: '#6366f1',
        borderWidth: 2, backgroundColor: grad, fill: true,
        pointRadius: 0, pointHoverRadius: 5, tension: 0.3 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP_DEFAULTS, mode: 'index', intersect: false,
          callbacks: {
            title: (items) => dates[items[0].dataIndex] || items[0].label,
            label: (c) => ' ₹' + c.parsed.y.toFixed(2),
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.03)' },
          border: { color: 'rgba(255,255,255,0.1)' },
          ticks: { color: '#7777a0', font: { size: 11 }, maxTicksLimit: 10, maxRotation: 0, autoSkip: true },
        },
        y: {
          ...AXIS_DEFAULTS,
          ticks: { color: '#7777a0', font: { size: 11 },
            callback: (v) => '₹' + v.toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 1 }) },
        },
      },
      interaction: { mode: 'index', intersect: false },
    },
  });
}

// ── Drilldown: intraday day chart ─────────────────
export function renderDrilldownDayChart(ticker) {
  const wrap   = document.getElementById('dd-day-wrap');
  const canvas = document.getElementById('ddDayChart');
  if (!wrap) return;

  const ticks = state.dayHistories[ticker];
  if (!ticks || !ticks.length) { noDataMsg(wrap, 'Intraday data unavailable for today'); return; }

  const labels = ticks.map(d => d.time);
  const prices = ticks.map(d => d.price);
  const isUp   = prices.length > 1 && prices[prices.length - 1] >= prices[0];
  const color  = isUp ? '#22c55e' : '#ef4444';

  if (state.ddDayChartInstance) state.ddDayChartInstance.destroy();

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
          callbacks: { label: (c) => ' ₹' + c.parsed.y.toFixed(2) } },
      },
      scales: {
        x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8, maxRotation: 0 } },
        y: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, callback: (v) => v.toFixed(1) } },
      },
      interaction: { mode: 'index', intersect: false },
    },
  });
}

// ── Destroy all ──────────────────────────────────
export function destroyAllCharts() {
  ['portfolioChartInstance', 'pieChartInstance', 'pnlChartInstance',
   'portfolioDayChartInstance', 'todayPnlChartInstance'].forEach(key => {
    if (state[key]) { state[key].destroy(); state[key] = null; }
  });
}
