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
  // Clear sessionStorage (tab-scoped) but preserve localStorage sessions
  try {
    sessionStorage.removeItem('portfolio_csv');
    sessionStorage.removeItem('dashboard_current_tab');
    sessionStorage.removeItem('dashboard_active_user');
    sessionStorage.removeItem('main_view');
    sessionStorage.removeItem('holdings_view');
    sessionStorage.removeItem('portfolio_view');
    sessionStorage.removeItem('active_chart_section');
    sessionStorage.removeItem('chart_display_mode');
    sessionStorage.removeItem('selected_benchmarks');
    sessionStorage.removeItem('time_filter');
    sessionStorage.removeItem('active_benchmark');
    // Signal to index.html: don't auto-redirect, show upload UI
    sessionStorage.setItem('force_upload', '1');
  } catch (_e) {}
  if (typeof window._stopAutoRefresh  === 'function') window._stopAutoRefresh();
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
