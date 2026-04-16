export const state = {
  rawRows: [],
  holdings: {},
  allHoldings: {},        // Feature 3: store all holdings before filtering
  users: [],              // Feature 3: list of unique users
  activeUser: 'all',      // Feature 3: currently selected user
  priceCache: {},
  historyCache: {},
  dayHistoryCache: {},
  portfolioTimeSeries: [],
  fullTimeSeries: [],
  currentFilter: '1W',
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
export function isMarketOpen() {
  const now = new Date();
  const istOffset = 5.5 * 60;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = (utcMinutes + istOffset) % (24 * 60);
  const istHour = Math.floor(istMinutes / 60);
  const istMin  = istMinutes % 60;
  const istDay  = new Date(now.getTime() + istOffset * 60000).getUTCDay();

  if (istDay === 0 || istDay === 6) return false;
  const openMinutes  = 9 * 60 + 15;
  const closeMinutes = 16 * 60 + 15;
  const currentMinutes = istHour * 60 + istMin;
  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
}