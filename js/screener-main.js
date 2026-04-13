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
  // Focus first to ensure input is active
  inp.focus();
  // Small delay to ensure focus is set before showing dropdown
  setTimeout(() => {
    inp.dispatchEvent(new Event('input'));
  }, 50);
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
    if (st) { st.textContent = 'Loading...'; st.style.display = 'block'; }
    const base = document.location.pathname.replace(/\/[^/]*$/, '') || '';
    const res = await fetch(base + '/data/stocks_db.json');
    if (!res.ok) throw new Error('Failed');
    _db = await res.json();
    _dbLoaded = true;
    if (st) {
      st.textContent = `✓ ${_db.length.toLocaleString()} stocks loaded (NSE + BSE)`;
      st.style.color = 'var(--green)';
      st.style.display = 'block';
    }
  } catch {
    if (st) { st.textContent = '⚠ DB load failed'; st.style.color = 'var(--red)'; }
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

  // Load news and filings — pass fund so concalls don't race against _fundData assignment
  loadNews(ticker, meta);
  loadFilings(ticker, meta);
  loadConcalls(ticker, meta, fund);
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

  // Exchange filing links - show only relevant exchanges
  const exchange = meta?.exchange || '';
  const bseCode = meta?.bseCode;
  const isBseOnly = /\.BO$/i.test(ticker) || exchange === 'BSE';
  const isNseOnly = /\.NS$/i.test(ticker) || exchange === 'NSE' || exchange === 'NSE-SME';
  
  // NSE Filings link
  const nseFilingsLink = document.getElementById('ss-nse-filings-link');
  if (nseFilingsLink) {
    if (!isBseOnly) {
      // Check if this is an NSE SME stock
      const isNseSme = meta?.exchange === 'NSE-SME';
      if (isNseSme) {
        // For NSE SME stocks, link directly to the SME tab this is the base page not the stock page
        nseFilingsLink.href = `https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol=${encodeURIComponent(nseSym)}&tabIndex=sme`;
      } else {
        // For regular NSE stocks
        nseFilingsLink.href = `https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol=${encodeURIComponent(nseSym)}`;
      }
      nseFilingsLink.style.display = '';
    } else {
      nseFilingsLink.style.display = 'none';
    }
  }
  // BSE Filings link
  const bseFilingsLink = document.getElementById('ss-bse-filings-link');
  if (bseFilingsLink) {
    if (bseCode && !isNseOnly) {
      bseFilingsLink.href = `https://www.bseindia.com/corporates/ann.html?scrip=${bseCode}`;
      bseFilingsLink.style.display = '';
    } else {
      bseFilingsLink.style.display = 'none';
    }
  }
}

// ── Price history chart ───────────────────────────
function renderChart() {
  const hist   = filterHist();
  let   dates  = Object.keys(hist).sort();
  let   prices = dates.map(d => hist[d]);

  // ── Patch today's last point with live price ──────
  const todayStr = new Date().toISOString().split('T')[0];
  const livePrice = state.livePrices[_ticker];
  if (livePrice && livePrice > 0) {
    const todayIdx = dates.indexOf(todayStr);
    if (todayIdx >= 0) {
      prices = [...prices];
      prices[todayIdx] = livePrice;
    } else if (dates.length && dates[dates.length - 1] < todayStr) {
      dates = [...dates, todayStr];
      prices = [...prices, livePrice];
    }
  }

  if (_chartInst) { _chartInst.destroy(); _chartInst = null; }
  const canvas = document.getElementById('ssChart');
  if (!canvas || !dates.length) return;

  // ── Period % change + ATH badge ───────────────────
  if (prices.length >= 2) {
    const startP = prices[0], endP = prices[prices.length - 1];
    const chg    = ((endP - startP) / startP) * 100;
    const allPrices = Object.values(_histFull);
    const ath = allPrices.length ? Math.max(...allPrices) : endP;
    const athChg = ((endP - ath) / ath) * 100;
    const el = document.getElementById('ss-period-chg');
    if (el) el.innerHTML =
      `<span style="color:${chg>=0?'var(--green)':'var(--red)'}">${chg>=0?'+':''}${chg.toFixed(2)}%</span>` +
      (Math.abs(athChg) > 0.01
        ? ` <span style="color:${athChg>=0?'var(--green)':'var(--red)'};font-size:11px;font-weight:600;background:rgba(239,68,68,0.08);padding:1px 6px;border-radius:4px">&nbsp;${athChg.toFixed(2)}% from ATH</span>`
        : '');
  }

  // Dynamic colour: green if current > period-start
  const isUp  = prices.length > 1 && prices[prices.length - 1] >= prices[0];
  const color = isUp ? '#22c55e' : '#ef4444';

  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 260);
  grad.addColorStop(0, isUp ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');

  const periodStart = prices[0];
  _chartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates.map(d => { const [y,m,dy] = d.split('-'); return `${dy}/${m}/${y.slice(2)}`; }),
      datasets: [{ data: prices, borderColor: color, borderWidth: 2,
        backgroundColor: grad, fill: true, pointRadius: 0, pointHoverRadius: 5, tension: 0.3 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { backgroundColor:'rgba(20,20,35,0.95)', borderColor:'rgba(255,255,255,0.1)', borderWidth:1,
          titleColor:'#a0a0c0', bodyColor:'#e0e0ff', padding:10, mode:'index', intersect:false,
          callbacks: {
            title: items => dates[items[0].dataIndex],
            label: c => {
              const price = c.parsed.y;
              const chg = periodStart > 0 ? ((price - periodStart) / periodStart) * 100 : null;
              return chg != null
                ? [` ₹${price.toFixed(2)}`, ` ${chg>=0?'+':''}${chg.toFixed(2)}% from period start`]
                : ` ₹${price.toFixed(2)}`;
            },
          },
        },
      },
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

  // ── Prev-close anchor ─────────────────────────────
  let prevClose = state.prevClosePrices[ticker];
  if (!prevClose || prevClose <= 0) {
    const allDates = Object.keys(_histFull).sort();
    if (allDates.length) prevClose = _histFull[allDates[allDates.length - 1]];
  }
  if (!prevClose || prevClose <= 0) prevClose = prices[0];

  const lastPrice = prices[prices.length - 1];
  const dayChgAbs = lastPrice - prevClose;
  const dayChgPct = prevClose > 0 ? (dayChgAbs / prevClose) * 100 : 0;
  const isUp  = dayChgAbs >= 0;
  const color = isUp ? '#22c55e' : '#ef4444';

  // ── Populate day-change badge ─────────────────────
  const dayChgEl = document.getElementById('ss-day-chg');
  if (dayChgEl) {
    dayChgEl.innerHTML =
      `<span style="color:${isUp?'var(--green)':'var(--red)'}">` +
      `${dayChgAbs >= 0 ? '+' : ''}₹${Math.abs(dayChgAbs).toFixed(2)} ` +
      `(${dayChgPct >= 0 ? '+' : ''}${dayChgPct.toFixed(2)}%)</span>` +
      `<span style="font-size:10px;color:var(--text3);margin-left:6px;">vs prev close</span>`;
  }

  if (_dayInst) { _dayInst.destroy(); _dayInst = null; }
  wrap.innerHTML = '<canvas id="ssDayChart" style="width:100%;height:100%"></canvas>';
  const ctx = document.getElementById('ssDayChart').getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 260);
  grad.addColorStop(0, isUp ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');

  _dayInst = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [
      // Prev-close dashed baseline
      {
        data: new Array(labels.length).fill(prevClose),
        borderColor: 'rgba(150,150,180,0.35)',
        borderWidth: 1,
        borderDash: [4, 4],
        pointRadius: 0,
        fill: false,
        tension: 0,
        order: 1,
      },
      // Live price line
      {
        data: prices,
        borderColor: color, borderWidth: 2,
        backgroundColor: grad, fill: true,
        pointRadius: 0, pointHoverRadius: 4, tension: 0.2,
        order: 0,
      },
    ]},
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        tooltip:{
          backgroundColor:'rgba(20,20,35,0.95)', borderColor:'rgba(255,255,255,0.1)',
          borderWidth:1, titleColor:'#a0a0c0', bodyColor:'#e0e0ff', padding:10,
          mode:'index', intersect:false,
          filter: (item) => item.datasetIndex === 1,
          callbacks:{
            label: c => {
              const price  = c.parsed.y;
              const chgAbs = price - prevClose;
              const chgPct = prevClose > 0 ? (chgAbs / prevClose) * 100 : 0;
              return [
                ` ₹${price.toFixed(2)}`,
                ` ${chgAbs>=0?'+':''}₹${Math.abs(chgAbs).toFixed(2)} (${chgPct>=0?'+':''}${chgPct.toFixed(2)}%) today`,
              ];
            },
          },
        },
      },
      scales:{
        x:{grid:{color:'rgba(255,255,255,0.03)'},border:{color:'rgba(255,255,255,0.1)'},
          ticks:{color:'#7777a0',font:{size:11},maxTicksLimit:8,maxRotation:0}},
        y:{grid:{color:'rgba(255,255,255,0.04)'},border:{color:'rgba(255,255,255,0.1)'},
          ticks:{color:'#7777a0',font:{size:11},
            callback:v=>'₹'+v.toLocaleString('en-IN',{notation:'compact',maximumFractionDigits:2})}},
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
    el.innerHTML = `<div class="fund-table-wrap" style="overflow-x:auto;direction:rtl;">
        <table class="fund-table" style="direction:ltr;">
          <thead>${thead}</thead><tbody>${tbody}</tbody>
        </table>
      </div>
      <div class="fund-table-note">${note} · Source: ${src}</div>`;
    // Ensure first column (labels) is sticky
    setTimeout(() => {
      el.querySelectorAll('.fund-table th:first-child, .fund-table td:first-child')
        .forEach(cell => { cell.style.cssText += ';position:sticky;left:0;background:var(--bg2);z-index:2;white-space:nowrap;'; });
    }, 0);
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

  let articles = [];
  try {
    // Use company name for more relevant news
    const searchQuery = company || sym;
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(searchQuery)}&newsCount=10&quotesCount=0&enableFuzzyQuery=false`;
    const res = await fetch(proxyUrl(url));
    if (res.ok) {
      const data = await res.json();
      articles = (data?.news || [])
        .filter(n => n.title && (
          n.title.toLowerCase().includes(company.toLowerCase()) ||
          n.title.toLowerCase().includes(sym.toLowerCase())
        ))
        .slice(0, 6)
        .map(n => ({
          title: n.title,
          publisher: n.publisher,
          link: n.link,
          time: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '',
        }));
    }
  } catch (e) { console.warn('News fetch failed', e); }

  const moreLink = document.getElementById('ss-news-more');
  if (moreLink) {
    moreLink.href = `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/news/`;
    moreLink.style.display = '';
  }

  // Fallback: Google News RSS via proxy when Yahoo returns nothing
  if (!articles.length) {
    try {
      const company = meta?.company || sym;
      const rssUrl = 'https://news.google.com/rss/search?q=' + encodeURIComponent(company + ' stock') + '&hl=en-IN&gl=IN&ceid=IN:en';
      const res2 = await fetch(proxyUrl(rssUrl));
      if (res2.ok) {
        const xml = await res2.text();
        const rssDoc = new DOMParser().parseFromString(xml, 'application/xml');
        rssDoc.querySelectorAll('item').forEach(item => {
          const title = item.querySelector('title')?.textContent?.replace(/<[^>]+>/g,'').trim() || '';
          const link  = item.querySelector('link')?.textContent?.trim() || item.querySelector('guid')?.textContent?.trim() || '';
          const pub   = item.querySelector('pubDate')?.textContent?.trim() || '';
          const src   = item.querySelector('source')?.textContent?.trim() || 'Google News';
          if (title && link) articles.push({ title, link, publisher: src,
            time: pub ? new Date(pub).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '' });
        });
        articles = articles.slice(0, 6);
      }
    } catch(_) {}
  }

  if (!articles.length) {
    grid.innerHTML = `<div style="color:var(--text3);font-size:13px;padding:0.5rem 0;">
      No news found. &nbsp;
      <a href="https://finance.yahoo.com/quote/${ticker}/news/" target="_blank" style="color:var(--accent2);">Yahoo Finance ↗</a> ·
      <a href="https://economictimes.indiatimes.com/markets/stocks/news" target="_blank" style="color:var(--accent2);">Economic Times ↗</a>
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

// ── AI — Groq (primary) + Ollama fallback ─────────────────────────────────
// Key resolution order:
//   1. sessionStorage (user pasted via ⚙ API Key UI — works in any deployment)
//   2. window.__GROQ_KEY (set in a non-committed local config.js for dev)
//   3. Vercel build-time injection — add to vite.config.js:
//        define: { __GROQ_KEY: JSON.stringify(process.env.VITE_GROQ_API_KEY||'') }
//      and add VITE_GROQ_API_KEY to Vercel env vars + GitHub Actions secrets.
function getGroqKey() {
  const session = sessionStorage.getItem('groq_api_key');
  if (session) return session;
  if (window.__GROQ_KEY) return window.__GROQ_KEY;
  // Safe build-time constant check — only works if bundler injects it
  try {
    // eslint-disable-next-line no-undef
    if (typeof __GROQ_KEY !== 'undefined' && __GROQ_KEY) return __GROQ_KEY;
  } catch(_) {}
  return null;
}

async function callFreeAI(prompt) {
  const key = getGroqKey();

  // ── Primary: Groq ────────────────────────────────
  if (key) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          max_tokens: 512,
          temperature: 0.4,
          messages: [
            { role: 'system', content: 'You are a concise Indian stock market analyst. Reply in 4-5 bullet points. No disclaimers, no preamble.' },
            { role: 'user',   content: prompt.slice(0, 1500) },
          ],
        }),
      });
      clearTimeout(t);
      if (res.ok) {
        const d = await res.json();
        const txt = d?.choices?.[0]?.message?.content?.trim();
        if (txt && txt.length > 20) return txt;
      } else {
        const err = await res.json().catch(() => ({}));
        console.warn('Groq API error:', res.status, err?.error?.message);
        throw new Error('Groq error ' + res.status + ': ' + (err?.error?.message || 'unknown'));
      }
    } catch (e) {
      if (e.message.startsWith('Groq error')) throw e;
      console.warn('Groq fetch failed:', e.message);
    }
  }

  // ── Fallback: Ollama local ───────────────────────
  for (const model of ['llama3.2', 'mistral', 'phi3']) {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: prompt.slice(0, 800), stream: false }),
      });
      if (res.ok) { const d = await res.json(); if (d?.response?.trim().length > 20) return d.response.trim(); }
    } catch(_) {}
  }

  if (!key) {
    throw new Error('No Groq API key found. Click ⚙ API Key above to paste your free key from console.groq.com');
  }
  throw new Error('AI unavailable. Check your Groq API key or try again.');
}

// ── Runtime key setter (called from screener.html ⚙ button) ──
window._setGroqKey = function(key) {
  if (!key?.trim()) return;
  sessionStorage.setItem('groq_api_key', key.trim());
  showToast('Groq API key saved for this session ✓');
  // Update the model tag to show key is active
  const tag = document.getElementById('ai-model-tag');
  if (tag) tag.textContent = 'Groq · Llama 3 · Key active ✓';
};

async function loadFilings(ticker, meta) {
  const grid = document.getElementById('ss-filings-grid');
  if (!grid) return;

  const sym = ticker.replace(/\.(NS|BO)$/i, '').replace(/-SM$/, '');
  const bseCode = meta?.bseCode || null;
  const exchange = meta?.exchange || '';
  const isBseOnly = /\.BO$/i.test(ticker) || exchange === 'BSE';
  const isNseOnly = /\.NS$/i.test(ticker) || exchange === 'NSE' || exchange === 'NSE-SME';
  
  let filings = [];

  // 1. Annual Report PDFs — parsed from Screener HTML by api.js
  if (_fundData?.annualReports?.length) {
    _fundData.annualReports.forEach(ar => {
      filings.push({ exchange: 'AR', title: ar.label, date: ar.label.match(/20\d{2}/)?.[0] || '',
        type: 'Annual Report', link: ar.url, isPdf: ar.url.includes('.pdf') });
    });
  }

  // 2. Concall Transcript PDFs — parsed from Screener HTML by api.js
  if (_fundData?.concalls?.length) {
    _fundData.concalls.slice(0, 6).forEach(cc => {
      filings.push({ exchange: 'CC',
        title: (cc.label || 'Concall') + (cc.date ? '  ·  ' + cc.date : ''),
        date: cc.date || '', type: 'Concall', link: cc.url, isPdf: cc.isPdf });
    });
  }

  // 3. Quarterly result PDFs scraped from Screener quarters section
  if (_fundData?.quarterlyPdfs?.length) {
    _fundData.quarterlyPdfs.slice(0, 6).forEach(q => {
      filings.push({ exchange: bseCode ? 'BSE' : 'NSE',
        title: (q.label || 'Quarterly Result') + (q.date ? '  ·  ' + q.date : ''),
        date: q.date, type: 'Results', link: q.url, isPdf: true });
    });
  } else if (_fundData?.quarterly?.rows?.length) {
    // Fallback: show figures from data even if no PDF link
    const headers = (_fundData.quarterly.headers || []).slice(1);
    const salesRow = _fundData.quarterly.rows.find(r => /sales|revenue/i.test(r.label));
    const patRow   = _fundData.quarterly.rows.find(r => /net profit/i.test(r.label));
    headers.slice(0, 4).forEach((period, i) => {
      const parts = [];
      if (salesRow?.values?.[i]) parts.push('Rev ₹' + salesRow.values[i] + ' Cr');
      if (patRow?.values?.[i])   parts.push('PAT ₹' + patRow.values[i] + ' Cr');
      filings.push({ exchange: bseCode ? 'BSE' : 'NSE',
        title: period + (parts.length ? '  —  ' + parts.join('  ·  ') : ''),
        date: period, type: 'Results',
        link: _fundData._url || ('https://www.screener.in/company/' + sym + '/'),
        isPdf: false });
    });
  }

  // 4. Direct exchange links — always useful as reference
  const slug = ((_meta?.company || sym).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));

  const isNseSme = meta?.exchange === 'NSE-SME';

  // BSE link (unchanged)
  if (bseCode) {
    filings.push({
      exchange: 'BSE',
      title: 'BSE Filings Page',
      date: '',
      type: '',
      link: 'https://www.bseindia.com/corporates/ann.html?scrip=' + bseCode + '&type=0',
      isPdf: false
    });
  }

  // NSE link (conditional)
  let nseLink = 'https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol=' + encodeURIComponent(sym);

  if (isNseSme) {
    nseLink += '&tabIndex=sme';
  }

  filings.push({
    exchange: 'NSE',
    title: 'NSE Filings Page',
    date: '',
    type: '',
    link: nseLink,
    isPdf: false
  });

  // limit
  filings = filings.slice(0, 15);

  // Badge color map
  const badgeColor = { 'AR': '#7c3aed', 'CC': '#0891b2', 'BSE': '#b45309', 'NSE': '#1d4ed8' };

  // Build a human-readable label — Screener often gives "Result Raw PDF - Raw PDF"
  // The useful info is in f.date (quarter/period) and f.type
  function buildFilingLabel(f) {
    // Exchange page links — already have good titles
    if (!f.isPdf) return f.title || 'View Filings';

    // For PDFs: prefer date + type combo over raw Screener title
    if (f.date && f.type) return `${f.type} · ${f.date}`;
    if (f.date) return f.date;

    // Clean up raw Screener title as last resort
    const cleaned = (f.title || '')
      .replace(/\bRaw PDF\b\s*[-–·]\s*/gi, '')
      .replace(/\bRaw PDF\b/gi, '')
      .replace(/^\s*[-–·\s]+|[-–·\s]+\s*$/g, '')
      .trim();
    return cleaned || (f.type || 'Filing');
  }

  const pdfIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.65;flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;

  grid.innerHTML = filings.map((f, idx) => {
    const label = buildFilingLabel(f);
    const isNavLink = !f.isPdf;
    const linkContent = isNavLink ? 'View ↗' : `<span style="display:flex;align-items:center;gap:4px;">${pdfIcon} PDF</span>`;

    return (
      '<div class="filing-item" id="filing-' + idx + '">' +
      '<span class="filing-exchange" style="background:' + (badgeColor[f.exchange] || '#374151') + ';color:#fff;font-size:10px;padding:2px 7px;border-radius:4px;white-space:nowrap;flex-shrink:0;">' + f.exchange + '</span>' +
      '<div class="filing-body">' +
      '<div class="filing-title" title="' + label + '">' + label + '</div>' +
      (f.type && f.isPdf && !f.date ? '<div class="filing-meta">' + f.type + '</div>' : '') +
      '</div>' +
      '<a class="filing-link" href="' + f.link + '" target="_blank" rel="noopener">' + linkContent + '</a>' +
      '</div>'
    );
  }).join('');

  window._currentFilings = filings;
}

// ── Conference Calls ──────────────────────────────
async function loadConcalls(ticker, meta, fundData) {
  const grid = document.getElementById('ss-concalls-grid');
  if (!grid) return;

  const sym = ticker.replace(/\.(NS|BO)$/i, '').replace(/-SM$/, '');

  // Use already-scraped fundData (passed in after parallel fetches complete)
  // rather than re-fetching Screener. Falls back to a direct parse if empty.
  let concalls = [];

  const source = fundData || _fundData;

  if (source?.concalls?.length) {
    concalls = source.concalls.map(cc => {
      let label = (cc.label || '').trim();
      // PPT → Investor Presentation
      label = label.replace(/\bPPT\b/gi, 'Investor Presentation');
      // If label is just a generic word with no detail, replace
      if (/^(transcript|concall|raw transcript)$/i.test(label)) label = '';

      const dateMatch = label.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+20\d{2}/i);
      const dateStr = cc.date || (dateMatch ? dateMatch[0] : '');

      if (!label || label === dateStr) {
        label = (cc.url || '').toLowerCase().includes('ppt') ? 'Investor Presentation' : 'Earnings Call Transcript';
      }
      return { label, date: dateStr, url: cc.url, isPdf: cc.isPdf };
    });
  }

  // Fallback: direct Screener parse only if we got nothing from fundData
  if (!concalls.length) {
    try {
      const res = await fetch(proxyUrl(`https://www.screener.in/company/${sym}/`));
      if (res.ok) {
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        ['#concalls a[href]', '#investor-presentations a[href]', 'a.concall-link[href]'].forEach(sel => {
          doc.querySelectorAll(sel).forEach(a => {
            const href = a.getAttribute('href') || '';
            if (!href || href === '#') return;
            const url = href.startsWith('http') ? href : 'https://www.screener.in/' + href.replace(/^\//, '');
            const rawLabel = (a.textContent.trim() || a.title || '').replace(/\bPPT\b/gi, 'Investor Presentation');
            const dateMatch = rawLabel.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+20\d{2}/i);
            const label = rawLabel || (url.includes('ppt') ? 'Investor Presentation' : 'Earnings Call Transcript');
            concalls.push({ label, date: dateMatch ? dateMatch[0] : '', url, isPdf: url.includes('.pdf') || href.includes('source') });
          });
        });
      }
    } catch (e) { console.warn('Concalls fallback fetch failed', e); }
  }

  if (!concalls.length) {
    grid.innerHTML = `<div style="color:var(--text3);font-size:13px;padding:0.5rem 0;">
      No conference call transcripts found. <a href="https://www.screener.in/company/${sym}/" target="_blank" style="color:var(--accent2);">Check Screener.in ↗</a>
    </div>`;
    return;
  }

  // Sort latest first; undated at the bottom
  concalls.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date) - new Date(a.date);
  });

  const micSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;flex-shrink:0"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>`;
  const docSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.65"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

  grid.innerHTML = concalls.slice(0, 8).map(c =>
    '<div class="filing-item">' +
    micSvg +
    '<div class="filing-body">' +
    '<div class="filing-title">' + c.label + '</div>' +
    (c.date ? '<div class="filing-meta">' + c.date + '</div>' : '') +
    '</div>' +
    '<a class="filing-link" href="' + c.url + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:4px;">' + docSvg + ' Transcript</a>' +
    '</div>'
  ).join('');
}

// ── AI Insights ───────────────────────────────────
window.analyzeFilingWithAI = async function(filingIdx, pdfLink, exchange) {
  const filing = window._currentFilings?.[filingIdx];
  if (!filing) return;
  
  const filingEl = document.getElementById('filing-' + filingIdx);
  if (!filingEl) return;
  
  // Create or find analysis container
  let analysisContainer = filingEl.querySelector('.filing-ai-analysis');
  if (!analysisContainer) {
    analysisContainer = document.createElement('div');
    analysisContainer.className = 'filing-ai-analysis';
    analysisContainer.style.cssText = 'grid-column: 1 / -1; margin-top: 0.75rem; padding: 0.75rem; background: rgba(99,102,241,0.05); border: 1px solid rgba(99,102,241,0.2); border-radius: 8px;';
    filingEl.appendChild(analysisContainer);
  }
  
  analysisContainer.innerHTML = '<div class="ai-loading"><div class="spinner"></div><span>Analyzing filing content with AI...</span></div>';
  
  try {
    // For demonstration: since we can't actually scrape PDFs via CORS proxy,
    // we'll use the filing metadata to generate insights
    const company = _meta?.company || _ticker.replace(/\.(NS|BO)$/i, '');
    const filingTitle = filing.title;
    const filingDate = filing.date;
    const filingType = filing.type;
    
    const prompt = `Analyze ${company} filing: ${filingTitle}. Key info, stock impact, investor actions. Brief bullets only.`;

    const text = await callFreeAI(prompt);
    
    // Format the response
    let html = text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^#{1,3} (.+)$/gm, '<strong style="font-size:13px;color:var(--text);">$1</strong>')
      .replace(/^(\d+)\. \*\*(.+?)\*\*/gm, '<br><strong style="color:var(--text);">$1. $2</strong>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul style="margin:0.5rem 0;padding-left:1.2rem;">${m}</ul>`)
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
    
    analysisContainer.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.5rem;">
        <span class="ai-badge">✨ AI Analysis</span>
        <span style="font-size:10px;color:var(--text3);">Powered by Groq · Llama 3</span>
      </div>
      <div style="font-size:12px;color:var(--text2);line-height:1.6;">${html}</div>
      <div style="font-size:10px;color:var(--text3);margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--border);">
        ⚠ AI-generated analysis based on filing metadata. Always read the full filing. Not financial advice.
      </div>`;
  } catch (e) {
    console.error('Filing AI analysis error:', e);
    analysisContainer.innerHTML = `
      <div style="color:var(--red);font-size:12px;margin-bottom:0.5rem;">⚠ Could not generate analysis: ${e.message}</div>
      <div style="font-size:11px;color:var(--text3);">
        The AI service may be temporarily unavailable. Try again in a moment.
      </div>`;
  }
};

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
      Uses Groq + Llama 3 (free tier). Add your key via ⚙ API Key above.
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

  const ratios = 'PE: ' + (_fundData?.peRatio||'?') + ', ROCE: ' + (_fundData?.roce||'?') + ', ROE: ' + (_fundData?.roe||'?') + ', Debt/Eq: ' + (_fundData?.debtEquity||'?');
  const qSummary = (_fundData?.quarterly?.rows||[]).slice(0,3).map(r => r.label + ': ' + r.values.slice(0,3).join(', ')).join('. ');
  const shortAbout = (_fundData?.about||'').slice(0, 150);

  const prompts = {
    filings: 'Tell me about ' + company + ' in 4 bullet points. What does it do, which sector, is it profitable. ' + shortAbout,
    results: 'Summarise the yoy and qoq quarterly results of ' + company + ' in 4 bullet points. Are revenues and profits growing? ' + qSummary,
    ar:      'Summarise the balance sheet health of ' + company + ' in 4 bullet points. Ratios: ' + ratios,
    orders:  'What are the growth prospects, ordebook and risks for ' + company + ' in 4 bullet points.',
  };

  try {
    const text = await callFreeAI(prompts[tab]);
    _aiCache[tab] = text;
    area.innerHTML = formatAIResponse(text);
  } catch (e) {
    console.error('AI error:', e);
    area.innerHTML = `<div style="color:var(--red);font-size:13px;margin-bottom:0.5rem;">⚠ ${e.message}</div>
      <div style="font-size:12px;color:var(--text3);margin-top:0.5rem;">
        Click <strong>⚙ API Key</strong> above to add your free Groq key, or for local AI: install
        <a href="https://ollama.com" target="_blank" style="color:var(--accent2);">Ollama</a>
        and run <code style="background:var(--bg3);padding:2px 6px;border-radius:4px;">ollama pull llama3.2</code>
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
