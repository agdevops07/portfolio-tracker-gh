// ═══════════════════════════════════════════════
// FILE HANDLER
// Drag-drop, file input, CSV parsing, sample data.
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { showToast, showScreen } from './utils.js';
import { fetchPortfolioCSV } from './api.js';
import { showPreview } from './preview.js';

export const SAMPLE_CSV = `ticker,quantity,average_buy_price,buy_date
RELIANCE.NS,10,2400.50,2023-06-01
TCS.NS,5,3800.00,2023-04-15
INFY.NS,20,1500.00,2023-01-10
HDFCBANK.NS,8,1650.00,2023-09-20
WIPRO.NS,25,450.00,2023-07-15
AAPL,15,175.00,2023-03-01`;

// ── Wire up drag-drop & file input ───────────────
export function initFileHandlers() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

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
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });
}

// ── Public entry points ──────────────────────────
export function handleFile(file) {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (r) => processCSV(r.data),
    error: (err) => alert('CSV parse error: ' + err.message),
  });
}

export function loadSampleData() {
  Papa.parse(SAMPLE_CSV, {
    header: true,
    skipEmptyLines: true,
    complete: (r) => processCSV(r.data),
  });
}

export async function loadMyPortfolio() {
  showToast('Loading your portfolio...');
  try {
    const csvText = await fetchPortfolioCSV();
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

// ── Date normalizer — converts any common format to YYYY-MM-DD ──────────────
function normalizeDate(raw) {
  if (!raw) return '';
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // DD-MM-YYYY or DD/MM/YYYY
  const dmY = raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (dmY) return `${dmY[3]}-${dmY[2].padStart(2,'0')}-${dmY[1].padStart(2,'0')}`;
  // MM-DD-YYYY or MM/DD/YYYY (US format — less likely but handle it)
  // Fallback: try native Date parse
  const d = new Date(raw);
  if (!isNaN(d)) return d.toISOString().split('T')[0];
  return raw;
}

// ── CSV processing ───────────────────────────────
export function processCSV(rows) {
  const errDiv = document.getElementById('preview-error');
  errDiv.innerHTML = '';
  const errors = [];
  const clean = [];

  rows.forEach((row, i) => {
    const ticker = (row.ticker || row.Ticker || row.TICKER || '').trim().toUpperCase();
    const qty = parseFloat(row.quantity || row.Quantity || row.qty || 0);
    const avg = parseFloat(
      row.average_buy_price || row.avg_buy_price || row.buyPrice || row.buy_price || 0
    );
    const date = row.buy_date || row.buyDate || row.date || '';
    const upstoxTicker = (row.upstox_ticker || row.upstoxTicker || '').trim().toUpperCase();

    if (!ticker) { errors.push(`Row ${i + 1}: missing ticker`); return; }
    if (!qty || qty <= 0) { errors.push(`Row ${i + 1}: invalid quantity`); return; }

    clean.push({ ticker, qty, avg, date: normalizeDate(date.trim()), upstoxTicker: upstoxTicker || null });
  });

  if (errors.length) {
    errDiv.innerHTML = `<div class="error-box">${errors.join('<br>')}</div>`;
  }
  if (!clean.length) {
    errDiv.innerHTML += `<div class="error-box">No valid rows found.</div>`;
    return;
  }

  state.rawRows = clean;
  state.holdings = aggregateHoldings(clean);
  showPreview();
}

// ── Aggregation ──────────────────────────────────
export function aggregateHoldings(rows) {
  const map = {};

  rows.forEach((r) => {
    if (!map[r.ticker]) {
      map[r.ticker] = {
        ticker: r.ticker,
        totalQty: 0,
        totalCost: 0,
        dates: [],
        upstoxTicker: r.upstoxTicker || null,
      };
    }
    map[r.ticker].totalQty += r.qty;
    map[r.ticker].totalCost += r.qty * r.avg;
    if (r.date) map[r.ticker].dates.push(r.date);
  });

  Object.values(map).forEach((h) => {
    h.avgBuy = h.totalCost / h.totalQty;
    h.invested = h.totalCost;
    h.earliestDate = h.dates.length ? h.dates.sort()[0] : null;
  });

  return map;
}
