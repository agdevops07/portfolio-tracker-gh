// ═══════════════════════════════════════════════
// API — GitHub Pages version
// Yahoo Finance via CORS proxy + Screener.in + Upstox
// ═══════════════════════════════════════════════

import { state } from './state.js';

const PROXY = 'https://corsproxy.io/?url=';
function proxyUrl(url) { return PROXY + encodeURIComponent(url); }

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

export async function fetchPrice(ticker) {
  if (state.priceCache[ticker]) return state.priceCache[ticker];

  const bust = Math.floor(Date.now() / 30000);

  const mirrors = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=2m&range=1d&_=${bust}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=2m&range=1d&_=${bust}`,
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}&_=${bust}`,
  ];

  for (const url of mirrors) {
    try {
      const res = await fetch(proxyUrl(url));
      if (!res.ok) continue;
      const data = await res.json();

      if (url.includes('/v7/finance/quote')) {
        const q = data?.quoteResponse?.result?.[0];
        if (q?.regularMarketPrice > 0) {
          state.priceCache[ticker] = q.regularMarketPrice;
          const pc = q.regularMarketPreviousClose ?? q.chartPreviousClose ?? null;
          if (pc && pc > 0) state.prevClosePrices[ticker] = pc;
          return q.regularMarketPrice;
        }
        continue;
      }

      const meta = data?.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      const previousClose = meta?.chartPreviousClose ?? meta?.previousClose ?? null;
      if (price && price > 0) {
        state.priceCache[ticker] = price;
        if (previousClose && previousClose > 0) state.prevClosePrices[ticker] = previousClose;
        return price;
      }
    } catch (e) { }
  }
  return null;
}

export async function fetchHistory(ticker, upstoxTicker, range = '2y') {
  const key = `${ticker}_${upstoxTicker || ''}_${range}`;
  if (state.historyCache[key]) return state.historyCache[key];

  const todayStr = new Date().toISOString().split('T')[0];
  
  let effectiveUpstoxTicker = upstoxTicker;
  if (!effectiveUpstoxTicker && window._stocksDb) {
    const entry = window._stocksDb.find(s =>
      s.yahooTicker && s.yahooTicker.toUpperCase() === ticker
    );
    if (entry && entry.isin) {
      effectiveUpstoxTicker = entry.isin;
    }
  }

  if (effectiveUpstoxTicker) {
    try {
      const fromDate = new Date();
      fromDate.setFullYear(fromDate.getFullYear() - 2);
      const from = fromDate.toISOString().split('T')[0];
      
      const upstoxUrls = [
        `https://api.upstox.com/v2/historical-candle/NSE_EQ|${effectiveUpstoxTicker}/day/${todayStr}/${from}`,
        `https://api.upstox.com/v2/historical-candle/NSE|${effectiveUpstoxTicker}/day/${todayStr}/${from}`,
        `https://api.upstox.com/v2/historical-candle/BSE|${effectiveUpstoxTicker}/day/${todayStr}/${from}`,
      ];
      
      for (const url of upstoxUrls) {
        try {
          const res = await fetch(proxyUrl(url));
          if (res.ok) {
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
                state.historyCache[key] = series;
                return series;
              }
            }
          }
        } catch (e) {
          continue;
        }
      }
    } catch (e) { }
  }

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

    if (Object.keys(series).length > 0) {
      const livePrice = meta?.regularMarketPrice || state.priceCache[ticker];
      if (livePrice && !isWeekend(todayStr)) {
        series[todayStr] = livePrice;
      } else if (livePrice) {
        const lastWD = getPreviousWeekday(todayStr);
        series[lastWD] = livePrice;
      }
      state.historyCache[key] = series;
      return series;
    }
  } catch (e) { }

  state.historyCache[key] = {};
  return {};
}

export async function fetchDayHistory(ticker, upstoxTicker) {
  const key = `intraday_${ticker}`;
  if (state.dayHistoryCache[key]) return state.dayHistoryCache[key];

  const bust = Math.floor(Date.now() / 30000);

  let effectiveUpstoxTicker = upstoxTicker;
  if (!effectiveUpstoxTicker && window._stocksDb) {
    const entry = window._stocksDb.find(s =>
      s.yahooTicker && s.yahooTicker.toUpperCase() === ticker
    );
    if (entry && entry.isin) {
      effectiveUpstoxTicker = entry.isin;
    }
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=5m&range=1d&_=${bust}`;
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

    const livePrice = meta?.regularMarketPrice;
    if (livePrice && livePrice > 0 && series.length > 0) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      series.push({ time: `${hh}:${mm}`, ts: now.getTime(), price: livePrice });
    }

    if (series.length > 2) {
      state.dayHistoryCache[key] = series;
      return series;
    }
  } catch (e) { }

  if (effectiveUpstoxTicker) {
    try {
      const prevDay = getPreviousWeekday(new Date().toISOString().split('T')[0]);
      const upstoxUrls = [
        `https://api.upstox.com/v2/historical-candle/NSE_EQ|${effectiveUpstoxTicker}/1minute/${prevDay}/${prevDay}`,
        `https://api.upstox.com/v2/historical-candle/NSE|${effectiveUpstoxTicker}/1minute/${prevDay}/${prevDay}`,
      ];
      
      for (const url of upstoxUrls) {
        try {
          const res = await fetch(proxyUrl(url));
          if (res.ok) {
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
                if (!state.prevClosePrices[ticker] && candles[candles.length - 1]) {
                  state.prevClosePrices[ticker] = candles[candles.length - 1][4];
                }
                return series;
              }
            }
          }
        } catch (e) {
          continue;
        }
      }
    } catch (e) { }
  }

  state.dayHistoryCache[key] = [];
  return [];
}

// Screener.in fundamentals (unchanged, keep as is)
let _bseCodes = null;
async function getBSECode(ticker) {
  if (!/\.BO$/i.test(ticker)) return null;
  const sym = ticker.replace(/\.BO$/i, '').toUpperCase();
  if (!_bseCodes) {
    try {
      const res = await fetch('./data/bse_codes.json');
      _bseCodes = res.ok ? await res.json() : {};
    } catch(e) { _bseCodes = {}; }
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
        qSec.querySelectorAll('a[href]').forEach(a => {
          const href = a.getAttribute('href') || '';
          const text = a.textContent.trim();
          if (!href || href === '#') return;
          const isDoc = href.includes('.pdf') || href.includes('bseindia') ||
                        href.includes('nseindia') || href.includes('source') ||
                        /\/company\/[^/]+\/[^/]+\/\d+\//.test(href);
          if (!isDoc) return;
          const base = href.startsWith('http') ? href : 'https://www.screener.in/' + href.replace(/^\//, '');
          const row = a.closest('tr');
          const period = row ? row.querySelector('td:first-child')?.textContent?.trim() : '';
          fund.quarterlyPdfs.push({ label: text || ('Result ' + period), date: period, url: base, isPdf: true });
        });
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