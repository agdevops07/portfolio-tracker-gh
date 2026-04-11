// ═══════════════════════════════════════════════
// DRILLDOWN — Per-stock detail view
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { fmt, pct, colorPnl, showScreen } from './utils.js';
import { renderDrilldownChart, renderDrilldownDayChart } from './charts.js';
import { fetchDayHistory, fetchScreenerFundamentals } from './api.js';

const DEFAULT_FROM = '2026-03-31';
const ddFilter = { value: 'CUSTOM', customFrom: DEFAULT_FROM, customTo: new Date().toISOString().split('T')[0] };

// Fundamentals state
let _fundData = null;
let _fundMode = 'consolidated';
let _fundTab  = 'ratios';
let _currentTicker = '';

// ── Render a financial table ──────────────────────
function renderFinTable(tableData, note = 'Figures in ₹ Cr') {
  if (!tableData || !tableData.rows?.length) return '<div style="color:var(--text3);font-size:12px;padding:1rem 0;">No data available</div>';
  const years = tableData.headers.slice(1); // first th is blank row-label column
  const thead = `<tr><th>Item</th>${years.map(y => `<th>${y}</th>`).join('')}</tr>`;
  const tbody = tableData.rows.map(row => {
    const cells = row.values.map(v => {
      const n = parseFloat(v.replace(/,/g, ''));
      const cls = !isNaN(n) ? (n < 0 ? 'negative' : '') : '';
      return `<td class="${cls}">${v || '—'}</td>`;
    }).join('');
    return `<tr><td>${row.label}</td>${cells}</tr>`;
  }).join('');
  return `<div style="overflow-x:auto;"><table class="fund-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>
          <div class="fund-table-note">${note} · Source: <a href="${_fundData?._url||''}" target="_blank" style="color:var(--accent2);text-decoration:none;">Screener.in ↗</a></div>`;
}

// ── Render current tab content ────────────────────
function renderFundTab() {
  const el = document.getElementById('dd-fundamentals');
  if (!el || !_fundData) return;

  if (_fundTab === 'ratios') {
    const row = (label, val, hint='') => val
      ? `<div class="fund-item" title="${hint}"><span class="fund-label">${label}</span><span class="fund-val">${val}</span></div>` : '';
    el.innerHTML = `
      <div class="fund-grid">
        ${row('Market Cap', _fundData.marketCap)}
        ${row('P/E Ratio', _fundData.peRatio, 'Stock P/E')}
        ${row('52W High/Low', _fundData.week52HL)}
        ${row('Book Value', _fundData.bookValue)}
        ${row('ROCE', _fundData.roce, 'Return on Capital Employed')}
        ${row('ROE', _fundData.roe, 'Return on Equity')}
        ${row('Div Yield', _fundData.divYield)}
        ${row('Debt/Equity', _fundData.debtEquity)}
        ${row('EPS', _fundData.eps)}
        ${row('Face Value', _fundData.faceValue)}
        ${_fundData.sector ? `<div class="fund-item fund-wide"><span class="fund-label">Sector</span><span class="fund-val">${_fundData.sector}</span></div>` : ''}
      </div>
      ${_fundData.about ? `<div style="margin-top:0.6rem;font-size:11px;color:var(--text2);line-height:1.5;border-top:1px solid var(--border);padding-top:0.5rem;">${_fundData.about}…</div>` : ''}
      <div class="fund-table-note" style="margin-top:0.5rem;">Source: <a href="${_fundData._url}" target="_blank" style="color:var(--accent2);text-decoration:none;">Screener.in ↗</a> · ${_fundData._mode}</div>`;
  } else if (_fundTab === 'pnl') {
    el.innerHTML = renderFinTable(_fundData.pnl, 'P&L figures in ₹ Cr');
  } else if (_fundTab === 'balance') {
    el.innerHTML = renderFinTable(_fundData.balance, 'Balance Sheet in ₹ Cr');
  } else if (_fundTab === 'cashflow') {
    el.innerHTML = renderFinTable(_fundData.cashflow, 'Cash Flow in ₹ Cr');
  }
}

// ── Exposed: switch tabs ──────────────────────────
window.switchFundTab = function(tab, btn) {
  _fundTab = tab;
  document.querySelectorAll('.fund-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (_fundData) renderFundTab();
};

// ── Exposed: switch consolidated/standalone ───────
window.switchFundMode = function(mode, btn) {
  if (_fundMode === mode) return;
  _fundMode = mode;
  document.querySelectorAll('.fund-mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const el = document.getElementById('dd-fundamentals');
  if (el) el.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:0.5rem 0;">Loading…</div>';
  fetchScreenerFundamentals(_currentTicker, mode).then(fund => {
    _fundData = fund;
    if (fund) { renderFundTab(); }
    else { renderFundFallback(_currentTicker); }
  });
};

function renderFundFallback(ticker) {
  const sym = ticker.replace(/\.(NS|BO|BSE|NSE)$/i, '');
  const el = document.getElementById('dd-fundamentals');
  if (el) el.innerHTML = `
    <div style="color:var(--text3);font-size:12px;padding:0.5rem 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <span>Could not load from Screener.in (may be geo-restricted via proxy).</span>
      <a href="https://www.screener.in/company/${sym}/" target="_blank" style="color:var(--accent2);text-decoration:none;">Open Screener.in ↗</a>
    </div>`;
}

// ── Open drilldown ────────────────────────────────
export async function openDrilldown(ticker) {
  showScreen('drilldown-screen');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  _currentTicker = ticker;
  _fundTab  = 'ratios';
  _fundMode = 'consolidated';
  _fundData = null;

  const today = new Date().toISOString().split('T')[0];
  ddFilter.value = 'CUSTOM'; ddFilter.customFrom = DEFAULT_FROM; ddFilter.customTo = today;

  const h   = state.holdings[ticker];
  const lp  = state.livePrices[ticker];
  const pc  = state.prevClosePrices[ticker];
  const cv  = lp ? lp * h.totalQty : null;
  const pnl = cv != null ? cv - h.invested : null;
  const pnlPct = pnl != null ? (pnl / h.invested) * 100 : null;
  const todayAbs = (lp && pc) ? (lp - pc) * h.totalQty : null;
  const todayPct = (lp && pc) ? ((lp - pc) / pc) * 100 : null;

  let cagr = null;
  if (h.earliestDate && lp) {
    const yrs = (Date.now() - new Date(h.earliestDate)) / (1000*60*60*24*365);
    if (yrs > 0.1) cagr = (Math.pow(lp / h.avgBuy, 1/yrs) - 1) * 100;
  }

  document.getElementById('dd-ticker').textContent = ticker;
  document.getElementById('dd-subtitle').textContent =
    `${h.totalQty} shares · Avg ₹${h.avgBuy.toFixed(2)} · Invested ₹${h.invested.toLocaleString('en-IN',{maximumFractionDigits:0})}`;

  document.getElementById('dd-cards').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Current Price</div>
      <div class="stat-value">${lp ? '₹'+lp.toFixed(2) : '—'}</div>
      ${pc ? `<div class="stat-sub">Prev close ₹${pc.toFixed(2)}</div>` : ''}
    </div>
    <div class="stat-card">
      <div class="stat-label">Today's Change</div>
      <div class="stat-value" style="color:${todayAbs!=null?colorPnl(todayAbs):'var(--text2)'}">
        ${todayAbs!=null?(todayAbs>=0?'+':'')+fmt(Math.abs(todayAbs)):'—'}</div>
      <div class="stat-sub" style="color:${todayPct!=null?colorPnl(todayPct):'var(--text2)'}">
        ${todayPct!=null?pct(todayPct)+' today':'Prev close unavailable'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Overall P&amp;L</div>
      <div class="stat-value" style="color:${pnl!=null?colorPnl(pnl):'inherit'}">
        ${pnl!=null?(pnl>=0?'+':'')+fmt(Math.abs(pnl)):'—'}</div>
      <div class="stat-sub" style="color:${pnlPct!=null?colorPnl(pnlPct):'inherit'}">
        ${pnlPct!=null?pct(pnlPct):''}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Value${cagr!=null?' · CAGR':''}</div>
      <div class="stat-value">${cv?fmt(cv):'—'}</div>
      ${cagr!=null?`<div class="stat-sub" style="color:${colorPnl(cagr)}">CAGR ${pct(cagr)}</div>`:''}
    </div>`;

  // Sync date inputs & filter buttons
  const fi = document.getElementById('dd-from'), ti = document.getElementById('dd-to');
  if (fi) fi.value = DEFAULT_FROM; if (ti) ti.value = today;
  const cw = document.getElementById('dd-custom-wrap');
  if (cw) cw.style.display = 'flex';
  document.querySelectorAll('.dd-tf-btn').forEach(b => b.classList.toggle('active', b.dataset.f === 'CUSTOM'));
  document.querySelectorAll('.fund-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'ratios'));
  document.querySelectorAll('.fund-mode-btn').forEach(b => b.classList.toggle('active', b.id === 'fund-mode-cons'));

  renderDDHistorySection(ticker);

  // Fundamentals — Screener only
  const fundEl = document.getElementById('dd-fundamentals');
  if (fundEl) fundEl.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:0.5rem 0;">Loading from Screener.in…</div>';
  _fundData = await fetchScreenerFundamentals(ticker, 'consolidated');
  if (_fundData) renderFundTab(); else renderFundFallback(ticker);

  // Intraday
  if (!state.dayHistories[ticker]?.length)
    state.dayHistories[ticker] = await fetchDayHistory(h.ticker, h.upstoxTicker);
  renderDrilldownDayChart(ticker);
}

function renderDDHistorySection(ticker) {
  const hist = state.histories?.[ticker];
  if (!hist || !Object.keys(hist).length) return;
  const allDates = Object.keys(hist).sort();
  const today = new Date().toISOString().split('T')[0];
  let from = allDates[0];
  if (ddFilter.value === 'CUSTOM' && ddFilter.customFrom) {
    renderDrilldownChart(ticker, filterHist(hist, ddFilter.customFrom, ddFilter.customTo || today));
    updateDDFilterUI(ticker, hist, ddFilter.customFrom, ddFilter.customTo || today);
    return;
  }
  const last = new Date(allDates[allDates.length-1]);
  if      (ddFilter.value === '1M') { const d=new Date(last); d.setMonth(d.getMonth()-1); from=d.toISOString().split('T')[0]; }
  else if (ddFilter.value === '3M') { const d=new Date(last); d.setMonth(d.getMonth()-3); from=d.toISOString().split('T')[0]; }
  else if (ddFilter.value === '1Y') { const d=new Date(last); d.setFullYear(d.getFullYear()-1); from=d.toISOString().split('T')[0]; }
  renderDrilldownChart(ticker, filterHist(hist, from, today));
  updateDDFilterUI(ticker, hist, from, today);
}

function filterHist(hist, from, to) {
  const out={};
  Object.keys(hist).forEach(d=>{if(d>=from&&d<=to)out[d]=hist[d];});
  return out;
}

function updateDDFilterUI(ticker, hist, from, to) {
  document.querySelectorAll('.dd-tf-btn').forEach(b=>b.classList.toggle('active',b.dataset.f===ddFilter.value));
  const dates = Object.keys(filterHist(hist,from,to)).sort();
  if (dates.length>=2) {
    const chg=((hist[dates[dates.length-1]]-hist[dates[0]])/hist[dates[0]])*100;
    const el=document.getElementById('dd-period-chg');
    if(el){el.textContent=`${chg>=0?'+':''}${chg.toFixed(2)}% in period`;el.style.color=chg>=0?'var(--green)':'var(--red)';}
  }
}

window.setDDFilter = function(f, btn) {
  ddFilter.value = f;
  const ticker = document.getElementById('dd-ticker').textContent;
  const cw = document.getElementById('dd-custom-wrap');
  if (f!=='CUSTOM') { if(cw) cw.style.display='none'; renderDDHistorySection(ticker); }
  else { if(cw) cw.style.display='flex'; }
};

window.applyDDCustom = function() {
  const from=document.getElementById('dd-from').value, to=document.getElementById('dd-to').value;
  if(!from||!to) return;
  ddFilter.customFrom=from; ddFilter.customTo=to;
  renderDDHistorySection(document.getElementById('dd-ticker').textContent);
};
