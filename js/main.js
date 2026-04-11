// ═══════════════════════════════════════════════
// MAIN — Bootstrap + holdings modal logic
// ═══════════════════════════════════════════════

import { initFileHandlers, loadSampleData, loadMyPortfolio, processCSV } from './fileHandler.js';
import { openStockPicker, closeStockPicker } from './stockPicker.js';
import { sortPreview } from './preview.js';
import { loadDashboard, refreshDashboard, refreshPricesOnly, toggleRefreshPause, setRefreshInterval } from './dashboard.js';
import { setTimeFilter } from './charts.js';
import { goBack, showDashboard } from './utils.js';
import { exportChart, exportPDF, toggleExportMenu } from './export.js';
import { openDrilldown } from './drilldown.js';
import { state } from './state.js';
import { fmt, pct, colorPnl } from './utils.js';
import { COLORS } from './charts.js';

// Expose globals immediately so inline onclick attrs work
window.openStockPicker     = openStockPicker;
window.closeStockPicker    = closeStockPicker;
window.loadSampleData      = loadSampleData;
window.loadMyPortfolio     = loadMyPortfolio;
window.loadDashboard       = loadDashboard;
window.refreshDashboard    = refreshDashboard;
window.refreshPricesOnly   = refreshPricesOnly;
window.toggleRefreshPause  = toggleRefreshPause;
window.setRefreshInterval  = setRefreshInterval;
window.goBack              = goBack;
window.showDashboard       = showDashboard;
window.sortPreview         = sortPreview;
window.setTimeFilter       = setTimeFilter;
window.exportChart         = exportChart;
window.exportPDF           = exportPDF;
window.toggleExportMenu    = toggleExportMenu;
window.openDrilldown       = openDrilldown;
window.openHoldingsModal   = openHoldingsModal;
window.closeHoldingsModal  = closeHoldingsModal;
window.sortHoldingsModal   = sortHoldingsModal;
window.toggleCsvTextInput  = toggleCsvTextInput;
window.loadFromTextInput   = loadFromTextInput;

document.addEventListener('DOMContentLoaded', () => {
  initFileHandlers();

  // Wire upload screen buttons (IDs changed for semantic markup)
  const browseBtn = document.getElementById('browse-btn');
  const demoBtn   = document.getElementById('demo-btn');
  if (browseBtn) browseBtn.addEventListener('click', () => document.getElementById('file-input').click());
  if (demoBtn)   demoBtn.addEventListener('click', () => loadMyPortfolio());

  // Premium drag-drop visual feedback
  const dz = document.getElementById('drop-zone');
  if (dz) {
    ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag-over'); }));
    ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('drag-over')));

    // Button click animation
    dz.querySelectorAll('.btn').forEach(btn => {
      btn.addEventListener('mousedown', () => btn.classList.add('btn-press'));
      btn.addEventListener('mouseup',   () => btn.classList.remove('btn-press'));
      btn.addEventListener('mouseleave',() => btn.classList.remove('btn-press'));
    });
  }
});

// ── Feature 3: Paste CSV text input ─────────────
export function toggleCsvTextInput() {
  const wrap = document.getElementById('csv-text-wrap');
  wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
}

export function loadFromTextInput() {
  const text = document.getElementById('csv-text-input').value.trim();
  if (!text) { alert('Please paste some CSV data first.'); return; }
  Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    complete: (r) => processCSV(r.data),
    error: (err) => alert('CSV parse error: ' + err.message),
  });
}

// ── Holdings Modal sort state ────────────────────
const modalSort = { key: 'currentVal', asc: false };

// ── Feature 1: Sort holdings modal by column ─────
export function sortHoldingsModal(key) {
  if (modalSort.key === key) {
    modalSort.asc = !modalSort.asc;
  } else {
    modalSort.key = key;
    modalSort.asc = false;
  }
  renderHoldingsTable();
}

// ── Holdings Full-Screen Modal ───────────────────
export function openHoldingsModal() {
  document.getElementById('holdings-modal').style.display = 'flex';
  renderHoldingsTable();
}

export function closeHoldingsModal() {
  document.getElementById('holdings-modal').style.display = 'none';
}

function computeRow(h, totalCurrent, i) {
  const lp        = state.livePrices[h.ticker];
  const pc        = state.prevClosePrices[h.ticker];
  const currentVal = lp ? lp * h.totalQty : null;
  const pnlAbs    = currentVal != null ? currentVal - h.invested : null;
  const pnlPct    = pnlAbs != null ? (pnlAbs / h.invested) * 100 : null;
  const allocPct  = totalCurrent && currentVal ? (currentVal / totalCurrent) * 100 : null;
  const dayChgAbs = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;
  const dayChgPct = (lp && pc && pc > 0) ? ((lp - pc) / pc) * 100 : null;
  return { h, lp, pc, currentVal, pnlAbs, pnlPct, allocPct, dayChgAbs, dayChgPct,
           color: COLORS[i % COLORS.length] };
}

function renderHoldingsTable() {
  const holdings = Object.values(state.holdings);
  let totalCurrent = 0;
  holdings.forEach((h) => {
    const lp = state.livePrices[h.ticker];
    if (lp) totalCurrent += lp * h.totalQty;
  });

  // Compute all derived values first so we can sort on them
  const rows = holdings.map((h, i) => computeRow(h, totalCurrent, i));

  // Sort
  rows.sort((a, b) => {
    let va, vb;
    switch (modalSort.key) {
      case 'ticker':     va = a.h.ticker;    vb = b.h.ticker;    break;
      case 'totalQty':   va = a.h.totalQty;  vb = b.h.totalQty;  break;
      case 'avgBuy':     va = a.h.avgBuy;    vb = b.h.avgBuy;    break;
      case 'livePrice':  va = a.lp ?? -Infinity;  vb = b.lp ?? -Infinity; break;
      case 'prevClose':  va = a.pc ?? -Infinity;  vb = b.pc ?? -Infinity; break;
      case 'invested':   va = a.h.invested;  vb = b.h.invested;  break;
      case 'currentVal': va = a.currentVal ?? -Infinity; vb = b.currentVal ?? -Infinity; break;
      case 'pnlAbs':     va = a.pnlAbs ?? -Infinity;    vb = b.pnlAbs ?? -Infinity;    break;
      case 'pnlPct':     va = a.pnlPct ?? -Infinity;    vb = b.pnlPct ?? -Infinity;    break;
      case 'dayChgAbs':  va = a.dayChgAbs ?? -Infinity; vb = b.dayChgAbs ?? -Infinity; break;
      case 'dayChgPct':  va = a.dayChgPct ?? -Infinity; vb = b.dayChgPct ?? -Infinity; break;
      case 'allocPct':   va = a.allocPct ?? -Infinity;  vb = b.allocPct ?? -Infinity;  break;
      default:            va = a.currentVal ?? -Infinity; vb = b.currentVal ?? -Infinity;
    }
    if (typeof va === 'string') return modalSort.asc ? va.localeCompare(vb) : vb.localeCompare(va);
    return modalSort.asc ? va - vb : vb - va;
  });

  // Update sort indicators on headers
  document.querySelectorAll('.sortable-th').forEach(th => {
    const key = th.id.replace('mth-', '');
    const base = th.textContent.replace(/ [↑↓]$/, '');
    th.textContent = key === modalSort.key ? base + (modalSort.asc ? ' ↑' : ' ↓') : base;
  });

  const tbody = document.getElementById('holdings-modal-tbody');
  tbody.innerHTML = '';

  rows.forEach(({ h, lp, pc, currentVal, pnlAbs, pnlPct, allocPct, dayChgAbs, dayChgPct, color }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></div>
          <strong>${h.ticker}</strong>
        </div>
      </td>
      <td>${h.totalQty}</td>
      <td>${h.avgBuy.toFixed(2)}</td>
      <td>${lp ? lp.toFixed(2) : '—'}</td>
      <td style="color:var(--text2)">${pc ? pc.toFixed(2) : '—'}</td>
      <td>${fmt(h.invested)}</td>
      <td>${currentVal ? fmt(currentVal) : '—'}</td>
      <td style="color:${pnlAbs != null ? colorPnl(pnlAbs) : 'var(--text2)'}">
        ${pnlAbs != null ? (pnlAbs >= 0 ? '+' : '') + fmt(Math.abs(pnlAbs)) : '—'}
      </td>
      <td style="color:${pnlPct != null ? colorPnl(pnlPct) : 'var(--text2)'}">
        ${pnlPct != null ? pct(pnlPct) : '—'}
      </td>
      <td style="color:${dayChgAbs != null ? colorPnl(dayChgAbs) : 'var(--text2)'}">
        ${dayChgAbs != null ? (dayChgAbs >= 0 ? '+' : '') + fmt(Math.abs(dayChgAbs)) : '—'}
      </td>
      <td style="color:${dayChgPct != null ? colorPnl(dayChgPct) : 'var(--text2)'}">
        ${dayChgPct != null ? pct(dayChgPct) : '—'}
      </td>
      <td>${allocPct != null ? allocPct.toFixed(1) + '%' : '—'}</td>
    `;
    tr.style.cursor = 'pointer';
    tr.title = 'Click to view stock detail';
    tr.onclick = () => {
      closeHoldingsModal();
      import('./drilldown.js').then((m) => m.openDrilldown(h.ticker));
    };
    tbody.appendChild(tr);
  });
}

// ── Dashboard tabs ─────────────────────────────
window.switchDashTab = function(tab, btn) {
  document.querySelectorAll('.dash-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('dash-tab-overview').style.display  = tab === 'overview'  ? '' : 'none';
  document.getElementById('dash-tab-holdings').style.display  = tab === 'holdings'  ? '' : 'none';
};
