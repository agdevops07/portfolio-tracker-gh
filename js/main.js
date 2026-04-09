// ═══════════════════════════════════════════════
// MAIN — Bootstrap + holdings modal logic
// ═══════════════════════════════════════════════

import { initFileHandlers, loadSampleData, loadMyPortfolio } from './fileHandler.js';
import { sortPreview } from './preview.js';
import { loadDashboard, refreshDashboard, refreshPricesOnly, toggleRefreshPause, setRefreshInterval } from './dashboard.js';
import { setTimeFilter } from './charts.js';
import { goBack, showDashboard } from './utils.js';
import { exportChart } from './export.js';
import { openDrilldown } from './drilldown.js';
import { state } from './state.js';
import { fmt, pct, colorPnl } from './utils.js';
import { COLORS } from './charts.js';

// Expose globals immediately (before DOMContentLoaded) so inline onclick attrs work
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
window.openDrilldown       = openDrilldown;
window.openHoldingsModal   = openHoldingsModal;
window.closeHoldingsModal  = closeHoldingsModal;

document.addEventListener('DOMContentLoaded', () => {
  initFileHandlers();
});

// ── Holdings Full-Screen Modal ───────────────────
export function openHoldingsModal() {
  document.getElementById('holdings-modal').style.display = 'flex';
  renderHoldingsTable();
}

export function closeHoldingsModal() {
  document.getElementById('holdings-modal').style.display = 'none';
}

function renderHoldingsTable() {
  const holdings = Object.values(state.holdings);

  let totalCurrent = 0;
  holdings.forEach((h) => {
    const lp = state.livePrices[h.ticker];
    if (lp) totalCurrent += lp * h.totalQty;
  });

  const sorted = [...holdings].sort((a, b) => {
    const va = (state.livePrices[a.ticker] || 0) * a.totalQty;
    const vb = (state.livePrices[b.ticker] || 0) * b.totalQty;
    return vb - va;
  });

  const tbody = document.getElementById('holdings-modal-tbody');
  tbody.innerHTML = '';

  sorted.forEach((h, i) => {
    const lp  = state.livePrices[h.ticker];
    const pc  = state.prevClosePrices[h.ticker];
    const currentVal  = lp ? lp * h.totalQty : null;
    const pnlVal      = currentVal != null ? currentVal - h.invested : null;
    const pnlPct      = pnlVal != null ? (pnlVal / h.invested) * 100 : null;
    const allocPct    = totalCurrent && currentVal ? (currentVal / totalCurrent) * 100 : null;
    const color       = COLORS[i % COLORS.length];

    const dayChgAbs   = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;
    const dayChgPct   = (lp && pc && pc > 0) ? ((lp - pc) / pc) * 100 : null;

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
      <td style="color:${pnlVal != null ? colorPnl(pnlVal) : 'var(--text2)'}">
        ${pnlVal != null ? (pnlVal >= 0 ? '+' : '') + fmt(Math.abs(pnlVal)) : '—'}
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
