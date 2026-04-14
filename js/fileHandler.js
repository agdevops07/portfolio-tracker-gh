// ═══════════════════════════════════════════════
// FILE HANDLER
// Drag-drop, file input, CSV parsing, sample data.
// ═══════════════════════════════════════════════

import { state, resetAllCaches } from './state.js';
import { showToast, showScreen } from './utils.js';
import { fetchPortfolioCSV } from './api.js';
import { showPreview } from './preview.js';

// ── Clear all portfolio state before loading new data ──
function clearPortfolioState() {
  if (typeof window._stopAutoRefresh === 'function') window._stopAutoRefresh();
  if (typeof window._destroyAllCharts === 'function') window._destroyAllCharts();
  if (typeof window._clearNoPortMsgs === 'function') window._clearNoPortMsgs();
  resetAllCaches();
  state.rawRows             = [];
  state.holdings            = {};
  state.allHoldings         = {};
  state.users               = [];
  state.activeUser          = 'all';
  state.portfolioTimeSeries = [];
  state.fullTimeSeries      = [];
  state.histories           = {};
  state.dayHistories        = {};
  state.currentFilter       = '1Y';
  state.refreshPaused       = false;
  if (state.refreshIntervalId) {
    clearInterval(state.refreshIntervalId);
    state.refreshIntervalId = null;
  }
}

export const SAMPLE_CSV = `ticker,quantity,average_buy_price,buy_date,user
RELIANCE.NS,10,2400.50,2023-06-01,User 1
TCS.NS,5,3800.00,2023-04-15,User 1
INFY.NS,20,1500.00,2023-01-10,User 2
HDFCBANK.NS,8,1650.00,2023-09-20,User 2
WIPRO.NS,25,450.00,2023-07-15,User 1
AAPL,15,175.00,2023-03-01,User 1`;

// ── Wire up drag-drop & file input ───────────────
export function initFileHandlers() {
  if (!window._stocksDb) {
    const base = document.location.pathname.replace(/\/[^/]*$/, '') || '';
    fetch(base + '/data/stocks_db.json')
      .then(r => r.json())
      .then(db => { window._stocksDb = db; })
      .catch(() => console.warn('Could not load stocks_db.json'));
  }

  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
  }
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });
  }
}

// ── Public entry points ──────────────────────────
export function handleFile(file) {
  clearPortfolioState();
  const reader = new FileReader();
  reader.onload = (ev) => {
    const csvText = ev.target.result;
    try { sessionStorage.setItem('portfolio_csv', csvText); } catch(_e) {}
    Papa.parse(csvText, {
      header: true, skipEmptyLines: true,
      complete: (r) => processCSV(r.data),
      error: (err) => alert('CSV parse error: ' + err.message),
    });
  };
  reader.readAsText(file);
}

export function loadSampleData() {
  clearPortfolioState();
  try { sessionStorage.setItem('portfolio_csv', SAMPLE_CSV); } catch(_e) {}
  Papa.parse(SAMPLE_CSV, {
    header: true,
    skipEmptyLines: true,
    complete: (r) => processCSV(r.data),
  });
}

export async function loadMyPortfolio() {
  clearPortfolioState();
  showToast('Loading your portfolio...');
  try {
    const csvText = await fetchPortfolioCSV();
    try { sessionStorage.setItem('portfolio_csv', csvText); } catch(_e) {}
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (r) => processCSV(r.data),
    });
  } catch (err) {
    alert('Failed to load portfolio file. Make sure data/my_portfolio.csv exists in the repo.');
    console.error(err);
  }
}

// ── Date normalizer ──────────────────────────────
function normalizeDate(raw) {
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dmY = raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (dmY) return `${dmY[3]}-${dmY[2].padStart(2,'0')}-${dmY[1].padStart(2,'0')}`;
  const d = new Date(raw);
  if (!isNaN(d)) return d.toISOString().split('T')[0];
  return raw;
}

// ── Helper to lookup ISIN from ticker ──
async function lookupISIN(ticker) {
  if (!window._stocksDb) {
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (window._stocksDb) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 5000);
    });
  }
  
  if (!window._stocksDb) return null;
  
  let entry = window._stocksDb.find(s => 
    s.yahooTicker && s.yahooTicker.toUpperCase() === ticker.toUpperCase()
  );
  
  if (!entry) {
    let searchSymbol = ticker.replace(/\.(NS|BO)$/i, '').toUpperCase();
    searchSymbol = searchSymbol.replace(/-SM$/i, '');
    entry = window._stocksDb.find(s => 
      s.symbol && s.symbol.toUpperCase() === searchSymbol
    );
  }
  
  if (!entry) {
    const baseTicker = ticker.replace(/-SM\.NS$/i, '.NS');
    entry = window._stocksDb.find(s => 
      s.yahooTicker && s.yahooTicker.toUpperCase() === baseTicker.toUpperCase()
    );
  }
  
  return entry?.isin || null;
}

// ── CSV processing ───────────────────────────────
export async function processCSV(rows) {
  const errDiv = document.getElementById('preview-error');
  if (errDiv) errDiv.innerHTML = '';
  const errors = [];
  const clean = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const ticker = (row.ticker || row.Ticker || row.TICKER || '').trim().toUpperCase();
    const qty = parseFloat(row.quantity || row.Quantity || row.qty || 0);
    const avg = parseFloat(
      row.average_buy_price || row.avg_buy_price || row.buyPrice || row.buy_price || 0
    );
    const date = row.buy_date || row.buyDate || row.date || '';
    
    let upstoxTicker = (row.upstox_ticker || row.upstoxTicker || '').trim().toUpperCase();
    
    if (!upstoxTicker && ticker) {
      upstoxTicker = await lookupISIN(ticker);
    }

    const rawUser = (row.user || row.User || row.USER || '').trim();
    const user = rawUser || 'User 1';

    if (!ticker) { errors.push(`Row ${i + 1}: missing ticker`); continue; }
    if (!qty || qty <= 0) { errors.push(`Row ${i + 1}: invalid quantity`); continue; }
    
    clean.push({ 
      ticker, qty, avg, 
      date: normalizeDate(date.trim()), 
      upstoxTicker: upstoxTicker || null,
      user 
    });
  }

  if (errors.length && errDiv) {
    errDiv.innerHTML = `<div class="error-box">${errors.join('<br>')}</div>`;
  }
  if (!clean.length) {
    const detail = errors.length
      ? errors.join('\n')
      : 'Make sure your CSV has ticker, quantity and average_buy_price columns with at least one valid row.';
    if (typeof window.showUploadError === 'function') {
      window.showUploadError(detail, 'No valid holdings found');
    } else {
      alert(detail);
    }
    return;
  }

  state.rawRows = clean;

  const userSet = [];
  clean.forEach(r => { if (!userSet.includes(r.user)) userSet.push(r.user); });
  state.users = userSet;
  state.activeUser = 'all';

  state.allHoldings = aggregateHoldings(clean);
  state.holdings = state.allHoldings;

  if (!sessionStorage.getItem('portfolio_csv')) {
    try {
      const reconstructed = [
        'ticker,quantity,average_buy_price,buy_date,upstox_ticker,user',
        ...clean.map(r => `${r.ticker},${r.qty},${r.avg},${r.date || ''},${r.upstoxTicker || ''},${r.user}`)
      ].join('\n');
      sessionStorage.setItem('portfolio_csv', reconstructed);
    } catch (_e) {}
  }

  showPreview();
}

// ── Aggregation ──────────────────────────────────
export function aggregateHoldings(rows) {
  const map = {};

  rows.forEach((r) => {
    const key = r.ticker;
    if (!map[key]) {
      map[key] = {
        ticker: r.ticker,
        totalQty: 0,
        totalCost: 0,
        dates: [],
        upstoxTicker: r.upstoxTicker || null,
        users: [],
      };
    } else if (r.upstoxTicker && !map[key].upstoxTicker) {
      map[key].upstoxTicker = r.upstoxTicker;
    }
    map[key].totalQty += r.qty;
    map[key].totalCost += r.qty * r.avg;
    if (r.date) map[key].dates.push(r.date);
    if (r.user && !map[key].users.includes(r.user)) map[key].users.push(r.user);
  });

  Object.values(map).forEach((h) => {
    h.avgBuy = h.totalCost / h.totalQty;
    h.invested = h.totalCost;
    h.earliestDate = h.dates.length ? h.dates.sort()[0] : null;
  });

  return map;
}

export function getFilteredHoldings(rawRows, user) {
  if (!user || user === 'all') return aggregateHoldings(rawRows);
  return aggregateHoldings(rawRows.filter(r => r.user === user));
}