// ═══════════════════════════════════════════════
// DRILLDOWN — Per-stock detail view
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { fmt, pct, colorPnl, showScreen } from './utils.js';
import { renderDrilldownChart, renderDrilldownDayChart } from './charts.js';
import { fetchDayHistory, fetchScreenerFundamentals, fetchYahooFundamentals } from './api.js';

// Default date range: 31 March 2026 → today
const DEFAULT_FROM = '2026-03-31';
const ddFilter = { value: 'CUSTOM', customFrom: DEFAULT_FROM, customTo: new Date().toISOString().split('T')[0] };

// ── Render fundamentals panel ─────────────────────
function renderFundamentals(ticker, fund) {
  const el = document.getElementById('dd-fundamentals');
  if (!el) return;

  if (!fund) {
    const sym = ticker.replace(/\.(NS|BO|BSE|NSE)$/i, '');
    el.innerHTML = `
      <div style="color:var(--text3);font-size:12px;padding:0.5rem 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span>Fundamentals could not be loaded automatically.</span>
        <a href="https://www.screener.in/company/${sym}/" target="_blank"
           style="color:var(--accent2);text-decoration:none;display:inline-flex;align-items:center;gap:4px;">
          View on Screener.in ↗
        </a>
        <a href="https://finance.yahoo.com/quote/${ticker}" target="_blank"
           style="color:var(--accent2);text-decoration:none;display:inline-flex;align-items:center;gap:4px;">
          Yahoo Finance ↗
        </a>
      </div>`;
    return;
  }

  const row = (label, val, hint = '') => val
    ? `<div class="fund-item" title="${hint}"><span class="fund-label">${label}</span><span class="fund-val">${val}</span></div>`
    : '';

  const src = fund._source === 'screener'
    ? `<a href="${fund._url}" target="_blank" style="color:var(--text3);font-size:10px;text-decoration:none;">Screener.in ↗</a>`
    : `<span style="color:var(--text3);font-size:10px;">Yahoo Finance</span>`;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
      <span style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;">Source: ${src}</span>
    </div>
    <div class="fund-grid">
      ${row('Market Cap', fund.marketCap)}
      ${row('P/E Ratio', fund.peRatio, 'Trailing P/E')}
      ${row('52W High / Low', fund.week52HL)}
      ${row('EPS', fund.eps)}
      ${row('Book Value', fund.bookValue)}
      ${row('ROCE', fund.roce, 'Return on Capital Employed')}
      ${row('ROE', fund.roe, 'Return on Equity')}
      ${row('Div Yield', fund.divYield)}
      ${row('Debt/Equity', fund.debtEquity)}
      ${row('Face Value', fund.faceValue)}
      ${fund.sector ? `<div class="fund-item fund-wide"><span class="fund-label">Sector</span><span class="fund-val">${fund.sector}</span></div>` : ''}
    </div>
    ${fund.about ? `<div style="margin-top:0.6rem;font-size:11px;color:var(--text2);line-height:1.5;border-top:1px solid var(--border);padding-top:0.5rem;">${fund.about}…</div>` : ''}`;
}

// ── Open drilldown for a ticker ───────────────────
export async function openDrilldown(ticker) {
  showScreen('drilldown-screen');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const today = new Date().toISOString().split('T')[0];
  ddFilter.value = 'CUSTOM';
  ddFilter.customFrom = DEFAULT_FROM;
  ddFilter.customTo = today;

  const h = state.holdings[ticker];
  document.getElementById('dd-ticker').textContent = ticker;
  document.getElementById('dd-subtitle').textContent =
    `${h.totalQty} shares · Avg buy ₹${h.avgBuy.toFixed(2)} · Invested ₹${h.invested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  const lp  = state.livePrices[ticker];
  const pc  = state.prevClosePrices[ticker];
  const currentVal  = lp ? lp * h.totalQty : null;
  const pnlVal      = currentVal != null ? currentVal - h.invested : null;
  const pnlPct      = pnlVal != null ? (pnlVal / h.invested) * 100 : null;
  const todayChgAbs = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;
  const todayChgPct = (lp && pc && pc > 0) ? ((lp - pc) / pc) * 100 : null;

  // CAGR
  let cagr = null;
  if (h.earliestDate && lp) {
    const days = (Date.now() - new Date(h.earliestDate)) / (1000 * 60 * 60 * 24);
    const years = days / 365;
    if (years > 0.1) cagr = (Math.pow(lp / h.avgBuy, 1 / years) - 1) * 100;
  }

  // Cards — CAGR placed inline with Current Value to avoid empty card
  document.getElementById('dd-cards').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Current Price</div>
      <div class="stat-value">${lp ? '₹' + lp.toFixed(2) : '—'}</div>
      ${pc ? `<div class="stat-sub">Prev close: ₹${pc.toFixed(2)}</div>` : ''}
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
      <div class="stat-label">Overall P&amp;L</div>
      <div class="stat-value" style="color:${pnlVal != null ? colorPnl(pnlVal) : 'inherit'}">
        ${pnlVal != null ? (pnlVal >= 0 ? '+' : '') + fmt(Math.abs(pnlVal)) : '—'}
      </div>
      <div class="stat-sub" style="color:${pnlPct != null ? colorPnl(pnlPct) : 'inherit'}">
        ${pnlPct != null ? pct(pnlPct) : ''}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Current Value${cagr != null ? ' · CAGR' : ''}</div>
      <div class="stat-value">${currentVal ? fmt(currentVal) : '—'}</div>
      ${cagr != null
        ? `<div class="stat-sub" style="color:${colorPnl(cagr)}">CAGR: ${pct(cagr)}</div>`
        : ''}
    </div>`;

  // Sync date inputs
  const fromInput = document.getElementById('dd-from');
  const toInput   = document.getElementById('dd-to');
  if (fromInput) fromInput.value = DEFAULT_FROM;
  if (toInput)   toInput.value   = today;

  // Show custom wrap, update filter buttons
  const customWrap = document.getElementById('dd-custom-wrap');
  if (customWrap) customWrap.style.display = 'flex';
  document.querySelectorAll('.dd-tf-btn').forEach(b => b.classList.toggle('active', b.dataset.f === 'CUSTOM'));

  // Render history chart
  renderDDHistorySection(ticker);

  // Fundamentals — try Screener first, then Yahoo
  const fundEl = document.getElementById('dd-fundamentals');
  if (fundEl) fundEl.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:0.5rem 0;">Loading fundamentals…</div>';
  const fund = await fetchScreenerFundamentals(ticker) || await fetchYahooFundamentals(ticker);
  renderFundamentals(ticker, fund);

  // Intraday
  if (!state.dayHistories[ticker]?.length) {
    state.dayHistories[ticker] = await fetchDayHistory(h.ticker, h.upstoxTicker);
  }
  renderDrilldownDayChart(ticker);
}

// ── History section renderer ──────────────────────
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
  if      (ddFilter.value === '1M')  { const d = new Date(last); d.setMonth(d.getMonth()-1);          from = d.toISOString().split('T')[0]; }
  else if (ddFilter.value === '3M')  { const d = new Date(last); d.setMonth(d.getMonth()-3);          from = d.toISOString().split('T')[0]; }
  else if (ddFilter.value === '1Y')  { const d = new Date(last); d.setFullYear(d.getFullYear()-1);    from = d.toISOString().split('T')[0]; }
  // ALL: from = allDates[0] (already set)

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
    const chg = ((hist[dates[dates.length - 1]] - hist[dates[0]]) / hist[dates[0]]) * 100;
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
  ddFilter.customFrom = from;
  ddFilter.customTo   = to;
  const ticker = document.getElementById('dd-ticker').textContent;
  renderDDHistorySection(ticker);
};
