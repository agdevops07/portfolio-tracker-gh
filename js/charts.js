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

// Chart display mode state ('percentage' or 'absolute')
const chartDisplayMode = 'percentage'; // toggle removed — always percentage

// Selected benchmarks for comparison (multiple)
let selectedBenchmarks = new Set();

// ── Benchmark configuration — Yahoo Finance only ──────────────────────────────
// All historical data (including today via meta.regularMarketPrice) comes from
// Yahoo Finance. No Upstox dependency for benchmarks at all.
const BENCHMARK_CONFIG = {
  nifty50: {
    name: 'Nifty 50',
    yahooSymbol: '^NSEI',
    color: '#f59e0b',
    shortName: 'Nifty50',
  },
  niftyBank: {
    name: 'Nifty Bank',
    yahooSymbol: '^NSEBANK',
    color: '#06b6d4',
    shortName: 'Nifty Bank',
  },
  niftyMidcap100: {
    name: 'Midcap 100',
    yahooSymbol: 'NIFTY_MIDCAP_100.NS',
    color: '#10b981',
    shortName: 'Nifty Midcap 100',
  },
  niftySmlcap100: {
    name: 'Smlcap 100',
    yahooSymbol: '^CNXSC',
    color: '#ec4899',
    shortName: 'SML',
  },
  niftySmlcap250: {
    name: 'Smlcap 250',
    yahooSymbol: 'NIFTYSMLCAP250.NS',
    color: '#a78bfa',
    shortName: 'S250',
  },
};

// Yahoo Finance CORS proxy — same one already used by the rest of the app
const YF_PROXY = 'https://corsproxy.io/?url=';

/**
 * Fetch full daily OHLCV history from Yahoo Finance for a benchmark.
 * Returns { 'YYYY-MM-DD': closePrice, ... } plus today's live price injected
 * via meta.regularMarketPrice — so NO separate intraday call is ever needed.
 *
 * range: '2y' | '1y' | '6mo' | '3mo' | '1mo' | '5d'
 */
async function fetchYahooBenchmarkHistory(benchmark, range = '2y') {
  const config = BENCHMARK_CONFIG[benchmark];
  if (!config) return null;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(config.yahooSymbol)}?interval=1d&range=${range}`;
  try {
    const res = await fetch(YF_PROXY + encodeURIComponent(url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const hist = {};

    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] == null) continue;
      // Convert unix timestamp → 'YYYY-MM-DD' in IST (UTC+5:30)
      const d = new Date((timestamps[i] + 19800) * 1000); // +5:30 offset
      const key = d.toISOString().split('T')[0];
      hist[key] = closes[i];
    }

    // Inject today's live price from meta so today's point is always current
    const livePrice = result.meta?.regularMarketPrice;
    if (livePrice) {
      const todayStr = new Date().toISOString().split('T')[0];
      const dow = new Date(todayStr + 'T12:00:00Z').getUTCDay();
      if (dow !== 0 && dow !== 6) hist[todayStr] = livePrice;
    }

    return Object.keys(hist).length > 0 ? hist : null;
  } catch (e) {
    console.warn(`fetchYahooBenchmarkHistory(${benchmark}) failed:`, e);
    return null;
  }
}

// Get benchmark label
function getBenchmarkLabel(benchmark) {
  return BENCHMARK_CONFIG[benchmark]?.name || benchmark;
}

// Get benchmark period change — purely from Yahoo, includes today's live price
async function getBenchmarkPeriodChange(benchmark, series) {
  if (!series || !series.length) return null;
  const dates = series.map(p => p.date);
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  const hist = await fetchYahooBenchmarkHistory(benchmark, '2y');
  if (!hist) return null;

  let startPrice = hist[startDate];
  if (!startPrice) {
    const pd = Object.keys(hist).filter(d => d <= startDate).sort();
    if (pd.length) startPrice = hist[pd[pd.length - 1]];
  }
  let endPrice = hist[endDate];
  if (!endPrice) {
    const pd = Object.keys(hist).filter(d => d <= endDate).sort();
    if (pd.length) endPrice = hist[pd[pd.length - 1]];
  }
  if (startPrice && endPrice && startPrice > 0) {
    return ((endPrice - startPrice) / startPrice) * 100;
  }
  return null;
}

// Toggle benchmark selection (multiple allowed)
export function toggleBenchmark(benchmark) {
  if (selectedBenchmarks.has(benchmark)) {
    selectedBenchmarks.delete(benchmark);
  } else {
    selectedBenchmarks.add(benchmark);
  }

  // Update button styles — active buttons use the benchmark's own color
  document.querySelectorAll('.benchmark-btn').forEach(btn => {
    const key = btn.getAttribute('data-benchmark');
    const cfg = BENCHMARK_CONFIG[key];
    if (selectedBenchmarks.has(key)) {
      btn.style.background = cfg?.color || 'var(--accent)';
      btn.style.color = '#fff';
      btn.style.boxShadow = `0 0 8px ${cfg?.color || 'var(--accent)'}55`;
    } else {
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text2)';
      btn.style.boxShadow = 'none';
    }
  });

  // Save preference
  try {
    sessionStorage.setItem('selected_benchmarks', JSON.stringify([...selectedBenchmarks]));
  } catch(e) {}

  // Refresh historical chart only — day chart has no benchmark dependency on Yahoo
  renderPortfolioChart(state.currentFilter);
}

// Save time filter preference
function saveTimeFilter(filter) {
  try {
    sessionStorage.setItem('time_filter', filter);
  } catch(e) {}
}

// Restore time filter preference
function restoreTimeFilter() {
  try {
    const saved = sessionStorage.getItem('time_filter');
    if (saved && (saved === '1W' || saved === '1M' || saved === '3M' || saved === '6M' || saved === '1Y' || saved === 'CUSTOM')) {
      return saved;
    }
  } catch(e) {}
  return '1W'; // Default to 1W
}

// Restore benchmark preferences
export function restoreBenchmarks() {
  try {
    const saved = sessionStorage.getItem('selected_benchmarks');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        selectedBenchmarks.clear();
        parsed.forEach(b => {
          if (BENCHMARK_CONFIG[b]) selectedBenchmarks.add(b);
        });
        document.querySelectorAll('.benchmark-btn').forEach(btn => {
          const key = btn.getAttribute('data-benchmark');
          const cfg = BENCHMARK_CONFIG[key];
          if (selectedBenchmarks.has(key)) {
            btn.style.background = cfg?.color || 'var(--accent)';
            btn.style.color = '#fff';
            btn.style.boxShadow = `0 0 8px ${cfg?.color || 'var(--accent)'}55`;
          } else {
            btn.style.background = 'transparent';
            btn.style.color = 'var(--text2)';
            btn.style.boxShadow = 'none';
          }
        });
      }
    }
  } catch(e) {}
}

// toggleChartDisplayMode: kept as no-op so callers don't break; toggle UI can be removed from HTML
export function toggleChartDisplayMode(_mode) { /* toggle removed — chart always % mode */ }

export function restoreChartDisplayMode() { return 'percentage'; }

// Calculate ATH (All Time High) from full history
function getATHFromFullHistory(series) {
  if (!series || !series.length) return null;
  const maxValue = Math.max(...series.map(p => p.value));
  const athPoint = series.find(p => p.value === maxValue);
  return { value: maxValue, date: athPoint?.date };
}

// Render portfolio chart with benchmark support
async function renderPortfolioChartWithBenchmark(filter) {
  const portFromEl = document.getElementById('port-from');
  const portToEl = document.getElementById('port-to');
  const _today = new Date().toISOString().split('T')[0];
  const portCustom = { active: true, from: '2026-03-31', to: _today };
  
  if (portFromEl && !portFromEl.value) portFromEl.value = portCustom.from;
  if (portToEl && !portToEl.value) portToEl.value = portCustom.to;

  // Restore saved time filter if not already set
  if (!state.currentFilter) {
    const savedFilter = restoreTimeFilter();
    state.currentFilter = savedFilter;
    // Update the active button UI
    setTimeout(() => {
      const activeBtn = document.querySelector(`.tf-btn[onclick*="${savedFilter}"]`);
      if (activeBtn) {
        const portFilters = activeBtn.closest('.time-filters');
        if (portFilters) {
          portFilters.querySelectorAll('.tf-btn').forEach(b => {
            b.classList.remove('active');
            b.style.background = 'transparent';
            b.style.color = 'var(--text2)';
          });
          activeBtn.classList.add('active');
          activeBtn.style.background = 'var(--accent)';
          activeBtn.style.color = 'white';
        }
      }
    }, 100);
  }

  // ── Always patch the last weekday point with live prices before rendering ──
  // Weekday: patch/append today. Weekend: update last Friday in-place.
  // This keeps the chart's rightmost value in sync with live prices always.
  if (state.fullTimeSeries?.length) {
    const holdings = Object.values(state.holdings);
    let liveValue = 0;
    let hasAnyPrice = false;
    holdings.forEach(h => {
      const lp = state.livePrices?.[h.ticker];
      if (lp) {
        liveValue += lp * h.totalQty;
        hasAnyPrice = true;
      } else {
        const hist = state.histories?.[h.ticker];
        if (hist) {
          const dates = Object.keys(hist).sort();
          const lastClose = hist[dates[dates.length - 1]];
          if (lastClose) liveValue += lastClose * h.totalQty;
        }
      }
    });
    if (hasAnyPrice && liveValue > 0) {
      const rounded = Math.round(liveValue);
      const todayStr = new Date().toISOString().split('T')[0];
      const todayDow = new Date(todayStr + 'T12:00:00Z').getUTCDay();
      const isWeekendToday = todayDow === 0 || todayDow === 6;
      if (!isWeekendToday) {
        // Weekday: patch or append today's entry
        const idx = state.fullTimeSeries.findIndex(p => p.date === todayStr);
        if (idx >= 0) state.fullTimeSeries[idx].value = rounded;
        else state.fullTimeSeries.push({ date: todayStr, value: rounded });
      } else {
        // Weekend: update the last entry (most recent Friday) in place
        state.fullTimeSeries[state.fullTimeSeries.length - 1].value = rounded;
      }
    }
  }

  let series;
  if (filter === 'CUSTOM') {
    const from = document.getElementById('port-from')?.value;
    const to = document.getElementById('port-to')?.value;
    if (from && to) {
      series = state.fullTimeSeries.filter(p => p.date >= from && p.date <= to);
    } else {
      series = state.fullTimeSeries;
    }
  } else {
    series = filterTimeSeries(filter);
  }

  if (!series.length) return;

  const rawDates = series.map(p => p.date);
  const labels = rawDates.map(d => formatDateLabel(d));
  const portfolioValues = series.map(p => p.value);
  
  const startValue = portfolioValues[0];
  const endValue = portfolioValues[portfolioValues.length - 1];
  const periodChg = ((endValue - startValue) / startValue) * 100;
  
  // Calculate ATH from full history
  const ath = getATHFromFullHistory(state.fullTimeSeries);
  const athChg = ath ? ((endValue - ath.value) / ath.value) * 100 : null;
  
  // Get benchmark period changes for display
  const benchmarkChanges = {};
  for (const benchmark of selectedBenchmarks) {
    const change = await getBenchmarkPeriodChange(benchmark, series);
    if (change !== null) benchmarkChanges[benchmark] = change;
  }

  // ── Period-change header ─────────────────────────────────────────────────
  const periodChgEl = document.getElementById('port-period-chg');
  if (periodChgEl) {
    const portColor = periodChg >= 0 ? 'var(--green)' : 'var(--red)';
    const portSign  = periodChg >= 0 ? '+' : '';

    // ATH badge
    let athHtml = '';
    if (athChg !== null && Math.abs(athChg) > 0.01) {
      const athColor = athChg >= 0 ? 'var(--green)' : 'var(--red)';
      athHtml = `<span style="font-size:10px;font-weight:600;background:rgba(239,68,68,0.10);
        color:${athColor};padding:2px 7px;border-radius:4px;white-space:nowrap;">
        ${athChg >= 0 ? '+' : ''}${athChg.toFixed(2)}% vs ATH</span>`;
    }

    // Benchmark chips — coloured border matching chart line
    let benchHtml = '';
    for (const [bm, chg] of Object.entries(benchmarkChanges)) {
      const cfg = BENCHMARK_CONFIG[bm];
      const chgColor = chg >= 0 ? 'var(--green)' : 'var(--red)';
      benchHtml += `
        <span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;
          background:rgba(0,0,0,0.25);border:1px solid ${cfg.color}44;
          padding:2px 8px;border-radius:4px;white-space:nowrap;">
          <span style="width:6px;height:6px;border-radius:50%;background:${cfg.color};flex-shrink:0;"></span>
          ${cfg.shortName}
          <span style="color:${chgColor}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>
        </span>`;
    }

    periodChgEl.innerHTML = `
      <span style="color:${portColor};font-size:13px;font-weight:700;">${portSign}${periodChg.toFixed(2)}%</span>
      ${athHtml}
      ${benchHtml ? `<span style="display:inline-flex;gap:4px;flex-wrap:wrap;vertical-align:middle;">${benchHtml}</span>` : ''}
    `;
  }

  // Always percentage mode
  const portfolioData = portfolioValues.map(v => ((v - startValue) / startValue) * 100);

  // Calculate if overall period is up or down
  const periodPerformance = periodChg >= 0;
  const lineColor = periodPerformance ? '#22c55e' : '#ef4444';
  const gradientColor = periodPerformance ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';

  // Create gradient based on period performance
  let portfolioGradient;
  try {
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    portfolioGradient = makeGrad(tempCtx, 400, gradientColor, 'rgba(0,0,0,0)');
  } catch(e) {
    portfolioGradient = gradientColor;
  }

  const datasets = [{
    label: 'Portfolio',
    data: portfolioData,
    borderColor: lineColor,
    borderWidth: 2.5,
    backgroundColor: portfolioGradient,
    fill: true,
    pointRadius: 0,
    pointHoverRadius: 5,
    tension: 0.3,
    order: 0
  }];

  // ── Benchmark datasets — all from Yahoo, today's price already baked in ──
  const benchmarkRawPrices = {};

  for (const benchmark of selectedBenchmarks) {
    const fullHist = await fetchYahooBenchmarkHistory(benchmark, '2y');
    if (!fullHist || !Object.keys(fullHist).length) continue;

    const firstDate = rawDates[0];
    let periodStartPrice = fullHist[firstDate];
    if (!periodStartPrice) {
      const pd = Object.keys(fullHist).filter(d => d <= firstDate).sort();
      if (pd.length) periodStartPrice = fullHist[pd[pd.length - 1]];
    }
    if (!periodStartPrice) continue;

    const benchmarkPctData = [];
    const rawPricesArr = [];
    let lastPrice = null;

    for (const date of rawDates) {
      let price = fullHist[date];
      if (!price) {
        const pd = Object.keys(fullHist).filter(d => d <= date).sort();
        if (pd.length) price = fullHist[pd[pd.length - 1]];
      }
      if (price != null) lastPrice = price;
      if (lastPrice != null) {
        benchmarkPctData.push(((lastPrice - periodStartPrice) / periodStartPrice) * 100);
        rawPricesArr.push(lastPrice);
      } else {
        benchmarkPctData.push(null);
        rawPricesArr.push(null);
      }
    }

    if (benchmarkPctData.some(v => v !== null)) {
      benchmarkRawPrices[benchmark] = rawPricesArr;
      datasets.push({
        label: getBenchmarkLabel(benchmark),
        data: benchmarkPctData,
        borderColor: BENCHMARK_CONFIG[benchmark]?.color || '#f59e0b',
        borderWidth: 2,
        borderDash: [6, 4],
        backgroundColor: 'transparent',
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.3,
        order: 1,
        _isBenchmark: true,
        _benchmarkKey: benchmark,
      });
    }
  }
  
  if (state.portfolioChartInstance) state.portfolioChartInstance.destroy();
  
  const ctx = document.getElementById('portfolioChart').getContext('2d');
  
  state.portfolioChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { 
          position: 'top', 
          labels: { 
            color: '#a0a0b0', 
            usePointStyle: true, 
            boxWidth: 10,
            font: { size: 11 }
          } 
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          ...TOOLTIP_DEFAULTS,
          callbacks: {
            label: (context) => {
              const idx = context.dataIndex;
              const pct = context.parsed.y;
              const ds = context.dataset;

              if (ds._isBenchmark && ds._benchmarkKey) {
                // Benchmark line: show % change AND the actual index level
                const absPrice = benchmarkRawPrices[ds._benchmarkKey]?.[idx];
                const pctStr = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
                if (absPrice != null) {
                  return `${ds.label}: ${pctStr}  (${absPrice.toLocaleString('en-IN', { maximumFractionDigits: 0 })})`;
                }
                return `${ds.label}: ${pctStr}`;
              } else {
                // Portfolio line: show % change AND absolute ₹ value + abs change
                const portVal = portfolioValues[idx];
                const chgAbs = portVal - startValue;
                const pctStr = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
                const absStr = `₹${portVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
                const chgStr = `${chgAbs >= 0 ? '+' : ''}₹${Math.abs(chgAbs).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
                return `${ds.label}: ${pctStr}, ${chgStr} (${absStr})`;
              }
            }
          }
        }
      },
      scales: {
        x: { 
          grid: { color: 'rgba(255,255,255,0.04)' }, 
          ticks: { color: '#7777a0', maxRotation: 0, font: { size: 10 } }
        },
        y: { 
          grid: { color: 'rgba(255,255,255,0.04)' }, 
          ticks: { color: '#7777a0', callback: (v) => v.toFixed(1) + '%', font: { size: 10 } },
          title: { display: true, text: 'Change (%)', color: '#7777a0', font: { size: 11 } }
        }
      },
      interaction: { mode: 'index', intersect: false }
    }
  });
  
  if (!window._chartInstances) window._chartInstances = {};
  window._chartInstances['portfolioChart'] = state.portfolioChartInstance;
}

export async function renderPortfolioChart(filter) {
  await renderPortfolioChartWithBenchmark(filter);
}

function noDataMsg(container, msg = 'No data available') {
  container.innerHTML = `<div style="color:var(--text2);text-align:center;padding:2rem;font-size:13px;">${msg}</div>`;
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// Portfolio custom date state
const _today = new Date().toISOString().split('T')[0];
const portCustom = { active: true, from: '2026-03-31', to: _today };

export function setTimeFilter(filter, btn) {
  state.currentFilter = filter;
  saveTimeFilter(filter);
  
  // Update button styles within the same time-filters group
  const portFilters = btn.closest('.time-filters');
  if (portFilters) {
    portFilters.querySelectorAll('.tf-btn').forEach(b => {
      b.classList.remove('active');
      b.style.background = 'transparent';
      b.style.color = 'var(--text2)';
    });
    btn.classList.add('active');
    btn.style.background = 'var(--accent)';
    btn.style.color = 'white';
  }

  const customWrap = document.getElementById('port-custom-wrap');
  if (filter === 'CUSTOM') {
    portCustom.active = true;
    if (customWrap) customWrap.style.display = 'flex';
    if (portCustom.from && portCustom.to) renderPortfolioChart('CUSTOM');
  } else {
    portCustom.active = false;
    if (customWrap) customWrap.style.display = 'none';
    renderPortfolioChart(filter);
  }
}

window.applyPortCustom = function() {
  const from = document.getElementById('port-from').value;
  const to = document.getElementById('port-to').value;
  if (!from || !to) return;
  portCustom.active = true;
  portCustom.from = from;
  portCustom.to = to;
  renderPortfolioChart('CUSTOM');
};

// ── Portfolio Day Chart (intraday) ────────────────────────────────────────────
// Note: benchmark overlays on the intraday chart are not supported — Yahoo Finance
// does not provide sub-daily data for NSE indices via the public API.
export async function renderPortfolioDayChart() {
  const wrap = document.getElementById('portfolio-day-wrap');
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

  // Calculate portfolio values at each time point
  const portfolioValues = new Array(sortedTimes.length).fill(0);
  holdings.forEach(h => {
    const ticks = state.dayHistories[h.ticker];
    const seedPrice = state.livePrices[h.ticker] || h.avgBuy;
    if (!ticks || !ticks.length) {
      sortedTimes.forEach((_, i) => { portfolioValues[i] += seedPrice * h.totalQty; });
      return;
    }
    const tickMap = {};
    ticks.forEach(({ time, price }) => { tickMap[time] = price; });
    let lastPrice = seedPrice;
    sortedTimes.forEach((t, i) => {
      if (tickMap[t] != null) lastPrice = tickMap[t];
      portfolioValues[i] += lastPrice * h.totalQty;
    });
  });

  const roundedValues = portfolioValues.map(Math.round);

  // Compute portfolio-level prev close value
  let prevClosePortfolioValue = 0;
  let hasPrevClose = false;
  holdings.forEach(h => {
    const pc = state.prevClosePrices[h.ticker];
    if (pc && pc > 0) {
      prevClosePortfolioValue += pc * h.totalQty;
      hasPrevClose = true;
    } else {
      const lp = state.livePrices[h.ticker] || h.avgBuy;
      prevClosePortfolioValue += lp * h.totalQty;
    }
  });
  prevClosePortfolioValue = Math.round(prevClosePortfolioValue);

  const lastVal = roundedValues[roundedValues.length - 1];
  const baseVal = hasPrevClose ? prevClosePortfolioValue : roundedValues[0];
  const dayChgAbs = lastVal - baseVal;
  const dayChgPct = baseVal > 0 ? (dayChgAbs / baseVal) * 100 : 0;
  const isUp = lastVal >= baseVal;
  const color = isUp ? '#22c55e' : '#ef4444';

  // Update header
  const titleEl = document.querySelector('#intraday-section .chart-title');
  if (titleEl) {
    const existingSpan = titleEl.querySelector('.day-chg-badge');
    if (existingSpan) existingSpan.remove();
    const span = document.createElement('span');
    span.className = 'day-chg-badge';
    span.style.cssText = `font-size:13px;font-weight:700;margin-left:8px;color:${isUp ? 'var(--green)' : 'var(--red)'}`;
    span.textContent = `${dayChgAbs >= 0 ? '+' : ''}₹${Math.abs(dayChgAbs).toLocaleString('en-IN')} (${dayChgPct >= 0 ? '+' : ''}${dayChgPct.toFixed(2)}%)`;
    titleEl.appendChild(span);
  }

  if (state.portfolioDayChartInstance) state.portfolioDayChartInstance.destroy();

  wrap.innerHTML = '<canvas id="portfolioDayChart" style="width:100%;height:100%"></canvas>';
  const ctx = document.getElementById('portfolioDayChart').getContext('2d');
  const grad = makeGrad(ctx, 250, isUp ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', 'rgba(0,0,0,0)');

  const datasets = [];

  // Prev close baseline
  if (hasPrevClose) {
    datasets.push({
      label: 'Prev Close',
      data: new Array(sortedTimes.length).fill(0),
      borderColor: 'rgba(150,150,180,0.5)',
      borderWidth: 1.5,
      borderDash: [4, 4],
      pointRadius: 0,
      fill: false,
      tension: 0,
      order: 2,
    });
  }

  // Portfolio line — % from prev close
  const portfolioDisplayValues = roundedValues.map(v => ((v - baseVal) / baseVal) * 100);
  datasets.push({
    label: 'Portfolio',
    data: portfolioDisplayValues,
    borderColor: color,
    borderWidth: 2.5,
    backgroundColor: grad,
    fill: true,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0.2,
    order: 0,
  });

  state.portfolioDayChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels: sortedTimes, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#a0a0b0', usePointStyle: true, boxWidth: 10, font: { size: 10 } }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          ...TOOLTIP_DEFAULTS,
          callbacks: {
            label: (context) => {
              if (context.dataset.label === 'Prev Close') return null;
              const idx = context.dataIndex;
              const p = context.parsed.y;
              const absVal = roundedValues[idx];
              const chgAbs = absVal - baseVal;
              const pctStr = `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
              const absStr = `₹${absVal.toLocaleString('en-IN')}`;
              const chgStr = `${chgAbs >= 0 ? '+' : ''}₹${Math.abs(chgAbs).toLocaleString('en-IN')}`;
              return `Portfolio: ${pctStr}, ${chgStr} (${absStr})`;
            }
          }
        }
      },
      scales: {
        x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8, maxRotation: 0 } },
        y: {
          ...AXIS_DEFAULTS,
          ticks: { ...AXIS_DEFAULTS.ticks, callback: v => v.toFixed(1) + '%' },
          title: { display: true, text: 'Change from Prev Close (%)', color: '#7777a0', font: { size: 11 } }
        }
      },
      interaction: { mode: 'index', intersect: false }
    }
  });
  if (!window._chartInstances) window._chartInstances = {};
  window._chartInstances['portfolioDayChart'] = state.portfolioDayChartInstance;
}

// fetchBenchmarkDailyChange — removed (was Upstox-based, no longer needed)

// ── Today P&L bar chart ───────────────────────────
export function renderTodayPnlChart(holdings) {
  const wrap = document.getElementById('today-pnl-wrap');
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
  const data = sorted.map(h => {
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
              const h = sorted[c.dataIndex];
              const lp = state.livePrices[h.ticker];
              const pc = state.prevClosePrices[h.ticker];
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
  const data = sorted.map(h =>
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

// ── Destroy all ──────────────────────────────────
export function destroyAllCharts() {
  ['portfolioChartInstance', 'pieChartInstance', 'pnlChartInstance',
   'portfolioDayChartInstance', 'todayPnlChartInstance'].forEach(key => {
    if (state[key]) { state[key].destroy(); state[key] = null; }
  });
}