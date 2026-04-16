// ═══════════════════════════════════════════════
// TIME SERIES
// Forward-fill and portfolio value construction.
// Weekends are always excluded from all series.
// ═══════════════════════════════════════════════

import { state } from './state.js';

function isWeekend(dateStr) {
  const day = new Date(dateStr + 'T12:00:00Z').getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Fill weekday gaps in a price series with the last known value.
 * Weekend dates are never included in the output.
 */
export function forwardFill(series) {
  const dates = Object.keys(series).sort();
  if (!dates.length) return series;

  const filled = {};
  const start = new Date(dates[0] + 'T12:00:00Z');
  const seriesEnd = new Date(dates[dates.length - 1] + 'T12:00:00Z');
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  const end = seriesEnd > today ? seriesEnd : today;
  let last = null;

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().split('T')[0];
    if (series[key] != null) last = series[key];
    // Only store weekday entries
    if (last != null && !isWeekend(key)) filled[key] = last;
  }
  return filled;
}

/**
 * Build a daily portfolio value time series (weekdays only).
 */
export async function buildTimeSeries(histories) {
  const holdings = Object.values(state.holdings);

  const allDates = new Set();
  holdings.forEach(h => {
    const hist = histories[h.ticker];
    if (hist && Object.keys(hist).length > 0) {
      Object.keys(hist).forEach(d => { if (!isWeekend(d)) allDates.add(d); });
    }
  });

  if (!allDates.size) return [];

  const sortedDates = [...allDates].sort();

  const augmented = { ...histories };
  holdings.forEach(h => {
    const hist = histories[h.ticker];
    if (!hist || Object.keys(hist).length === 0) {
      const flatSeries = {};
      sortedDates.forEach(d => {
        if (!h.earliestDate || d >= h.earliestDate) flatSeries[d] = h.avgBuy;
      });
      augmented[h.ticker] = flatSeries;
    }
  });

  const result = sortedDates
    .map(date => {
      if (isWeekend(date)) return null;
      let value = 0;
      holdings.forEach(h => {
        if (h.earliestDate && date < h.earliestDate) return;
        const hist = augmented[h.ticker];
        if (!hist) return;
        const price = hist[date];
        if (price != null) value += price * h.totalQty;
      });
      return { date, value: Math.round(value) };
    })
    .filter(p => p && p.value > 0);

  // ── Patch / append today's live value ──────────────
  // Replace or append a point for today using live prices so the chart's
  // rightmost value always reflects the current portfolio value, not yesterday's close.
  const todayStr = new Date().toISOString().split('T')[0];
  if (!isWeekend(todayStr)) {
    let todayLiveValue = 0;
    let hasAllPrices = true;
    holdings.forEach(h => {
      const lp = state.livePrices[h.ticker];
      if (lp) {
        todayLiveValue += lp * h.totalQty;
      } else {
        hasAllPrices = false;
        // Fall back to last known close for this holding
        const hist = augmented[h.ticker];
        if (hist) {
          const dates = Object.keys(hist).sort();
          const lastClose = hist[dates[dates.length - 1]];
          if (lastClose) todayLiveValue += lastClose * h.totalQty;
        }
      }
    });

    if (todayLiveValue > 0) {
      const rounded = Math.round(todayLiveValue);
      const existing = result.findIndex(p => p.date === todayStr);
      if (existing >= 0) {
        result[existing] = { date: todayStr, value: rounded };
      } else {
        result.push({ date: todayStr, value: rounded });
      }
    }
  }

  return result;
}

/**
 * Patch only today's point in state.fullTimeSeries with the latest live prices.
 * Call this after refreshPricesOnly() instead of rebuilding the full 2-year series.
 */
export function patchTodayTimeSeries() {
  const todayStr = new Date().toISOString().split('T')[0];
  if (isWeekend(todayStr) || !state.fullTimeSeries.length) return;

  const holdings = Object.values(state.holdings);
  let todayValue = 0;
  holdings.forEach(h => {
    const lp = state.livePrices[h.ticker];
    if (lp) {
      todayValue += lp * h.totalQty;
    } else {
      const hist = state.histories?.[h.ticker];
      if (hist) {
        const dates = Object.keys(hist).sort();
        const lastClose = hist[dates[dates.length - 1]];
        if (lastClose) todayValue += lastClose * h.totalQty;
      }
    }
  });

  if (todayValue <= 0) return;
  const rounded = Math.round(todayValue);
  const idx = state.fullTimeSeries.findIndex(p => p.date === todayStr);
  if (idx >= 0) {
    state.fullTimeSeries[idx].value = rounded;
  } else {
    state.fullTimeSeries.push({ date: todayStr, value: rounded });
  }
}

export function filterTimeSeries(filter) {
  const all = state.fullTimeSeries;
  if (!all.length) return all;

  const last = new Date(all[all.length - 1].date);
  let cutoff;

  if (filter === '1W')  { cutoff = new Date(last); cutoff.setDate(cutoff.getDate() - 7); }
  else if (filter === '1M')  { cutoff = new Date(last); cutoff.setMonth(cutoff.getMonth() - 1); }
  else if (filter === '3M') { cutoff = new Date(last); cutoff.setMonth(cutoff.getMonth() - 3); }
  else if (filter === '6M') { cutoff = new Date(last); cutoff.setMonth(cutoff.getMonth() - 6); }
  else if (filter === '1Y') { cutoff = new Date(last); cutoff.setFullYear(cutoff.getFullYear() - 1); }
  else return all;

  const cutStr = cutoff.toISOString().split('T')[0];
  return all.filter(p => p.date >= cutStr && !isWeekend(p.date));
}