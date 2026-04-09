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
  const end = new Date(dates[dates.length - 1]);
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
 * @param {{ [ticker: string]: { [date: string]: number } }} histories
 * @returns {Promise<Array<{ date: string, value: number }>>}
 */
export async function buildTimeSeries(histories) {
  const holdings = Object.values(state.holdings);

  // Collect all dates across all stocks
  const allDates = new Set();
  holdings.forEach((h) => {
    const hist = histories[h.ticker];
    if (hist) Object.keys(hist).forEach((d) => allDates.add(d));
  });

  const sortedDates = [...allDates].sort();
  if (!sortedDates.length) return [];

  const result = sortedDates
    .map((date) => {
      let value = 0;
      holdings.forEach((h) => {
        const hist = histories[h.ticker];
        if (!hist) return;
        if (h.earliestDate && date < h.earliestDate) return; // only count after purchase
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
