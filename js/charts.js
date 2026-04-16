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

// Color palette for benchmarks
const BENCHMARK_COLORS = {
  nifty50: '#f59e0b',
  niftyBank: '#06b6d4',
  niftyFinancial: '#ec4899',
  niftyMidcap: '#10b981'
};

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
let chartDisplayMode = 'percentage';

// Selected benchmarks for comparison (multiple)
let selectedBenchmarks = new Set();

// Benchmark configuration with Upstox keys
const BENCHMARK_CONFIG = {
  nifty50: {
    name: 'Nifty 50',
    upstoxKey: 'NSE_INDEX|Nifty 50',
    color: '#f59e0b'
  },
  niftyBank: {
    name: 'Nifty Bank',
    upstoxKey: 'NSE_INDEX|Nifty Bank',
    color: '#06b6d4'
  },
  niftyMidcap: {
    name: 'Nifty Midcap 50',
    upstoxKey: 'NSE_INDEX|Nifty Midcap 50',
    color: '#10b981'
  }
};

// Store current period change for benchmarks
let currentPeriodChanges = {};

// Add function to fetch intraday data for benchmarks
async function fetchBenchmarkIntraday(benchmark) {
  const config = BENCHMARK_CONFIG[benchmark];
  if (!config) return null;
  
  try {
    const { fetchDayHistory } = await import('./api.js');
    // Use the upstoxKey to fetch intraday data
    const intradayData = await fetchDayHistory(config.upstoxKey, null);
    if (intradayData && intradayData.length > 0) {
      return intradayData;
    }
  } catch(e) {
    console.warn(`Failed to fetch intraday data for ${benchmark}:`, e);
  }
  return null;
}

// Process intraday benchmark data - normalize to percentage change from previous close
function processBenchmarkIntraday(intradayData, prevClose) {
  if (!intradayData || !intradayData.length || !prevClose) return null;
  
  return intradayData.map(point => ({
    time: point.time,
    price: point.price,
    changePercent: ((point.price - prevClose) / prevClose) * 100
  }));
}

// Get benchmark label
function getBenchmarkLabel(benchmark) {
  return BENCHMARK_CONFIG[benchmark]?.name || benchmark;
}

// Fetch benchmark data using Upstox
async function fetchBenchmarkData(benchmark, dates) {
  const config = BENCHMARK_CONFIG[benchmark];
  if (!config) return null;
  
  try {
    const { fetchHistory } = await import('./api.js');
    const hist = await fetchHistory(config.upstoxKey, null, '2y');
    if (hist && Object.keys(hist).length > 0) {
      return hist;
    }
  } catch(e) {
    console.warn(`Failed to fetch ${benchmark}:`, e);
  }
  
  return null;
}

// Process benchmark history data - normalize to percentage based on period start
function processBenchmarkHistory(hist, dates, periodStartValue = null) {
  const filtered = [];
  let firstValue = periodStartValue;
  
  // If no period start value provided, find the first available price for the first date
  if (!firstValue) {
    const firstDate = dates[0];
    let price = hist[firstDate];
    if (!price) {
      const prevDates = Object.keys(hist).filter(d => d <= firstDate).sort();
      if (prevDates.length) price = hist[prevDates[prevDates.length - 1]];
    }
    firstValue = price;
  }
  
  if (!firstValue) return null;
  
  for (const date of dates) {
    let price = hist[date];
    if (!price) {
      const prevDates = Object.keys(hist).filter(d => d <= date).sort();
      if (prevDates.length) price = hist[prevDates[prevDates.length - 1]];
    }
    if (price) {
      filtered.push((price / firstValue) * 100);
    } else {
      filtered.push(null);
    }
  }
  
  // Forward fill nulls
  let lastVal = null;
  for (let i = 0; i < filtered.length; i++) {
    if (filtered[i] !== null) lastVal = filtered[i];
    else if (lastVal !== null) filtered[i] = lastVal;
  }
  
  return filtered;
}

// Get benchmark period change (for display in header)
async function getBenchmarkPeriodChange(benchmark, series) {
  if (!series || !series.length) return null;
  
  const config = BENCHMARK_CONFIG[benchmark];
  if (!config) return null;
  
  const dates = series.map(p => p.date);
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  
  try {
    const { fetchHistory } = await import('./api.js');
    const hist = await fetchHistory(config.upstoxKey, null, '2y');
    if (!hist || Object.keys(hist).length === 0) return null;
    
    // Get start price
    let startPrice = hist[startDate];
    if (!startPrice) {
      const prevDates = Object.keys(hist).filter(d => d <= startDate).sort();
      if (prevDates.length) startPrice = hist[prevDates[prevDates.length - 1]];
    }
    
    // Get end price
    let endPrice = hist[endDate];
    if (!endPrice) {
      const prevDates = Object.keys(hist).filter(d => d <= endDate).sort();
      if (prevDates.length) endPrice = hist[prevDates[prevDates.length - 1]];
    }
    
    if (startPrice && endPrice && startPrice > 0) {
      return ((endPrice - startPrice) / startPrice) * 100;
    }
  } catch(e) {
    console.warn(`Failed to fetch period change for ${benchmark}:`, e);
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
  
  // Update button styles
  document.querySelectorAll('.benchmark-btn').forEach(btn => {
    const btnBenchmark = btn.getAttribute('data-benchmark');
    if (selectedBenchmarks.has(btnBenchmark)) {
      btn.style.background = 'var(--accent)';
      btn.style.color = 'white';
    } else {
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text2)';
    }
  });
  
  // Save preference
  try {
    sessionStorage.setItem('selected_benchmarks', JSON.stringify([...selectedBenchmarks]));
  } catch(e) {}
  
  // Refresh charts
  renderPortfolioChart(state.currentFilter);
  renderPortfolioDayChart();
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
          // Only add if the benchmark still exists in config
          if (BENCHMARK_CONFIG[b]) selectedBenchmarks.add(b);
        });
        // Update UI
        document.querySelectorAll('.benchmark-btn').forEach(btn => {
          const btnBenchmark = btn.getAttribute('data-benchmark');
          if (selectedBenchmarks.has(btnBenchmark)) {
            btn.style.background = 'var(--accent)';
            btn.style.color = 'white';
          } else {
            btn.style.background = 'transparent';
            btn.style.color = 'var(--text2)';
          }
        });
      }
    }
  } catch(e) {}
}

// Toggle chart display mode
export function toggleChartDisplayMode(mode) {
  chartDisplayMode = mode;
  
  document.querySelectorAll('.display-mode-btn').forEach(btn => {
    const btnMode = btn.getAttribute('data-mode');
    if (btnMode === mode) {
      btn.style.background = 'var(--accent)';
      btn.style.color = 'white';
    } else {
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text2)';
    }
  });
  
  try {
    sessionStorage.setItem('chart_display_mode', mode);
  } catch(e) {}
  
  renderPortfolioChart(state.currentFilter);
  renderPortfolioDayChart();
}

export function restoreChartDisplayMode() {
  try {
    const saved = sessionStorage.getItem('chart_display_mode');
    if (saved && (saved === 'percentage' || saved === 'absolute')) {
      chartDisplayMode = saved;
      document.querySelectorAll('.display-mode-btn').forEach(btn => {
        const btnMode = btn.getAttribute('data-mode');
        if (btnMode === saved) {
          btn.style.background = 'var(--accent)';
          btn.style.color = 'white';
        } else {
          btn.style.background = 'transparent';
          btn.style.color = 'var(--text2)';
        }
      });
    }
  } catch(e) {}
  return chartDisplayMode;
}

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
    if (change !== null) {
      benchmarkChanges[benchmark] = change;
    }
  }
  
  // Update period change and ATH badge
  const periodChgEl = document.getElementById('port-period-chg');
  if (periodChgEl) {
    let benchmarkHtml = '';
    if (selectedBenchmarks.size > 0 && Object.keys(benchmarkChanges).length > 0) {
      benchmarkHtml = '<div style="display:flex;gap:8px;margin-left:12px;flex-wrap:wrap;">';
      for (const [benchmark, change] of Object.entries(benchmarkChanges)) {
        const label = getBenchmarkLabel(benchmark);
        const changeColor = change >= 0 ? 'var(--green)' : 'var(--red)';
        benchmarkHtml += `<span style="font-size:11px;font-weight:600;background:rgba(0,0,0,0.2);padding:2px 8px;border-radius:4px;">${label}: <span style="color:${changeColor}">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</span></span>`;
      }
      benchmarkHtml += '</div>';
    }
    
    let athHtml = '';
    if (athChg !== null && Math.abs(athChg) > 0.01) {
      const athColor = athChg >= 0 ? 'var(--green)' : 'var(--red)';
      athHtml = `<span style="color:${athColor};font-size:11px;font-weight:600;background:rgba(239,68,68,0.08);padding:2px 8px;border-radius:4px;margin-left:8px;">${athChg >= 0 ? '+' : ''}${athChg.toFixed(2)}% from ATH (${ath.date})</span>`;
    }
    periodChgEl.innerHTML = `<span style="color:${periodChg >= 0 ? 'var(--green)' : 'var(--red)'}">${periodChg >= 0 ? '+' : ''}${periodChg.toFixed(2)}%</span>${athHtml}${benchmarkHtml}`;
  }
  
  let portfolioData, yAxisLabel, yAxisCallback;
  
  if (chartDisplayMode === 'percentage') {
    portfolioData = portfolioValues.map(v => ((v - startValue) / startValue) * 100);
    yAxisLabel = 'Change (%)';
    yAxisCallback = (v) => v.toFixed(1) + '%';
  } else {
    portfolioData = portfolioValues;
    yAxisLabel = 'Portfolio Value (₹)';
    yAxisCallback = (v) => {
      if (v >= 10000000) return '₹' + (v / 10000000).toFixed(1) + 'Cr';
      if (v >= 100000) return '₹' + (v / 100000).toFixed(1) + 'L';
      return '₹' + v.toLocaleString('en-IN');
    };
  }
  
  const datasets = [{
    label: 'Portfolio',
    data: portfolioData,
    borderColor: '#6366f1',
    borderWidth: 2.5,
    backgroundColor: 'rgba(99,102,241,0.05)',
    fill: true,
    pointRadius: 0,
    pointHoverRadius: 5,
    tension: 0.3,
    order: 0
  }];
  
  // Add selected benchmarks (only in percentage mode)
  if (chartDisplayMode === 'percentage') {
    for (const benchmark of selectedBenchmarks) {
      const fullHist = await fetchBenchmarkData(benchmark, rawDates);
      if (fullHist && Object.keys(fullHist).length > 0) {
        // Get the starting price for the period
        let periodStartPrice = null;
        const firstDate = rawDates[0];
        periodStartPrice = fullHist[firstDate];
        if (!periodStartPrice) {
          const prevDates = Object.keys(fullHist).filter(d => d <= firstDate).sort();
          if (prevDates.length) periodStartPrice = fullHist[prevDates[prevDates.length - 1]];
        }
        
        if (periodStartPrice) {
          // Calculate percentage CHANGE from period start (so it starts at 0%, same as portfolio)
          const benchmarkData = rawDates.map(date => {
            let price = fullHist[date];
            if (!price) {
              const prevDates = Object.keys(fullHist).filter(d => d <= date).sort();
              if (prevDates.length) price = fullHist[prevDates[prevDates.length - 1]];
            }
            if (price) {
              // Return percentage CHANGE, not normalized value
              return ((price - periodStartPrice) / periodStartPrice) * 100;
            }
            return null;
          });
          
          // Forward fill nulls
          let lastVal = null;
          for (let i = 0; i < benchmarkData.length; i++) {
            if (benchmarkData[i] !== null) lastVal = benchmarkData[i];
            else if (lastVal !== null) benchmarkData[i] = lastVal;
          }
          
          if (benchmarkData.some(v => v !== null)) {
            datasets.push({
              label: getBenchmarkLabel(benchmark),
              data: benchmarkData,
              borderColor: BENCHMARK_CONFIG[benchmark]?.color || '#f59e0b',
              borderWidth: 2,
              borderDash: [6, 4],
              backgroundColor: 'transparent',
              fill: false,
              pointRadius: 0,
              pointHoverRadius: 4,
              tension: 0.3,
              order: 1
            });
          }
        }
      }
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
          backgroundColor: '#1a1a1f',
          titleColor: '#8a8a9a',
          bodyColor: '#f0f0f5',
          callbacks: {
            label: (context) => {
              let value = context.parsed.y;
              if (chartDisplayMode === 'percentage') {
                return `${context.dataset.label}: ${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
              } else {
                return `${context.dataset.label}: ₹${value.toLocaleString('en-IN')}`;
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
          ticks: { color: '#7777a0', callback: yAxisCallback, font: { size: 10 } },
          title: { display: true, text: yAxisLabel, color: '#7777a0', font: { size: 11 } }
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

// ── Portfolio Day Chart (intraday) with prev close comparison ──
// ── Portfolio Day Chart (intraday) with benchmark comparison ──
export async function renderPortfolioDayChart() {
  const wrap = document.getElementById('portfolio-day-wrap');
  const canvas = document.getElementById('portfolioDayChart');
  if (!wrap || !canvas) return;

  const holdings = Object.values(state.holdings);
  const allTimesSet = new Set();
  
  // Collect all time points from portfolio holdings
  holdings.forEach(h => {
    const ticks = state.dayHistories[h.ticker];
    if (ticks && ticks.length) ticks.forEach(({ time }) => allTimesSet.add(time));
  });
  
  // Also collect time points from selected benchmarks
  const benchmarkIntradayData = {};
  if (selectedBenchmarks.size > 0 && chartDisplayMode === 'percentage') {
    for (const benchmark of selectedBenchmarks) {
      const data = await fetchBenchmarkIntraday(benchmark);
      if (data && data.length) {
        benchmarkIntradayData[benchmark] = data;
        data.forEach(({ time }) => allTimesSet.add(time));
      }
    }
  }

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

  // Update header with percentage change
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

  // Prepare data based on display mode
  let yAxisLabel, yAxisCallback;
  if (chartDisplayMode === 'percentage') {
    yAxisLabel = 'Change from Prev Close (%)';
    yAxisCallback = (v) => v.toFixed(1) + '%';
  } else {
    yAxisLabel = 'Portfolio Value (₹)';
    yAxisCallback = (v) => {
      if (v >= 10000000) return '₹' + (v / 10000000).toFixed(1) + 'Cr';
      if (v >= 100000) return '₹' + (v / 100000).toFixed(1) + 'L';
      return '₹' + v.toLocaleString('en-IN');
    };
  }

  if (state.portfolioDayChartInstance) state.portfolioDayChartInstance.destroy();

  wrap.innerHTML = '<canvas id="portfolioDayChart" style="width:100%;height:100%"></canvas>';
  const ctx = document.getElementById('portfolioDayChart').getContext('2d');
  const grad = makeGrad(ctx, 250, isUp ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', 'rgba(0,0,0,0)');

  const datasets = [];

  // Add benchmark lines for intraday (full timeline, not just daily change)
  if (chartDisplayMode === 'percentage' && selectedBenchmarks.size > 0) {
    for (const benchmark of selectedBenchmarks) {
      const config = BENCHMARK_CONFIG[benchmark];
      const intradayData = benchmarkIntradayData[benchmark];
      
      if (config && intradayData && intradayData.length) {
        // Create a map of time to price
        const priceMap = {};
        intradayData.forEach(point => {
          priceMap[point.time] = point.price;
        });
        
        // Get previous close for this benchmark
        let benchmarkPrevClose = null;
        try {
          const { fetchHistory } = await import('./api.js');
          const hist = await fetchHistory(config.upstoxKey, null, '5d');
          if (hist && Object.keys(hist).length > 0) {
            const dates = Object.keys(hist).sort();
            if (dates.length >= 2) {
              benchmarkPrevClose = hist[dates[dates.length - 2]];
            }
          }
        } catch(e) {
          console.warn(`Failed to fetch prev close for ${benchmark}:`, e);
        }
        
        if (benchmarkPrevClose) {
          // Build benchmark values aligned with portfolio time points
          const benchmarkValues = [];
          let lastPrice = null;
          
          for (const time of sortedTimes) {
            let price = priceMap[time];
            if (!price && lastPrice) price = lastPrice;
            if (price) lastPrice = price;
            
            if (price && benchmarkPrevClose) {
              benchmarkValues.push(((price - benchmarkPrevClose) / benchmarkPrevClose) * 100);
            } else {
              benchmarkValues.push(null);
            }
          }
          
          // Forward fill any remaining nulls
          let lastVal = null;
          for (let i = 0; i < benchmarkValues.length; i++) {
            if (benchmarkValues[i] !== null) lastVal = benchmarkValues[i];
            else if (lastVal !== null) benchmarkValues[i] = lastVal;
          }
          
          if (benchmarkValues.some(v => v !== null)) {
            datasets.push({
              data: benchmarkValues,
              borderColor: config.color,
              borderWidth: 2,
              borderDash: [6, 4],
              pointRadius: 0,
              fill: false,
              tension: 0.2,
              order: 1,
              label: `${config.name}`
            });
          }
        }
      }
    }
  }

  // Portfolio data
  let portfolioDisplayValues;
  if (chartDisplayMode === 'percentage') {
    portfolioDisplayValues = roundedValues.map(v => ((v - baseVal) / baseVal) * 100);
  } else {
    portfolioDisplayValues = roundedValues;
  }

  // Prev close dashed line (at 0% in percentage mode)
  if (hasPrevClose && chartDisplayMode === 'percentage') {
    datasets.push({
      data: new Array(sortedTimes.length).fill(0),
      borderColor: 'rgba(150,150,180,0.5)',
      borderWidth: 1.5,
      borderDash: [4, 4],
      pointRadius: 0,
      fill: false,
      tension: 0,
      order: 2,
      label: 'Prev Close'
    });
  }

  // Live portfolio value line
  datasets.push({
    data: portfolioDisplayValues,
    borderColor: color,
    borderWidth: 2.5,
    backgroundColor: grad,
    fill: true,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0.2,
    order: 0,
    label: 'Portfolio',
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
          backgroundColor: '#1a1a1f',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#8a8a9a',
          bodyColor: '#f0f0f5',
          padding: 10,
          callbacks: {
            label: (context) => {
              const val = context.parsed.y;
              if (chartDisplayMode === 'percentage') {
                return `${context.dataset.label}: ${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
              } else {
                const originalVal = roundedValues[context.dataIndex];
                const chgAbs = originalVal - baseVal;
                const chgPct = baseVal > 0 ? (chgAbs / baseVal) * 100 : 0;
                return [
                  `${context.dataset.label}: ₹${originalVal.toLocaleString('en-IN')}`,
                  `  Change: ${chgAbs >= 0 ? '+' : ''}₹${Math.abs(chgAbs).toLocaleString('en-IN')} (${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%)`
                ];
              }
            }
          }
        }
      },
      scales: {
        x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8, maxRotation: 0 } },
        y: {
          ...AXIS_DEFAULTS,
          ticks: { ...AXIS_DEFAULTS.ticks, callback: yAxisCallback },
          title: { display: true, text: yAxisLabel, color: '#7777a0', font: { size: 11 } }
        }
      },
      interaction: { mode: 'index', intersect: false }
    }
  });
  if (!window._chartInstances) window._chartInstances = {};
  window._chartInstances['portfolioDayChart'] = state.portfolioDayChartInstance;
}

// Fetch benchmark's daily change percentage
async function fetchBenchmarkDailyChange(benchmark) {
  const config = BENCHMARK_CONFIG[benchmark];
  if (!config) return null;
  
  try {
    const { fetchHistory } = await import('./api.js');
    const hist = await fetchHistory(config.upstoxKey, null, '5d');
    if (hist && Object.keys(hist).length > 0) {
      const dates = Object.keys(hist).sort();
      if (dates.length >= 2) {
        const prevClose = hist[dates[dates.length - 2]];
        const currentPrice = hist[dates[dates.length - 1]];
        if (prevClose && currentPrice && prevClose > 0) {
          return ((currentPrice - prevClose) / prevClose) * 100;
        }
      }
    }
  } catch(e) {
    console.warn(`Failed to fetch daily change for ${benchmark}:`, e);
  }
  return null;
}

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