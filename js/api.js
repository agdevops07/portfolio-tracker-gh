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
export async function fetchPrice(ticker) {
  if (state.priceCache[ticker]) return state.priceCache[ticker];
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
    const res = await fetch(proxyUrl(url));
    const data = await res.json();

    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const previousClose = meta?.chartPreviousClose ?? meta?.previousClose ?? null;

    if (price) {
      state.priceCache[ticker] = price;
      if (previousClose && previousClose > 0) {
        state.prevClosePrices[ticker] = previousClose;
      }
    }
    return price ?? null;
  } catch (e) {
    console.warn('fetchPrice failed:', ticker, e);
    return null;
  }
}

// ── Historical daily closes ──────────────────────
export async function fetchHistory(ticker, upstoxTicker, range = '2y') {
  const key = `${ticker}_${upstoxTicker || ''}_${range}`;
  if (state.historyCache[key]) return state.historyCache[key];

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
      if (date !== today && closes[i] != null) {
        series[date] = closes[i];
      }
    });

    state.historyCache[key] = series;
    return series;
  } catch (e) {
    console.error('fetchHistory failed:', ticker, e);
    return null;
  }
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
      .map((ts, i) => ({
        time: new Date(ts * 1000).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
        ts,
        price: closes[i],
      }))
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
