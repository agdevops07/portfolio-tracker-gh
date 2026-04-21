// ═══════════════════════════════════════════════════════════════
// DATA SOURCE CONFIG
// Central registry for data-source preferences.
// Persisted in localStorage so choices survive page reloads.
//
// Historical sources: 'upstox' | 'yahoo'
// Live-price sources: 'yahoo' | 'screener'
//
// NSE SME stocks (ticker ends with "-SM" or flagged in stocksDb
// as smeStock === true) ALWAYS use Upstox for history regardless
// of user preference.  This override is enforced by fetchHistory()
// in api.js which calls isNseSme() exported from this module.
//
// BSE-only stocks (ticker ends with ".BO", or flagged bseOnly/exchange=BSE
// in stocksDb) ALWAYS use Screener.in as the sole live-price source.
// Yahoo Finance is unreliable for BSE-only prices; Upstox is not used
// for live prices at all.  Enforced in fetchPrice() via isBseOnly().
// ═══════════════════════════════════════════════════════════════

const STORAGE_KEY = 'dashboard_data_source_prefs';

const DEFAULTS = {
  histPrimary:   'upstox',   // historical: primary source
  histFallback:  'yahoo',    // historical: fallback source
  livePrimary:   'yahoo',    // live price: primary source
  liveFallback:  'screener', // live price: fallback source
};

// ── Internal state ───────────────────────────────────────────
let _prefs = { ...DEFAULTS };

// ── Persistence helpers ──────────────────────────────────────
function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      _prefs = { ...DEFAULTS, ...parsed };
    }
  } catch (_) {
    _prefs = { ...DEFAULTS };
  }
}

function _save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_prefs));
  } catch (_) {}
}

_load(); // hydrate on module load

// ── Public getters ───────────────────────────────────────────
export function getHistoricalSources() {
  return { primary: _prefs.histPrimary, fallback: _prefs.histFallback };
}

export function getLiveSources() {
  return { primary: _prefs.livePrimary, fallback: _prefs.liveFallback };
}

export function getAllPrefs() {
  return { ..._prefs };
}

// ── Public setters ───────────────────────────────────────────
/**
 * @param {'upstox'|'yahoo'} primary
 * @param {'upstox'|'yahoo'} fallback
 */
export function setHistoricalSources(primary, fallback) {
  if (primary === fallback) {
    console.warn('[DataSource] primary and fallback must differ — ignoring');
    return;
  }
  _prefs.histPrimary  = primary;
  _prefs.histFallback = fallback;
  _save();
  console.log(`[DataSource] Historical → primary: ${primary}, fallback: ${fallback}`);
}

/**
 * @param {'yahoo'|'screener'} primary
 * @param {'yahoo'|'screener'} fallback
 */
export function setLiveSources(primary, fallback) {
  if (primary === fallback) {
    console.warn('[DataSource] primary and fallback must differ — ignoring');
    return;
  }
  _prefs.livePrimary  = primary;
  _prefs.liveFallback = fallback;
  _save();
  console.log(`[DataSource] Live price → primary: ${primary}, fallback: ${fallback}`);
}

// ── NSE SME detection ────────────────────────────────────────
/**
 * Returns true when a ticker must always use Upstox for history.
 * Detection criteria (any one is sufficient):
 *  1. Yahoo ticker ends with "-SM" (NSE SME suffix)
 *  2. stocks_db.json entry has smeStock === true
 */
export function isNseSme(ticker) {
  if (!ticker) return false;
  // Criterion 1: "-SM" suffix used by Yahoo Finance for NSE SME board
  if (/-SM(\.(NS|BO))?$/i.test(ticker)) return true;
  // Criterion 2: explicit flag in stocksDb
  if (window._stocksDb) {
    const entry = window._stocksDb.find(
      s => s.yahooTicker && s.yahooTicker.toUpperCase() === ticker.toUpperCase()
    );
    if (entry && entry.smeStock === true) return true;
  }
  return false;
}

// ── BSE-only detection ───────────────────────────────────────
/**
 * Returns true when a ticker is listed ONLY on BSE (not on NSE).
 * BSE-only stocks use Screener.in as the sole live-price source
 * because Yahoo Finance returns stale/unreliable prices for them
 * and Upstox is not used for live prices at all.
 *
 * Detection criteria (any one is sufficient):
 *  1. Yahoo ticker ends with ".BO" AND does NOT end with ".NS"
 *     (i.e. the holding was given a BSE ticker, not an NSE one)
 *  2. stocks_db.json entry has bseOnly === true
 *  3. stocks_db.json entry has exchange === 'BSE' (and no NSE equivalent)
 */
export function isBseOnly(ticker) {
  if (!ticker) return false;

  // Criterion 1: explicit .BO Yahoo suffix
  if (/\.BO$/i.test(ticker)) return true;

  // Criteria 2 & 3: stocksDb flags
  if (window._stocksDb) {
    const entry = window._stocksDb.find(
      s => s.yahooTicker && s.yahooTicker.toUpperCase() === ticker.toUpperCase()
    );
    if (!entry) return false;
    if (entry.bseOnly === true) return true;
    if (entry.exchange && entry.exchange.toUpperCase() === 'BSE' && !entry.nseCode) return true;
  }

  return false;
}

// ── Source labels (for UI display) ──────────────────────────
export const SOURCE_LABELS = {
  upstox:   'Upstox',
  yahoo:    'Yahoo Finance',
  screener: 'Screener.in',
};