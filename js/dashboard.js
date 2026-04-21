// ═══════════════════════════════════════════════
// DASHBOARD
// Data loading, stat cards, holdings grid,
// auto-refresh, today's change, day charts.
// ═══════════════════════════════════════════════

import { state, resetCaches, resetAllCaches, isMarketOpen } from './state.js';
import { fmt, pct, colorPnl, showScreen, showToast } from './utils.js';
import { fetchPrice, fetchHistory, fetchDayHistory } from './api.js';
import { forwardFill, buildTimeSeries, patchTodayTimeSeries } from './timeSeries.js';
import {
  renderPortfolioChart,
  renderPnlChart,
  renderPortfolioDayChart,
  renderTodayPnlChart,
  destroyAllCharts,
  COLORS,
  restoreChartDisplayMode,
  restoreBenchmarks,
  setTimeFilter,
} from './charts.js';

import { getFilteredHoldings } from './fileHandler.js';

// Save current user to sessionStorage
function saveCurrentUser(user) {
  try {
    sessionStorage.setItem('dashboard_active_user', user);
  } catch(e) {}
}


// Helper to check if currently on portfolio tab
function isOnPortfolioTab() {
  const portfolioContent = document.getElementById('dash-tab-portfolio');
  const allPortfoliosContent = document.getElementById('dash-tab-all-portfolios');
  if (portfolioContent && allPortfoliosContent) {
    return portfolioContent.style.display === 'block';
  }
  return true;
}

// All Portfolios view state — default to card on mobile immediately
let allPortfoliosView = window.innerWidth <= 768 ? 'card' : 'table';

// Set All Portfolios view
// On mobile (≤768px) we always force card view — no table option.
export function setAllPortfoliosView(view) {
  const isMobile = window.innerWidth <= 768;
  if (isMobile) view = 'card';

  allPortfoliosView = view;
  const tableView = document.getElementById('all-portfolios-table-view');
  const cardView = document.getElementById('all-portfolios-card-view');
  const tableViewBtn = document.getElementById('all-portfolios-table-view-btn');
  const cardViewBtn = document.getElementById('all-portfolios-card-view-btn');

  try {
    sessionStorage.setItem('all_portfolios_view', view);
  } catch(e) {}

  if (view === 'table') {
    if (tableView) tableView.style.display = 'block';
    if (cardView) cardView.style.display = 'none';
    if (tableViewBtn) {
      tableViewBtn.style.background = 'var(--accent)';
      tableViewBtn.style.color = 'white';
    }
    if (cardViewBtn) {
      cardViewBtn.style.background = 'transparent';
      cardViewBtn.style.color = 'var(--text2)';
    }
    renderAllPortfoliosTable();
  } else {
    if (tableView) tableView.style.display = 'none';
    if (cardView) cardView.style.display = 'block';
    if (cardViewBtn) {
      cardViewBtn.style.background = 'var(--accent)';
      cardViewBtn.style.color = 'white';
    }
    if (tableViewBtn) {
      tableViewBtn.style.background = 'transparent';
      tableViewBtn.style.color = 'var(--text2)';
    }
    renderAllPortfoliosCards();
  }
}

// Restore All Portfolios view
// Always returns 'card' on mobile screens regardless of saved preference.
function restoreAllPortfoliosView() {
  if (window.innerWidth <= 768) return 'card';
  try {
    const saved = sessionStorage.getItem('all_portfolios_view');
    if (saved && (saved === 'table' || saved === 'card')) {
      allPortfoliosView = saved;
      return saved;
    }
  } catch(e) {}
  return 'table';
}

// Responsive view handler for All Portfolios
// Called on resize — always enforces card view on mobile with no override option.
function handleResponsiveAllPortfoliosView() {
  const isMobile = window.innerWidth <= 768;
  if (isMobile && allPortfoliosView !== 'card') {
    setAllPortfoliosView('card');
  } else if (!isMobile && allPortfoliosView === 'card') {
    const saved = sessionStorage.getItem('all_portfolios_view');
    setAllPortfoliosView(saved === 'card' ? 'card' : 'table');
  }
}

// Render All Portfolios as cards
function renderAllPortfoliosCards() {
  const users = state.users || [];
  const container = document.getElementById('all-portfolios-cards');
  if (!container) return;
  
  if (!users.length) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;">No users found</div>';
    return;
  }
  
  const rows = [];
  let totalInvestedAll = 0;
  let totalCurrentAll = 0;
  let totalPrevCloseAll = 0;
  
  for (const user of users) {
    const userHoldings = getFilteredHoldings(state.rawRows, user);
    const holdingsList = Object.values(userHoldings);
    
    if (!holdingsList.length) continue;
    
    let totalInvested = 0;
    let totalCurrent = 0;
    let totalPrevClose = 0;
    
    holdingsList.forEach(h => {
      const lp = state.livePrices[h.ticker];
      const pc = state.prevClosePrices[h.ticker];
      totalInvested += h.invested;
      if (lp) totalCurrent += lp * h.totalQty;
      if (pc) totalPrevClose += pc * h.totalQty;
    });
    
    totalInvestedAll += totalInvested;
    totalCurrentAll += totalCurrent;
    totalPrevCloseAll += totalPrevClose;
    
    const totalPnl = totalCurrent - totalInvested;
    const totalPnlPct = totalInvested ? (totalPnl / totalInvested) * 100 : 0;
    const todayChange = totalPrevClose > 0 ? totalCurrent - totalPrevClose : null;
    const todayChangePct = totalPrevClose > 0 ? (todayChange / totalPrevClose) * 100 : null;
    
    rows.push({
      user,
      stockCount: holdingsList.length,
      totalInvested,
      totalCurrent,
      totalPnl,
      totalPnlPct,
      todayChange,
      todayChangePct
    });
  }
  
  container.innerHTML = rows.map(row => `
    <div class="all-portfolios-card holding-card" data-user="${row.user}" style="cursor:pointer;">
      <div class="hc-top">
        <div>
          <div class="hc-ticker" style="display:flex; align-items:center; gap:8px;">
            <div style="width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg, var(--accent), var(--accent2)); display:flex; align-items:center; justify-content:center; font-size:14px; color:white;">${row.user.charAt(0)}</div>
            <strong>${escapeHtml(row.user)}</strong>
          </div>
          <div class="hc-name">${row.stockCount} stocks</div>
        </div>
        <div class="hc-pnl">
          <div class="hc-pnl-val" style="color:${colorPnl(row.totalPnl)}">
            ${row.totalPnl >= 0 ? '+' : ''}${fmt(Math.abs(row.totalPnl))}
          </div>
          <div class="hc-pnl-pct" style="color:${colorPnl(row.totalPnlPct)}">
            ${row.totalPnlPct >= 0 ? '+' : ''}${row.totalPnlPct.toFixed(2)}%
          </div>
        </div>
      </div>
      <div class="hc-bar-bg">
        <div class="hc-bar" style="width:100%; background:linear-gradient(90deg, var(--accent), var(--accent2));"></div>
      </div>
      <div class="hc-bottom">
        <div>
          <div class="hc-meta-label">Invested</div>
          <div class="hc-meta-val">${fmt(row.totalInvested)}</div>
        </div>
        <div>
          <div class="hc-meta-label">Current</div>
          <div class="hc-meta-val">${fmt(row.totalCurrent)}</div>
        </div>
        <div>
          <div class="hc-meta-label">Day Change</div>
          <div class="hc-meta-val" style="color:${row.todayChange != null ? colorPnl(row.todayChange) : 'var(--text2)'}">
            ${row.todayChange != null ? (row.todayChange >= 0 ? '+' : '') + fmt(Math.abs(row.todayChange)) : '—'}
          </div>
        </div>
        <div>
          <div class="hc-meta-label">Day %</div>
          <div class="hc-meta-val" style="color:${row.todayChangePct != null ? colorPnl(row.todayChangePct) : 'var(--text2)'}">
            ${row.todayChangePct != null ? (row.todayChangePct >= 0 ? '+' : '') + row.todayChangePct.toFixed(2) + '%' : '—'}
          </div>
        </div>
      </div>
    </div>
  `).join('');

  // ── Append consolidated "All" card when there are multiple users ──────────
  if (rows.length > 1) {
    const allPnl       = totalCurrentAll - totalInvestedAll;
    const allPnlPct    = totalInvestedAll ? (allPnl / totalInvestedAll) * 100 : 0;
    const allDayChg    = totalPrevCloseAll > 0 ? totalCurrentAll - totalPrevCloseAll : null;
    const allDayChgPct = totalPrevCloseAll > 0 ? (allDayChg / totalPrevCloseAll) * 100 : null;

    const allCard = document.createElement('div');
    allCard.className = 'all-portfolios-card holding-card';
    allCard.dataset.user = '__all__';
    allCard.style.cssText = 'cursor:pointer;border:1px solid var(--accent)44;background:rgba(99,102,241,0.06);';
    allCard.innerHTML = `
      <div class="hc-top">
        <div>
          <div class="hc-ticker" style="display:flex; align-items:center; gap:8px;">
            <div style="width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg,#6366f1,#8b5cf6); display:flex; align-items:center; justify-content:center; font-size:16px; color:white;">∑</div>
            <strong style="color:var(--accent);">All</strong>
          </div>
          <div class="hc-name" style="color:var(--text3);">Combined · ${rows.length} portfolios</div>
        </div>
        <div class="hc-pnl">
          <div class="hc-pnl-val" style="color:${colorPnl(allPnl)}">
            ${allPnl >= 0 ? '+' : ''}${fmt(Math.abs(allPnl))}
          </div>
          <div class="hc-pnl-pct" style="color:${colorPnl(allPnlPct)}">
            ${allPnlPct >= 0 ? '+' : ''}${allPnlPct.toFixed(2)}%
          </div>
        </div>
      </div>
      <div class="hc-bar-bg">
        <div class="hc-bar" style="width:100%; background:linear-gradient(90deg,#6366f1,#8b5cf6);"></div>
      </div>
      <div class="hc-bottom">
        <div>
          <div class="hc-meta-label">Invested</div>
          <div class="hc-meta-val">${fmt(totalInvestedAll)}</div>
        </div>
        <div>
          <div class="hc-meta-label">Current</div>
          <div class="hc-meta-val">${fmt(totalCurrentAll)}</div>
        </div>
        <div>
          <div class="hc-meta-label">Day Change</div>
          <div class="hc-meta-val" style="color:${allDayChg != null ? colorPnl(allDayChg) : 'var(--text2)'}">
            ${allDayChg != null ? (allDayChg >= 0 ? '+' : '') + fmt(Math.abs(allDayChg)) : '—'}
          </div>
        </div>
        <div>
          <div class="hc-meta-label">Day %</div>
          <div class="hc-meta-val" style="color:${allDayChgPct != null ? colorPnl(allDayChgPct) : 'var(--text2)'}">
            ${allDayChgPct != null ? (allDayChgPct >= 0 ? '+' : '') + allDayChgPct.toFixed(2) + '%' : '—'}
          </div>
        </div>
      </div>
    `;
    allCard.addEventListener('click', () => {
      const portfolioTab = document.querySelector('.dash-tab[data-tab="portfolio"]');
      if (portfolioTab) window.switchDashTab('portfolio', portfolioTab);
      setTimeout(() => {
        if (typeof switchDashUser === 'function') switchDashUser('all');
      }, 100);
    });
    container.appendChild(allCard);
  }

  // Add click handlers for individual user cards
  document.querySelectorAll('.all-portfolios-card[data-user]:not([data-user="__all__"])').forEach(card => {
    card.addEventListener('click', () => {
      const user = card.dataset.user;
      const portfolioTab = document.querySelector('.dash-tab[data-tab="portfolio"]');
      if (portfolioTab) {
        window.switchDashTab('portfolio', portfolioTab);
      }
      setTimeout(() => {
        if (typeof switchDashUser === 'function') {
          switchDashUser(user);
        }
      }, 100);
    });
  });
}


// Benchmark comparison state
let activeBenchmark = 'none'; // 'none', 'nifty50', 'nifty200', 'smallcap'

// Toggle benchmark comparison on historical chart
export async function toggleBenchmark(benchmark) {
  activeBenchmark = benchmark;
  
  // Update button styles
  document.querySelectorAll('.benchmark-btn').forEach(btn => {
    const btnBenchmark = btn.getAttribute('data-benchmark');
    if (btnBenchmark === benchmark) {
      btn.style.background = 'var(--accent)';
      btn.style.color = 'white';
    } else {
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text2)';
    }
  });
  
  // Save preference
  try {
    sessionStorage.setItem('active_benchmark', benchmark);
  } catch(e) {}
  
  // Refresh historical chart with benchmark
  await renderPortfolioChartWithBenchmark(state.currentFilter, benchmark);
}

// Render portfolio chart with benchmark comparison
async function renderPortfolioChartWithBenchmark(filter, benchmark) {
  // First get the portfolio series
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
  
  // Normalize portfolio values to percentage (starting at 100)
  const startValue = portfolioValues[0];
  const portfolioNormalized = portfolioValues.map(v => (v / startValue) * 100);
  
  // Prepare datasets
  const datasets = [{
    label: 'Portfolio',
    data: portfolioNormalized,
    borderColor: '#6366f1',
    borderWidth: 2,
    backgroundColor: 'rgba(99,102,241,0.05)',
    fill: true,
    pointRadius: 0,
    pointHoverRadius: 5,
    tension: 0.3,
    order: 0
  }];
  
  // Add benchmark if selected
  if (benchmark !== 'none') {
    let benchmarkData = await fetchBenchmarkData(benchmark, rawDates);
    if (benchmarkData && benchmarkData.length) {
      datasets.push({
        label: getBenchmarkLabel(benchmark),
        data: benchmarkData,
        borderColor: '#f59e0b',
        borderWidth: 2,
        borderDash: [5, 5],
        backgroundColor: 'transparent',
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.3,
        order: 1
      });
    }
  }
  
  // Calculate period change
  const endValue = portfolioValues[portfolioValues.length - 1];
  const chg = ((endValue - startValue) / startValue) * 100;
  const periodChgEl = document.getElementById('port-period-chg');
  if (periodChgEl) {
    periodChgEl.innerHTML = `<span style="color:${chg >= 0 ? 'var(--green)' : 'var(--red)'}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>`;
  }
  
  // Destroy existing chart
  if (state.portfolioChartInstance) state.portfolioChartInstance.destroy();
  
  const ctx = document.getElementById('portfolioChart').getContext('2d');
  
  state.portfolioChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { color: '#a0a0b0', usePointStyle: true, boxWidth: 10 } },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: '#1a1a1f',
          titleColor: '#8a8a9a',
          bodyColor: '#f0f0f5',
          callbacks: {
            label: (context) => {
              const value = context.parsed.y;
              return `${context.dataset.label}: ${value.toFixed(2)}%`;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7777a0', maxRotation: 0 } },
        y: { 
          grid: { color: 'rgba(255,255,255,0.04)' }, 
          ticks: { color: '#7777a0', callback: (v) => v.toFixed(0) + '%' },
          title: { display: true, text: 'Normalized Value (%)', color: '#7777a0' }
        }
      },
      interaction: { mode: 'index', intersect: false }
    }
  });
  
  if (!window._chartInstances) window._chartInstances = {};
  window._chartInstances['portfolioChart'] = state.portfolioChartInstance;
}

// Fetch benchmark data (Nifty, etc.)
async function fetchBenchmarkData(benchmark, dates) {
  // Map benchmark to Yahoo Finance symbol
  const symbolMap = {
    nifty50: '^NSEI',
    nifty200: 'NIFTY200.NS',
    smallcap: 'NIFTYSMALLCAP250.NS'
  };
  
  const symbol = symbolMap[benchmark];
  if (!symbol) return null;
  
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  
  try {
    const hist = await fetchHistory(symbol, null, '2y');
    if (!hist || Object.keys(hist).length === 0) return null;
    
    // Filter to date range and get values
    const filtered = [];
    let firstValue = null;
    
    for (const date of dates) {
      let price = hist[date];
      if (!price) {
        // Find nearest previous price
        const prevDates = Object.keys(hist).filter(d => d <= date).sort();
        if (prevDates.length) price = hist[prevDates[prevDates.length - 1]];
      }
      if (price && !firstValue) firstValue = price;
      if (price && firstValue) {
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
  } catch(e) {
    console.warn('Failed to fetch benchmark data:', e);
    return null;
  }
}

function getBenchmarkLabel(benchmark) {
  const labels = {
    nifty50: 'Nifty 50',
    nifty200: 'Nifty 200',
    smallcap: 'Nifty Small Cap 100'
  };
  return labels[benchmark] || benchmark;
}



// Restore benchmark preference
function restoreBenchmark() {
  try {
    const saved = sessionStorage.getItem('active_benchmark');
    if (saved && (saved === 'none' || saved === 'nifty50' || saved === 'nifty200' || saved === 'smallcap')) {
      activeBenchmark = saved;
      // Update UI after charts render
      setTimeout(() => {
        const btn = document.querySelector(`.benchmark-btn[data-benchmark="${saved}"]`);
        if (btn) {
          document.querySelectorAll('.benchmark-btn').forEach(b => {
            b.style.background = 'transparent';
            b.style.color = 'var(--text2)';
          });
          btn.style.background = 'var(--accent)';
          btn.style.color = 'white';
        }
      }, 100);
    }
  } catch(e) {}
}

// Main view state ('holdings' or 'charts')
let mainView = 'holdings';

// Toggle between Holdings and Charts & Analytics
export function toggleMainView(view) {
  mainView = view;
  const holdingsView = document.getElementById('holdings-main-view');
  const chartsView = document.getElementById('charts-main-view');
  const holdingsBtn = document.getElementById('main-toggle-holdings-btn');
  const chartsBtn = document.getElementById('main-toggle-charts-btn');
  const holdingsSubtoggles = document.getElementById('holdings-subtoggles');
  const chartsSubtoggles = document.getElementById('charts-subtoggles');
  
  // Save to sessionStorage
  try {
    sessionStorage.setItem('main_view', view);
  } catch(e) {}
  
  if (view === 'holdings') {
    if (holdingsView) holdingsView.style.display = 'block';
    if (chartsView) chartsView.style.display = 'none';
    if (holdingsSubtoggles) holdingsSubtoggles.style.display = 'flex';
    if (chartsSubtoggles) chartsSubtoggles.style.display = 'none';
    if (holdingsBtn) {
      holdingsBtn.style.background = 'var(--accent)';
      holdingsBtn.style.color = 'white';
      holdingsBtn.style.border = 'none';
      holdingsBtn.style.boxShadow = '0 2px 8px rgba(91,94,244,0.3)';
    }
    if (chartsBtn) {
      chartsBtn.style.background = 'transparent';
      chartsBtn.style.color = 'var(--text2)';
      chartsBtn.style.border = 'none';
      chartsBtn.style.boxShadow = 'none';
    }
    // Refresh holdings table if needed
    if (holdingsView === 'table') {
      renderHoldingsTable();
    } else {
      const holdings = Object.values(state.holdings);
      const totalCurrent = getTotalCurrent();
      renderHoldingCards(holdings, totalCurrent);
    }
  } else {
    if (holdingsView) holdingsView.style.display = 'none';
    if (chartsView) chartsView.style.display = 'block';
    if (holdingsSubtoggles) holdingsSubtoggles.style.display = 'none';
    if (chartsSubtoggles) chartsSubtoggles.style.display = 'flex';
    if (chartsBtn) {
      chartsBtn.style.background = 'var(--accent)';
      chartsBtn.style.color = 'white';
      chartsBtn.style.border = 'none';
      chartsBtn.style.boxShadow = '0 2px 8px rgba(91,94,244,0.3)';
    }
    if (holdingsBtn) {
      holdingsBtn.style.background = 'transparent';
      holdingsBtn.style.color = 'var(--text2)';
      holdingsBtn.style.border = 'none';
      holdingsBtn.style.boxShadow = 'none';
    }
    // Restore chart section preference
    restoreChartSection();
  }
}

// Restore main view preference
function restoreMainView() {
  try {
    const saved = sessionStorage.getItem('main_view');
    if (saved && (saved === 'holdings' || saved === 'charts')) {
      mainView = saved;
      toggleMainView(saved);
      return;
    }
  } catch(e) {}
  toggleMainView('holdings');
}

// Chart section toggle state
let activeChartSection = 'intraday'; // 'intraday', 'historical', or 'pnl'

// Toggle between chart sections (Intraday, Historical, P&L)
export function toggleChartSection(section) {
  activeChartSection = section;
  
  const intradaySection = document.getElementById('intraday-section');
  const historicalSection = document.getElementById('historical-section');
  const pnlSection = document.getElementById('pnl-section');
  const intradayBtn = document.getElementById('toggle-intraday-btn');
  const historicalBtn = document.getElementById('toggle-historical-btn');
  const pnlBtn = document.getElementById('toggle-pnl-btn');
  
  // Reset all button styles
  const btns = [intradayBtn, historicalBtn, pnlBtn];
  btns.forEach(btn => {
    if (btn) {
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text2)';
    }
  });
  
  // Hide all sections
  if (intradaySection) intradaySection.style.display = 'none';
  if (historicalSection) historicalSection.style.display = 'none';
  if (pnlSection) pnlSection.style.display = 'none';
  
  // Show selected section and highlight button
  if (section === 'intraday') {
    if (intradaySection) intradaySection.style.display = 'block';
    if (intradayBtn) {
      intradayBtn.style.background = 'var(--accent)';
      intradayBtn.style.color = 'white';
    }
    // Refresh intraday chart
    renderPortfolioDayChart();
  } else if (section === 'historical') {
    if (historicalSection) historicalSection.style.display = 'block';
    if (historicalBtn) {
      historicalBtn.style.background = 'var(--accent)';
      historicalBtn.style.color = 'white';
    }
    // Refresh historical chart
    renderPortfolioChart(state.currentFilter);
  } else if (section === 'pnl') {
    if (pnlSection) pnlSection.style.display = 'flex';
    if (pnlBtn) {
      pnlBtn.style.background = 'var(--accent)';
      pnlBtn.style.color = 'white';
    }
    // Refresh P&L charts
    const holdings = Object.values(state.holdings);
    renderTodayPnlChart(holdings);
    renderPnlChart(holdings);
  }
  
  // Save preference
  try {
    sessionStorage.setItem('active_chart_section', section);
  } catch(e) {}
}

// Restore chart section preference
export function restoreChartSection() {
  try {
    const saved = sessionStorage.getItem('active_chart_section');
    if (saved && (saved === 'intraday' || saved === 'historical' || saved === 'pnl')) {
      activeChartSection = saved;
      toggleChartSection(saved);
      return;
    }
  } catch(e) {}
  toggleChartSection('intraday');
}

// Portfolio view state ('table', 'card', or 'charts')
let portfolioView = 'table'; // default to table view

// Set portfolio view (table, card, or charts)
export function setPortfolioView(view) {
  portfolioView = view;
  const tableView = document.getElementById('portfolio-table-view');
  const cardView = document.getElementById('portfolio-card-view');
  const chartsView = document.getElementById('portfolio-charts-view');
  const tableViewBtn = document.getElementById('portfolio-table-view-btn');
  const cardViewBtn = document.getElementById('portfolio-card-view-btn');
  const chartsViewBtn = document.getElementById('portfolio-charts-view-btn');
  
  // Save to sessionStorage
  try {
    sessionStorage.setItem('portfolio_view', view);
  } catch(e) {}
  
  // Reset all button styles
  if (tableViewBtn) {
    tableViewBtn.style.background = 'transparent';
    tableViewBtn.style.color = 'var(--text2)';
  }
  if (cardViewBtn) {
    cardViewBtn.style.background = 'transparent';
    cardViewBtn.style.color = 'var(--text2)';
  }
  if (chartsViewBtn) {
    chartsViewBtn.style.background = 'transparent';
    chartsViewBtn.style.color = 'var(--text2)';
  }
  
  if (view === 'table') {
    if (tableView) tableView.style.display = 'block';
    if (cardView) cardView.style.display = 'none';
    if (chartsView) chartsView.style.display = 'none';
    if (tableViewBtn) {
      tableViewBtn.style.background = 'var(--accent)';
      tableViewBtn.style.color = 'white';
    }
    renderHoldingsTable();
  } else if (view === 'card') {
    if (tableView) tableView.style.display = 'none';
    if (cardView) cardView.style.display = 'block';
    if (chartsView) chartsView.style.display = 'none';
    if (cardViewBtn) {
      cardViewBtn.style.background = 'var(--accent)';
      cardViewBtn.style.color = 'white';
    }
    const holdings = Object.values(state.holdings);
    const totalCurrent = getTotalCurrent();
    renderHoldingCards(holdings, totalCurrent);
  } else {
    if (tableView) tableView.style.display = 'none';
    if (cardView) cardView.style.display = 'none';
    if (chartsView) chartsView.style.display = 'block';
    if (chartsViewBtn) {
      chartsViewBtn.style.background = 'var(--accent)';
      chartsViewBtn.style.color = 'white';
    }
    // Refresh all charts (excluding allocation chart)
    const holdings = Object.values(state.holdings);
    const totalCurrent = getTotalCurrent();
    renderPortfolioChart(state.currentFilter);
    renderPortfolioDayChart();
    renderTodayPnlChart(holdings);
    renderPnlChart(holdings);
  }
}

function restorePortfolioView() {
  try {
    const savedView = sessionStorage.getItem('portfolio_view');
    if (savedView && (savedView === 'table' || savedView === 'card' || savedView === 'charts')) {
      portfolioView = savedView;
      return portfolioView;
    }
  } catch(e) {}
  return 'table';
}

// Rebuild time series based on current filtered holdings
async function rebuildTimeSeriesForCurrentUser() {
  const holdings = Object.values(state.holdings);
  if (!holdings.length) {
    state.fullTimeSeries = [];
    return;
  }
  
  // Get histories for current filtered holdings
  const histories = {};
  for (const h of holdings) {
    if (state.histories[h.ticker]) {
      histories[h.ticker] = state.histories[h.ticker];
    } else {
      // Fetch history if not available
      const hist = await fetchHistory(h.ticker, h.upstoxTicker, '2y');
      const filled = (hist && Object.keys(hist).length > 0) ? forwardFill(hist) : {};
      histories[h.ticker] = filled;
      state.histories[h.ticker] = filled;
    }
  }
  
  // Rebuild time series for filtered holdings only
  state.fullTimeSeries = await buildTimeSeries(histories);
}

// Restore saved user from sessionStorage
function restoreCurrentUser() {
  try {
    const savedUser = sessionStorage.getItem('dashboard_active_user');
    if (savedUser && (savedUser === 'all' || (state.users && state.users.includes(savedUser)))) {
      return savedUser;
    }
  } catch(e) {}
  return 'all';
}

export async function loadDashboard() {
  const ds = document.getElementById('dashboard-screen');
  const dd = document.getElementById('drilldown-screen');
  if (ds) ds.style.display = 'block';
  if (dd) dd.style.display = 'none';

  // Get saved tab from sessionStorage
  let savedTab = 'portfolio';
  try {
    const stored = sessionStorage.getItem('dashboard_current_tab');
    if (stored && (stored === 'portfolio' || stored === 'all-portfolios')) {
      savedTab = stored;
    }
  } catch(e) {}
  
  const loadingDiv = document.getElementById('dash-loading');
  const contentDiv = document.getElementById('dash-content');
  const loadMsg   = document.getElementById('loading-msg');

  loadingDiv.style.display = 'flex';
  contentDiv.style.display  = 'none';

  // Get ALL holdings first (for data fetching)
  const allHoldings = state.allHoldings || getFilteredHoldings(state.rawRows, 'all');
  state.allHoldings = allHoldings;
  const tickers = Object.keys(allHoldings);
  loadMsg.textContent = `Fetching historic data for ${tickers.length} stocks…`;

  try {
    const historyResults = await Promise.all(
      tickers.map(async (ticker) => {
        const h = allHoldings[ticker];
        const hist = await fetchHistory(h.ticker, h.upstoxTicker, '2y');
        const filled = (hist && Object.keys(hist).length > 0) ? forwardFill(hist) : {};
        return { ticker, data: filled };
      })
    );
    const histories = {};
    historyResults.forEach(({ ticker, data }) => { histories[ticker] = data; });

    loadMsg.textContent = 'Fetching live prices…';
    const priceResults = await Promise.all(
      tickers.map(async (ticker) => {
        let price = await fetchPrice(ticker);
        if (!price && histories[ticker] && Object.keys(histories[ticker]).length > 0) {
          const dates = Object.keys(histories[ticker]).sort();
          price = histories[ticker][dates[dates.length - 1]];
        }
        if (!price) {
          price = allHoldings[ticker]?.avgBuy ?? null;
        }
        return { ticker, price };
      })
    );
    priceResults.forEach(({ ticker, price }) => { state.livePrices[ticker] = price; });

    loadMsg.textContent = 'Fetching intraday data…';
    const dayResults = await Promise.all(
      tickers.map(async (ticker) => {
        const h = allHoldings[ticker];
        const dayData = await fetchDayHistory(h.ticker, h.upstoxTicker);
        return { ticker, dayData };
      })
    );
    dayResults.forEach(({ ticker, dayData }) => { state.dayHistories[ticker] = dayData; });

    loadMsg.textContent = 'Building charts…';
    // Store the full time series for ALL holdings
    state.fullTimeSeriesAll = await buildTimeSeries(histories);
    state.histories = histories;

    // CRITICAL: Restore saved user and apply filter
    const savedUser = restoreCurrentUser();
    state.activeUser = savedUser;
    
    // Filter holdings based on saved user
    if (savedUser && savedUser !== 'all') {
      state.holdings = getFilteredHoldings(state.rawRows, savedUser);
    } else {
      state.holdings = allHoldings;
    }
    
    // CRITICAL: Rebuild time series for the FILTERED holdings only
    // Get histories for filtered holdings
    const filteredHistories = {};
    for (const ticker of Object.keys(state.holdings)) {
      if (histories[ticker]) {
        filteredHistories[ticker] = histories[ticker];
      }
    }
    state.fullTimeSeries = await buildTimeSeries(filteredHistories);

    loadingDiv.style.display = 'none';
    contentDiv.style.display  = 'block';
    
    // Only switch to saved tab if switchDashTab is available
    if (typeof window.switchDashTab === 'function') {
      window.switchDashTab(savedTab, document.querySelector(`[data-tab="${savedTab}"]`));
    }
    
    renderDashboard();
    startAutoRefresh();

    if (typeof renderAllPortfolios === 'function') {
      renderAllPortfolios();
    }

    updateRefreshUI();

  } catch (err) {
    console.error(err);
    loadingDiv.innerHTML = `<div class="error-box">Failed to load portfolio data: ${err.message}</div>`;
  }
}

export async function refreshPricesOnly() {
  showToast('Refreshing prices…');
  resetCaches();

  // Fetch prices for ALL holdings across every user, not just the active
  // user's filtered subset. This keeps the All Portfolios view live too.
  const allHoldings = state.allHoldings || state.holdings;
  const allTickers  = Object.keys(allHoldings);

  await Promise.all(
    allTickers.map(async (ticker) => {
      let price = await fetchPrice(ticker);
      if (!price && state.histories[ticker] && Object.keys(state.histories[ticker]).length > 0) {
        const dates = Object.keys(state.histories[ticker]).sort();
        price = state.histories[ticker][dates[dates.length - 1]];
      }
      if (!price) {
        price = allHoldings[ticker]?.avgBuy ?? null;
      }
      state.livePrices[ticker] = price;
    })
  );

  await Promise.all(
    allTickers.map(async (ticker) => {
      const h = allHoldings[ticker];
      state.dayHistories[ticker] = await fetchDayHistory(h.ticker, h.upstoxTicker);
    })
  );

  patchTodayTimeSeries();
  renderDashboardInPlace();
  // Re-render All Portfolios view so it reflects the fresh prices too.
  if (typeof renderAllPortfolios === 'function') renderAllPortfolios();
  updateRefreshTimestamp();
  showToast('Prices updated ✓');
}

export async function refreshDashboard() {
  stopAutoRefresh();
  showToast('Full refresh…');
  resetAllCaches();
  destroyAllCharts();
  await loadDashboard();
}

export function startAutoRefresh() {
  stopAutoRefresh();
  if (!state.refreshPaused) {
    state.refreshIntervalId = setInterval(() => {
      if (state.refreshPaused) return;
      if (!isMarketOpen()) {
        updateRefreshUI(true);
        return;
      }
      refreshPricesOnly();
    }, state.refreshIntervalMs);
  }
  updateRefreshUI();
}

export function stopAutoRefresh() {
  if (state.refreshIntervalId) {
    clearInterval(state.refreshIntervalId);
    state.refreshIntervalId = null;
  }
}

export function toggleRefreshPause() {
  state.refreshPaused = !state.refreshPaused;
  state.refreshPaused ? stopAutoRefresh() : startAutoRefresh();
  updateRefreshUI();
  showToast(state.refreshPaused ? 'Auto-refresh paused' : 'Auto-refresh resumed');
}

export function setRefreshInterval(ms) {
  state.refreshIntervalMs = ms;
  if (!state.refreshPaused) startAutoRefresh();
  updateRefreshUI();
  showToast(`Refresh every ${ms / 1000}s`);
}

function updateRefreshUI(marketClosed = false) {
  const pauseBtn    = document.getElementById('refresh-pause-btn');
  const intervalSel = document.getElementById('refresh-interval-sel');
  const marketTag   = document.getElementById('market-status-tag');
  const open        = isMarketOpen();
  if (pauseBtn) {
    if (state.refreshPaused) {
      pauseBtn.textContent = '▶ Resume';
      pauseBtn.style.color = 'var(--gold)';
      pauseBtn.disabled = false;
    } else {
      pauseBtn.textContent = '⏸ Pause';
      pauseBtn.style.color = open ? '' : 'var(--text3)';
      pauseBtn.title    = open ? 'Pause auto-refresh' : 'Market is closed — auto-refresh suspended';
      pauseBtn.disabled = !open;
    }
  }
  if (intervalSel) intervalSel.value = state.refreshIntervalMs;
  if (marketTag) {
    marketTag.textContent   = open ? '🟢 Market Open' : '🔴 Market Closed';
    marketTag.style.color   = open ? 'var(--green)'   : 'var(--red)';
    marketTag.style.borderColor = open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)';
    marketTag.style.display = '';
  }
}

function updateRefreshTimestamp() {
  const el = document.getElementById('last-refresh-time');
  if (el) el.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

// Update All Portfolios stats without re-rendering the table
function updateAllPortfoliosStats() {
  const users = state.users || [];
  const statsContainer = document.getElementById('all-portfolios-stats');
  if (!statsContainer) return;
  
  if (!users.length) {
    statsContainer.innerHTML = '';
    return;
  }
  
  let totalInvestedAll = 0;
  let totalCurrentAll = 0;
  let totalPrevCloseAll = 0;
  const uniqueTickersAll = new Set();
  
  for (const user of users) {
    const userHoldings = getFilteredHoldings(state.rawRows, user);
    const holdingsList = Object.values(userHoldings);
    
    if (!holdingsList.length) continue;
    
    Object.keys(userHoldings).forEach(ticker => uniqueTickersAll.add(ticker));
    
    let totalInvested = 0;
    let totalCurrent = 0;
    let totalPrevClose = 0;
    
    holdingsList.forEach(h => {
      const lp = state.livePrices[h.ticker];
      const pc = state.prevClosePrices[h.ticker];
      totalInvested += h.invested;
      if (lp) totalCurrent += lp * h.totalQty;
      if (pc) totalPrevClose += pc * h.totalQty;
    });
    
    totalInvestedAll += totalInvested;
    totalCurrentAll += totalCurrent;
    totalPrevCloseAll += totalPrevClose;
  }
  
  const consolidatedPnl = totalCurrentAll - totalInvestedAll;
  const consolidatedPnlPct = totalInvestedAll ? (consolidatedPnl / totalInvestedAll) * 100 : 0;
  const consolidatedDayChange = totalPrevCloseAll > 0 ? totalCurrentAll - totalPrevCloseAll : null;
  const consolidatedDayChangePct = totalPrevCloseAll > 0 ? (consolidatedDayChange / totalPrevCloseAll) * 100 : null;
  
  statsContainer.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total Portfolios</div>
      <div class="stat-value" style="font-size:1.4rem">${users.length}</div>
      <div class="stat-sub">${uniqueTickersAll.size} unique stocks</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Consolidated Invested</div>
      <div class="stat-value">${fmt(totalInvestedAll)}</div>
      <div class="stat-sub">Across all users</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Consolidated Value</div>
      <div class="stat-value" style="color:${totalCurrentAll ? 'var(--text)' : 'var(--text2)'}">${totalCurrentAll ? fmt(totalCurrentAll) : '—'}</div>
      <div class="stat-sub" style="color:${colorPnl(consolidatedPnl)}">${consolidatedPnlPct.toFixed(2)}% overall</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total P&amp;L</div>
      <div class="stat-value" style="color:${colorPnl(consolidatedPnl)}">${consolidatedPnl >= 0 ? '+' : ''}${fmt(Math.abs(consolidatedPnl))}</div>
      <div class="stat-sub" style="color:${colorPnl(consolidatedPnl)}">${consolidatedPnl >= 0 ? 'Profit' : 'Loss'} · ${consolidatedPnlPct.toFixed(2)}%</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Day's Change (All)</div>
      <div class="stat-value" style="color:${consolidatedDayChange != null ? colorPnl(consolidatedDayChange) : 'var(--text2)'}">${consolidatedDayChange != null ? (consolidatedDayChange >= 0 ? '+' : '') + fmt(Math.abs(consolidatedDayChange)) : '—'}</div>
      <div class="stat-sub" style="color:${consolidatedDayChangePct != null ? colorPnl(consolidatedDayChangePct) : 'var(--text2)'}">${consolidatedDayChangePct != null ? (consolidatedDayChangePct >= 0 ? '+' : '') + consolidatedDayChangePct.toFixed(2) + '%' : '—'}</div>
    </div>
  `;
}

// Update renderAllPortfolios function to use the new stats function
export function renderAllPortfolios() {
  // First update stats
  updateAllPortfoliosStats();

  // On mobile (≤768px) always render cards — never the table
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    allPortfoliosView = 'card';
    // Ensure the DOM reflects card-only state
    const tableView = document.getElementById('all-portfolios-table-view');
    const cardView  = document.getElementById('all-portfolios-card-view');
    if (tableView) tableView.style.display = 'none';
    if (cardView)  cardView.style.display  = 'block';
    renderAllPortfoliosCards();
  } else if (allPortfoliosView === 'table') {
    renderAllPortfoliosTable();
  } else {
    renderAllPortfoliosCards();
  }
}

export function renderAllPortfoliosTable() {
  const users = state.users || [];
  const tbody = document.getElementById('all-portfolios-tbody');
  if (!tbody) {
    console.log('All portfolios tbody not found');
    return;
  }
  
  console.log('Rendering all portfolios for users:', users);
  
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;">No users found</td></tr>';
    const statsContainer = document.getElementById('all-portfolios-stats');
    if (statsContainer) statsContainer.innerHTML = '';
    return;
  }
  
  const rows = [];
  let totalInvestedAll = 0;
  let totalCurrentAll = 0;
  let totalPrevCloseAll = 0;
  const uniqueTickersAll = new Set();
  
  for (const user of users) {
    const userHoldings = getFilteredHoldings(state.rawRows, user);
    const holdingsList = Object.values(userHoldings);
    
    if (!holdingsList.length) continue;
    
    Object.keys(userHoldings).forEach(ticker => uniqueTickersAll.add(ticker));
    
    let totalInvested = 0;
    let totalCurrent = 0;
    let totalPrevClose = 0;
    
    holdingsList.forEach(h => {
      const lp = state.livePrices[h.ticker];
      const pc = state.prevClosePrices[h.ticker];
      totalInvested += h.invested;
      if (lp) totalCurrent += lp * h.totalQty;
      if (pc) totalPrevClose += pc * h.totalQty;
    });
    
    totalInvestedAll += totalInvested;
    totalCurrentAll += totalCurrent;
    totalPrevCloseAll += totalPrevClose;
    
    const totalPnl = totalCurrent - totalInvested;
    const totalPnlPct = totalInvested ? (totalPnl / totalInvested) * 100 : 0;
    const todayChange = totalPrevClose > 0 ? totalCurrent - totalPrevClose : null;
    const todayChangePct = totalPrevClose > 0 ? (todayChange / totalPrevClose) * 100 : null;
    
    rows.push({
      user,
      stockCount: holdingsList.length,
      totalInvested,
      totalCurrent,
      totalPnl,
      totalPnlPct,
      todayChange,
      todayChangePct
    });
  }
  
  // Apply sorting
  rows.sort((a, b) => {
    let va, vb;
    switch (allPortfoliosSort.key) {
      case 'user':
        va = a.user.toLowerCase();
        vb = b.user.toLowerCase();
        return allPortfoliosSort.asc ? va.localeCompare(vb) : vb.localeCompare(va);
      case 'stockCount':
        va = a.stockCount;
        vb = b.stockCount;
        return allPortfoliosSort.asc ? va - vb : vb - va;
      case 'totalInvested':
        va = a.totalInvested;
        vb = b.totalInvested;
        return allPortfoliosSort.asc ? va - vb : vb - va;
      case 'totalCurrent':
        va = a.totalCurrent;
        vb = b.totalCurrent;
        return allPortfoliosSort.asc ? va - vb : vb - va;
      case 'totalPnl':
        va = a.totalPnl;
        vb = b.totalPnl;
        return allPortfoliosSort.asc ? va - vb : vb - va;
      case 'totalPnlPct':
        va = a.totalPnlPct;
        vb = b.totalPnlPct;
        return allPortfoliosSort.asc ? va - vb : vb - va;
      case 'todayChange':
        va = a.todayChange ?? -Infinity;
        vb = b.todayChange ?? -Infinity;
        return allPortfoliosSort.asc ? va - vb : vb - va;
      case 'todayChangePct':
        va = a.todayChangePct ?? -Infinity;
        vb = b.todayChangePct ?? -Infinity;
        return allPortfoliosSort.asc ? va - vb : vb - va;
      default:
        return 0;
    }
  });
  
  // Update sort indicators on headers
  const headers = document.querySelectorAll('#all-portfolios-table-view th');
  headers.forEach(th => {
    const onclickAttr = th.getAttribute('onclick');
    let columnKey = null;
    if (onclickAttr) {
      const match = onclickAttr.match(/sortAllPortfoliosTable\('([^']+)'\)/);
      if (match) columnKey = match[1];
    }
    
    let baseText = th.textContent.replace(/[ ↑↓]/g, '');
    
    if (columnKey === allPortfoliosSort.key) {
      th.textContent = baseText + (allPortfoliosSort.asc ? ' ↑' : ' ↓');
    } else {
      th.textContent = baseText;
    }
  });
  
  // Calculate consolidated totals (same as before)
  const consolidatedPnl = totalCurrentAll - totalInvestedAll;
  const consolidatedPnlPct = totalInvestedAll ? (consolidatedPnl / totalInvestedAll) * 100 : 0;
  const consolidatedDayChange = totalPrevCloseAll > 0 ? totalCurrentAll - totalPrevCloseAll : null;
  const consolidatedDayChangePct = totalPrevCloseAll > 0 ? (consolidatedDayChange / totalPrevCloseAll) * 100 : null;
  
  // Render stat cards (same as before)
  const statsContainer = document.getElementById('all-portfolios-stats');
  if (statsContainer) {
    statsContainer.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Total Portfolios</div>
        <div class="stat-value" style="font-size:1.4rem">${users.length}</div>
        <div class="stat-sub">${uniqueTickersAll.size} unique stocks</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Consolidated Invested</div>
        <div class="stat-value">${fmt(totalInvestedAll)}</div>
        <div class="stat-sub">Across all users</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Consolidated Value</div>
        <div class="stat-value" style="color:${totalCurrentAll ? 'var(--text)' : 'var(--text2)'}">${totalCurrentAll ? fmt(totalCurrentAll) : '—'}</div>
        <div class="stat-sub" style="color:${colorPnl(consolidatedPnl)}">${consolidatedPnlPct.toFixed(2)}% overall</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total P&amp;L</div>
        <div class="stat-value" style="color:${colorPnl(consolidatedPnl)}">${consolidatedPnl >= 0 ? '+' : ''}${fmt(Math.abs(consolidatedPnl))}</div>
        <div class="stat-sub" style="color:${colorPnl(consolidatedPnl)}">${consolidatedPnl >= 0 ? 'Profit' : 'Loss'} · ${consolidatedPnlPct.toFixed(2)}%</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Day's Change (All)</div>
        <div class="stat-value" style="color:${consolidatedDayChange != null ? colorPnl(consolidatedDayChange) : 'var(--text2)'}">${consolidatedDayChange != null ? (consolidatedDayChange >= 0 ? '+' : '') + fmt(Math.abs(consolidatedDayChange)) : '—'}</div>
        <div class="stat-sub" style="color:${consolidatedDayChangePct != null ? colorPnl(consolidatedDayChangePct) : 'var(--text2)'}">${consolidatedDayChangePct != null ? (consolidatedDayChangePct >= 0 ? '+' : '') + consolidatedDayChangePct.toFixed(2) + '%' : '—'}</div>
      </div>
    `;
  }
  
  // Render table rows — individual users
  tbody.innerHTML = rows.map(row => `
    <tr class="all-portfolios-row" data-user="${row.user}" style="cursor:pointer; transition:background 0.15s;">
      <td style="padding:12px 20px; border-bottom:1px solid var(--border);">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg, var(--accent), var(--accent2)); display:flex; align-items:center; justify-content:center; font-size:14px; color:white;">${row.user.charAt(0)}</div>
          <strong style="font-size:14px;">${escapeHtml(row.user)}</strong>
        </div>
       </td>
      <td style="padding:12px 20px; text-align:right; border-bottom:1px solid var(--border); font-weight:600;">${row.stockCount}</td>
      <td style="padding:12px 20px; text-align:right; border-bottom:1px solid var(--border);">${fmt(row.totalInvested)}</td>
      <td style="padding:12px 20px; text-align:right; border-bottom:1px solid var(--border); font-weight:600;">${row.totalCurrent ? fmt(row.totalCurrent) : '—'}</td>
      <td style="padding:12px 20px; text-align:right; border-bottom:1px solid var(--border); color:${colorPnl(row.totalPnl)}; font-weight:600;">
        ${row.totalPnl >= 0 ? '+' : ''}${fmt(Math.abs(row.totalPnl))}
      </td>
      <td style="padding:12px 20px; text-align:right; border-bottom:1px solid var(--border); color:${colorPnl(row.totalPnlPct)};">
        ${row.totalPnlPct >= 0 ? '+' : ''}${row.totalPnlPct.toFixed(2)}%
      </td>
      <td style="padding:12px 20px; text-align:right; border-bottom:1px solid var(--border); color:${row.todayChange != null ? colorPnl(row.todayChange) : 'var(--text2)'};">
        ${row.todayChange != null ? (row.todayChange >= 0 ? '+' : '') + fmt(Math.abs(row.todayChange)) : '—'}
      </td>
      <td style="padding:12px 20px; text-align:right; border-bottom:1px solid var(--border); color:${row.todayChangePct != null ? colorPnl(row.todayChangePct) : 'var(--text2)'};">
        ${row.todayChangePct != null ? (row.todayChangePct >= 0 ? '+' : '') + row.todayChangePct.toFixed(2) + '%' : '—'}
      </td>
    </tr>
  `).join('');

  // ── "All" consolidated row pinned at the bottom ──────────────────────────
  // Lets the user jump straight to the combined view without leaving this page.
  if (rows.length > 1) {
    const allPnl       = totalCurrentAll - totalInvestedAll;
    const allPnlPct    = totalInvestedAll ? (allPnl / totalInvestedAll) * 100 : 0;
    const allDayChg    = totalPrevCloseAll > 0 ? totalCurrentAll - totalPrevCloseAll : null;
    const allDayChgPct = totalPrevCloseAll > 0 ? (allDayChg / totalPrevCloseAll) * 100 : null;
    const allTr = document.createElement('tr');
    allTr.className = 'all-portfolios-row all-portfolios-all-row';
    allTr.dataset.user = '__all__';
    allTr.style.cssText = 'cursor:pointer;background:rgba(99,102,241,0.06);border-top:2px solid var(--accent);transition:background 0.15s;';
    allTr.innerHTML = `
      <td style="padding:12px 20px; border-bottom:1px solid var(--border);">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg,#6366f1,#8b5cf6); display:flex; align-items:center; justify-content:center; font-size:14px; color:white;">∑</div>
          <strong style="font-size:14px; color:var(--accent);">All</strong>
        </div>
      </td>
      <td style="padding:12px 20px; text-align:right; border-bottom:1px solid var(--border); font-weight:600;">${uniqueTickersAll.size} <span style="color:var(--text3);font-weight:400;font-size:11px;">unique</span></td>
      <td style="padding:12px 20px; text-align:right; border-bottom:1px solid var(--border);">${fmt(totalInvestedAll)}</td>
      <td style="padding:12px 20px; text-align:right; border-bottom:1px solid var(--border); font-weight:600;">${totalCurrentAll ? fmt(totalCurrentAll) : '—'}</td>
      <td style="padding:12px 20px; text-align:right; border-bottom:1px solid var(--border); color:${colorPnl(allPnl)}; font-weight:600;">
        ${allPnl >= 0 ? '+' : ''}${fmt(Math.abs(allPnl))}
      </td>
      <td style="padding:12px 20px; text-align:right; border-bottom:1px solid var(--border); color:${colorPnl(allPnlPct)};">
        ${allPnlPct >= 0 ? '+' : ''}${allPnlPct.toFixed(2)}%
      </td>
      <td style="padding:12px 20px; text-align:right; border-bottom:1px solid var(--border); color:${allDayChg != null ? colorPnl(allDayChg) : 'var(--text2)'};">
        ${allDayChg != null ? (allDayChg >= 0 ? '+' : '') + fmt(Math.abs(allDayChg)) : '—'}
      </td>
      <td style="padding:12px 20px; text-align:right; border-bottom:1px solid var(--border); color:${allDayChgPct != null ? colorPnl(allDayChgPct) : 'var(--text2)'};">
        ${allDayChgPct != null ? (allDayChgPct >= 0 ? '+' : '') + allDayChgPct.toFixed(2) + '%' : '—'}
      </td>
    `;
    allTr.addEventListener('mouseenter', () => { allTr.style.background = 'rgba(99,102,241,0.12)'; });
    allTr.addEventListener('mouseleave', () => { allTr.style.background = 'rgba(99,102,241,0.06)'; });
    allTr.addEventListener('click', () => {
      const portfolioTab = document.querySelector('.dash-tab[data-tab="portfolio"]');
      if (portfolioTab) window.switchDashTab('portfolio', portfolioTab);
      setTimeout(() => {
        // 'all' is the special user value that shows combined holdings
        if (typeof switchDashUser === 'function') switchDashUser('all');
      }, 100);
    });
    tbody.appendChild(allTr);
  }
  
  // Add click handlers (same as before)
  document.querySelectorAll('.all-portfolios-row').forEach(row => {
    row.addEventListener('click', () => {
      const user = row.dataset.user;
      const portfolioTab = document.querySelector('.dash-tab[data-tab="portfolio"]');
      if (portfolioTab) {
        window.switchDashTab('portfolio', portfolioTab);
      }
      setTimeout(() => {
        if (typeof switchDashUser === 'function') {
          switchDashUser(user);
        }
      }, 100);
    });
    
    row.addEventListener('mouseenter', () => {
      row.style.background = 'var(--bg3)';
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = '';
    });
  });
}


// Helper function to escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// Update renderUserTabs function
export function renderUserTabs() {
  const users = state.users || [];
  const wrap = document.getElementById('dash-user-tabs');
  if (!wrap) return;
  
  // Get current tab
  let currentTab = 'portfolio';
  try {
    const savedTab = sessionStorage.getItem('dashboard_current_tab');
    if (savedTab) currentTab = savedTab;
  } catch(e) {}
  
  // Check which tab is actually visible
  const portfolioContent = document.getElementById('dash-tab-portfolio');
  const allPortfoliosContent = document.getElementById('dash-tab-all-portfolios');
  if (portfolioContent && allPortfoliosContent) {
    if (allPortfoliosContent.style.display === 'block') {
      currentTab = 'all-portfolios';
    } else if (portfolioContent.style.display === 'block') {
      currentTab = 'portfolio';
    }
  }
  
  // Only show user tabs if there are at least 2 users AND we're on portfolio tab
  if (!users || users.length <= 1 || currentTab === 'all-portfolios') { 
    wrap.style.display = 'none'; 
    return; 
  }
  wrap.style.display = 'flex';
  
  // Restore saved user
  let active = state.activeUser || restoreCurrentUser();
  if (active !== 'all' && !users.includes(active)) {
    active = 'all';
  }
  state.activeUser = active;
  
  // CRITICAL: Apply the user filter to holdings
  if (active !== 'all') {
    state.holdings = getFilteredHoldings(state.rawRows, active);
  } else {
    state.holdings = state.allHoldings || getFilteredHoldings(state.rawRows, 'all');
  }
  
  const tabs = ['all', ...users];
  wrap.innerHTML = tabs.map(u => `
    <button class="dash-user-tab${u === active ? ' active' : ''}" data-user="${u}"
      onclick="switchDashUser('${u}')">
      ${u === 'all' ? '👥 All' : u}
    </button>`).join('');
}

export async function switchDashUser(user) {
  state.activeUser = user;
  saveCurrentUser(user);  // This saves to sessionStorage
  state.holdings = getFilteredHoldings(state.rawRows, user);
  
  // Update user tab UI
  document.querySelectorAll('.dash-user-tab').forEach(t => {
    const isActive = t.dataset.user === user;
    t.classList.toggle('active', isActive);
    t.style.background = isActive ? 'var(--accent)' : 'var(--bg3)';
    t.style.color = isActive ? '#fff' : 'var(--text2)';
  });
  
  // Rebuild time series for the filtered holdings
  await rebuildTimeSeriesForCurrentUser();
  
  // Re-render dashboard with new data
  renderDashboard();
}

export function renderDashboard() {
  renderUserTabs();
  const holdings = Object.values(state.holdings);

  let totalInvested = 0, totalCurrent = 0, totalPrevClose = 0;
  holdings.forEach((h) => {
    const lp = state.livePrices[h.ticker];
    const pc = state.prevClosePrices[h.ticker];
    totalInvested  += h.invested;
    if (lp) totalCurrent   += lp * h.totalQty;
    if (pc) totalPrevClose += pc * h.totalQty;
  });

  const totalPnl        = totalCurrent - totalInvested;
  const totalPnlPct     = totalInvested ? (totalPnl / totalInvested) * 100 : 0;
  const todayChange     = totalPrevClose > 0 ? totalCurrent - totalPrevClose : null;
  const todayChangePct  = totalPrevClose > 0 ? (todayChange / totalPrevClose) * 100 : null;

  let best = null, worst = null;
  holdings.forEach((h) => {
    const lp = state.livePrices[h.ticker];
    if (!lp) return;
    const p = ((lp - h.avgBuy) / h.avgBuy) * 100;
    if (!best  || p > best.pct)  best  = { ticker: h.ticker, pct: p };
    if (!worst || p < worst.pct) worst = { ticker: h.ticker, pct: p };
  });

  renderStatCards({ totalInvested, totalCurrent, totalPnl, totalPnlPct, todayChange, todayChangePct, best, holdings });
  
  // Small delay to ensure DOM is ready for charts
  setTimeout(() => {
    // Always update charts data (even if not visible, they'll be ready when switched)
    renderPortfolioChart(state.currentFilter);
    renderPortfolioDayChart();
    renderTodayPnlChart(holdings);
    renderPnlChart(holdings);
  }, 100);
    
  // Show the appropriate view based on saved preference
  const savedHoldingsView = restoreHoldingsView();
  setHoldingsView(savedHoldingsView);
  updateRefreshTimestamp();
}

function renderDashboardInPlace() {
  const holdings = Object.values(state.holdings);

  let totalInvested = 0, totalCurrent = 0, totalPrevClose = 0;
  holdings.forEach((h) => {
    const lp = state.livePrices[h.ticker];
    const pc = state.prevClosePrices[h.ticker];
    totalInvested  += h.invested;
    if (lp) totalCurrent   += lp * h.totalQty;
    if (pc) totalPrevClose += pc * h.totalQty;
  });

  const totalPnl       = totalCurrent - totalInvested;
  const totalPnlPct    = totalInvested ? (totalPnl / totalInvested) * 100 : 0;
  const todayChange    = totalPrevClose > 0 ? totalCurrent - totalPrevClose : null;
  const todayChangePct = totalPrevClose > 0 ? (todayChange / totalPrevClose) * 100 : null;

  let best = null;
  holdings.forEach((h) => {
    const lp = state.livePrices[h.ticker];
    if (!lp) return;
    const p = ((lp - h.avgBuy) / h.avgBuy) * 100;
    if (!best || p > best.pct) best = { ticker: h.ticker, pct: p };
  });

  renderStatCards({ totalInvested, totalCurrent, totalPnl, totalPnlPct, todayChange, todayChangePct, best, holdings });
  
  // Update charts
  renderPortfolioChart(state.currentFilter);
  renderPortfolioDayChart();
  renderTodayPnlChart(holdings);
  renderPnlChart(holdings);
  
  // Update table if visible
  if (portfolioView === 'table') {
    renderHoldingsTable();
  }

  restoreChartDisplayMode();
  updateRefreshTimestamp();
  restoreBenchmarks();
  restoreChartSection();
  restoreMainView();
  restoreBenchmark();
  // Keep All Portfolios in sync whenever the portfolio view re-renders.
  const apContent = document.getElementById('dash-tab-all-portfolios');
  if (apContent && apContent.style.display !== 'none') {
    if (typeof renderAllPortfolios === 'function') renderAllPortfolios();
  }
}

// Restore time filter button state
function restoreTimeFilterUI() {
  const savedFilter = state.currentFilter || '1M';
  const timeFilters = document.querySelectorAll('.time-filters .tf-btn');
  
  timeFilters.forEach(btn => {
    const btnFilter = btn.getAttribute('onclick');
    let filterValue = null;
    if (btnFilter) {
      const match = btnFilter.match(/setTimeFilter\('([^']+)'/);
      if (match) filterValue = match[1];
    }
    
    if (filterValue === savedFilter) {
      btn.classList.add('active');
      btn.style.background = 'var(--accent)';
      btn.style.color = 'white';
    } else {
      btn.classList.remove('active');
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text2)';
    }
  });
}

function renderStatCards({ totalInvested, totalCurrent, totalPnl, totalPnlPct,
                            todayChange, todayChangePct, best, holdings }) {
  const hasPrevClose = todayChange !== null;

  // Find the intraday best performer (highest day change percentage)
  let intradayBest = null;
  holdings.forEach((h) => {
    const lp = state.livePrices[h.ticker];
    const pc = state.prevClosePrices[h.ticker];
    if (lp && pc && pc > 0) {
      const dayPct = ((lp - pc) / pc) * 100;
      if (!intradayBest || dayPct > intradayBest.pct) {
        intradayBest = { ticker: h.ticker, pct: dayPct };
      }
    }
  });

  document.getElementById('stat-cards').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total Invested</div>
      <div class="stat-value">${fmt(totalInvested)}</div>
      <div class="stat-sub">${holdings.length} stocks</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Current Value</div>
      <div class="stat-value" style="color:${totalCurrent ? 'var(--text)' : 'var(--text2)'}">
        ${totalCurrent ? fmt(totalCurrent) : 'Fetching…'}
      </div>
      <div class="stat-sub" style="color:${colorPnl(totalPnl)}">
        ${totalCurrent ? pct(totalPnlPct) + ' overall' : ''}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total P&amp;L</div>
      <div class="stat-value" style="color:${colorPnl(totalPnl)}">
        ${totalCurrent ? fmt(Math.abs(totalPnl)) : '—'}
      </div>
      <div class="stat-sub" style="color:${colorPnl(totalPnl)}">
        ${totalCurrent ? (totalPnl >= 0 ? 'Profit' : 'Loss') + ' · ' + pct(totalPnlPct) : ''}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Day's Change</div>
      <div class="stat-value" style="color:${hasPrevClose ? colorPnl(todayChange) : 'var(--text2)'}">
        ${hasPrevClose ? (todayChange >= 0 ? '+' : '') + fmt(Math.abs(todayChange)) : '—'}
      </div>
      <div class="stat-sub" style="color:${hasPrevClose ? colorPnl(todayChangePct) : 'var(--text2)'}">
        ${hasPrevClose ? pct(todayChangePct) + ' today' : 'Prev close unavailable'}
      </div>
    </div>
    ${intradayBest ? `
      <div class="stat-card">
        <div class="stat-label">Best Performer (Intraday)</div>
        <div class="stat-value" style="color:var(--green);font-size:${intradayBest.ticker.length > 10 ? '0.95rem' : intradayBest.ticker.length > 7 ? '1.1rem' : '1.3rem'};word-break:break-all;line-height:1.2;">${intradayBest.ticker}</div>
        <div class="stat-sub" style="color:var(--green)">+${intradayBest.pct.toFixed(2)}% today</div>
      </div>` : ''}
    ${best ? `
    <div class="stat-card">
      <div class="stat-label">Best Performer (Overall)</div>
      <div class="stat-value" style="color:var(--green);font-size:${best.ticker.length > 10 ? '0.95rem' : best.ticker.length > 7 ? '1.1rem' : '1.3rem'};word-break:break-all;line-height:1.2;">${best.ticker}</div>
      <div class="stat-sub" style="color:var(--green)">${pct(best.pct)}</div>
    </div>` : ''}`;
}

function renderHoldingCards(holdings, totalCurrent) {
  const grid = document.getElementById('holdings-grid');
  grid.innerHTML = '';

  holdings.forEach((h, i) => {
    const lp  = state.livePrices[h.ticker];
    const pc  = state.prevClosePrices[h.ticker];
    const currentVal  = lp ? lp * h.totalQty : null;
    const pnlVal      = currentVal != null ? currentVal - h.invested : null;
    const pnlPct      = pnlVal != null ? (pnlVal / h.invested) * 100 : null;
    const allocPct    = totalCurrent && currentVal ? (currentVal / totalCurrent) * 100 : null;
    const color       = COLORS[i % COLORS.length];

    const todayChgPct = (lp && pc && pc > 0) ? ((lp - pc) / pc) * 100 : null;
    const todayChgAbs = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;

    const card = document.createElement('div');
    card.className = 'holding-card';
    card.onclick = () => import('./drilldown.js').then((m) => m.openDrilldown(h.ticker));
    card.dataset.ticker = h.ticker;
    card.innerHTML = `
      <div class="hc-top">
        <div>
          <div class="hc-ticker">${h.ticker}</div>
          <div class="hc-name">Qty: ${h.totalQty} · Avg: ${h.avgBuy.toFixed(2)}</div>
        </div>
        <div class="hc-pnl">
          <div class="hc-pnl-val" style="color:${pnlVal != null ? colorPnl(pnlVal) : 'var(--text2)'}">
            ${pnlVal != null ? (pnlVal >= 0 ? '+' : '') + pnlVal.toFixed(0) : '—'}
          </div>
          <div class="hc-pnl-pct" style="color:${pnlPct != null ? colorPnl(pnlPct) : 'var(--text2)'}">
            ${pnlPct != null ? pct(pnlPct) : 'no price'}
          </div>
        </div>
      </div>
      <div class="hc-bar-bg">
        <div class="hc-bar" style="width:${allocPct ? Math.min(100, allocPct * 2) : 10}%;background:${color}"></div>
      </div>
      <div class="hc-bottom">
        <div><div class="hc-meta-label">Invested</div><div class="hc-meta-val">${fmt(h.invested)}</div></div>
        <div><div class="hc-meta-label">Current</div><div class="hc-meta-val hc-d-current">${currentVal ? fmt(currentVal) : '—'}</div></div>
        <div><div class="hc-meta-label">Live Price</div><div class="hc-meta-val hc-d-price">${lp ? lp.toFixed(2) : '—'}</div></div>
        <div>
          <div class="hc-meta-label">Today</div>
          <div class="hc-meta-val hc-d-today" style="color:${todayChgPct != null ? colorPnl(todayChgPct) : 'var(--text2)'}">
            ${todayChgPct != null ? pct(todayChgPct) : '—'}
          </div>
        </div>
        <div>
          <div class="hc-meta-label">Day P&amp;L</div>
          <div class="hc-meta-val hc-d-daypnl" style="color:${todayChgAbs != null ? colorPnl(todayChgAbs) : 'var(--text2)'}">
            ${todayChgAbs != null ? (todayChgAbs >= 0 ? '+' : '') + fmt(Math.abs(todayChgAbs)) : '—'}
          </div>
        </div>
      </div>`;
    grid.appendChild(card);
  });
}

function updateHoldingCardsInPlace(holdings, totalCurrent) {
  const grid = document.getElementById('holdings-grid');
  if (!grid) return;
  const existingCards = [...grid.querySelectorAll('.holding-card[data-ticker]')];
  if (existingCards.length !== holdings.length) {
    renderHoldingCards(holdings, totalCurrent);
    return;
  }

  holdings.forEach((h) => {
    const card = grid.querySelector(`.holding-card[data-ticker="${h.ticker}"]`);
    if (!card) return;

    const lp  = state.livePrices[h.ticker];
    const pc  = state.prevClosePrices[h.ticker];
    const currentVal  = lp ? lp * h.totalQty : null;
    const pnlVal      = currentVal != null ? currentVal - h.invested : null;
    const pnlPct      = pnlVal != null ? (pnlVal / h.invested) * 100 : null;
    const todayChgPct = (lp && pc && pc > 0) ? ((lp - pc) / pc) * 100 : null;
    const todayChgAbs = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;

    const pnlValEl  = card.querySelector('.hc-pnl-val');
    const pnlPctEl  = card.querySelector('.hc-pnl-pct');
    const currEl    = card.querySelector('.hc-d-current');
    const priceEl   = card.querySelector('.hc-d-price');
    const todayEl   = card.querySelector('.hc-d-today');
    const daypnlEl  = card.querySelector('.hc-d-daypnl');

    if (pnlValEl) {
      pnlValEl.style.color = pnlVal != null ? colorPnl(pnlVal) : 'var(--text2)';
      pnlValEl.textContent = pnlVal != null ? (pnlVal >= 0 ? '+' : '') + pnlVal.toFixed(0) : '—';
    }
    if (pnlPctEl) {
      pnlPctEl.style.color = pnlPct != null ? colorPnl(pnlPct) : 'var(--text2)';
      pnlPctEl.textContent = pnlPct != null ? pct(pnlPct) : 'no price';
    }
    if (currEl)   currEl.textContent  = currentVal ? fmt(currentVal) : '—';
    if (priceEl)  priceEl.textContent = lp ? lp.toFixed(2) : '—';
    if (todayEl) {
      todayEl.style.color = todayChgPct != null ? colorPnl(todayChgPct) : 'var(--text2)';
      todayEl.textContent = todayChgPct != null ? pct(todayChgPct) : '—';
    }
    if (daypnlEl) {
      daypnlEl.style.color = todayChgAbs != null ? colorPnl(todayChgAbs) : 'var(--text2)';
      daypnlEl.textContent = todayChgAbs != null ? (todayChgAbs >= 0 ? '+' : '') + fmt(Math.abs(todayChgAbs)) : '—';
    }
  });
}

// Holdings view state
let holdingsView = 'table'; // 'table' or 'card'
let holdingsSort = { key: 'currentVal', asc: false };

// Sort holdings table
export function sortHoldingsTable(key) {
  if (holdingsSort.key === key) {
    holdingsSort.asc = !holdingsSort.asc;
  } else {
    holdingsSort.key = key;
    holdingsSort.asc = false;
  }
  renderHoldingsTable();
}

// All Portfolios sort state
let allPortfoliosSort = { key: 'user', asc: true }; // default sort by user name ascending

// Sort All Portfolios table
export function sortAllPortfoliosTable(key) {
  if (allPortfoliosSort.key === key) {
    allPortfoliosSort.asc = !allPortfoliosSort.asc;
  } else {
    allPortfoliosSort.key = key;
    allPortfoliosSort.asc = true;
  }
  renderAllPortfoliosTable();
}

// Set holdings view (table or card)
// On mobile (≤768px) we always force card view regardless of the requested view.
export function setHoldingsView(view) {
  const isMobile = window.innerWidth <= 768;
  if (isMobile) view = 'card';

  holdingsView = view;
  const tableView = document.getElementById('holdings-table-view');
  const cardView = document.getElementById('holdings-card-view');
  const tableViewBtn = document.getElementById('holdings-table-view-btn');
  const cardViewBtn = document.getElementById('holdings-card-view-btn');

  try {
    sessionStorage.setItem('holdings_view', view);
  } catch(e) {}

  if (view === 'table') {
    if (tableView) tableView.style.display = 'block';
    if (cardView) cardView.style.display = 'none';
    if (tableViewBtn) {
      tableViewBtn.style.background = 'var(--accent)';
      tableViewBtn.style.color = 'white';
    }
    if (cardViewBtn) {
      cardViewBtn.style.background = 'transparent';
      cardViewBtn.style.color = 'var(--text2)';
    }
    renderHoldingsTable();
  } else {
    if (tableView) tableView.style.display = 'none';
    if (cardView) cardView.style.display = 'block';
    if (cardViewBtn) {
      cardViewBtn.style.background = 'var(--accent)';
      cardViewBtn.style.color = 'white';
    }
    if (tableViewBtn) {
      tableViewBtn.style.background = 'transparent';
      tableViewBtn.style.color = 'var(--text2)';
    }
    const holdings = Object.values(state.holdings);
    const totalCurrent = getTotalCurrent();
    renderHoldingCards(holdings, totalCurrent);
  }
}

// Restore holdings view from sessionStorage
// Always returns 'card' on mobile screens regardless of saved preference.
function restoreHoldingsView() {
  if (window.innerWidth <= 768) return 'card';
  try {
    const savedView = sessionStorage.getItem('holdings_view');
    if (savedView && (savedView === 'table' || savedView === 'card')) {
      holdingsView = savedView;
      return holdingsView;
    }
  } catch(e) {}
  return 'table';
}

// Helper to calculate total current value
function getTotalCurrent() {
  let total = 0;
  Object.values(state.holdings).forEach(h => {
    const lp = state.livePrices[h.ticker];
    if (lp) total += lp * h.totalQty;
  });
  return total;
}

// Compute row data for table
function computeTableRow(h, totalCurrent, i) {
  const lp = state.livePrices[h.ticker];
  const pc = state.prevClosePrices[h.ticker];
  const currentVal = lp ? lp * h.totalQty : null;
  const pnlAbs = currentVal != null ? currentVal - h.invested : null;
  const pnlPct = pnlAbs != null ? (pnlAbs / h.invested) * 100 : null;
  const allocPct = totalCurrent && currentVal ? (currentVal / totalCurrent) * 100 : null;
  const dayChgAbs = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;
  const dayChgPct = (lp && pc && pc > 0) ? ((lp - pc) / pc) * 100 : null;
  return { h, lp, pc, currentVal, pnlAbs, pnlPct, allocPct, dayChgAbs, dayChgPct, color: COLORS[i % COLORS.length] };
}

// Render holdings table
function renderHoldingsTable() {
  const holdings = Object.values(state.holdings);
  const totalCurrent = getTotalCurrent();
  
  const rows = holdings.map((h, i) => computeTableRow(h, totalCurrent, i));
  
  // Sort
  rows.sort((a, b) => {
    let va, vb;
    switch (holdingsSort.key) {
      case 'ticker':     va = a.h.ticker;    vb = b.h.ticker;    break;
      case 'totalQty':   va = a.h.totalQty;  vb = b.h.totalQty;  break;
      case 'avgBuy':     va = a.h.avgBuy;    vb = b.h.avgBuy;    break;
      case 'livePrice':  va = a.lp ?? -Infinity;  vb = b.lp ?? -Infinity; break;
      case 'prevClose':  va = a.pc ?? -Infinity;  vb = b.pc ?? -Infinity; break;
      case 'invested':   va = a.h.invested;  vb = b.h.invested;  break;
      case 'currentVal': va = a.currentVal ?? -Infinity; vb = b.currentVal ?? -Infinity; break;
      case 'pnlAbs':     va = a.pnlAbs ?? -Infinity;    vb = b.pnlAbs ?? -Infinity;    break;
      case 'pnlPct':     va = a.pnlPct ?? -Infinity;    vb = b.pnlPct ?? -Infinity;    break;
      case 'dayChgAbs':  va = a.dayChgAbs ?? -Infinity; vb = b.dayChgAbs ?? -Infinity; break;
      case 'dayChgPct':  va = a.dayChgPct ?? -Infinity; vb = b.dayChgPct ?? -Infinity; break;
      case 'allocPct':   va = a.allocPct ?? -Infinity;  vb = b.allocPct ?? -Infinity;  break;
      default:           va = a.currentVal ?? -Infinity; vb = b.currentVal ?? -Infinity;
    }
    if (typeof va === 'string') return holdingsSort.asc ? va.localeCompare(vb) : vb.localeCompare(va);
    return holdingsSort.asc ? va - vb : vb - va;
  });
  
  // Update sort indicators on headers
  // Update sort indicators on headers - FIXED VERSION
  const headers = document.querySelectorAll('.holdings-table th');
  headers.forEach(th => {
    // Get the original onclick attribute to determine which column this is
    const onclickAttr = th.getAttribute('onclick');
    let columnKey = null;
    if (onclickAttr) {
      const match = onclickAttr.match(/sortHoldingsTable\('([^']+)'\)/);
      if (match) columnKey = match[1];
    }
    
    // Get the base text (remove any existing arrow)
    let baseText = th.textContent.replace(/[ ↑↓]/g, '');
    
    // Add arrow if this is the sorted column
    if (columnKey === holdingsSort.key) {
      th.textContent = baseText + (holdingsSort.asc ? ' ↑' : ' ↓');
    } else {
      th.textContent = baseText;
    }
  });
  const tbody = document.getElementById('holdings-table-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  rows.forEach(({ h, lp, pc, currentVal, pnlAbs, pnlPct, allocPct, dayChgAbs, dayChgPct, color }) => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.title = 'Click to view stock detail';
    tr.onclick = () => import('./drilldown.js').then((m) => m.openDrilldown(h.ticker));
    tr.innerHTML = `
      <td style="padding:10px 16px; border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></div>
          <strong>${h.ticker}</strong>
        </div>
      </td>
      <td style="padding:10px 16px; text-align:right; border-bottom:1px solid var(--border);">${h.totalQty}</td>
      <td style="padding:10px 16px; text-align:right; border-bottom:1px solid var(--border);">${h.avgBuy.toFixed(2)}</td>
      <td style="padding:10px 16px; text-align:right; border-bottom:1px solid var(--border); font-weight:600;">${lp ? lp.toFixed(2) : '—'}</td>
      <td style="padding:10px 16px; text-align:right; border-bottom:1px solid var(--border); color:var(--text2);">${pc ? pc.toFixed(2) : '—'}</td>
      <td style="padding:10px 16px; text-align:right; border-bottom:1px solid var(--border);">${fmt(h.invested)}</td>
      <td style="padding:10px 16px; text-align:right; border-bottom:1px solid var(--border); font-weight:600;">${currentVal ? fmt(currentVal) : '—'}</td>
      <td style="padding:10px 16px; text-align:right; border-bottom:1px solid var(--border); color:${pnlAbs != null ? colorPnl(pnlAbs) : 'var(--text2)'}; font-weight:600;">
        ${pnlAbs != null ? (pnlAbs >= 0 ? '+' : '') + fmt(Math.abs(pnlAbs)) : '—'}
      </td>
      <td style="padding:10px 16px; text-align:right; border-bottom:1px solid var(--border); color:${pnlPct != null ? colorPnl(pnlPct) : 'var(--text2)'};">
        ${pnlPct != null ? pct(pnlPct) : '—'}
      </td>
      <td style="padding:10px 16px; text-align:right; border-bottom:1px solid var(--border); color:${dayChgAbs != null ? colorPnl(dayChgAbs) : 'var(--text2)'};">
        ${dayChgAbs != null ? (dayChgAbs >= 0 ? '+' : '') + fmt(Math.abs(dayChgAbs)) : '—'}
      </td>
      <td style="padding:10px 16px; text-align:right; border-bottom:1px solid var(--border); color:${dayChgPct != null ? colorPnl(dayChgPct) : 'var(--text2)'};">
        ${dayChgPct != null ? pct(dayChgPct) : '—'}
      </td>
      <td style="padding:10px 16px; text-align:right; border-bottom:1px solid var(--border);">
        ${allocPct != null ? allocPct.toFixed(1) + '%' : '—'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}