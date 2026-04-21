// ═══════════════════════════════════════════════
// API — GitHub Pages version
// Yahoo Finance via CORS proxy + Screener.in + Upstox
//
// Source-toggle behaviour is driven by dataSourceConfig.js:
//   Historical: Upstox ↔ Yahoo Finance (NSE SME always Upstox)
//   Live price: Yahoo Finance ↔ Screener.in  (Upstox NOT used)
//   BSE-only stocks: Screener.in always (Yahoo unreliable for BSE)
// ═══════════════════════════════════════════════

import { state } from './state.js';
import {
  getHistoricalSources,
  getLiveSources,
  isNseSme,
  isBseOnly,
} from './dataSourceConfig.js';

const PROXY = 'https://corsproxy.io/?url=';
function proxyUrl(url) { return PROXY + encodeURIComponent(url); }

// ── Shared timeout wrapper ───────────────────────────────────
function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// ── Weekend helpers ──────────────────────────────────────────
function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function getPreviousWeekday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().split('T')[0];
}

// ════════════════════════════════════════════════════════════
// NSE INDEX HISTORY (benchmarks — always Upstox, no toggle)
// ════════════════════════════════════════════════════════════
export async function fetchNseIndexHistory(indexName) {
  const baseUrl = 'https://www.nseindia.com';
  const proxy = 'https://corsproxy.io/?url=';

  try {
    const homeResponse = await fetch(proxy + encodeURIComponent(baseUrl + '/'), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive',
      },
    });

    const cookies = homeResponse.headers.get('set-cookie');

    const apiUrl = `${baseUrl}/api/chart-databyindex?index=${encodeURIComponent(indexName)}`;
    const dataResponse = await fetch(proxy + encodeURIComponent(apiUrl), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': baseUrl + '/',
        'Cookie': cookies || '',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    if (dataResponse.ok) {
      const data = await dataResponse.json();
      if (data && data.grapthData && data.grapthData.length > 0) {
        const series = {};
        for (const point of data.grapthData) {
          const date = new Date(point[0]).toISOString().split('T')[0];
          const price = point[1];
          const day = new Date(date + 'T12:00:00Z').getUTCDay();
          if (day !== 0 && day !== 6 && price != null) {
            series[date] = price;
          }
        }
        return series;
      }
    }
    return null;
  } catch (error) {
    console.error(`Failed to fetch NSE index history for ${indexName}:`, error);
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// LIVE PRICE — Source-toggled: Yahoo Finance | Screener.in
// Upstox is NOT used for live prices.
// ════════════════════════════════════════════════════════════

// ── Yahoo Finance live price ─────────────────────────────────
async function _fetchPriceYahoo(ticker) {
  const bust = Math.floor(Date.now() / 30000);
  const mirrors = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=2m&range=1d&_=${bust}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=2m&range=1d&_=${bust}`,
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}&_=${bust}`,
  ];

  for (const url of mirrors) {
    try {
      const res = await withTimeout(fetch(proxyUrl(url)));
      if (!res.ok) continue;
      const data = await res.json();

      if (url.includes('/v7/finance/quote')) {
        const q = data?.quoteResponse?.result?.[0];
        if (q?.regularMarketPrice > 0) {
          const pc = q.regularMarketPreviousClose ?? q.chartPreviousClose ?? null;
          if (pc && pc > 0) {
            state.prevClosePrices[ticker] = pc;
            console.log(`[Yahoo Live] prevClose for ${ticker}: ${pc}`);
          }
          return q.regularMarketPrice;
        }
        continue;
      }

      const meta = data?.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      const previousClose = meta?.chartPreviousClose ?? meta?.previousClose ?? null;
      if (price && price > 0) {
        if (previousClose && previousClose > 0) {
          state.prevClosePrices[ticker] = previousClose;
          console.log(`[Yahoo Live] prevClose for ${ticker}: ${previousClose}`);
        }
        return price;
      }
    } catch (e) {
      console.warn(`[Yahoo Live] error for ${ticker}:`, e.message);
    }
  }
  return null;
}

// ── Screener.in live price (scrape current price from page) ──
async function _fetchPriceScreener(ticker) {
  // Strip exchange suffix to get the base symbol Screener understands
  const rawSym = ticker.replace(/\.(NS|BO|BSE|NSE)$/i, '').toUpperCase().replace(/-SM$/i, '');
  const bseCode = await getBSECode(ticker).catch(() => null);
  const sym = bseCode || rawSym;

  // Cache-bust every 30 s (same cadence as Yahoo) so corsproxy.io and the
  // browser cache never serve stale HTML. Without this the proxy returns the
  // same cached page for the entire session.
  const bust = Math.floor(Date.now() / 30000);

  const urls = [
    `https://www.screener.in/company/${sym}/consolidated/?_=${bust}`,
    `https://www.screener.in/company/${sym}/?_=${bust}`,
  ];

  for (const url of urls) {
    try {
      // cache: 'no-store' prevents the browser's own HTTP cache from
      // returning a stale response even when the URL bust param changes.
      const res = await withTimeout(fetch(proxyUrl(url), { cache: 'no-store' }));
      if (!res.ok) continue;
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      // Current Price is listed in #top-ratios
      let currentPrice = null;
      let prevClose = null;

      doc.querySelectorAll('#top-ratios li, .company-ratios li').forEach(li => {
        const label = li.querySelector('.name, span:first-child')?.textContent?.trim().toLowerCase() || '';
        const val   = li.querySelector('.value, .number, span:last-child')?.textContent?.trim() || '';
        if (!val) return;

        if (label.includes('current price')) {
          // strip commas and currency symbols
          const clean = val.replace(/[^0-9.]/g, '');
          const n = parseFloat(clean);
          if (n > 0) currentPrice = n;
        }
        // Some pages expose prev close in ratios
        if (label.includes('previous close') || label.includes('prev. close')) {
          const clean = val.replace(/[^0-9.]/g, '');
          const n = parseFloat(clean);
          if (n > 0) prevClose = n;
        }
      });

      if (currentPrice && currentPrice > 0) {
        if (prevClose && !state.prevClosePrices[ticker]) {
          state.prevClosePrices[ticker] = prevClose;
          console.log(`[Screener Live] prevClose for ${ticker}: ${prevClose}`);
        }
        console.log(`[Screener Live] price for ${ticker}: ${currentPrice}`);
        return currentPrice;
      }
    } catch (e) {
      console.warn(`[Screener Live] error for ${ticker}:`, e.message);
    }
  }
  return null;
}

/**
 * Public fetchPrice — respects live-source toggle.
 * Special overrides (take priority over user prefs):
 *   • BSE-only stocks → always Screener.in only (Yahoo is unreliable for BSE)
 * Order: primary → fallback → null.
 * Result is cached in state.priceCache for the session.
 */
export async function fetchPrice(ticker) {
  // BSE-only tickers must NOT use the cache — fetchDayHistory may have
  // written a stale Yahoo price into priceCache before this runs.
  // We always go direct to Screener for BSE-only stocks.
  const bseOnly = isBseOnly(ticker);

  if (!bseOnly && state.priceCache[ticker]) return state.priceCache[ticker];

  const fetchers = {
    yahoo:    () => _fetchPriceYahoo(ticker),
    screener: () => _fetchPriceScreener(ticker),
  };

  // ── BSE-only override: Screener is the only viable source ──
  if (bseOnly) {
    console.log(`[fetchPrice] BSE-only detected for ${ticker} — using Screener.in exclusively`);
    try {
      const price = await fetchers.screener();
      if (price && price > 0) {
        state.priceCache[ticker] = price;
        return price;
      }
    } catch (e) {
      console.warn(`[fetchPrice] Screener failed for BSE-only ${ticker}:`, e.message);
    }
    console.error(`[fetchPrice] Screener returned no price for BSE-only ${ticker}`);
    return null;
  }

  // ── Normal toggle-driven flow ──────────────────────────────
  const { primary, fallback } = getLiveSources();

  // Try primary
  try {
    const price = await fetchers[primary]?.();
    if (price && price > 0) {
      state.priceCache[ticker] = price;
      return price;
    }
    console.warn(`[fetchPrice] Primary (${primary}) returned no price for ${ticker}, trying fallback (${fallback})…`);
  } catch (e) {
    console.warn(`[fetchPrice] Primary (${primary}) threw for ${ticker}:`, e.message);
  }

  // Try fallback
  try {
    const price = await fetchers[fallback]?.();
    if (price && price > 0) {
      state.priceCache[ticker] = price;
      console.log(`[fetchPrice] Used fallback (${fallback}) for ${ticker}`);
      return price;
    }
  } catch (e) {
    console.warn(`[fetchPrice] Fallback (${fallback}) threw for ${ticker}:`, e.message);
  }

  console.error(`[fetchPrice] Both sources failed for ${ticker}`);
  return null;
}

// ════════════════════════════════════════════════════════════
// HISTORICAL PRICE — Source-toggled: Upstox | Yahoo Finance
// NSE SME stocks ALWAYS use Upstox (override user selection).
// ════════════════════════════════════════════════════════════

// ── Upstox historical ────────────────────────────────────────
async function _fetchHistoryUpstox(ticker, upstoxTicker, range, todayStr) {
  const isNseIndex = ticker.startsWith('NSE_INDEX|');

  let effectiveKey = upstoxTicker;
  if (!effectiveKey && window._stocksDb && !isNseIndex) {
    const entry = window._stocksDb.find(
      s => s.yahooTicker && s.yahooTicker.toUpperCase() === ticker
    );
    if (entry && entry.isin) effectiveKey = entry.isin;
  }

  const instrumentKey = isNseIndex ? ticker : effectiveKey;
  if (!instrumentKey) return null;

  const fromDate = new Date();
  fromDate.setFullYear(fromDate.getFullYear() - 2);
  const from = fromDate.toISOString().split('T')[0];

  let urls;
  if (isNseIndex) {
    const encodedKey = encodeURIComponent(instrumentKey);
    urls = [`https://api.upstox.com/v2/historical-candle/${encodedKey}/day/${todayStr}/${from}`];
  } else {
    urls = [
      `https://api.upstox.com/v2/historical-candle/NSE_EQ|${instrumentKey}/day/${todayStr}/${from}`,
      `https://api.upstox.com/v2/historical-candle/NSE|${instrumentKey}/day/${todayStr}/${from}`,
      `https://api.upstox.com/v2/historical-candle/BSE|${instrumentKey}/day/${todayStr}/${from}`,
    ];
  }

  for (const url of urls) {
    try {
      const res = await withTimeout(fetch(proxyUrl(url)));
      if (!res.ok) continue;
      const data = await res.json();
      const candles = data?.data?.candles || [];
      if (candles.length > 0) {
        const series = {};
        candles.forEach(c => {
          const date = c[0].split('T')[0];
          if (!isWeekend(date) && c[4] != null) series[date] = c[4];
        });
        if (Object.keys(series).length > 0) {
          const livePrice = state.priceCache[ticker] || state.livePrices?.[ticker];
          if (livePrice && !isWeekend(todayStr)) series[todayStr] = livePrice;
          console.log(`[Upstox History] OK for ${ticker} (${Object.keys(series).length} points)`);
          return series;
        }
      }
    } catch (e) {
      console.warn(`[Upstox History] error for ${ticker}:`, e.message);
    }
  }
  return null;
}

// ── Yahoo Finance historical ─────────────────────────────────
async function _fetchHistoryYahoo(ticker, range, todayStr) {
  const isNseIndex = ticker.startsWith('NSE_INDEX|');
  if (isNseIndex) return null; // Yahoo doesn't support NSE_INDEX keys

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`;
    const res = await withTimeout(fetch(proxyUrl(url)));
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

    if (Object.keys(series).length > 0) {
      const livePrice = meta?.regularMarketPrice || state.priceCache[ticker];
      if (livePrice && !isWeekend(todayStr)) {
        series[todayStr] = livePrice;
      } else if (livePrice) {
        series[getPreviousWeekday(todayStr)] = livePrice;
      }
      console.log(`[Yahoo History] OK for ${ticker} (${Object.keys(series).length} points)`);
      return series;
    }
  } catch (e) {
    console.warn(`[Yahoo History] error for ${ticker}:`, e.message);
  }
  return null;
}

/**
 * Public fetchHistory — respects historical-source toggle.
 * NSE SME stocks are always routed to Upstox first regardless of prefs.
 * NSE_INDEX tickers are always Upstox-only (Yahoo doesn't support them).
 * Order: primary → fallback → {} (empty, error state).
 */
export async function fetchHistory(ticker, upstoxTicker, range = '2y') {
  const key = `${ticker}_${upstoxTicker || ''}_${range}`;
  if (state.historyCache[key]) return state.historyCache[key];

  const todayStr = new Date().toISOString().split('T')[0];
  const isNseIndex = ticker.startsWith('NSE_INDEX|');
  const forcedUpstox = isNseIndex || isNseSme(ticker);

  // Determine effective source order
  let { primary, fallback } = getHistoricalSources();
  if (forcedUpstox) {
    // Override: always Upstox first
    primary  = 'upstox';
    fallback = 'yahoo';
    if (forcedUpstox && !isNseIndex) {
      console.log(`[fetchHistory] NSE SME detected for ${ticker} — forcing Upstox`);
    }
  }

  const fetchers = {
    upstox: () => _fetchHistoryUpstox(ticker, upstoxTicker, range, todayStr),
    yahoo:  () => _fetchHistoryYahoo(ticker, range, todayStr),
  };

  // Try primary
  try {
    const series = await fetchers[primary]?.();
    if (series && Object.keys(series).length > 0) {
      state.historyCache[key] = series;
      return series;
    }
    if (!isNseIndex) {
      console.warn(`[fetchHistory] Primary (${primary}) returned nothing for ${ticker}, trying fallback (${fallback})…`);
    }
  } catch (e) {
    console.warn(`[fetchHistory] Primary (${primary}) threw for ${ticker}:`, e.message);
  }

  // Try fallback (skip Yahoo fallback for NSE_INDEX — it cannot handle them)
  if (!isNseIndex) {
    try {
      const series = await fetchers[fallback]?.();
      if (series && Object.keys(series).length > 0) {
        state.historyCache[key] = series;
        console.log(`[fetchHistory] Used fallback (${fallback}) for ${ticker}`);
        return series;
      }
    } catch (e) {
      console.warn(`[fetchHistory] Fallback (${fallback}) threw for ${ticker}:`, e.message);
    }
  }

  // Both failed
  console.error(`[fetchHistory] Both sources failed for ${ticker}`);
  state.historyCache[key] = {};
  return {};
}

// ════════════════════════════════════════════════════════════
// INTRADAY (DAY HISTORY) — Yahoo primary, Upstox fallback
// This is separate from live-price source toggle because it
// fetches candlestick series, not a single price point.
// Upstox is still acceptable here as a fallback for candle data.
// ════════════════════════════════════════════════════════════
export async function fetchDayHistory(ticker, upstoxTicker) {
  const key = `intraday_${ticker}`;
  if (state.dayHistoryCache[key]) return state.dayHistoryCache[key];

  const bust = Math.floor(Date.now() / 30000);

  let effectiveUpstoxTicker = upstoxTicker;
  if (!effectiveUpstoxTicker && window._stocksDb) {
    const entry = window._stocksDb.find(
      s => s.yahooTicker && s.yahooTicker.toUpperCase() === ticker
    );
    if (entry && entry.isin) effectiveUpstoxTicker = entry.isin;
  }

  // ── Try Yahoo Finance first ──────────────────────────────
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=5m&range=1d&_=${bust}`;
    const res = await withTimeout(fetch(proxyUrl(url)));
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
      console.log(`[DayHistory Yahoo] prevClose for ${ticker}: ${previousClose}`);
    }

    const livePrice = meta?.regularMarketPrice;
    if (livePrice && livePrice > 0 && series.length > 0) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      series.push({ time: `${hh}:${mm}`, ts: now.getTime(), price: livePrice });
      // BSE-only: do NOT write Yahoo price into priceCache/livePrices.
      // fetchPrice() must run the Screener override on a cold cache.
      // Writing here would poison the cache and silently bypass Screener.
      if (!isBseOnly(ticker)) {
        state.priceCache[ticker] = livePrice;
        state.livePrices[ticker] = livePrice;
      } else {
        console.log(`[DayHistory Yahoo] skipping priceCache for BSE-only ${ticker} — Screener will set live price`);
      }
    }

    if (series.length > 2) {
      state.dayHistoryCache[key] = series;
      return series;
    }
  } catch (e) {
    console.warn(`[DayHistory Yahoo] error for ${ticker}:`, e.message);
  }

  // ── Fallback: Upstox previous-day candles ────────────────
  if (effectiveUpstoxTicker) {
    try {
      const prevDay = getPreviousWeekday(new Date().toISOString().split('T')[0]);
      const upstoxUrls = [
        `https://api.upstox.com/v2/historical-candle/NSE_EQ|${effectiveUpstoxTicker}/1minute/${prevDay}/${prevDay}`,
        `https://api.upstox.com/v2/historical-candle/NSE|${effectiveUpstoxTicker}/1minute/${prevDay}/${prevDay}`,
      ];

      for (const url of upstoxUrls) {
        try {
          const res = await withTimeout(fetch(proxyUrl(url)));
          if (!res.ok) continue;
          const data = await res.json();
          const candles = data?.data?.candles || [];
          if (candles.length > 2) {
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
              if (candles[candles.length - 1] && !state.prevClosePrices[ticker]) {
                state.prevClosePrices[ticker] = candles[candles.length - 1][4];
                console.log(`[DayHistory Upstox] prevClose for ${ticker}: ${candles[candles.length - 1][4]}`);
              }
              return series;
            }
          }
        } catch (e) {
          continue;
        }
      }
    } catch (e) {
      console.warn(`[DayHistory Upstox] error for ${ticker}:`, e.message);
    }
  }

  state.dayHistoryCache[key] = [];
  return [];
}

// ════════════════════════════════════════════════════════════
// SCREENER.IN FUNDAMENTALS (unchanged)
// ════════════════════════════════════════════════════════════
let _bseCodes = null;
async function getBSECode(ticker) {
  if (!/\.BO$/i.test(ticker)) return null;
  const sym = ticker.replace(/\.BO$/i, '').toUpperCase();
  if (!_bseCodes) {
    try {
      const res = await fetch('./data/bse_codes.json');
      _bseCodes = res.ok ? await res.json() : {};
    } catch (e) { _bseCodes = {}; }
  }
  return _bseCodes[sym] || null;
}

function parseScreenerTable(doc, sectionId) {
  const section = doc.querySelector(`#${sectionId}, section[data-src*="${sectionId}"]`);
  if (!section) return null;
  const table = section.querySelector('table');
  if (!table) return null;
  const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
  const rows = [...table.querySelectorAll('tbody tr')].map(tr => ({
    label: tr.querySelector('td')?.textContent?.trim() || '',
    values: [...tr.querySelectorAll('td:not(:first-child)')].map(td => td.textContent.trim()),
  })).filter(r => r.label);
  return { headers, rows };
}

export async function fetchScreenerFundamentals(ticker, mode = 'consolidated') {
  const rawSym = ticker.replace(/\.(NS|BO|BSE|NSE)$/i, '').toUpperCase().replace('-SM', '');
  const bseCode = await getBSECode(ticker);
  const sym = bseCode || rawSym;
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

      doc.querySelectorAll('#top-ratios li, .company-ratios li').forEach(li => {
        const label = li.querySelector('.name, span:first-child')?.textContent?.trim().toLowerCase() || '';
        const val   = li.querySelector('.value, .number, span:last-child')?.textContent?.trim() || '';
        if (!val) return;
        if (label.includes('market cap'))    fund.marketCap   = val;
        if (label.includes('current price')) fund.currentPrice = val;
        if (label.includes('high / low') || label.includes('52 week')) fund.week52HL = val;
        if (label.includes('stock p/e'))     fund.peRatio     = val;
        if (label.includes('book value'))    fund.bookValue   = val;
        if (label.includes('dividend yield'))fund.divYield    = val;
        if (label.includes('roce'))          fund.roce        = val;
        if (label.includes('roe'))           fund.roe         = val;
        if (label.includes('face value'))    fund.faceValue   = val;
        if (label.includes('debt / equity') || label.includes('debt/equity')) fund.debtEquity = val;
        if (label.includes('eps'))           fund.eps         = val;
      });

      const about = doc.querySelector('.company-profile p, #company-info p, .about p');
      if (about) fund.about = about.textContent.trim();

      let peerPara = null;
      doc.querySelectorAll('h2').forEach(h2 => {
        if (h2.textContent.trim().includes('Peer comparison')) {
          let sib = h2.nextElementSibling;
          while (sib && sib.tagName !== 'P') sib = sib.nextElementSibling;
          if (sib) peerPara = sib;
        }
      });
      if (peerPara) {
        peerPara.querySelectorAll('a[title]').forEach(a => {
          const t = a.getAttribute('title'), v = a.textContent.trim();
          if (t === 'Broad Sector')   fund.broadSector   = v;
          if (t === 'Sector')         fund.sector        = v;
          if (t === 'Broad Industry') fund.broadIndustry = v;
          if (t === 'Industry')       fund.industry      = v;
        });
        const parts = [fund.broadSector, fund.sector, fund.industry].filter(Boolean);
        if (parts.length) fund.sectorBreadcrumb = parts.join(' › ');
      }

      fund.pnl       = parseScreenerTable(doc, 'profit-loss');
      fund.balance   = parseScreenerTable(doc, 'balance-sheet');
      fund.cashflow  = parseScreenerTable(doc, 'cash-flow');
      fund.quarterly = parseScreenerTable(doc, 'quarters');

      fund.annualReports = [];
      fund.concalls = [];

      function parseDocLinks(section, isAR) {
        if (!section) return;
        section.querySelectorAll('a[href]').forEach(a => {
          const href = a.getAttribute('href') || '';
          const text = a.textContent.trim();
          if (!href || href === '#') return;
          const isDocLink = href.includes('source') || href.includes('annual-report') ||
                            href.includes('concall') || href.includes('transcript') ||
                            href.includes('.pdf') || href.includes('bseindia') ||
                            href.includes('nseindia') || href.includes('sebi') ||
                            /\/company\/[^/]+\/[^/]+\/\d+\//.test(href);
          if (!isDocLink) return;
          const base = href.startsWith('http') ? href : 'https://www.screener.in/' + href.replace(/^\//, '');
          const hrefDate = href.match(/\/(\d{1,2})\/(20\d{2})\/?$/);
          const textDate = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s,]+20\d{2}/i);
          const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const date = textDate ? textDate[0] : (hrefDate ? months[parseInt(hrefDate[1])] + ' ' + hrefDate[2] : '');
          const yearMatch = (text + href).match(/20\d{2}/);
          const entry = {
            label: text || ((isAR ? 'Annual Report' : 'Concall') + (date ? ' · ' + date : (yearMatch ? ' ' + yearMatch[0] : ''))),
            date, url: base, isPdf: base.includes('.pdf') || href.includes('source'),
          };
          if (isAR) fund.annualReports.push(entry);
          else fund.concalls.push(entry);
        });
      }

      parseDocLinks(doc.querySelector('#annual-reports'), true);

      const concallSections = ['#concalls', '#investor-presentations'];
      concallSections.forEach(sel => {
        const sec = doc.querySelector(sel);
        if (!sec) return;
        const directLinks = sec.querySelectorAll('a.concall-link[href], a[href*=".pdf"], a[href*="transcript"], a[href*="concall"]');
        if (directLinks.length) {
          directLinks.forEach(a => {
            const href = a.getAttribute('href') || '';
            const text = a.textContent.trim() || a.title || 'Transcript';
            if (!href || href === '#') return;
            const base = href.startsWith('http') ? href : 'https://www.screener.in/' + href.replace(/^\//, '');
            const row = a.closest('tr, li');
            const rowText = row ? row.textContent : text;
            const hrefDate = href.match(/\/(\d{1,2})\/(20\d{2})\/?$/);
            const textDate = rowText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s,]+20\d{2}/i);
            const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const date = textDate ? textDate[0] : (hrefDate ? months[parseInt(hrefDate[1])] + ' ' + hrefDate[2] : '');
            fund.concalls.push({ label: text, date, url: base, isPdf: base.includes('.pdf') });
          });
        } else {
          parseDocLinks(sec, false);
        }
      });

      if (!fund.quarterlyPdfs) fund.quarterlyPdfs = [];
      const qSec = doc.querySelector('#quarters');
      if (qSec) {
        const rows = qSec.querySelectorAll('tr');
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length < 2) return;
          const periodText = cells[0]?.textContent?.trim() || '';
          if (!periodText) return;
          const resultLink = row.querySelector('a[href*="result"], a[href*="quarter"], a[href*="source"], a[href*=".pdf"]');
          if (!resultLink) return;
          const href = resultLink.getAttribute('href') || '';
          if (!href || href === '#') return;
          const base = href.startsWith('http') ? href : 'https://www.screener.in/' + href.replace(/^\//, '');
          let quarter = '', quarterNum = 0, finYear = '', sortKey = 0;
          const monthMatch = periodText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
          if (monthMatch) {
            const month = monthMatch[1].toLowerCase();
            const calYear = parseInt(monthMatch[2]);
            if (['jan', 'feb', 'mar'].includes(month)) {
              quarter = 'Q4'; quarterNum = 4; finYear = calYear.toString(); sortKey = calYear * 10 + 4;
            } else if (['apr', 'may', 'jun'].includes(month)) {
              quarter = 'Q1'; quarterNum = 1; finYear = (calYear + 1).toString(); sortKey = (calYear + 1) * 10 + 1;
            } else if (['jul', 'aug', 'sep'].includes(month)) {
              quarter = 'Q2'; quarterNum = 2; finYear = (calYear + 1).toString(); sortKey = (calYear + 1) * 10 + 2;
            } else if (['oct', 'nov', 'dec'].includes(month)) {
              quarter = 'Q3'; quarterNum = 3; finYear = (calYear + 1).toString(); sortKey = (calYear + 1) * 10 + 3;
            }
            const displayPeriod = `${quarter} FY${finYear}`;
            const existing = fund.quarterlyPdfs.find(p => p.period === displayPeriod);
            if (!existing) {
              fund.quarterlyPdfs.push({
                label: 'Quarterly Result',
                period: displayPeriod,
                rawPeriod: periodText,
                quarter, quarterNum,
                finYear: parseInt(finYear),
                sortKey, url: base, isPdf: true,
              });
            }
          }
        });
        fund.quarterlyPdfs.sort((a, b) => b.sortKey - a.sortKey);
        console.log(`📊 Quarterly PDFs for ${rawSym}:`, fund.quarterlyPdfs.map(p => `${p.period} (sortKey: ${p.sortKey})`));
      }

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

export async function fetchPortfolioCSV() {
  const res = await fetch('./data/my_portfolio.csv');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}