// ═══════════════════════════════════════════════
// DASHBOARD-MAIN — Entry point for dashboard.html
// Reads portfolio CSV from sessionStorage, processes
// it, and boots the dashboard.
// ═══════════════════════════════════════════════

import { openStockPicker, closeStockPicker } from './stockPicker.js';
import { loadDashboard, refreshDashboard, refreshPricesOnly, toggleRefreshPause, setRefreshInterval, stopAutoRefresh, renderDashboard } from './dashboard.js';
import { setTimeFilter } from './charts.js';
import { showDashboard } from './utils.js';
import { exportHoldingsCSV, exportPDF, toggleExportMenu } from './export.js';
import { openDrilldown } from './drilldown.js';
import { state } from './state.js';
import { processCSV } from './fileHandler.js';
import { fmt, pct, colorPnl } from './utils.js';
import { COLORS, destroyAllCharts } from './charts.js';

// Expose globals
window.openStockPicker    = openStockPicker;
window.closeStockPicker   = closeStockPicker;
window.loadDashboard      = loadDashboard;
window.refreshDashboard   = refreshDashboard;
window.refreshPricesOnly  = refreshPricesOnly;
window.toggleRefreshPause = toggleRefreshPause;
window.setRefreshInterval = setRefreshInterval;
window.showDashboard      = showDashboard;
window.setTimeFilter      = setTimeFilter;
window.exportHoldingsCSV  = exportHoldingsCSV;
window.exportPDF          = exportPDF;
window.toggleExportMenu   = toggleExportMenu;
window.openDrilldown      = openDrilldown;
window.openHoldingsModal  = openHoldingsModal;
window.closeHoldingsModal = closeHoldingsModal;
window.sortHoldingsModal  = sortHoldingsModal;
window._destroyAllCharts  = destroyAllCharts;
window._stopAutoRefresh   = stopAutoRefresh;

window.switchDashTab = function(tab, btn) {
  document.querySelectorAll('.dash-tab').forEach(b => b.classList.toggle('active', b.dataset && b.dataset.tab === tab));
  const ov = document.getElementById('dash-tab-overview');
  const ho = document.getElementById('dash-tab-holdings');
  if (ov) ov.style.display = tab === 'overview' ? '' : 'none';
  if (ho) ho.style.display = tab === 'holdings' ? '' : 'none';
};

// ── Boot ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  let csv = sessionStorage.getItem('portfolio_csv');

  if (!csv) {
    // No CSV in session — but the stock-picker flow populates state.holdings
    // directly without writing to sessionStorage.  Reconstruct a CSV from
    // whatever holdings are already in state so we don't bounce back to upload.
    const holdingValues = Object.values(state.holdings);
    if (holdingValues.length > 0) {
      const rows = holdingValues.map(h =>
        `${h.ticker},${h.totalQty},${h.avgBuy.toFixed(4)},${h.earliestDate || ''},${h.upstoxTicker || ''}`
      );
      csv = 'ticker,quantity,average_buy_price,buy_date,upstox_ticker\n' + rows.join('\n');
      try { sessionStorage.setItem('portfolio_csv', csv); } catch (_e) {}
    } else {
      // Truly nothing loaded — redirect to upload
      window.location.href = 'index.html';
      return;
    }
  }

  // Parse CSV and boot dashboard
  await new Promise(resolve => {
    Papa.parse(csv, {
      header: true,
      skipEmptyLines: true,
      complete: async (r) => {
        processCSV(r.data);
        resolve();
      },
    });
  });

  await loadDashboard();
});

// ── Holdings Modal ────────────────────────────────
const modalSort = { key: 'currentVal', asc: false };

export function sortHoldingsModal(key) {
  if (modalSort.key === key) { modalSort.asc = !modalSort.asc; } else { modalSort.key = key; modalSort.asc = false; }
  renderHoldingsTable();
}

export function openHoldingsModal() {
  document.getElementById('holdings-modal').style.display = 'flex';
  renderHoldingsTable();
}

export function closeHoldingsModal() {
  document.getElementById('holdings-modal').style.display = 'none';
}

function computeRow(h, totalCurrent, i) {
  const lp = state.livePrices[h.ticker];
  const pc = state.prevClosePrices[h.ticker];
  const currentVal = lp ? lp * h.totalQty : null;
  const pnlAbs = currentVal != null ? currentVal - h.invested : null;
  const pnlPct = pnlAbs != null ? (pnlAbs / h.invested) * 100 : null;
  const allocPct = totalCurrent && currentVal ? (currentVal / totalCurrent) * 100 : null;
  const dayChgAbs = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;
  const dayChgPct = (lp && pc && pc > 0) ? ((lp - pc) / pc) * 100 : null;
  return { h, lp, pc, currentVal, pnlAbs, pnlPct, allocPct, dayChgAbs, dayChgPct, color: COLORS[i % COLORS.length] };
}

function renderHoldingsTable() {
  const holdings = Object.values(state.holdings);
  let totalCurrent = 0;
  holdings.forEach(h => { const lp = state.livePrices[h.ticker]; if (lp) totalCurrent += lp * h.totalQty; });
  const rows = holdings.map((h, i) => computeRow(h, totalCurrent, i));
  rows.sort((a, b) => {
    let va, vb;
    switch (modalSort.key) {
      case 'ticker':     va = a.h.ticker;   vb = b.h.ticker;   break;
      case 'totalQty':   va = a.h.totalQty; vb = b.h.totalQty; break;
      case 'avgBuy':     va = a.h.avgBuy;   vb = b.h.avgBuy;   break;
      case 'livePrice':  va = a.lp ?? -Infinity; vb = b.lp ?? -Infinity; break;
      case 'prevClose':  va = a.pc ?? -Infinity; vb = b.pc ?? -Infinity; break;
      case 'invested':   va = a.h.invested; vb = b.h.invested; break;
      case 'currentVal': va = a.currentVal ?? -Infinity; vb = b.currentVal ?? -Infinity; break;
      case 'pnlAbs':     va = a.pnlAbs ?? -Infinity; vb = b.pnlAbs ?? -Infinity; break;
      case 'pnlPct':     va = a.pnlPct ?? -Infinity; vb = b.pnlPct ?? -Infinity; break;
      case 'dayChgAbs':  va = a.dayChgAbs ?? -Infinity; vb = b.dayChgAbs ?? -Infinity; break;
      case 'dayChgPct':  va = a.dayChgPct ?? -Infinity; vb = b.dayChgPct ?? -Infinity; break;
      case 'allocPct':   va = a.allocPct ?? -Infinity; vb = b.allocPct ?? -Infinity; break;
      default:           va = a.currentVal ?? -Infinity; vb = b.currentVal ?? -Infinity;
    }
    if (typeof va === 'string') return modalSort.asc ? va.localeCompare(vb) : vb.localeCompare(va);
    return modalSort.asc ? va - vb : vb - va;
  });

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
      <td><div style="display:flex;align-items:center;gap:8px;"><div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></div><strong>${h.ticker}</strong></div></td>
      <td>${h.totalQty}</td>
      <td>${h.avgBuy.toFixed(2)}</td>
      <td>${lp ? lp.toFixed(2) : '—'}</td>
      <td style="color:var(--text2)">${pc ? pc.toFixed(2) : '—'}</td>
      <td>${fmt(h.invested)}</td>
      <td>${currentVal ? fmt(currentVal) : '—'}</td>
      <td style="color:${pnlAbs != null ? colorPnl(pnlAbs) : 'var(--text2)'}">${pnlAbs != null ? (pnlAbs >= 0 ? '+' : '') + fmt(Math.abs(pnlAbs)) : '—'}</td>
      <td style="color:${pnlPct != null ? colorPnl(pnlPct) : 'var(--text2)'}">${pnlPct != null ? pct(pnlPct) : '—'}</td>
      <td style="color:${dayChgAbs != null ? colorPnl(dayChgAbs) : 'var(--text2)'}">${dayChgAbs != null ? (dayChgAbs >= 0 ? '+' : '') + fmt(Math.abs(dayChgAbs)) : '—'}</td>
      <td style="color:${dayChgPct != null ? colorPnl(dayChgPct) : 'var(--text2)'}">${dayChgPct != null ? pct(dayChgPct) : '—'}</td>
      <td>${allocPct != null ? allocPct.toFixed(1) + '%' : '—'}</td>`;
    tr.style.cursor = 'pointer';
    tr.title = 'Click to view stock detail';
    tr.onclick = () => { closeHoldingsModal(); import('./drilldown.js').then(m => m.openDrilldown(h.ticker)); };
    tbody.appendChild(tr);
  });
}
