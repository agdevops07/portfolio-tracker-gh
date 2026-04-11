// ═══════════════════════════════════════════════
// STOCK SEARCH TAB — mirrors drilldown exactly
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { fetchPrice, fetchHistory, fetchDayHistory, fetchScreenerFundamentals } from './api.js';
import { pct, colorPnl } from './utils.js';

let _ssDB = null, _ssLoaded = false, _ssTimeout = null;
let _ssTicker = '', _ssFundData = null, _ssFundTab = 'ratios', _ssFundMode = 'standalone';
let _ssHistFull = {}, _ssChartInst = null, _ssDayInst = null;
const SS_DEFAULT_FROM = '2026-03-31';
let _ssFilter = { value: 'CUSTOM', customFrom: SS_DEFAULT_FROM, customTo: new Date().toISOString().split('T')[0] };
let _ssLastMeta = null; // store last picked meta

// ── Public init ──────────────────────────────────
export function initStockSearch() {
  if (_ssLoaded) return;
  _ssLoaded = true;
  loadSSDB();
  const inp = document.getElementById('ss-search-input');
  if (inp) {
    inp.addEventListener('input', onSSInput);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); window._ssSubmit(); } });
  }
  document.addEventListener('click', e => {
    if (!e.target.closest('#ss-search-wrap')) closeSSDropdown();
  });
}

async function loadSSDB() {
  if (_ssDB) return;
  const st = document.getElementById('ss-db-status');
  try {
    if (st) { st.textContent = 'Loading stock database…'; st.style.display = 'block'; }
    const base = document.location.pathname.replace(/\/[^/]*$/, '') || '';
    const res  = await fetch(base + '/data/stocks_db.json');
    if (!res.ok) throw new Error('Failed');
    _ssDB = await res.json();
    if (st) {
      st.textContent = `✓ ${_ssDB.length.toLocaleString()} stocks (NSE + BSE)`;
      st.style.color = 'var(--green)';
      setTimeout(() => { st.style.display = 'none'; }, 2500);
    }
  } catch {
    if (st) { st.textContent = '⚠ Could not load stock DB. Type a ticker manually.'; st.style.color = 'var(--red)'; }
  }
}

function onSSInput(e) {
  clearTimeout(_ssTimeout);
  const q = e.target.value.trim().toUpperCase();
  // Show/hide clear button
  const clr = document.getElementById('ss-clear-btn');
  if (clr) clr.style.display = e.target.value ? 'block' : 'none';
  // If user clears or modifies input, reset loaded ticker so submit works fresh
  if (!q || !q.includes('—')) { _ssTicker = ''; _ssLastMeta = null; }
  const dd = document.getElementById('ss-dropdown');
  if (!q) { if (dd) dd.style.display = 'none'; return; }
  _ssTimeout = setTimeout(() => {
    if (!_ssDB) { dd.innerHTML = '<div class="sp-dd-hint">Loading database…</div>'; dd.style.display = 'block'; return; }
    const results = _ssDB.filter(s => s.symbol.startsWith(q) || s.company.toUpperCase().includes(q)).slice(0, 14);
    if (!results.length) { dd.innerHTML = '<div class="sp-dd-hint">No results found.</div>'; dd.style.display = 'block'; return; }
    window._ssResultCache = results;
    dd.innerHTML = results.map((s, i) =>
      `<div class="sp-dd-item" onmousedown="window._ssPickResult(${i})">
         <span class="sp-badge sp-badge-${s.exchange.toLowerCase().replace('-','')}">${s.exchange}</span>
         <span class="sp-dd-sym">${s.symbol}</span>
         <span class="sp-dd-name">${s.company}</span>
       </div>`).join('');
    dd.style.display = 'block';
  }, 150);
}

function closeSSDropdown() {
  const dd = document.getElementById('ss-dropdown');
  if (dd) dd.style.display = 'none';
}

window._ssPickResult = function(idx) {
  const stock = window._ssResultCache?.[idx];
  if (!stock) return;
  closeSSDropdown();
  const ticker = stock.exchange === 'BSE'
    ? (stock.bseTicker || stock.yahooTicker?.replace('.NS', '.BO') || stock.symbol + '.BO')
    : (stock.yahooTicker || stock.symbol + '.NS');
  const inp = document.getElementById('ss-search-input');
  if (inp) { inp.value = `${stock.symbol}  —  ${stock.company}`; inp.blur(); }
  _ssLastMeta = stock;
  const clr = document.getElementById('ss-clear-btn');
  if (clr) clr.style.display = 'block';
  loadSSStock(ticker, stock);
};

window._ssSubmit = function() {
  const raw = document.getElementById('ss-search-input')?.value?.trim().toUpperCase();
  if (!raw) return;
  closeSSDropdown();
  // If input contains "—", it's a dropdown pick already loaded — do nothing
  if (raw.includes('—')) return;
  _ssLastMeta = null;
  loadSSStock(raw, null);
};

// ── Main loader ──────────────────────────────────
async function loadSSStock(ticker, meta) {
  _ssTicker = ticker;
  _ssFundData = null; _ssFundTab = 'ratios'; _ssFundMode = 'standalone';
  const today = new Date().toISOString().split('T')[0];
  _ssFilter = { value: 'CUSTOM', customFrom: SS_DEFAULT_FROM, customTo: today };

  // Destroy old charts before touching DOM
  if (_ssChartInst) { _ssChartInst.destroy(); _ssChartInst = null; }
  if (_ssDayInst)   { _ssDayInst.destroy();   _ssDayInst   = null; }

  // Collapse hero to just the search bar when a stock is loaded
  const hero = document.getElementById('ss-hero');
  if (hero) {
    hero.querySelectorAll(':scope > div:not(#ss-search-wrap)').forEach(el => el.style.display = 'none');
    hero.style.padding = '0.75rem 0 1rem';
    hero.style.textAlign = 'left';
    hero.style.maxWidth = '';
  }
  renderSSSkeleton(ticker, meta, today);

  const [livePrice, hist, fund, dayHist] = await Promise.all([
    fetchPrice(ticker),
    fetchHistory(ticker, meta?.isin),
    fetchScreenerFundamentals(ticker, 'standalone'),
    fetchDayHistory(ticker, meta?.isin),
  ]);

  if (livePrice) state.livePrices[ticker] = livePrice;
  _ssHistFull = hist || {};
  _ssFundData = fund;
  state.dayHistories[ticker] = dayHist || [];

  fillSSHeader(ticker, meta, fund);
  fillSSCards(ticker, fund);
  renderSSChart();
  renderSSDayChart(ticker);
  renderSSFundTab();
  syncSSFilterUI();
}

// ── Skeleton ─────────────────────────────────────
function renderSSSkeleton(ticker, meta, today) {
  const panel = document.getElementById('ss-result-panel');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="dd-header-row">
      <div>
        <div class="dd-title" id="ss-ticker-el">${ticker}</div>
        <div class="dd-subtitle" id="ss-subtitle-el">${meta?.company || '…'}</div>
        <div class="dd-meta" id="ss-meta-el"></div>
        <div class="dd-about" id="ss-about-el" style="display:none"></div>
      </div>
    </div>

    <div class="cards-grid" id="ss-cards" style="margin-bottom:1rem">
      ${['Current Price',"Day's Change",'Market Cap','P/E Ratio'].map(l =>
        `<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value" style="color:var(--text3)">…</div></div>`
      ).join('')}
    </div>

    <div class="dd-charts-row">
      <div class="chart-card collapsible-card dd-chart-half" id="ss-history-card">
        <div class="chart-header" onclick="toggleSection('ss-history-body','ss-history-toggle')">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div class="chart-title">Price History</div>
            <span id="ss-period-chg" style="font-size:12px;font-weight:600;"></span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;" onclick="event.stopPropagation()">
            <div class="time-filters">
              ${['1M','3M','1Y','ALL','CUSTOM'].map(f =>
                `<button class="tf-btn ss-tf-btn${f==='CUSTOM'?' active':''}" data-f="${f}"
                   onclick="window._ssSetFilter('${f}',this)">${f}</button>`
              ).join('')}
            </div>
            <button class="icon-btn" title="Maximize" onclick="maximizeChart('ss-history-card','ss-history-body','ssChart')">⤢</button>
            <button class="collapse-btn" id="ss-history-toggle"
              onclick="toggleSection('ss-history-body','ss-history-toggle')">▲</button>
          </div>
        </div>
        <div id="ss-history-body" class="collapsible-body">
          <div id="ss-custom-wrap" style="display:flex;align-items:center;gap:8px;padding:0.4rem 0 0.6rem;flex-wrap:wrap;">
            <input type="date" id="ss-from" name="ss-from" value="${SS_DEFAULT_FROM}"
              style="background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:6px;padding:4px 8px;font-size:12px;">
            <span style="color:var(--text3)">to</span>
            <input type="date" id="ss-to" name="ss-to" value="${today}"
              style="background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:6px;padding:4px 8px;font-size:12px;">
            <button class="tf-btn active" onclick="window._ssApplyCustom()">Apply</button>
          </div>
          <div class="chart-wrap" style="height:260px;"><canvas id="ssChart"></canvas></div>
        </div>
      </div>

      <div class="chart-card collapsible-card dd-chart-half" id="ss-day-card">
        <div class="chart-header" onclick="toggleSection('ss-day-body','ss-day-toggle')">
          <div class="chart-title">Price Intraday <span class="chart-subtitle">(15-min delay)</span></div>
          <div style="display:flex;align-items:center;gap:6px;" onclick="event.stopPropagation()">
            <button class="icon-btn" title="Maximize" onclick="maximizeChart('ss-day-card','ss-day-body','ssDayChart')">⤢</button>
            <button class="collapse-btn" id="ss-day-toggle"
              onclick="toggleSection('ss-day-body','ss-day-toggle')">▲</button>
          </div>
        </div>
        <div id="ss-day-body" class="collapsible-body">
          <div id="ss-day-wrap" style="position:relative;width:100%;height:260px;">
            <div class="ss-loading"><div class="ss-spinner"></div><span>Loading intraday…</span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="chart-card collapsible-card" style="margin-bottom:1rem">
      <div class="chart-header" onclick="toggleSection('ss-fund-body','ss-fund-toggle')">
        <div class="chart-title">Fundamentals <span class="chart-subtitle">(Screener.in)</span></div>
        <div style="display:flex;align-items:center;gap:8px;" onclick="event.stopPropagation()">
          <div class="fund-mode-toggle">
            <button class="fund-mode-btn" id="ss-fund-mode-cons"
              onclick="window._ssSwitchMode('consolidated',this)">Consolidated</button>
            <button class="fund-mode-btn active" id="ss-fund-mode-stand"
              onclick="window._ssSwitchMode('standalone',this)">Standalone</button>
          </div>
          <button class="collapse-btn" id="ss-fund-toggle"
            onclick="toggleSection('ss-fund-body','ss-fund-toggle')">▲</button>
        </div>
      </div>
      <div id="ss-fund-body" class="collapsible-body">
        <div class="fund-tabs" onclick="event.stopPropagation()">
          <button class="fund-tab active" data-tab="ratios"   onclick="window._ssSwitchFundTab('ratios',this)">Key Ratios</button>
          <button class="fund-tab"        data-tab="pnl"      onclick="window._ssSwitchFundTab('pnl',this)">P&amp;L</button>
          <button class="fund-tab"        data-tab="balance"  onclick="window._ssSwitchFundTab('balance',this)">Balance Sheet</button>
          <button class="fund-tab"        data-tab="cashflow" onclick="window._ssSwitchFundTab('cashflow',this)">Cash Flow</button>
          <button class="fund-tab"        data-tab="quarterly" onclick="window._ssSwitchFundTab('quarterly',this)">Quarterly Results</button>
        </div>
        <div id="ss-fundamentals" style="padding:0.5rem 0 0.25rem;">
          <div class="ss-loading"><div class="ss-spinner"></div><span>Loading fundamentals…</span></div>
        </div>
      </div>
    </div>`;
}

// ── Fill header after data ───────────────────────
function fillSSHeader(ticker, meta, fund) {
  const el = id => document.getElementById(id);
  if (el('ss-ticker-el'))   el('ss-ticker-el').textContent   = ticker;
  if (el('ss-subtitle-el')) el('ss-subtitle-el').textContent = meta?.company || fund?.companyName || ticker;
  const sector = fund ? (fund.sectorBreadcrumb || (fund.sector ? fund.sector + (fund.industry ? ' › ' + fund.industry : '') : '')) : '';
  if (el('ss-meta-el'))  el('ss-meta-el').innerHTML  = sector ? `<span>${sector}</span>` : '';
  if (el('ss-about-el') && fund?.about) {
    el('ss-about-el').textContent = fund.about;
    el('ss-about-el').style.display = '';
  }
}

// ── Fill stat cards ──────────────────────────────
function fillSSCards(ticker, fund) {
  const lp  = state.livePrices[ticker];
  const pc  = state.prevClosePrices[ticker];
  const dAbs = (lp && pc) ? lp - pc : null;
  const dPct = (lp && pc) ? ((lp - pc) / pc) * 100 : null;
  const cards = document.getElementById('ss-cards');
  if (!cards) return;
  cards.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Current Price</div>
      <div class="stat-value">${lp ? '₹' + lp.toFixed(2) : '—'}</div>
      ${pc ? `<div class="stat-sub">Prev close ₹${pc.toFixed(2)}</div>` : ''}
    </div>
    <div class="stat-card">
      <div class="stat-label">Day's Change</div>
      <div class="stat-value" style="color:${dAbs != null ? colorPnl(dAbs) : 'var(--text2)'}">
        ${dAbs != null ? (dAbs >= 0 ? '+' : '') + '₹' + Math.abs(dAbs).toFixed(2) : '—'}</div>
      <div class="stat-sub" style="color:${dPct != null ? colorPnl(dPct) : 'var(--text2)'}">
        ${dPct != null ? pct(dPct) : 'Prev close unavailable'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Market Cap</div>
      <div class="stat-value" style="${fund?.marketCap ? '' : 'color:var(--text3)'}">
        ${fund?.marketCap || '—'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">P/E Ratio</div>
      <div class="stat-value" style="${fund?.peRatio ? '' : 'color:var(--text3)'}">
        ${fund?.peRatio || '—'}</div>
    </div>`;
}

// ── Price history chart ──────────────────────────
function renderSSChart() {
  const hist   = filterSSHist();
  const dates  = Object.keys(hist).sort();
  const prices = dates.map(d => hist[d]);
  if (_ssChartInst) { _ssChartInst.destroy(); _ssChartInst = null; }
  const canvas = document.getElementById('ssChart');
  if (!canvas || !dates.length) return;

  if (dates.length >= 2) {
    const chg = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
    const el  = document.getElementById('ss-period-chg');
    if (el) el.innerHTML = `<span style="color:${chg>=0?'var(--green)':'var(--red)'}">${chg>=0?'+':''}${chg.toFixed(2)}%</span>`;
  }

  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 260);
  grad.addColorStop(0, 'rgba(99,102,241,0.2)'); grad.addColorStop(1, 'rgba(0,0,0,0)');

  _ssChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates.map(d => { const [y,m,dy] = d.split('-'); return `${dy}/${m}/${y.slice(2)}`; }),
      datasets: [{ data: prices, borderColor: '#6366f1', borderWidth: 2,
        backgroundColor: grad, fill: true, pointRadius: 0, pointHoverRadius: 5, tension: 0.3 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { backgroundColor:'rgba(20,20,35,0.95)', borderColor:'rgba(255,255,255,0.1)',
          borderWidth:1, titleColor:'#a0a0c0', bodyColor:'#e0e0ff', padding:10,
          mode:'index', intersect:false,
          callbacks: { title: items => dates[items[0].dataIndex], label: c => ' ₹'+c.parsed.y.toFixed(2) } } },
      scales: {
        x: { grid:{color:'rgba(255,255,255,0.03)'}, border:{color:'rgba(255,255,255,0.1)'},
          ticks:{color:'#7777a0', font:{size:11}, maxTicksLimit:10, maxRotation:0} },
        y: { grid:{color:'rgba(255,255,255,0.04)'}, border:{color:'rgba(255,255,255,0.1)'},
          ticks:{color:'#7777a0', font:{size:11},
            callback: v => '₹'+v.toLocaleString('en-IN',{notation:'compact',maximumFractionDigits:1})} },
      },
      interaction: { mode:'index', intersect:false },
    },
  });
  if (!window._chartInstances) window._chartInstances = {};
  window._chartInstances['ssChart'] = _ssChartInst;
}

// ── Intraday chart ───────────────────────────────
function renderSSDayChart(ticker) {
  const wrap = document.getElementById('ss-day-wrap');
  if (!wrap) return;
  const ticks = state.dayHistories[ticker];
  if (!ticks?.length) {
    wrap.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:1rem;">Intraday data unavailable for today.</div>';
    return;
  }
  const labels = ticks.map(d => d.time);
  const prices = ticks.map(d => d.price);
  const isUp   = prices[prices.length-1] >= prices[0];
  const color  = isUp ? '#22c55e' : '#ef4444';
  if (_ssDayInst) { _ssDayInst.destroy(); _ssDayInst = null; }
  wrap.innerHTML = '<canvas id="ssDayChart" style="width:100%;height:100%"></canvas>';
  const ctx = document.getElementById('ssDayChart').getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 260);
  grad.addColorStop(0, isUp ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  _ssDayInst = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ data:prices, borderColor:color, borderWidth:2,
      backgroundColor:grad, fill:true, pointRadius:0, pointHoverRadius:4, tension:0.2 }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: { legend:{display:false},
        tooltip:{ backgroundColor:'rgba(20,20,35,0.95)', borderColor:'rgba(255,255,255,0.1)',
          borderWidth:1, titleColor:'#a0a0c0', bodyColor:'#e0e0ff', padding:10,
          mode:'index', intersect:false, callbacks:{label: c=>' ₹'+c.parsed.y.toFixed(2)} } },
      scales: {
        x:{grid:{color:'rgba(255,255,255,0.03)'},border:{color:'rgba(255,255,255,0.1)'},
          ticks:{color:'#7777a0',font:{size:11},maxTicksLimit:8,maxRotation:0}},
        y:{grid:{color:'rgba(255,255,255,0.04)'},border:{color:'rgba(255,255,255,0.1)'},
          ticks:{color:'#7777a0',font:{size:11},callback:v=>v.toFixed(1)}},
      },
      interaction:{mode:'index',intersect:false},
    },
  });
  if (!window._chartInstances) window._chartInstances = {};
  window._chartInstances['ssDayChart'] = _ssDayInst;
}

// ── Fundamentals — identical to drilldown ────────
function renderSSFundTab() {
  const el = document.getElementById('ss-fundamentals');
  if (!el) return;
  if (!_ssFundData) {
    const sym = _ssTicker.replace(/\.(NS|BO|BSE|NSE)$/i, '');
    el.innerHTML = `<div style="color:var(--text3);font-size:12px;padding:0.5rem 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <span>Could not load from Screener.in (may be geo-restricted via proxy).</span>
      <a href="https://www.screener.in/company/${sym}/" target="_blank" style="color:var(--accent2);text-decoration:none;">Open Screener.in ↗</a>
    </div>`;
    return;
  }
  const f = _ssFundData;
  const src = `<a href="${f._url||'#'}" target="_blank" style="color:var(--accent2);text-decoration:none;">Screener.in ↗</a>`;
  if (_ssFundTab === 'ratios') {
    const row = (lbl, val, hint='') => val ? `<div class="fund-item" title="${hint}"><span class="fund-label">${lbl}</span><span class="fund-val">${val}</span></div>` : '';
    el.innerHTML = `<div class="fund-grid">
      ${row('Market Cap',f.marketCap)}${row('P/E Ratio',f.peRatio,'Stock P/E')}
      ${row('52W High/Low',f.week52HL)}${row('Book Value',f.bookValue)}
      ${row('ROCE',f.roce,'Return on Capital Employed')}${row('ROE',f.roe,'Return on Equity')}
      ${row('Div Yield',f.divYield)}${row('Debt/Equity',f.debtEquity)}
      ${row('EPS',f.eps)}${row('Face Value',f.faceValue)}
    </div><div class="fund-table-note" style="margin-top:0.5rem;">Source: ${src} · ${f._mode}</div>`;
  } else {
    const key  = _ssFundTab === 'pnl' ? 'pnl' : _ssFundTab === 'balance' ? 'balance' : _ssFundTab === 'cashflow' ? 'cashflow' : 'quarterly';
    const note = _ssFundTab === 'pnl' ? 'P&L figures in ₹ Cr' : _ssFundTab === 'balance' ? 'Balance Sheet in ₹ Cr' : _ssFundTab === 'cashflow' ? 'Cash Flow in ₹ Cr' : 'Quarterly Results in ₹ Cr';
    const td   = f[key];
    if (!td?.rows?.length) { el.innerHTML = `<div style="color:var(--text3);font-size:12px;padding:1rem 0;">No data available · ${src}</div>`; return; }
    const years = td.headers.slice(1);
    const thead = `<tr><th>Item</th>${years.map(y=>`<th>${y}</th>`).join('')}</tr>`;
    const tbody = td.rows.map(r => {
      const cells = r.values.map(v => { const n=parseFloat(v.replace(/,/g,'')); return `<td class="${!isNaN(n)&&n<0?'negative':''}">${v||'—'}</td>`; }).join('');
      return `<tr><td>${r.label}</td>${cells}</tr>`;
    }).join('');
    el.innerHTML = `<div style="overflow-x:auto;"><table class="fund-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>
      <div class="fund-table-note">${note} · Source: ${src}</div>`;
  }
}

// ── Filter helpers ───────────────────────────────
function syncSSFilterUI() {
  document.querySelectorAll('.ss-tf-btn').forEach(b => b.classList.toggle('active', b.dataset.f === _ssFilter.value));
  const cw = document.getElementById('ss-custom-wrap');
  if (cw) cw.style.display = _ssFilter.value === 'CUSTOM' ? 'flex' : 'none';
  // Sync date inputs
  const fi = document.getElementById('ss-from'), ti = document.getElementById('ss-to');
  if (fi && _ssFilter.customFrom) fi.value = _ssFilter.customFrom;
  if (ti && _ssFilter.customTo)   ti.value = _ssFilter.customTo;
}

function filterSSHist() {
  const all = _ssHistFull, dates = Object.keys(all).sort();
  if (!dates.length) return {};
  const last = dates[dates.length-1];
  if (_ssFilter.value === 'CUSTOM') {
    const from = _ssFilter.customFrom || dates[0], to = _ssFilter.customTo || last;
    return Object.fromEntries(Object.entries(all).filter(([d]) => d >= from && d <= to));
  }
  const ref = new Date(last);
  if (_ssFilter.value === '1M') ref.setMonth(ref.getMonth()-1);
  else if (_ssFilter.value === '3M') ref.setMonth(ref.getMonth()-3);
  else if (_ssFilter.value === '1Y') ref.setFullYear(ref.getFullYear()-1);
  const from = _ssFilter.value === 'ALL' ? dates[0] : ref.toISOString().split('T')[0];
  return Object.fromEntries(Object.entries(all).filter(([d]) => d >= from));
}

window._ssClear = function() {
  const inp = document.getElementById('ss-search-input');
  if (inp) { inp.value = ''; inp.focus(); }
  const clr = document.getElementById('ss-clear-btn');
  if (clr) clr.style.display = 'none';
  closeSSDropdown();
  // Only reset ticker state so next pick/search loads fresh — keep results visible
  _ssTicker = ''; _ssLastMeta = null;
};

window._ssSetFilter = function(f, btn) {
  _ssFilter.value = f;
  syncSSFilterUI();
  if (f !== 'CUSTOM') renderSSChart();
};
window._ssApplyCustom = function() {
  const from = document.getElementById('ss-from')?.value, to = document.getElementById('ss-to')?.value;
  if (!from || !to) return;
  _ssFilter.customFrom = from; _ssFilter.customTo = to;
  renderSSChart();
};
window._ssSwitchFundTab = function(tab, btn) {
  _ssFundTab = tab;
  document.querySelectorAll('#ss-fund-body .fund-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderSSFundTab();
};
window._ssSwitchMode = function(mode, btn) {
  if (_ssFundMode === mode) return;
  _ssFundMode = mode;
  document.querySelectorAll('#ss-result-panel .fund-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
  const el = document.getElementById('ss-fundamentals');
  if (el) el.innerHTML = '<div class="ss-loading"><div class="ss-spinner"></div><span>Loading…</span></div>';
  fetchScreenerFundamentals(_ssTicker, mode).then(fund => { _ssFundData = fund; renderSSFundTab(); });
};
