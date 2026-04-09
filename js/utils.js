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
    document.getElementById(s).style.display =
      s === id ? (s === 'upload-screen' ? 'flex' : 'block') : 'none';
  });
}

export function goBack() {
  showScreen('upload-screen');
}

export function showDashboard() {
  showScreen('dashboard-screen');
}
