// ═══════════════════════════════════════════════
// INDEX-MAIN — Entry point for index.html (upload page)
// Only loads file handling and preview — no dashboard JS.
// ═══════════════════════════════════════════════

import { initFileHandlers, loadSampleData, loadMyPortfolio, processCSV } from './fileHandler.js';
import { openStockPicker, closeStockPicker } from './stockPicker.js';
import { sortPreview } from './preview.js';
import { goBack } from './utils.js';
import { exportHoldingsCSV } from './export.js';
import { state } from './state.js';

window.openStockPicker   = openStockPicker;
window.closeStockPicker  = closeStockPicker;
window.loadSampleData    = loadSampleData;
window.loadMyPortfolio   = loadMyPortfolio;
window.sortPreview       = sortPreview;
window.goBack            = goBack;
window.exportHoldingsCSV = exportHoldingsCSV;
window._stopAutoRefresh  = () => {};
window._destroyAllCharts = () => {};

// Expose state.holdings so the inline loadDashboardFromPreview() can serialise it
window._getHoldings = () => state.holdings;

// Paste CSV text input
window.toggleCsvTextInput = function() {
  const wrap = document.getElementById('csv-text-wrap');
  if (wrap) wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
};
window.loadFromTextInput = function() {
  const text = document.getElementById('csv-text-input')?.value?.trim();
  if (!text) { alert('Please paste some CSV data first.'); return; }
  try { sessionStorage.setItem('portfolio_csv', text); } catch(_e) {}
  Papa.parse(text, {
    header: true, skipEmptyLines: true,
    complete: (r) => processCSV(r.data),
    error: (err) => alert('CSV parse error: ' + err.message),
  });
};

document.addEventListener('DOMContentLoaded', () => {
  // Clear any stale session on fresh visit to upload page
  sessionStorage.removeItem('portfolio_csv');

  initFileHandlers();

  const browseBtn = document.getElementById('browse-btn');
  const fileInput = document.getElementById('file-input');
  const demoBtn   = document.getElementById('demo-btn');

  if (browseBtn) browseBtn.addEventListener('click', () => fileInput.click());
  if (demoBtn)   demoBtn.addEventListener('click', () => loadMyPortfolio());

  // Reset input value after each selection so the same file can be re-uploaded
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      // Let fileHandler process the file first, then reset so change fires next time
      setTimeout(() => { fileInput.value = ''; }, 500);
    });
  }

  // Drag-drop visual feedback
  const dz = document.getElementById('drop-zone');
  if (dz) {
    ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag-over'); }));
    ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('drag-over')));
    dz.querySelectorAll('.btn').forEach(btn => {
      btn.addEventListener('mousedown', () => btn.classList.add('btn-press'));
      btn.addEventListener('mouseup',   () => btn.classList.remove('btn-press'));
      btn.addEventListener('mouseleave',() => btn.classList.remove('btn-press'));
    });
  }
});
