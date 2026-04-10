// ═══════════════════════════════════════════════
// TIME SERIES
// Forward-fill and portfolio value construction.
// ═══════════════════════════════════════════════

import { state } from './state.js';

/**
 * Fill weekday gaps in a price series with the last known value.
 * @param {{ [date: string]: number }} series
 * @returns {{ [date: string]: number }}
 */
export function forwardFill(series) {
  const dates = Object.keys(series).sort();
  if (!dates.length) return series;

  const filled = {};
  const start = new Date(dates[0]);
  // Extend end to today so the latest data point is always included
  const seriesEnd = new Date(dates[dates.length - 1]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = seriesEnd > today ? seriesEnd : today;
  let last = null;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().split('T')[0];
    if (series[key] != null) last = series[key];
    if (last != null) filled[key] = last;
  }
  return filled;
}

/**
 * Build a daily portfolio value time series from individual stock histories.
 * For stocks with no history (e.g. SME), uses avgBuy as a constant price
 * so they are never silently dropped from the portfolio value.
 * @param {{ [ticker: string]: { [date: string]: number } }} histories
 * @returns {Promise<Array<{ date: string, value: number }>>}
 */
export async function buildTimeSeries(histories) {
  const holdings = Object.values(state.holdings);

  // Collect all dates from stocks that HAVE history
  const allDates = new Set();
  holdings.forEach((h) => {
    const hist = histories[h.ticker];
    if (hist && Object.keys(hist).length > 0) {
      Object.keys(hist).forEach((d) => allDates.add(d));
    }
  });

  if (!allDates.size) return [];

  const sortedDates = [...allDates].sort();

  // For each stock with no history, generate a flat series from its earliestDate
  // using avgBuy, covering the same date range as the portfolio
  const augmented = { ...histories };
  holdings.forEach((h) => {
    const hist = histories[h.ticker];
    if (!hist || Object.keys(hist).length === 0) {
      // Build flat series at avgBuy from earliestDate onwards
      const flatSeries = {};
      sortedDates.forEach((d) => {
        if (!h.earliestDate || d >= h.earliestDate) {
          flatSeries[d] = h.avgBuy;
        }
      });
      augmented[h.ticker] = flatSeries;
    }
  });

  const result = sortedDates
    .map((date) => {
      let value = 0;
      holdings.forEach((h) => {
        // Skip dates before this stock was purchased
        if (h.earliestDate && date < h.earliestDate) return;
        const hist = augmented[h.ticker];
        if (!hist) return;
        const price = hist[date];
        if (price != null) value += price * h.totalQty;
      });
      return { date, value: Math.round(value) };
    })
    .filter((p) => p.value > 0);

  return result;
}

/**
 * Slice fullTimeSeries to the requested time window.
 * @param {'1M'|'3M'|'1Y'|'ALL'} filter
 */
export function filterTimeSeries(filter) {
  const all = state.fullTimeSeries;
  if (!all.length) return all;

  const last = new Date(all[all.length - 1].date);
  let cutoff;

  if (filter === '1M') { cutoff = new Date(last); cutoff.setMonth(cutoff.getMonth() - 1); }
  else if (filter === '3M') { cutoff = new Date(last); cutoff.setMonth(cutoff.getMonth() - 3); }
  else if (filter === '1Y') { cutoff = new Date(last); cutoff.setFullYear(cutoff.getFullYear() - 1); }
  else return all;

  const cutStr = cutoff.toISOString().split('T')[0];
  return all.filter((p) => p.date >= cutStr);
}
