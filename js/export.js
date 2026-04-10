// ═══════════════════════════════════════════════
// EXPORT — Chart/PDF export helpers
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { showToast } from './utils.js';

// ── Export chart as PNG ──────────────────────────
export function exportChart() {
  const chart = state.portfolioChartInstance;
  if (!chart) return;
  const url = chart.canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'portfolio-chart.png';
  a.click();
  showToast('Chart exported!');
  closeExportMenu();
}

// ── Export full dashboard as PDF ─────────────────
export function exportPDF() {
  closeExportMenu();
  showToast('Preparing PDF…');

  // Use browser print with a print stylesheet
  // We trigger window.print() — CSS @media print hides non-dashboard elements
  window.print();
}

// ── Export dropdown toggle ───────────────────────
export function toggleExportMenu() {
  const menu = document.getElementById('export-menu');
  if (!menu) return;
  const isOpen = menu.classList.toggle('open');
  if (isOpen) {
    // Close when clicking outside
    setTimeout(() => {
      document.addEventListener('click', closeExportMenuOutside, { once: true });
    }, 0);
  }
}

function closeExportMenuOutside(e) {
  const dropdown = document.getElementById('export-dropdown');
  if (dropdown && !dropdown.contains(e.target)) closeExportMenu();
}

export function closeExportMenu() {
  const menu = document.getElementById('export-menu');
  if (menu) menu.classList.remove('open');
}
