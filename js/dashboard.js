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

  // Get saved tab from sessionStorage, default to 'overview'
  let savedTab = 'overview';
  try {
    const stored = sessionStorage.getItem('dashboard_current_tab');
    if (stored && (stored === 'overview' || stored === 'holdings')) {
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
  ['dash-user-tabs-overview', 'dash-user-tabs-holdings'].forEach(id => {
    let wrap = document.getElementById(id);
    if (!wrap) return;
    if (users.length <= 1) { wrap.style.display = 'none'; return; }
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
  });
}

export function switchDashUser(user) {
  state.activeUser = user;
  saveCurrentUser(user);  // Add this line
  state.holdings = getFilteredHoldings(state.rawRows, user);
  document.querySelectorAll('.dash-user-tab').forEach(t => {
    const isActive = t.dataset.user === user;
    t.classList.toggle('active', isActive);
    t.style.background = isActive ? 'var(--accent)' : 'var(--bg3)';
    t.style.color = isActive ? '#fff' : 'var(--text2)';
  });
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
  renderPortfolioChart(state.currentFilter);
  renderPortfolioDayChart();
  renderTodayPnlChart(holdings);
  renderPieChart(holdings, totalCurrent);
  renderPnlChart(holdings);
  if (holdingsView === 'table') {
    renderHoldingsTable();
  } else {
    renderHoldingCards(holdings, totalCurrent);
  }

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
  renderPortfolioChart(state.currentFilter);
  renderPortfolioDayChart();
  renderTodayPnlChart(holdings);
  renderPieChart(holdings, totalCurrent);
  renderPnlChart(holdings);
  
  // Update based on current view
  if (holdingsView === 'table') {
    renderHoldingsTable();
  } else {
    // Update card view in place if cards exist
    const grid = document.getElementById('holdings-grid');
    if (grid && grid.children.length === holdings.length) {
      updateHoldingCardsInPlace(holdings, totalCurrent);
    } else {
      renderHoldingCards(holdings, totalCurrent);
    }
  }

  const modal = document.getElementById('holdings-modal');
  if (modal && modal.style.display !== 'none') {
    modal.dispatchEvent(new CustomEvent('refreshTable'));
  }

  updateRefreshTimestamp();
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
  const tableContainer = document.getElementById('holdings-table-container');
  const cardContainer = document.getElementById('holdings-card-container');
  const tableViewBtn = document.getElementById('holdings-table-view-btn');
  const cardViewBtn = document.getElementById('holdings-card-view-btn');
  
  if (view === 'table') {
    tableContainer.style.display = 'block';
    cardContainer.style.display = 'none';
    tableViewBtn.style.background = 'var(--accent)';
    tableViewBtn.style.color = 'white';
    cardViewBtn.style.background = 'transparent';
    cardViewBtn.style.color = 'var(--text2)';
    renderHoldingsTable();
  } else {
    tableContainer.style.display = 'none';
    cardContainer.style.display = 'block';
    cardViewBtn.style.background = 'var(--accent)';
    cardViewBtn.style.color = 'white';
    tableViewBtn.style.background = 'transparent';
    tableViewBtn.style.color = 'var(--text2)';
    renderHoldingCards(Object.values(state.holdings), getTotalCurrent());
  }
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