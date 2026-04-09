// ═══════════════════════════════════════════════
// EXPORT
// Chart / data export helpers.
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { showToast } from './utils.js';

export function exportChart() {
  const chart = state.portfolioChartInstance;
  if (!chart) return;

  const url = chart.canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'portfolio-chart.png';
  a.click();

  showToast('Chart exported!');
}
