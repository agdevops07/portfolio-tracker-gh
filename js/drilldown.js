// ═══════════════════════════════════════════════
// DRILLDOWN — Per-stock detail view
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { fmt, pct, colorPnl, showScreen } from './utils.js';
import { renderDrilldownChart, renderDrilldownDayChart } from './charts.js';
import { fetchDayHistory } from './api.js';

// Default date range: 31 March 2026 → today
const DEFAULT_FROM = '2026-03-31';

// Track current filter per ticker
const ddFilter = { value: 'CUSTOM', customFrom: DEFAULT_FROM, customTo: new Date().toISOString().split('T')[0] };

// ── Fetch stock fundamentals from Yahoo Finance ──
async function fetchFundamentals(ticker) {
  const PROXY = 'https://corsproxy.io/?url=';
  const urls = [
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=summaryDetail,defaultKeyStatistics,assetProfile,price`,
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=summaryDetail,defaultKeyStatistics,assetProfile,price`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(PROXY + encodeURIComponent(url));
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.quoteSummary?.result?.[0];
      if (!result) continue;

      const sd  = result.summaryDetail || {};
      const ks  = result.defaultKeyStatistics || {};
      const ap  = result.assetProfile || {};
      const pr  = result.price || {};

      return {
        marketCap:       pr.marketCap?.fmt || sd.marketCap?.fmt || null,
        peRatio:         sd.trailingPE?.fmt || pr.trailingPE?.fmt || null,
        week52High:      sd.fiftyTwoWeekHigh?.fmt || null,
        week52Low:       sd.fiftyTwoWeekLow?.fmt || null,
        sector:          ap.sector || null,
        industry:        ap.industry || null,
        dividendYield:   sd.dividendYield?.fmt || null,
        beta:            sd.beta?.fmt || null,
        eps:             ks.trailingEps?.fmt || null,
        bookValue:       ks.bookValue?.fmt || null,
        priceToBook:     ks.priceToBook?.fmt || null,
        avgVolume:       sd.averageVolume?.fmt || null,
      };
    } catch (e) { /* try next */ }
  }
  return null;
}

function renderFundamentals(ticker, fund) {
  const el = document.getElementById('dd-fundamentals');
  if (!el) return;

  if (!fund) {
    el.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:0.5rem 0;">Fundamentals unavailable</div>';
    return;
  }

  const row = (label, val, hint = '') => val
    ? `<div class="fund-item"><span class="fund-label">${label}</span><span class="fund-val" title="${hint}">${val}</span></div>`
    : '';

  el.innerHTML = `
    <div class="fund-grid">
      ${row('Market Cap', fund.marketCap)}
      ${row('P/E Ratio', fund.peRatio, 'Trailing P/E')}
      ${row('52W High', fund.week52High)}
      ${row('52W Low', fund.week52Low)}
      ${row('EPS', fund.eps, 'Trailing EPS')}
      ${row('P/B Ratio', fund.priceToBook, 'Price to Book')}
      ${row('Book Value', fund.bookValue)}
      ${row('Beta', fund.beta)}
      ${row('Div Yield', fund.dividendYield)}
      ${row('Avg Volume', fund.avgVolume)}
      ${fund.sector ? `<div class="fund-item fund-wide"><span class="fund-label">Sector</span><span class="fund-val">${fund.sector}</span></div>` : ''}
      ${fund.industry ? `<div class="fund-item fund-wide"><span class="fund-label">Industry</span><span class="fund-val fund-industry">${fund.industry}</span></div>` : ''}
    </div>`;
}

export async function openDrilldown(ticker) {
  showScreen('drilldown-screen');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Reset filter to default range (31 Mar 2026 → today)
  const today = new Date().toISOString().split('T')[0];
  ddFilter.value = 'CUSTOM';
  ddFilter.customFrom = DEFAULT_FROM;
  ddFilter.customTo = today;

  const h = state.holdings[ticker];
  document.getElementById('dd-ticker').textContent = ticker;
  document.getElementById('dd-subtitle').textContent =
    `${h.totalQty} shares · Avg buy: ${h.avgBuy.toFixed(2)} · Invested: ₹${h.invested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  const lp  = state.livePrices[ticker];
  const pc  = state.prevClosePrices[ticker];
  const currentVal  = lp ? lp * h.totalQty : null;
  const pnlVal      = currentVal != null ? currentVal - h.invested : null;
  const pnlPct      = pnlVal != null ? (pnlVal / h.invested) * 100 : null;
  const todayChgAbs = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;
  const todayChgPct = (lp && pc && pc > 0) ? ((lp - pc) / pc) * 100 : null;

  let cagr = null;
  if (h.earliestDate && lp) {
    const days = (Date.now() - new Date(h.earliestDate)) / (1000 * 60 * 60 * 24);
    const years = days / 365;
    if (years > 0.1) cagr = (Math.pow(lp / h.avgBuy, 1 / years) - 1) * 100;
  }

  document.getElementById('dd-cards').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Current Price</div>
      <div class="stat-value">${lp ? lp.toFixed(2) : '—'}</div>
      ${pc ? `<div class="stat-sub">Prev close: ${pc.toFixed(2)}</div>` : ''}
    </div>
    <div class="stat-card">
      <div class="stat-label">Today's Change</div>
      <div class="stat-value" style="color:${todayChgAbs != null ? colorPnl(todayChgAbs) : 'var(--text2)'}">
        ${todayChgAbs != null ? (todayChgAbs >= 0 ? '+' : '') + fmt(Math.abs(todayChgAbs)) : '—'}
      </div>
      <div class="stat-sub" style="color:${todayChgPct != null ? colorPnl(todayChgPct) : 'var(--text2)'}">
        ${todayChgPct != null ? pct(todayChgPct) + ' today' : 'Prev close unavailable'}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-label">P&amp;L (Overall)</div>
      <div class="stat-value" style="color:${pnlVal != null ? colorPnl(pnlVal) : 'inherit'}">
        ${pnlVal != null ? (pnlVal >= 0 ? '+' : '') + fmt(Math.abs(pnlVal)) : '—'}
      </div>
      <div class="stat-sub" style="color:${pnlPct != null ? colorPnl(pnlPct) : 'inherit'}">
        ${pnlPct != null ? pct(pnlPct) : ''}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Current Value</div>
      <div class="stat-value">${currentVal ? fmt(currentVal) : '—'}</div>
    </div>
    ${cagr != null ? `<div class="stat-card">
      <div class="stat-label">CAGR</div>
      <div class="stat-value" style="color:${colorPnl(cagr)}">${pct(cagr)}</div>
    </div>` : ''}`;

  // Sync custom date inputs to default range
  const fromInput = document.getElementById('dd-from');
  const toInput   = document.getElementById('dd-to');
  if (fromInput) fromInput.value = DEFAULT_FROM;
  if (toInput)   toInput.value   = today;

  // Show custom wrap by default, update filter buttons
  const customWrap = document.getElementById('dd-custom-wrap');
  if (customWrap) customWrap.style.display = 'flex';
  document.querySelectorAll('.dd-tf-btn').forEach(b => b.classList.toggle('active', b.dataset.f === 'CUSTOM'));

  // Render history chart with default date range
  renderDDHistorySection(ticker);

  // Load fundamentals asynchronously
  const fundEl = document.getElementById('dd-fundamentals');
  if (fundEl) fundEl.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:0.5rem 0;">Loading fundamentals…</div>';
  fetchFundamentals(h.ticker).then(fund => renderFundamentals(ticker, fund));

  // Intraday
  if (!state.dayHistories[ticker]?.length) {
    state.dayHistories[ticker] = await fetchDayHistory(h.ticker);
  }
  renderDrilldownDayChart(ticker);
}

function renderDDHistorySection(ticker) {
  const hist = state.histories?.[ticker];
  if (!hist || !Object.keys(hist).length) return;

  const allDates = Object.keys(hist).sort();
  const today = new Date().toISOString().split('T')[0];

  let from = allDates[0];
  if (ddFilter.value === 'CUSTOM' && ddFilter.customFrom) {
    from = ddFilter.customFrom;
    const to = ddFilter.customTo || today;
    renderDrilldownChart(ticker, filterHist(hist, from, to));
    updateDDFilterUI(ticker, hist, from, to);
    return;
  }

  const last = new Date(allDates[allDates.length - 1]);
  if (ddFilter.value === '1M') { const d = new Date(last); d.setMonth(d.getMonth()-1); from = d.toISOString().split('T')[0]; }
  else if (ddFilter.value === '3M') { const d = new Date(last); d.setMonth(d.getMonth()-3); from = d.toISOString().split('T')[0]; }
  else if (ddFilter.value === '1Y') { const d = new Date(last); d.setFullYear(d.getFullYear()-1); from = d.toISOString().split('T')[0]; }
  else from = allDates[0]; // ALL

  const filtered = filterHist(hist, from, today);
  renderDrilldownChart(ticker, filtered);
  updateDDFilterUI(ticker, hist, from, today);
}

function filterHist(hist, from, to) {
  const out = {};
  Object.keys(hist).forEach(d => { if (d >= from && d <= to) out[d] = hist[d]; });
  return out;
}

function updateDDFilterUI(ticker, hist, from, to) {
  document.querySelectorAll('.dd-tf-btn').forEach(b => b.classList.toggle('active', b.dataset.f === ddFilter.value));

  const dates = Object.keys(filterHist(hist, from, to)).sort();
  if (dates.length >= 2) {
    const startPrice = hist[dates[0]];
    const endPrice   = hist[dates[dates.length - 1]];
    const chg = ((endPrice - startPrice) / startPrice) * 100;
    const el = document.getElementById('dd-period-chg');
    if (el) {
      el.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% in period`;
      el.style.color = chg >= 0 ? 'var(--green)' : 'var(--red)';
    }
  }
}

window.setDDFilter = function(f, btn) {
  ddFilter.value = f;
  const ticker = document.getElementById('dd-ticker').textContent;
  const customWrap = document.getElementById('dd-custom-wrap');
  if (f !== 'CUSTOM') {
    if (customWrap) customWrap.style.display = 'none';
    renderDDHistorySection(ticker);
  } else {
    if (customWrap) customWrap.style.display = 'flex';
  }
};

window.applyDDCustom = function() {
  const from = document.getElementById('dd-from').value;
  const to   = document.getElementById('dd-to').value;
  if (!from || !to) return;
  ddFilter.customFrom = from; ddFilter.customTo = to;
  const ticker = document.getElementById('dd-ticker').textContent;
  renderDDHistorySection(ticker);
};
