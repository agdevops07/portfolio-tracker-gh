// ═══════════════════════════════════════════════
// DASHBOARD
// Data loading, stat cards, holdings grid,
// auto-refresh, today's change, day charts.
// ═══════════════════════════════════════════════

import { state, resetCaches, resetAllCaches } from './state.js';
import { fmt, pct, colorPnl, showScreen, showToast } from './utils.js';
import { fetchPrice, fetchHistory, fetchDayHistory } from './api.js';
import { forwardFill, buildTimeSeries } from './timeSeries.js';
import {
  renderPortfolioChart,
  renderPieChart,
  renderPnlChart,
  renderPortfolioDayChart,
  renderTodayPnlChart,
  destroyAllCharts,
  COLORS,
} from './charts.js';

// ── Full load (history + prices + intraday) ──────
export async function loadDashboard() {
  showScreen('dashboard-screen');

  const loadingDiv = document.getElementById('dash-loading');
  const contentDiv = document.getElementById('dash-content');
  const loadMsg   = document.getElementById('loading-msg');

  loadingDiv.style.display = 'flex';
  contentDiv.style.display  = 'none';

  const tickers = Object.keys(state.holdings);
  loadMsg.textContent = `Fetching historic data for ${tickers.length} stocks…`;

  try {
    // 1. Historical daily data (parallel)
    const historyResults = await Promise.all(
      tickers.map(async (ticker) => {
        const h = state.holdings[ticker];
        const hist = await fetchHistory(h.ticker, h.upstoxTicker, '2y');
        // hist may be empty {} for SME stocks — forwardFill handles that gracefully
        const filled = (hist && Object.keys(hist).length > 0) ? forwardFill(hist) : {};
        return { ticker, data: filled };
      })
    );
    const histories = {};
    // Always store, even if empty — buildTimeSeries uses avgBuy fallback for empty ones
    historyResults.forEach(({ ticker, data }) => { histories[ticker] = data; });

    // 2. Live prices + prevClose (parallel) — must run BEFORE intraday so prevClose is set
    loadMsg.textContent = 'Fetching live prices…';
    const priceResults = await Promise.all(
      tickers.map(async (ticker) => {
        let price = await fetchPrice(ticker);
        if (!price && histories[ticker] && Object.keys(histories[ticker]).length > 0) {
          // Use last known close from history
          const dates = Object.keys(histories[ticker]).sort();
          price = histories[ticker][dates[dates.length - 1]];
        }
        if (!price) {
          // Final fallback for SME stocks with no data at all: use avgBuy
          price = state.holdings[ticker]?.avgBuy ?? null;
        }
        return { ticker, price };
      })
    );
    priceResults.forEach(({ ticker, price }) => { state.livePrices[ticker] = price; });

    // 3. Intraday 5-min data (parallel) — also backfills prevClose if price API missed it
    loadMsg.textContent = 'Fetching intraday data…';
    const dayResults = await Promise.all(
      tickers.map(async (ticker) => {
        const h = state.holdings[ticker];
        const dayData = await fetchDayHistory(h.ticker, h.upstoxTicker);
        return { ticker, dayData };
      })
    );
    dayResults.forEach(({ ticker, dayData }) => { state.dayHistories[ticker] = dayData; });

    // 4. Portfolio time series
    loadMsg.textContent = 'Building charts…';
    state.fullTimeSeries = await buildTimeSeries(histories);
    state.histories      = histories;

    loadingDiv.style.display = 'none';
    contentDiv.style.display  = 'block';
    renderDashboard();
    startAutoRefresh();

  } catch (err) {
    console.error(err);
    loadingDiv.innerHTML = `<div class="error-box">Failed to load portfolio data: ${err.message}</div>`;
  }
}

// ── Refresh prices + intraday only ──────────────
export async function refreshPricesOnly() {
  showToast('Refreshing prices…');
  resetCaches(); // clears priceCache, prevClosePrices, dayHistoryCache

  const tickers = Object.keys(state.holdings);

  // Prices first
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

  // Then intraday (also backfills prevClose)
  await Promise.all(
    tickers.map(async (ticker) => {
      const h = state.holdings[ticker];
      state.dayHistories[ticker] = await fetchDayHistory(h.ticker, h.upstoxTicker);
    })
  );

  renderDashboard();
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

// ── Auto-refresh ─────────────────────────────────
export function startAutoRefresh() {
  stopAutoRefresh();
  if (!state.refreshPaused) {
    state.refreshIntervalId = setInterval(() => {
      if (!state.refreshPaused) refreshPricesOnly();
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

function updateRefreshUI() {
  const pauseBtn   = document.getElementById('refresh-pause-btn');
  const intervalSel = document.getElementById('refresh-interval-sel');
  if (pauseBtn) {
    pauseBtn.textContent = state.refreshPaused ? '▶ Resume' : '⏸ Pause';
    pauseBtn.style.color = state.refreshPaused ? 'var(--gold)' : '';
  }
  if (intervalSel) intervalSel.value = state.refreshIntervalMs;
}

function updateRefreshTimestamp() {
  const el = document.getElementById('last-refresh-time');
  if (el) el.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

// ── Render all dashboard sections ────────────────
export function renderDashboard() {
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
  renderHoldingCards(holdings, totalCurrent);
  updateRefreshTimestamp();
}

// ── Stat cards ───────────────────────────────────
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

// ── Holding cards ────────────────────────────────
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

    // Today's change
    const todayChgPct = (lp && pc && pc > 0) ? ((lp - pc) / pc) * 100 : null;
    const todayChgAbs = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;

    const card = document.createElement('div');
    card.className = 'holding-card';
    card.onclick = () => import('./drilldown.js').then((m) => m.openDrilldown(h.ticker));
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
        <div><div class="hc-meta-label">Current</div><div class="hc-meta-val">${currentVal ? fmt(currentVal) : '—'}</div></div>
        <div><div class="hc-meta-label">Live Price</div><div class="hc-meta-val">${lp ? lp.toFixed(2) : '—'}</div></div>
        <div>
          <div class="hc-meta-label">Today</div>
          <div class="hc-meta-val" style="color:${todayChgPct != null ? colorPnl(todayChgPct) : 'var(--text2)'}">
            ${todayChgPct != null ? pct(todayChgPct) : '—'}
          </div>
        </div>
        <div>
          <div class="hc-meta-label">Day P&amp;L</div>
          <div class="hc-meta-val" style="color:${todayChgAbs != null ? colorPnl(todayChgAbs) : 'var(--text2)'}">
            ${todayChgAbs != null ? (todayChgAbs >= 0 ? '+' : '') + fmt(Math.abs(todayChgAbs)) : '—'}
          </div>
        </div>
      </div>`;
    grid.appendChild(card);
  });
}
