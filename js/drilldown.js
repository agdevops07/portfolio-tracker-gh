// ═══════════════════════════════════════════════
// DRILLDOWN — Navigates to screener page with
// holding context embedded in sessionStorage.
// The screener page reads this and shows
// portfolio-specific stat cards when present.
// ═══════════════════════════════════════════════

import { state } from './state.js';

// ── Open drilldown: pass context to screener page ──
export function openDrilldown(ticker) {
  const h   = state.holdings[ticker];
  const lp  = state.livePrices[ticker];
  const pc  = state.prevClosePrices[ticker];

  // Encode all the holding data we want the screener to show
  const ctx = {
    ticker,
    fromHolding: true,
    holding: h ? {
      totalQty    : h.totalQty,
      avgBuy      : h.avgBuy,
      invested    : h.invested,
      earliestDate: h.earliestDate || null,
      upstoxTicker: h.upstoxTicker || null,
    } : null,
    livePrice  : lp || null,
    prevClose  : pc || null,
    // pass history if already fetched so screener doesn't re-fetch
    history    : state.histories?.[ticker] || null,
    dayHistory : state.dayHistories?.[ticker] || null,
  };

  try {
    sessionStorage.setItem('drilldown_ctx', JSON.stringify(ctx));
  } catch (_) {}

  // Navigate to screener with ticker in URL
  const base = window.location.pathname.replace(/\/[^/]*$/, '') || '';
  window.location.href = base + '/screener.html?ticker=' + encodeURIComponent(ticker) + '&from=dashboard';
}
