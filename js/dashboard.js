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
  renderPieChart,
  renderPnlChart,
  renderPortfolioDayChart,
  renderTodayPnlChart,
  destroyAllCharts,
  COLORS,
} from './charts.js';
import { getFilteredHoldings } from './fileHandler.js';

// Save current user to sessionStorage
function saveCurrentUser(user) {
  try {
    sessionStorage.setItem('dashboard_active_user', user);
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
  
  // Save to sessionStorage
  try {
    sessionStorage.setItem('main_view', view);
  } catch(e) {}
  
  if (view === 'holdings') {
    if (holdingsView) holdingsView.style.display = 'block';
    if (chartsView) chartsView.style.display = 'none';
    if (holdingsBtn) {
      holdingsBtn.style.background = 'var(--accent)';
      holdingsBtn.style.color = 'white';
      holdingsBtn.style.border = 'none';
      holdingsBtn.style.boxShadow = '0 2px 8px rgba(91,94,244,0.3)';
    }
    if (chartsBtn) {
      chartsBtn.style.background = 'var(--bg4)';
      chartsBtn.style.color = 'var(--text2)';
      chartsBtn.style.border = '1px solid var(--border2)';
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
    if (chartsBtn) {
      chartsBtn.style.background = 'var(--accent)';
      chartsBtn.style.color = 'white';
      chartsBtn.style.border = 'none';
      chartsBtn.style.boxShadow = '0 2px 8px rgba(91,94,244,0.3)';
    }
    if (holdingsBtn) {
      holdingsBtn.style.background = 'var(--bg4)';
      holdingsBtn.style.color = 'var(--text2)';
      holdingsBtn.style.border = '1px solid var(--border2)';
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
  
  // Rebuild time series
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

  // Get saved tab from sessionStorage, default to 'portfolio' (not 'overview')
  let savedTab = 'portfolio';
  try {
    const stored = sessionStorage.getItem('dashboard_current_tab');
    if (stored && (stored === 'portfolio')) {
      savedTab = stored;
    }
  } catch(e) {}
  
  // Restore saved user
  const savedUser = restoreCurrentUser();
  state.activeUser = savedUser;
  
  // Only switch to saved tab if switchDashTab is available
  if (typeof window.switchDashTab === 'function') {
    window.switchDashTab(savedTab, document.querySelector(`[data-tab="${savedTab}"]`));
  }

  const loadingDiv = document.getElementById('dash-loading');
  const contentDiv = document.getElementById('dash-content');
  const loadMsg   = document.getElementById('loading-msg');

  loadingDiv.style.display = 'flex';
  contentDiv.style.display  = 'none';

  const tickers = Object.keys(state.holdings);
  loadMsg.textContent = `Fetching historic data for ${tickers.length} stocks…`;

  try {
    const historyResults = await Promise.all(
      tickers.map(async (ticker) => {
        const h = state.holdings[ticker];
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
          price = state.holdings[ticker]?.avgBuy ?? null;
        }
        return { ticker, price };
      })
    );
    priceResults.forEach(({ ticker, price }) => { state.livePrices[ticker] = price; });

    loadMsg.textContent = 'Fetching intraday data…';
    const dayResults = await Promise.all(
      tickers.map(async (ticker) => {
        const h = state.holdings[ticker];
        const dayData = await fetchDayHistory(h.ticker, h.upstoxTicker);
        return { ticker, dayData };
      })
    );
    dayResults.forEach(({ ticker, dayData }) => { state.dayHistories[ticker] = dayData; });

    loadMsg.textContent = 'Building charts…';
    state.fullTimeSeries = await buildTimeSeries(histories);
    state.histories      = histories;

    // Apply user filter if needed
    if (state.activeUser && state.activeUser !== 'all') {
      state.holdings = getFilteredHoldings(state.rawRows, state.activeUser);
    }

    loadingDiv.style.display = 'none';
    contentDiv.style.display  = 'block';
    renderDashboard();
    startAutoRefresh();
    updateRefreshUI();

  } catch (err) {
    console.error(err);
    loadingDiv.innerHTML = `<div class="error-box">Failed to load portfolio data: ${err.message}</div>`;
  }
}

export async function refreshPricesOnly() {
  showToast('Refreshing prices…');
  resetCaches();

  const tickers = Object.keys(state.holdings);

  await Promise.all(
    tickers.map(async (ticker) => {
      let price = await fetchPrice(ticker);
      if (!price && state.histories[ticker] && Object.keys(state.histories[ticker]).length > 0) {
        const dates = Object.keys(state.histories[ticker]).sort();
        price = state.histories[ticker][dates[dates.length - 1]];
      }
      if (!price) {
        price = state.holdings[ticker]?.avgBuy ?? null;
      }
      state.livePrices[ticker] = price;
    })
  );

  await Promise.all(
    tickers.map(async (ticker) => {
      const h = state.holdings[ticker];
      state.dayHistories[ticker] = await fetchDayHistory(h.ticker, h.upstoxTicker);
    })
  );

  patchTodayTimeSeries();
  renderDashboardInPlace();
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

export function renderUserTabs() {
  const users = state.users || [];
  const wrap = document.getElementById('dash-user-tabs-portfolio');
  if (!wrap) return;
  
  if (users.length <= 1) { 
    wrap.style.display = 'none'; 
    return; 
  }
  wrap.style.display = 'flex';
  
  // Restore saved user, default to 'all' if none saved
  let active = state.activeUser || restoreCurrentUser();
  if (active !== 'all' && !users.includes(active)) {
    active = 'all';
  }
  state.activeUser = active;
  
  const tabs = ['all', ...users];
  wrap.innerHTML = tabs.map(u => `
    <button class="dash-user-tab${u === active ? ' active' : ''}" data-user="${u}"
      onclick="switchDashUser('${u}')"
      style="padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;border:1px solid var(--border2);
             background:${u === active ? 'var(--accent)' : 'var(--bg3)'};
             color:${u === active ? '#fff' : 'var(--text2)'};cursor:pointer;transition:all 0.2s;">
      ${u === 'all' ? '👥 All' : u}
    </button>`).join('');
}

export async function switchDashUser(user) {
  state.activeUser = user;
  saveCurrentUser(user);
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
  
  // Always update charts data (even if not visible, they'll be ready when switched)
  renderPortfolioChart(state.currentFilter);
  renderPortfolioDayChart();
  renderTodayPnlChart(holdings);
  renderPnlChart(holdings);
    
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

  updateRefreshTimestamp();
  restoreChartSection();
  restoreMainView();
}

function renderStatCards({ totalInvested, totalCurrent, totalPnl, totalPnlPct,
                            todayChange, todayChangePct, best, holdings }) {
  const hasPrevClose = todayChange !== null;
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
    ${best ? `
    <div class="stat-card">
      <div class="stat-label">Best Performer</div>
      <div class="stat-value" style="color:var(--green);font-size:1.3rem">${best.ticker}</div>
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

// Set holdings view (table or card)
export function setHoldingsView(view) {
  holdingsView = view;
  const tableView = document.getElementById('holdings-table-view');
  const cardView = document.getElementById('holdings-card-view');
  const tableViewBtn = document.getElementById('holdings-table-view-btn');
  const cardViewBtn = document.getElementById('holdings-card-view-btn');
  
  // Save to sessionStorage
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
function restoreHoldingsView() {
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