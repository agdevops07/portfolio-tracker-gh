// ═══════════════════════════════════════════════
// UTILS
// Pure formatting helpers + DOM utilities.
// ═══════════════════════════════════════════════

export const fmt = (n, dec = 0) =>
  '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });

export const fmtUSD = (n, dec = 0) =>
  '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

export const fmtAny = (n, ticker, dec = 0) =>
  ticker && !ticker.endsWith('.NS') && !ticker.endsWith('.BO')
    ? fmtUSD(n, dec)
    : fmt(n, dec);

export const pct = (n) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

export const colorPnl = (v) => (v >= 0 ? 'var(--green)' : 'var(--red)');

// ── Toast ────────────────────────────────────────
export function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ── Screen switcher ──────────────────────────────
const SCREENS = ['upload-screen', 'preview-screen', 'dashboard-screen', 'drilldown-screen'];

export function showScreen(id) {
  SCREENS.forEach((s) => {
    const el = document.getElementById(s);
    if (!el) return; // element may not exist on this page
    el.style.display = s === id ? (s === 'upload-screen' ? 'flex' : 'block') : 'none';
  });
}

export function goBack() {
  // Clear session and go back to upload page
  try { sessionStorage.removeItem('portfolio_csv'); } catch(_e) {}
  if (typeof window._stopAutoRefresh === 'function') window._stopAutoRefresh();
  if (typeof window._destroyAllCharts === 'function') window._destroyAllCharts();
  window.location.href = 'index.html';
}

export function showDashboard() {
  // On dashboard.html, hide drilldown, show dashboard content
  const ds = document.getElementById('dashboard-screen');
  const dd = document.getElementById('drilldown-screen');
  if (ds) ds.style.display = 'block';
  if (dd) dd.style.display = 'none';
}
