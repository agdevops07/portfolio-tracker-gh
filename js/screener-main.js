// ═══════════════════════════════════════════════
// SCREENER-MAIN — Stock search page entry point
// News, Filings, AI Insights via Claude API
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { fetchPrice, fetchHistory, fetchDayHistory, fetchScreenerFundamentals } from './api.js';
import { pct, colorPnl, showToast } from './utils.js';

const PROXY = 'https://corsproxy.io/?url=';
const proxyUrl = (u) => PROXY + encodeURIComponent(u);

// ── State ─────────────────────────────────────────
let _db = null, _dbLoaded = false, _searchTimeout = null;
let _ticker = '', _meta = null, _fundData = null;
let _fundTab = 'ratios', _fundMode = 'standalone';
let _histFull = {}, _chartInst = null, _dayInst = null;
let _aiTab = 'filings';
let _aiCache = {};
const SS_DEFAULT_FROM = '2026-03-31';
let _filter = { value: 'CUSTOM', customFrom: SS_DEFAULT_FROM, customTo: new Date().toISOString().split('T')[0] };


// ── Hint chip trigger ────────────────────────────
window._ssTrigger = function(name) {
  const inp = document.getElementById('ss-search-input');
  if (!inp) return;
  inp.value = name;
  const clr = document.getElementById('ss-clear-btn');
  if (clr) clr.style.display = 'block';
  // Fire input event to show dropdown
  inp.dispatchEvent(new Event('input'));
  inp.focus();
};
// ── Init ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadDB();
  wireSearch('ss-search-input', 'ss-dropdown');
  wireSearch('ss-search-input-compact', 'ss-dropdown-compact');
  document.addEventListener('click', e => {
    if (!e.target.closest('#ss-search-wrap') && !e.target.closest('.ss-compact-search')) {
      closeDropdown('ss-dropdown');
      closeDropdown('ss-dropdown-compact');
    }
  });
});

async function loadDB() {
  if (_db) return;
  const st = document.getElementById('ss-db-status');
  try {
    if (st) { st.textContent = 'Loading stock database…'; st.style.display = 'block'; }
    const base = document.location.pathname.replace(/\/[^/]*$/, '') || '';
    const res = await fetch(base + '/data/stocks_db.json');
    if (!res.ok) throw new Error('Failed');
    _db = await res.json();
    _dbLoaded = true;
    if (st) {
      st.textContent = `✓ ${_db.length.toLocaleString()} stocks (NSE + BSE)`;
      st.style.color = 'var(--green)';
      setTimeout(() => { st.style.display = 'none'; }, 2500);
    }
  } catch {
    if (st) { st.textContent = '⚠ Could not load stock DB. Type a ticker manually.'; st.style.color = 'var(--red)'; }
  }
}

// ── Wire search input ─────────────────────────────
function wireSearch(inputId, dropdownId) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.addEventListener('input', e => onInput(e.target, dropdownId));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitSearch(inp.value.trim().toUpperCase(), dropdownId); }
  });
}

function onInput(inp, dropdownId) {
  clearTimeout(_searchTimeout);
  const q = inp.value.trim().toUpperCase();
  const clr = document.getElementById('ss-clear-btn');
  if (clr) clr.style.display = inp.value ? 'block' : 'none';
  if (!q || q.includes('—')) { closeDropdown(dropdownId); return; }
  _searchTimeout = setTimeout(() => showDropdown(q, dropdownId, inp), 150);
}

function showDropdown(q, dropdownId, inp) {
  const dd = document.getElementById(dropdownId);
  if (!dd) return;
  if (!_db) { dd.innerHTML = '<div class="sp-dd-hint">Loading database…</div>'; dd.style.display = 'block'; return; }
  const results = _db.filter(s => s.symbol.startsWith(q) || s.company.toUpperCase().includes(q)).slice(0, 14);
  if (!results.length) { dd.innerHTML = '<div class="sp-dd-hint">No results found.</div>'; dd.style.display = 'block'; return; }
  window._ssResultCache = results;
  dd.innerHTML = results.map((s, i) =>
    `<div class="sp-dd-item" onmousedown="window._ssPick(${i},'${dropdownId}')">
       <span class="sp-badge sp-badge-${s.exchange.toLowerCase().replace('-','')}">${s.exchange}</span>
       <span class="sp-dd-sym">${s.symbol}</span>
       <span class="sp-dd-name">${s.company}</span>
     </div>`).join('');
  dd.style.display = 'block';
}

function closeDropdown(id) {
  const dd = document.getElementById(id);
  if (dd) dd.style.display = 'none';
}

window._ssPick = function(idx, dropdownId) {
  const stock = window._ssResultCache?.[idx];
  if (!stock) return;
  closeDropdown(dropdownId);
  const ticker = stock.exchange === 'BSE'
    ? (stock.bseTicker || stock.yahooTicker?.replace('.NS', '.BO') || stock.symbol + '.BO')
    : (stock.yahooTicker || stock.symbol + '.NS');
  // Sync both inputs
  const inp1 = document.getElementById('ss-search-input');
  const inp2 = document.getElementById('ss-search-input-compact');
  const label = `${stock.symbol}  —  ${stock.company}`;
  if (inp1) inp1.value = label;
  if (inp2) inp2.value = label;
  _meta = stock;
  const clr = document.getElementById('ss-clear-btn');
  if (clr) clr.style.display = 'block';
  loadStock(ticker, stock);
};

function submitSearch(raw, dropdownId) {
  closeDropdown(dropdownId);
  if (!raw || raw.includes('—')) return;
  _meta = null;
  loadStock(raw, null);
}

window._ssClear = function() {
  const inp1 = document.getElementById('ss-search-input');
  const inp2 = document.getElementById('ss-search-input-compact');
  if (inp1) { inp1.value = ''; inp1.focus(); }
  if (inp2) inp2.value = '';
  const clr = document.getElementById('ss-clear-btn');
  if (clr) clr.style.display = 'none';
  _ticker = ''; _meta = null;
};

// ── Load stock ────────────────────────────────────
async function loadStock(ticker, meta) {
  _ticker = ticker;
  _meta = meta;
  _fundData = null; _fundTab = 'ratios'; _fundMode = 'standalone';
  _aiCache = {};
  const today = new Date().toISOString().split('T')[0];
  _filter = { value: 'CUSTOM', customFrom: SS_DEFAULT_FROM, customTo: today };

  if (_chartInst) { _chartInst.destroy(); _chartInst = null; }
  if (_dayInst)   { _dayInst.destroy();   _dayInst   = null; }

  // Switch to compact search mode
  const hero = document.getElementById('ss-hero');
  const compact = document.getElementById('ss-compact');
  if (hero) hero.style.display = 'none';
  if (compact) compact.style.display = 'flex';

  // Show result panel with skeleton
  const panel = document.getElementById('ss-result');
  if (panel) panel.style.display = 'block';

  showSkeleton(ticker, meta);
  renderAIPlaceholder();

  // Parallel fetch
  const [livePrice, hist, fund, dayHist] = await Promise.all([
    fetchPrice(ticker),
    fetchHistory(ticker, meta?.isin),
    fetchScreenerFundamentals(ticker, 'standalone'),
    fetchDayHistory(ticker, meta?.isin),
  ]);

  if (livePrice) state.livePrices[ticker] = livePrice;
  _histFull = hist || {};
  _fundData = fund;
  state.dayHistories[ticker] = dayHist || [];

  fillHeader(ticker, meta, fund);
  fillCards(ticker, fund);
  renderChart();
  renderDayChart(ticker);
  renderFundTab();
  syncFilterUI();
  renderExchangeLinks(ticker, meta);

  // Load news and filings in parallel
  loadNews(ticker, meta);
  loadFilings(ticker, meta);
}

// ── Skeleton ──────────────────────────────────────
function showSkeleton(ticker, meta) {
  const el = document.getElementById('ss-ticker-el');
  const sub = document.getElementById('ss-subtitle-el');
  if (el) el.textContent = ticker;
  if (sub) sub.textContent = meta?.company || '…';
  const cards = document.getElementById('ss-cards');
  if (cards) {
    cards.innerHTML = ['Current Price',"Day's Change",'Market Cap','P/E Ratio'].map(l =>
      `<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value" style="color:var(--text3)">…</div></div>`
    ).join('');
  }
}

// ── Fill header ───────────────────────────────────
function fillHeader(ticker, meta, fund) {
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

// ── Fill stat cards ───────────────────────────────
function fillCards(ticker, fund) {
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

// ── Exchange links ────────────────────────────────
function renderExchangeLinks(ticker, meta) {
  const sym = ticker.replace(/\.(NS|BO)$/i, '').replace(/-SM$/, '');
  const isBSE = /\.BO$/i.test(ticker);
  const linksEl = document.getElementById('ss-exchange-links');
  if (!linksEl) return;

  const nseSym = sym;
  const screenerSym = meta?.isin ? meta.isin : sym;

  linksEl.innerHTML = `
    <a class="exch-link-btn" href="https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(nseSym)}" target="_blank" rel="noopener">
      <span class="exch-icon">📊</span> NSE Quote
    </a>
    ${(meta?.bseCode || /\.BO$/i.test(ticker)) ? `
    <a class="exch-link-btn" href="https://www.bseindia.com/stock-share-price/${(meta?.company||sym).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}/${sym}/${meta?.bseCode||''}/" target="_blank" rel="noopener">
      <span class="exch-icon">📈</span> BSE Quote
    </a>` : ''}
    <a class="exch-link-btn" href="https://www.screener.in/company/${sym}/" target="_blank" rel="noopener">
      <span class="exch-icon">🔎</span> Screener.in
    </a>`;

  // NSE Filings link
  const nseFilingsLink = document.getElementById('ss-nse-filings-link');
  if (nseFilingsLink) {
    nseFilingsLink.href = `https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol=${encodeURIComponent(nseSym)}`;
    nseFilingsLink.style.display = '';
  }
  // BSE Filings link
  const bseFilingsLink = document.getElementById('ss-bse-filings-link');
  if (bseFilingsLink) {
    bseFilingsLink.href = `https://www.bseindia.com/corporates/ann.html?scrip=${encodeURIComponent(sym)}&type=0`;
    bseFilingsLink.style.display = '';
  }
}

// ── Price history chart ───────────────────────────
function renderChart() {
  const hist   = filterHist();
  const dates  = Object.keys(hist).sort();
  const prices = dates.map(d => hist[d]);
  if (_chartInst) { _chartInst.destroy(); _chartInst = null; }
  const canvas = document.getElementById('ssChart');
  if (!canvas || !dates.length) return;

  if (dates.length >= 2) {
    const chg = ((prices[prices.length-1] - prices[0]) / prices[0]) * 100;
    const el  = document.getElementById('ss-period-chg');
    if (el) el.innerHTML = `<span style="color:${chg>=0?'var(--green)':'var(--red)'}">${chg>=0?'+':''}${chg.toFixed(2)}%</span>`;
  }

  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 260);
  grad.addColorStop(0, 'rgba(99,102,241,0.2)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  _chartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates.map(d => { const [y,m,dy] = d.split('-'); return `${dy}/${m}/${y.slice(2)}`; }),
      datasets: [{ data: prices, borderColor: '#6366f1', borderWidth: 2,
        backgroundColor: grad, fill: true, pointRadius: 0, pointHoverRadius: 5, tension: 0.3 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { backgroundColor:'rgba(20,20,35,0.95)', borderColor:'rgba(255,255,255,0.1)', borderWidth:1,
          titleColor:'#a0a0c0', bodyColor:'#e0e0ff', padding:10, mode:'index', intersect:false,
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
  window._chartInstances['ssChart'] = _chartInst;
}

// ── Intraday chart ────────────────────────────────
function renderDayChart(ticker) {
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
  if (_dayInst) { _dayInst.destroy(); _dayInst = null; }
  wrap.innerHTML = '<canvas id="ssDayChart" style="width:100%;height:100%"></canvas>';
  const ctx = document.getElementById('ssDayChart').getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 260);
  grad.addColorStop(0, isUp ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  _dayInst = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ data:prices, borderColor:color, borderWidth:2,
      backgroundColor:grad, fill:true, pointRadius:0, pointHoverRadius:4, tension:0.2 }] },
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        tooltip:{backgroundColor:'rgba(20,20,35,0.95)',borderColor:'rgba(255,255,255,0.1)',
          borderWidth:1,titleColor:'#a0a0c0',bodyColor:'#e0e0ff',padding:10,
          mode:'index',intersect:false,callbacks:{label:c=>' ₹'+c.parsed.y.toFixed(2)}} },
      scales:{
        x:{grid:{color:'rgba(255,255,255,0.03)'},border:{color:'rgba(255,255,255,0.1)'},
          ticks:{color:'#7777a0',font:{size:11},maxTicksLimit:8,maxRotation:0}},
        y:{grid:{color:'rgba(255,255,255,0.04)'},border:{color:'rgba(255,255,255,0.1)'},
          ticks:{color:'#7777a0',font:{size:11},callback:v=>v.toFixed(1)}},
      },
      interaction:{mode:'index',intersect:false},
    },
  });
  window._chartInstances['ssDayChart'] = _dayInst;
}

// ── Fundamentals ──────────────────────────────────
function renderFundTab() {
  const el = document.getElementById('ss-fundamentals');
  if (!el) return;
  if (!_fundData) {
    const sym = _ticker.replace(/\.(NS|BO|BSE|NSE)$/i, '');
    el.innerHTML = `<div style="color:var(--text3);font-size:12px;padding:0.5rem 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <span>Could not load from Screener.in (may be geo-restricted via proxy).</span>
      <a href="https://www.screener.in/company/${sym}/" target="_blank" style="color:var(--accent2);text-decoration:none;">Open Screener.in ↗</a>
    </div>`;
    return;
  }
  const f = _fundData;
  const src = `<a href="${f._url||'#'}" target="_blank" style="color:var(--accent2);text-decoration:none;">Screener.in ↗</a>`;
  if (_fundTab === 'ratios') {
    const row = (lbl, val, hint='') => val ? `<div class="fund-item" title="${hint}"><span class="fund-label">${lbl}</span><span class="fund-val">${val}</span></div>` : '';
    el.innerHTML = `<div class="fund-grid">
      ${row('Market Cap',f.marketCap)}${row('P/E Ratio',f.peRatio,'Stock P/E')}
      ${row('52W High/Low',f.week52HL)}${row('Book Value',f.bookValue)}
      ${row('ROCE',f.roce,'Return on Capital Employed')}${row('ROE',f.roe,'Return on Equity')}
      ${row('Div Yield',f.divYield)}${row('Debt/Equity',f.debtEquity)}
      ${row('EPS',f.eps)}${row('Face Value',f.faceValue)}
    </div><div class="fund-table-note" style="margin-top:0.5rem;">Source: ${src} · ${f._mode}</div>`;
  } else {
    const key  = { pnl:'pnl', balance:'balance', cashflow:'cashflow', quarterly:'quarterly' }[_fundTab];
    const note = { pnl:'P&L figures in ₹ Cr', balance:'Balance Sheet in ₹ Cr', cashflow:'Cash Flow in ₹ Cr', quarterly:'Quarterly Results in ₹ Cr' }[_fundTab];
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

// ── Filter helpers ────────────────────────────────
function syncFilterUI() {
  document.querySelectorAll('.ss-tf-btn').forEach(b => b.classList.toggle('active', b.dataset.f === _filter.value));
  const cw = document.getElementById('ss-custom-wrap');
  if (cw) cw.style.display = _filter.value === 'CUSTOM' ? 'flex' : 'none';
  const fi = document.getElementById('ss-from'), ti = document.getElementById('ss-to');
  if (fi && _filter.customFrom) fi.value = _filter.customFrom;
  if (ti && _filter.customTo)   ti.value = _filter.customTo;
}

function filterHist() {
  const all = _histFull, dates = Object.keys(all).sort();
  if (!dates.length) return {};
  const last = dates[dates.length-1];
  if (_filter.value === 'CUSTOM') {
    const from = _filter.customFrom || dates[0], to = _filter.customTo || last;
    return Object.fromEntries(Object.entries(all).filter(([d]) => d >= from && d <= to));
  }
  const ref = new Date(last);
  if (_filter.value === '1M') ref.setMonth(ref.getMonth()-1);
  else if (_filter.value === '3M') ref.setMonth(ref.getMonth()-3);
  else if (_filter.value === '1Y') ref.setFullYear(ref.getFullYear()-1);
  const from = _filter.value === 'ALL' ? dates[0] : ref.toISOString().split('T')[0];
  return Object.fromEntries(Object.entries(all).filter(([d]) => d >= from));
}

window._ssSetFilter = function(f, btn) { _filter.value = f; syncFilterUI(); if (f !== 'CUSTOM') renderChart(); };
window._ssApplyCustom = function() {
  const from = document.getElementById('ss-from')?.value, to = document.getElementById('ss-to')?.value;
  if (!from || !to) return;
  _filter.customFrom = from; _filter.customTo = to; renderChart();
};
window._ssSwitchFundTab = function(tab, btn) {
  _fundTab = tab;
  document.querySelectorAll('#ss-fund-body .fund-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderFundTab();
};
window._ssSwitchMode = function(mode, btn) {
  if (_fundMode === mode) return;
  _fundMode = mode;
  document.querySelectorAll('.fund-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
  const el = document.getElementById('ss-fundamentals');
  if (el) el.innerHTML = '<div class="ss-loading"><div class="ss-spinner"></div><span>Loading…</span></div>';
  fetchScreenerFundamentals(_ticker, mode).then(fund => { _fundData = fund; renderFundTab(); });
};

// ── News ──────────────────────────────────────────
async function loadNews(ticker, meta) {
  const grid = document.getElementById('ss-news-grid');
  if (!grid) return;
  const company = meta?.company || ticker.replace(/\.(NS|BO)$/i, '');
  const sym = ticker.replace(/\.(NS|BO)$/i, '');

  // Use Yahoo Finance news via the chart API (it includes news items)
  let articles = [];
  try {
    // Use ticker directly for stock-specific news
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d&includePrePost=false`;
    const res = await fetch(proxyUrl(url));
    if (res.ok) {
      const data = await res.json();
      const news = data?.chart?.result?.[0]?.events?.dividends; // not news here, use search endpoint
    }
  } catch(_e) {}
  try {
    // Stock-specific news via Yahoo search with ticker symbol
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(sym)}&newsCount=8&quotesCount=0&enableFuzzyQuery=false`;
    const res = await fetch(proxyUrl(url));
    if (res.ok) {
      const data = await res.json();
      articles = (data?.news || []).slice(0, 6).map(n => ({
        title: n.title,
        publisher: n.publisher,
        link: n.link,
        time: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '',
      }));
    }
  } catch (e) { console.warn('News fetch failed', e); }

  // More link
  const moreLink = document.getElementById('ss-news-more');
  if (moreLink) {
    moreLink.href = `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/news/`;
    moreLink.style.display = '';
  }

  if (!articles.length) {
    grid.innerHTML = `<div style="color:var(--text3);font-size:13px;padding:0.5rem 0;">
      No news found. <a href="https://finance.yahoo.com/quote/${ticker}/news/" target="_blank" style="color:var(--accent2);">Check Yahoo Finance ↗</a>
    </div>`;
    return;
  }

  grid.innerHTML = articles.map(a => `
    <a class="news-item" href="${a.link || '#'}" target="_blank" rel="noopener">
      <span class="news-source-badge">${(a.publisher || 'News').substring(0,12)}</span>
      <div class="news-content">
        <div class="news-title">${a.title}</div>
        <div class="news-meta">${a.time}</div>
      </div>
    </a>`).join('');
}

// ── Filings ───────────────────────────────────────
async function loadFilings(ticker, meta) {
  const grid = document.getElementById('ss-filings-grid');
  if (!grid) return;

  const sym = ticker.replace(/\.(NS|BO)$/i, '').replace(/-SM$/, '');
  const bseCode = meta?.bseCode || null;
  let filings = [];

  // 1. Try BSE announcements API (returns actual PDF links)
  if (bseCode) {
    try {
      const bseUrl = `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=1&strCat=-1&strPrevDate=&strScrip=${bseCode}&strSearch=P&strToDate=&strType=C&subcategory=-1`;
      const res = await fetch(proxyUrl(bseUrl), { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        const items = data?.Table || [];
        filings = items.slice(0, 6).map(f => {
          const pdfLink = f.ATTACHMENTNAME
            ? 'https://www.bseindia.com/xml-data/corpfiling/AttachLive/' + f.ATTACHMENTNAME
            : 'https://www.bseindia.com/corporates/ann.html?scrip=' + bseCode + '&type=0';
          return {
            exchange: 'BSE',
            title: f.NEWSSUB || f.SUBCATNAME || 'Announcement',
            date: f.NEWS_DT ? new Date(f.NEWS_DT).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '',
            type: f.SUBCATNAME || '',
            link: pdfLink,
            isPdf: !!f.ATTACHMENTNAME,
          };
        });
      }
    } catch (e) { console.warn('BSE filings failed', e); }
  }

  // 2. Try NSE announcements API
  if (!filings.length) {
    try {
      const nseUrl = `https://www.nseindia.com/api/corp-announcements?index=equities&symbol=\${encodeURIComponent(sym)}`;
      const res = await fetch(proxyUrl(nseUrl), { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data?.data || []);
        filings = items.slice(0, 5).map(f => ({
          exchange: 'NSE',
          title: f.desc || f.attchmntText || f.subject || 'Announcement',
          date: f.an_dt ? new Date(f.an_dt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '',
          type: f.attchmntType || f.purpose || '',
          link: f.attchmntFile ? 'https://www.nseindia.com' + f.attchmntFile : 'https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol=' + encodeURIComponent(sym),
          isPdf: !!f.attchmntFile,
        }));
      }
    } catch (e) { console.warn('NSE filings failed', e); }
  }

  // 3. Fallback: direct links to exchange filing pages
  if (!filings.length) {
    filings = [
      { exchange: 'BSE', title: 'View all BSE corporate filings', date: '', type: '', link: 'https://www.bseindia.com/corporates/ann.html?scrip=' + (bseCode || sym) + '&type=0', isPdf: false },
      { exchange: 'NSE', title: 'View all NSE corporate filings', date: '', type: '', link: 'https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol=' + encodeURIComponent(sym), isPdf: false },
    ];
  }

  grid.innerHTML = filings.map(f =>
    '<div class="filing-item">' +
    '<span class="filing-exchange ' + f.exchange.toLowerCase() + '">' + f.exchange + '</span>' +
    '<div class="filing-body">' +
    '<div class="filing-title" title="' + f.title + '">' + f.title + '</div>' +
    (f.date ? '<div class="filing-meta">' + f.date + '</div>' : '') +
    '</div>' +
    (f.type ? '<span class="filing-type-badge">' + f.type + '</span>' : '') +
    '<a class="filing-link" href="' + f.link + '" target="_blank" rel="noopener">' + (f.isPdf ? '📄 PDF' : 'View ↗') + '</a>' +
    '</div>'
  ).join('');
}

// ── AI Insights ───────────────────────────────────
window.setAiTab = function(tab) {
  _aiTab = tab;
  document.querySelectorAll('.ai-tab').forEach((b, i) => {
    const tabs = ['filings', 'results', 'ar', 'orders'];
    b.classList.toggle('active', tabs[i] === tab);
  });
  renderAITab();
};

function renderAIPlaceholder() {
  const area = document.getElementById('ai-content-area');
  if (!area) return;
  area.innerHTML = `<div style="color:var(--text3);font-size:13px;">Search for a stock to generate AI-powered filing insights.</div>`;
}

function renderAITab() {
  const area = document.getElementById('ai-content-area');
  if (!area) return;

  if (!_ticker) {
    area.innerHTML = `<div style="color:var(--text3);font-size:13px;">Search for a stock to generate AI-powered filing insights.</div>`;
    return;
  }

  if (_aiCache[_aiTab]) {
    area.innerHTML = formatAIResponse(_aiCache[_aiTab]);
    return;
  }

  const labels = { filings:'Latest Filings', results:'Results Analysis', ar:'Annual Report', orders:'Order Wins' };
  const sym = _ticker.replace(/\.(NS|BO)$/i, '');
  area.innerHTML = `
    <div style="color:var(--text2);font-size:13px;margin-bottom:0.75rem;">
      Generate AI insights on <strong>${_meta?.company || sym}</strong>'s ${labels[_aiTab]}.
    </div>
    <button class="ai-generate-btn" onclick="generateAI('${_aiTab}')">
      ✨ Generate ${labels[_aiTab]} Insights
    </button>
    <div style="font-size:11px;color:var(--text3);margin-top:0.6rem;">
      Uses Pollinations.ai (open-source AI, no API key required). Not financial advice.
    </div>`;
}

window.generateAI = async function(tab) {
  const area = document.getElementById('ai-content-area');
  if (!area) return;

  area.innerHTML = `<div class="ai-loading"><div class="spinner"></div><span>Analysing data with Claude…</span></div>`;

  const sym = _ticker.replace(/\.(NS|BO)$/i, '');
  const company = _meta?.company || sym;
  const sector = _fundData?.sectorBreadcrumb || _fundData?.sector || '';
  const mktCap = _fundData?.marketCap || '';
  const pe = _fundData?.peRatio || '';
  const roce = _fundData?.roce || '';
  const roe = _fundData?.roe || '';
  const about = _fundData?.about || '';

  // Build financial context
  let financialContext = '';
  if (_fundData?.quarterly?.rows?.length) {
    const rows = _fundData.quarterly.rows.slice(0, 5);
    const headers = _fundData.quarterly.headers.slice(1, 5);
    financialContext = `Quarterly Results (last 4 periods — ${headers.join(', ')}):\n`;
    rows.forEach(r => {
      financialContext += `  ${r.label}: ${r.values.slice(0, 4).join(' | ')}\n`;
    });
  }
  if (_fundData?.pnl?.rows?.length) {
    const rows = _fundData.pnl.rows.slice(0, 6);
    const headers = _fundData.pnl.headers.slice(1, 4);
    financialContext += `\nP&L (last 3 years — ${headers.join(', ')}):\n`;
    rows.forEach(r => {
      financialContext += `  ${r.label}: ${r.values.slice(0, 3).join(' | ')}\n`;
    });
  }

  const prompts = {
    filings: `You are an expert Indian stock market analyst. Analyse the latest regulatory filings and announcements for ${company} (${_ticker}) on NSE/BSE.

Company context:
- Sector: ${sector}
- Market Cap: ${mktCap}
- P/E: ${pe}, ROCE: ${roce}, ROE: ${roe}
- About: ${about}
${financialContext}

Provide a structured analysis covering:
1. **Recent Filing Activity** — what types of filings are typically submitted (board meetings, shareholding patterns, financial results)
2. **Key Observations** — any material events investors should note
3. **Regulatory Compliance** — SEBI disclosure adherence assessment
4. **What to Watch** — upcoming expected filings (quarterly results, AGM, etc.)

Be concise, factual, and specific to this company. Format with bullet points. 3-4 key points per section.`,

    results: `You are an expert Indian stock market analyst. Analyse the financial results for ${company} (${_ticker}).

Financial data:
${financialContext || 'No detailed financial data available — use general knowledge about this company.'}

Key ratios: P/E: ${pe}, ROCE: ${roce}, ROE: ${roe}, Market Cap: ${mktCap}
Sector: ${sector}

Provide analysis covering:
1. **Revenue & Profit Trend** — growth trajectory, margins
2. **Key Metrics Assessment** — ROCE, ROE, P/E vs sector norms
3. **Quarterly Performance** — recent quarter highlights, YoY comparison
4. **Analyst Perspective** — key positives and concerns from results

Be direct, data-driven, and use ₹ for Indian currency. Format with bullet points.`,

    ar: `You are an expert Indian equity research analyst. Provide insights on the Annual Report of ${company} (${_ticker}).

Company: ${company}
Sector: ${sector}
About: ${about}
Key ratios: Market Cap: ${mktCap}, P/E: ${pe}, ROCE: ${roce}, ROE: ${roe}

${financialContext}

Cover these areas:
1. **Business Overview** — core segments, revenue mix
2. **Management Commentary** — typical themes management discusses (growth drivers, risks)
3. **Balance Sheet Health** — debt, working capital, cash position
4. **Dividend & Capital Allocation** — payout history and policy
5. **ESG & Governance** — board composition, sustainability initiatives

Note: Infer from financial data and company profile. Format with clear headers and bullet points.`,

    orders: `You are an expert Indian stock market analyst focused on order wins and business development.

Company: ${company} (${_ticker})
Sector: ${sector}
About: ${about}
Market Cap: ${mktCap}

${financialContext}

Analyse order wins and business pipeline:
1. **Order Book Overview** — typical order book size, visibility for this type of company
2. **Recent Wins** — categories of contracts/orders this company typically announces
3. **Pipeline Assessment** — sectors and geographies driving new business
4. **Revenue Visibility** — order-to-execution timeline and revenue recognition pattern
5. **Competitive Position** — key moats enabling order wins

If this is not a capital-goods/infrastructure company, adapt to discuss revenue wins, new contracts, or business development milestones. Format with bullet points.`,
  };

  try {
    // Pollinations.ai — free, no API key, uses open-source models (Mistral/LLaMA)
    const encoded = encodeURIComponent(prompts[tab]);
    const response = await fetch(`https://text.pollinations.ai/${encoded}`, {
      method: 'GET',
      headers: { 'Accept': 'text/plain' },
    });
    if (!response.ok) throw new Error(`API error ${response.status}`);
    const text = await response.text();
    if (!text?.trim()) throw new Error('Empty response');
    _aiCache[tab] = text;
    area.innerHTML = formatAIResponse(text);
  } catch (e) {
    console.error('AI error:', e);
    area.innerHTML = `
      <div style="color:var(--red);font-size:13px;margin-bottom:0.5rem;">⚠ Could not generate insights: ${e.message}</div>
      <div style="font-size:12px;color:var(--text3);">
        The free AI service (Pollinations.ai) may be temporarily unavailable. Try again in a moment.
      </div>`;
  }
};

function formatAIResponse(text) {
  // Convert markdown-ish text to HTML
  let html = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^#{1,3} (.+)$/gm, '<strong style="font-size:14px;color:var(--text);">$1</strong>')
    .replace(/^(\d+)\. \*\*(.+?)\*\*/gm, '<br><strong style="color:var(--text);">$1. $2</strong>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');

  return `<div class="ai-content">${html}</div>
    <div class="ai-disclaimer">⚠ AI-generated analysis based on available data. Not financial advice. Always verify with official filings and consult a SEBI-registered advisor before investing.</div>`;
}

// ── Expose globals ────────────────────────────────
window._ssSetFilter    = window._ssSetFilter;
window._ssApplyCustom  = window._ssApplyCustom;
window._ssSwitchFundTab = window._ssSwitchFundTab;
window._ssSwitchMode   = window._ssSwitchMode;

// Re-init AI tab when switching
const origSetAiTab = window.setAiTab;
window.setAiTab = function(tab) {
  _aiTab = tab;
  document.querySelectorAll('#ai-tab-bar .ai-tab').forEach((b, i) => {
    const tabs = ['filings', 'results', 'ar', 'orders'];
    b.classList.toggle('active', tabs[i] === tab);
  });
  renderAITab();
};
