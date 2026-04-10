// ═══════════════════════════════════════════════
// API — GitHub Pages version
// Calls Yahoo Finance directly via a public CORS proxy.
// No server required — works from any static host.
// ═══════════════════════════════════════════════

import { state } from './state.js';

// Public CORS proxy — no signup needed, no rate limit for personal use
const PROXY = 'https://corsproxy.io/?url=';

function proxyUrl(url) {
  return PROXY + encodeURIComponent(url);
}

// ── Live price + previous close ──────────────────
// Source 1: Yahoo Finance query1 (primary)
// Source 2: Yahoo Finance query2 (fallback mirror)
export async function fetchPrice(ticker) {
  if (state.priceCache[ticker]) return state.priceCache[ticker];

  const mirrors = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
  ];

  for (const url of mirrors) {
    try {
      const res = await fetch(proxyUrl(url));
      if (!res.ok) continue;
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      const previousClose = meta?.chartPreviousClose ?? meta?.previousClose ?? null;
      if (price && price > 0) {
        state.priceCache[ticker] = price;
        if (previousClose && previousClose > 0) {
          state.prevClosePrices[ticker] = previousClose;
        }
        return price;
      }
    } catch (e) { /* try next mirror */ }
  }

  console.warn('fetchPrice: all sources failed for', ticker);
  return null;
}

// ── Historical daily closes ──────────────────────
export async function fetchHistory(ticker, upstoxTicker, range = '2y') {
  const key = `${ticker}_${upstoxTicker || ''}_${range}`;
  if (state.historyCache[key]) return state.historyCache[key];

  // 1. Try Upstox public historical API for stocks that have an ISIN (SME stocks)
  if (upstoxTicker) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const fromDate = new Date();
      fromDate.setFullYear(fromDate.getFullYear() - 2);
      const from = fromDate.toISOString().split('T')[0];
      const upstoxUrl = `https://api.upstox.com/v2/historical-candle/NSE_EQ|${upstoxTicker}/day/${today}/${from}`;
      const res = await fetch(proxyUrl(upstoxUrl));
      if (res.ok) {
        const data = await res.json();
        const candles = data?.data?.candles || [];
        if (candles.length > 0) {
          const today = new Date().toISOString().split('T')[0];
          const series = {};
          // Upstox format: [datetime, open, high, low, close, volume, oi]
          candles.forEach(c => {
            const date = c[0].split('T')[0];
            if (date !== today && c[4] != null) series[date] = c[4];
          });
          if (Object.keys(series).length > 0) {
            state.historyCache[key] = series;
            return series;
          }
        }
      }
    } catch (e) {
      // Upstox failed (likely needs auth), fall through to Yahoo
    }
  }

  // 2. Try Yahoo Finance
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`;
    const res = await fetch(proxyUrl(url));
    const data = await res.json();

    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const today = new Date().toISOString().split('T')[0];

    const series = {};
    timestamps.forEach((ts, i) => {
      const date = new Date(ts * 1000).toISOString().split('T')[0];
      // Include today's data if it's the latest available point (intraday close)
      if (closes[i] != null) {
        series[date] = closes[i];
      }
    });

    if (Object.keys(series).length > 0) {
      state.historyCache[key] = series;
      return series;
    }
  } catch (e) {
    console.warn('fetchHistory Yahoo failed:', ticker, e);
  }

  // 3. No data from any source — return empty, dashboard will use avgBuy fallback
  state.historyCache[key] = {};
  return {};
}

// ── Intraday (5-min) data for day charts ─────────
export async function fetchDayHistory(ticker) {
  const key = `intraday_${ticker}`;
  if (state.dayHistoryCache[key]) return state.dayHistoryCache[key];

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=5m&range=1d`;
    const res = await fetch(proxyUrl(url));
    const data = await res.json();

    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const meta = result?.meta || {};

    const series = timestamps
      .map((ts, i) => {
        const d = new Date(ts * 1000);
        // Use zero-padded HH:MM built from Date methods — toLocaleTimeString
        // is locale-dependent and can produce '9:15' vs '09:15' inconsistently
        // across browsers, causing slots to mismatch when aggregating.
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return { time: `${hh}:${mm}`, ts, price: closes[i] };
      })
      .filter((x) => x.price != null);

    const previousClose = meta?.chartPreviousClose ?? meta?.previousClose ?? null;
    if (previousClose && previousClose > 0 && !state.prevClosePrices[ticker]) {
      state.prevClosePrices[ticker] = previousClose;
    }

    state.dayHistoryCache[key] = series;
    return series;
  } catch (e) {
    console.warn('fetchDayHistory failed:', ticker, e);
    return [];
  }
}

// ── Portfolio CSV (fetched from same repo's data/ folder) ────────────────────
export async function fetchPortfolioCSV() {
  // Works when served from GitHub Pages — fetches relative to the page origin
  const res = await fetch('./data/my_portfolio.csv');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
