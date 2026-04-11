// ═══════════════════════════════════════════════
// PREVIEW
// Preview table rendering + column sorting.
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { showScreen } from './utils.js';

const COLUMN_LABELS = {
  ticker: 'Ticker',
  upstoxTicker: 'ISIN',
  totalQty: 'Qty',
  avgBuy: 'Avg Buy Price',
  invested: 'Invested',
  earliestDate: 'Buy Date',
};

// ── Public ───────────────────────────────────────
export function showPreview() {
  const holdings = getSortedHoldings();
  renderRows(holdings);
  updateSortIndicators();

  const totalInvested = holdings.reduce((s, h) => s + h.invested, 0);
  document.getElementById('preview-summary').textContent =
    `${holdings.length} stocks · Total invested: ₹${totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  showScreen('preview-screen');
}

export function sortPreview(key) {
  if (state.previewSort.key === key) {
    state.previewSort.asc = !state.previewSort.asc;
  } else {
    state.previewSort.key = key;
    state.previewSort.asc = true;
  }

  renderRows(getSortedHoldings());
  updateSortIndicators();
}

// ── Sorting ──────────────────────────────────────
function getSortedHoldings() {
  return sortHoldings(Object.values(state.holdings));
}

export function sortHoldings(holdings) {
  const { key, asc } = state.previewSort;

  return [...holdings].sort((a, b) => {
    const valA = a[key];
    const valB = b[key];

    if (valA == null) return 1;
    if (valB == null) return -1;

    if (typeof valA === 'number') {
      return asc ? valA - valB : valB - valA;
    }
    if (key === 'earliestDate') {
      return asc ? new Date(valA) - new Date(valB) : new Date(valB) - new Date(valA);
    }
    return asc
      ? valA.toString().localeCompare(valB.toString())
      : valB.toString().localeCompare(valA.toString());
  });
}

// ── Rendering ────────────────────────────────────
function renderRows(holdings) {
  const tbody = document.querySelector('#preview-table tbody');
  tbody.innerHTML = '';

  holdings.forEach((h, index) => {
    const tr = document.createElement('tr');
    if (index < 3) tr.style.background = 'rgba(99,102,241,0.08)';

    tr.innerHTML = `
      <td><strong>${h.ticker}</strong></td>
      <td>${h.upstoxTicker ? h.upstoxTicker : '—'}</td>
      <td>${h.totalQty}</td>
      <td>${h.avgBuy.toFixed(2)}</td>
      <td>${h.invested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
      <td>${h.earliestDate || '—'}</td>`;

    tbody.appendChild(tr);
  });
}

function updateSortIndicators() {
  Object.keys(COLUMN_LABELS).forEach((col) => {
    const th = document.getElementById(`th-${col}`);
    if (!th) return;
    th.innerHTML =
      state.previewSort.key === col
        ? `${COLUMN_LABELS[col]} ${state.previewSort.asc ? '↑' : '↓'}`
        : COLUMN_LABELS[col];
  });
}
