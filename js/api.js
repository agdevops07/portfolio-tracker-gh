// ═══════════════════════════════════════════════
// API — GitHub Pages version
// Yahoo Finance via CORS proxy + Screener.in + Upstox
// ═══════════════════════════════════════════════

import { state } from './state.js';

const PROXY = 'https://corsproxy.io/?url=';
function proxyUrl(url) { return PROXY + encodeURIComponent(url); }

// ── Helpers ──────────────────────────────────────
function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  return day === 0 || day === 6; // 0=Sunday, 6=Saturday
}

function getPreviousWeekday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().split('T')[0];
}

// ── Live price + previous close ──────────────────
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
        if (previousClose && previousClose > 0) state.prevClosePrices[ticker] = previousClose;
        return price;
      }
    } catch (e) { /* try next */ }
  }
  return null;
}

// ── Historical daily closes (weekdays only) ──────
export async function fetchHistory(ticker, upstoxTicker, range = '2y') {
  const key = `${ticker}_${upstoxTicker || ''}_${range}`;
  if (state.historyCache[key]) return state.historyCache[key];

  const todayStr = new Date().toISOString().split('T')[0];

  // 1. Try Upstox for SME/ISIN stocks
  if (upstoxTicker) {
    try {
      const fromDate = new Date();
      fromDate.setFullYear(fromDate.getFullYear() - 2);
      const from = fromDate.toISOString().split('T')[0];
      const upstoxUrl = `https://api.upstox.com/v2/historical-candle/NSE_EQ|${upstoxTicker}/day/${todayStr}/${from}`;
      const res = await fetch(proxyUrl(upstoxUrl));
      if (res.ok) {
        const data = await res.json();
        const candles = data?.data?.candles || [];
        if (candles.length > 0) {
          const series = {};
          candles.forEach(c => {
            const date = c[0].split('T')[0];
            if (!isWeekend(date) && c[4] != null) series[date] = c[4];
          });
          // Patch latest date with live price if available
          if (Object.keys(series).length > 0) {
            const livePrice = state.priceCache[ticker] || state.livePrices?.[ticker];
            if (livePrice && !isWeekend(todayStr)) series[todayStr] = livePrice;
            state.historyCache[key] = series;
            return series;
          }
        }
      }
    } catch (e) { /* fall through */ }
  }

  // 2. Yahoo Finance
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`;
    const res = await fetch(proxyUrl(url));
    const data = await res.json();

    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const meta = result?.meta || {};

    const series = {};
    timestamps.forEach((ts, i) => {
      const date = new Date(ts * 1000).toISOString().split('T')[0];
      if (!isWeekend(date) && closes[i] != null) series[date] = closes[i];
    });

    // Patch latest weekday with live price for accuracy
    if (Object.keys(series).length > 0) {
      const livePrice = meta?.regularMarketPrice || state.priceCache[ticker];
      if (livePrice && !isWeekend(todayStr)) {
        series[todayStr] = livePrice;
      } else if (livePrice) {
        // today is weekend — patch last known weekday
        const lastWD = getPreviousWeekday(todayStr);
        series[lastWD] = livePrice;
      }
      state.historyCache[key] = series;
      return series;
    }
  } catch (e) {
    console.warn('fetchHistory Yahoo failed:', ticker, e);
  }

  state.historyCache[key] = {};
  return {};
}

// ── Intraday (5-min) — with previous-day Upstox fallback ─────────────────────
export async function fetchDayHistory(ticker, upstoxTicker) {
  const key = `intraday_${ticker}`;
  if (state.dayHistoryCache[key]) return state.dayHistoryCache[key];

  // 1. Try Yahoo Finance for today's intraday
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
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return { time: `${hh}:${mm}`, ts, price: closes[i] };
      })
      .filter(x => x.price != null);

    const previousClose = meta?.chartPreviousClose ?? meta?.previousClose ?? null;
    if (previousClose && previousClose > 0 && !state.prevClosePrices[ticker]) {
      state.prevClosePrices[ticker] = previousClose;
    }

    // If we got meaningful intraday data (>2 points), use it
    if (series.length > 2) {
      state.dayHistoryCache[key] = series;
      return series;
    }
  } catch (e) {
    console.warn('fetchDayHistory Yahoo failed:', ticker, e);
  }

  // 2. Fallback: Try Upstox for previous trading day (1-min candles)
  //    Useful on weekends, holidays, or when Yahoo returns no intraday data
  if (upstoxTicker) {
    try {
      const prevDay = getPreviousWeekday(new Date().toISOString().split('T')[0]);
      const upstoxUrl = `https://api.upstox.com/v2/historical-candle/NSE_EQ|${upstoxTicker}/1minute/${prevDay}/${prevDay}`;
      const res = await fetch(proxyUrl(upstoxUrl));
      if (res.ok) {
        const data = await res.json();
        const candles = data?.data?.candles || [];
        if (candles.length > 2) {
          // Upstox format: [datetime, open, high, low, close, volume, oi]
          const series = candles
            .map(c => {
              const d = new Date(c[0]);
              const hh = String(d.getHours()).padStart(2, '0');
              const mm = String(d.getMinutes()).padStart(2, '0');
              return { time: `${hh}:${mm}`, ts: d.getTime(), price: c[4] };
            })
            .filter(x => x.price != null)
            .sort((a, b) => a.ts - b.ts);

          if (series.length > 0) {
            state.dayHistoryCache[key] = series;
            // Set prevClose from first candle's open if not already set
            if (!state.prevClosePrices[ticker] && candles[candles.length - 1]) {
              state.prevClosePrices[ticker] = candles[candles.length - 1][4];
            }
            return series;
          }
        }
      }
    } catch (e) {
      console.warn('fetchDayHistory Upstox fallback failed:', ticker, e);
    }
  }

  // 3. Final fallback: try Yahoo previous day (5m range=2d, take yesterday's ticks)
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=5m&range=2d`;
    const res = await fetch(proxyUrl(url));
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const todayStr = new Date().toISOString().split('T')[0];

    const series = timestamps
      .map((ts, i) => {
        const d = new Date(ts * 1000);
        const dateStr = d.toISOString().split('T')[0];
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return { time: `${hh}:${mm}`, date: dateStr, ts, price: closes[i] };
      })
      .filter(x => x.price != null && x.date !== todayStr); // take previous day only

    if (series.length > 0) {
      const result2 = series.map(({ time, ts, price }) => ({ time, ts, price }));
      state.dayHistoryCache[key] = result2;
      return result2;
    }
  } catch (e) { /* give up */ }

  state.dayHistoryCache[key] = [];
  return [];
}

// ── Screener.in fundamentals ─────────────────────
// Scrapes Screener.in public company page for Indian stocks.
// No auth needed. Returns structured fundamental data.
// ── Parse a Screener financial table into {headers, rows} ──
function parseScreenerTable(doc, sectionId) {
  const section = doc.querySelector(`#${sectionId}, section[data-src*="${sectionId}"]`);
  if (!section) return null;
  const table = section.querySelector('table');
  if (!table) return null;
  // Keep ALL headers (including blank first th) — slice(1) in render for year cols
  const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
  const rows = [...table.querySelectorAll('tbody tr')].map(tr => ({
    label: tr.querySelector('td')?.textContent?.trim() || '',
    values: [...tr.querySelectorAll('td:not(:first-child)')].map(td => td.textContent.trim()),
  })).filter(r => r.label);
  return { headers, rows };
}

export async function fetchScreenerFundamentals(ticker, mode = 'consolidated') {
  const sym = ticker.replace(/\.(NS|BO|BSE|NSE)$/i, '').toUpperCase().replace('-SM', '');
  const urls = mode === 'consolidated'
    ? [`https://www.screener.in/company/${sym}/consolidated/`, `https://www.screener.in/company/${sym}/`]
    : [`https://www.screener.in/company/${sym}/`];

  for (const targetUrl of urls) {
    try {
      const res = await fetch(proxyUrl(targetUrl));
      if (!res.ok) continue;
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const fund = {};

      // Key ratios
      doc.querySelectorAll('#top-ratios li, .company-ratios li').forEach(li => {
        const label = li.querySelector('.name, span:first-child')?.textContent?.trim().toLowerCase() || '';
        const val   = li.querySelector('.value, .number, span:last-child')?.textContent?.trim() || '';
        if (!val) return;
        if (label.includes('market cap'))    fund.marketCap  = val;
        if (label.includes('current price')) fund.currentPrice= val;
        if (label.includes('high / low') || label.includes('52 week')) fund.week52HL = val;
        if (label.includes('stock p/e'))     fund.peRatio    = val;
        if (label.includes('book value'))    fund.bookValue  = val;
        if (label.includes('dividend yield'))fund.divYield   = val;
        if (label.includes('roce'))          fund.roce       = val;
        if (label.includes('roe'))           fund.roe        = val;
        if (label.includes('face value'))    fund.faceValue  = val;
        if (label.includes('debt / equity') || label.includes('debt/equity')) fund.debtEquity = val;
        if (label.includes('eps'))           fund.eps        = val;
      });

      // About & sector
      const about  = doc.querySelector('.company-profile p, #company-info p, .about p');
      if (about) fund.about = about.textContent.trim();
      const sector = doc.querySelector('.company-profile .tag, .company-sector a, a[href*="/screen/"]');
      if (sector) fund.sector = sector.textContent.trim();

      // Financial tables
      fund.pnl       = parseScreenerTable(doc, 'profit-loss');
      fund.balance   = parseScreenerTable(doc, 'balance-sheet');
      fund.cashflow  = parseScreenerTable(doc, 'cash-flow');

      if (Object.keys(fund).length > 2) {
        fund._source = 'screener';
        fund._url    = targetUrl;
        fund._mode   = mode;
        return fund;
      }
    } catch (e) { console.warn('Screener fetch failed:', sym, e); }
  }
  return null;
}

// ── Portfolio CSV ────────────────────────────────
export async function fetchPortfolioCSV() {
  const res = await fetch('./data/my_portfolio.csv');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}