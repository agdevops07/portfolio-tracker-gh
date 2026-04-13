export const state = {
  rawRows: [],
  holdings: {},
  priceCache: {},
  historyCache: {},
  dayHistoryCache: {},
  portfolioTimeSeries: [],
  fullTimeSeries: [],
  currentFilter: '1Y',
  portfolioChartInstance: null,
  pieChartInstance: null,
  pnlChartInstance: null,
  todayPnlChartInstance: null,
  ddChartInstance: null,
  ddDayChartInstance: null,
  portfolioDayChartInstance: null,
  livePrices: {},
  prevClosePrices: {},
  histories: {},
  dayHistories: {},
  previewSort: { key: 'invested', asc: false },
  // Dashboard auto-refresh
  refreshIntervalId: null,
  refreshIntervalMs: 60000,
  refreshPaused: false,
  // Screener page auto-refresh (shared config)
  screenerRefreshIntervalId: null,
  screenerRefreshIntervalMs: 60000,
  screenerRefreshPaused: false,
};

export function resetCaches() {
  // Only prices + intraday — history stays intact
  state.priceCache      = {};
  state.livePrices      = {};
  state.prevClosePrices = {};
  state.dayHistoryCache = {};
  state.dayHistories    = {};
}

export function resetAllCaches() {
  state.priceCache      = {};
  state.historyCache    = {};
  state.dayHistoryCache = {};
  state.livePrices      = {};
  state.prevClosePrices = {};
  state.fullTimeSeries  = [];
  state.dayHistories    = {};
}

// ── Market hours helper (IST) ─────────────────────
// Returns true if NSE/BSE market is currently open
export function isMarketOpen() {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istOffset = 5.5 * 60; // minutes
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = (utcMinutes + istOffset) % (24 * 60);
  const istHour = Math.floor(istMinutes / 60);
  const istMin  = istMinutes % 60;
  const istDay  = new Date(now.getTime() + istOffset * 60000).getUTCDay(); // 0=Sun, 6=Sat

  // Weekend check
  if (istDay === 0 || istDay === 6) return false;

  // Market open: 9:15 AM – 4:15 PM IST
  const openMinutes  = 9 * 60 + 15;   // 9:15
  const closeMinutes = 16 * 60 + 15;  // 16:15
  const currentMinutes = istHour * 60 + istMin;

  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
}
