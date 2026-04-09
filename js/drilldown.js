// ═══════════════════════════════════════════════
// DRILLDOWN — Per-stock detail view
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { fmt, pct, colorPnl, showScreen } from './utils.js';
import { renderDrilldownChart, renderDrilldownDayChart } from './charts.js';
import { fetchDayHistory } from './api.js';

export async function openDrilldown(ticker) {
  showScreen('drilldown-screen');

  const h = state.holdings[ticker];
  document.getElementById('dd-ticker').textContent   = ticker;
  document.getElementById('dd-subtitle').textContent =
    `${h.totalQty} shares · Avg buy: ${h.avgBuy.toFixed(2)} · Invested: ₹${h.invested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  const lp  = state.livePrices[ticker];
  const pc  = state.prevClosePrices[ticker];
  const currentVal    = lp ? lp * h.totalQty : null;
  const pnlVal        = currentVal != null ? currentVal - h.invested : null;
  const pnlPct        = pnlVal != null ? (pnlVal / h.invested) * 100 : null;
  const todayChgPct   = (lp && pc && pc > 0) ? ((lp - pc) / pc) * 100 : null;
  const todayChgAbs   = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;

  // CAGR
  let cagr = null;
  if (h.earliestDate && lp) {
    const days  = (Date.now() - new Date(h.earliestDate)) / (1000 * 60 * 60 * 24);
    const years = days / 365;
    if (years > 0.1) cagr = (Math.pow(lp / h.avgBuy, 1 / years) - 1) * 100;
  }

  document.getElementById('dd-cards').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Current Price</div>
      <div class="stat-value">${lp ? lp.toFixed(2) : '—'}</div>
      ${pc ? `<div class="stat-sub">Prev close: ${pc.toFixed(2)}</div>` : ''}
    </div>
    <div class="stat-card">
      <div class="stat-label">Today's Change</div>
      <div class="stat-value" style="color:${todayChgPct != null ? colorPnl(todayChgPct) : 'var(--text2)'}">
        ${todayChgPct != null ? pct(todayChgPct) : '—'}
      </div>
      <div class="stat-sub" style="color:${todayChgAbs != null ? colorPnl(todayChgAbs) : 'var(--text2)'}">
        ${todayChgAbs != null ? (todayChgAbs >= 0 ? '+' : '') + fmt(Math.abs(todayChgAbs)) : 'Prev close unavailable'}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-label">P&amp;L (Overall)</div>
      <div class="stat-value" style="color:${pnlVal != null ? colorPnl(pnlVal) : 'inherit'}">
        ${pnlVal != null ? fmt(Math.abs(pnlVal)) : '—'}
      </div>
      <div class="stat-sub" style="color:${pnlPct != null ? colorPnl(pnlPct) : 'inherit'}">
        ${pnlPct != null ? pct(pnlPct) : ''}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Current Value</div>
      <div class="stat-value">${currentVal ? fmt(currentVal) : '—'}</div>
    </div>
    ${cagr != null ? `
    <div class="stat-card">
      <div class="stat-label">CAGR</div>
      <div class="stat-value" style="color:${colorPnl(cagr)}">${pct(cagr)}</div>
    </div>` : ''}`;

  // History chart
  const hist = state.histories?.[ticker];
  if (hist) renderDrilldownChart(ticker, hist, h.earliestDate);

  // Intraday day chart — fetch if not cached
  if (!state.dayHistories[ticker]?.length) {
    state.dayHistories[ticker] = await fetchDayHistory(h.ticker);
  }
  renderDrilldownDayChart(ticker);
}
