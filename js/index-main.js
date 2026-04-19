// ═══════════════════════════════════════════════
// INDEX-MAIN — Entry point for index.html (upload page)
// Handles file upload, preview, and session management.
// ═══════════════════════════════════════════════

import { initFileHandlers, loadSampleData, loadMyPortfolio, processCSV } from './fileHandler.js';
import { openStockPicker, closeStockPicker } from './stockPicker.js';
import { sortPreview } from './preview.js';
import { goBack } from './utils.js';
import { exportPreviewHoldings } from './export.js';
import { state } from './state.js';
import { switchPreviewUser } from './preview.js';
import {
  loadSessions, saveSession, deleteSession, renameSession,
  activateSession, getActiveCSV, hasSessions, fmtSessionDate,
  getActiveSessionId,
} from './session.js';

// ── Expose globals required by inline HTML handlers ──────────────────────────
window.switchPreviewUser = switchPreviewUser;
window.openStockPicker   = openStockPicker;
window.closeStockPicker  = closeStockPicker;
window.loadSampleData    = loadSampleData;
window.loadMyPortfolio   = loadMyPortfolio;
window.sortPreview       = sortPreview;
window.goBack            = goBack;
window.exportPreviewHoldings = exportPreviewHoldings;
window._stopAutoRefresh  = () => {};
window._destroyAllCharts = () => {};
window._getHoldings      = () => state.holdings;

// ── Paste CSV text input ─────────────────────────────────────────────────────
window.toggleCsvTextInput = function () {
  const wrap = document.getElementById('csv-text-wrap');
  if (wrap) wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
};

window.loadFromTextInput = function () {
  const text = document.getElementById('csv-text-input')?.value?.trim();
  if (!text) { alert('Please paste some CSV data first.'); return; }
  try { sessionStorage.setItem('portfolio_csv', text); } catch (_e) {}
  Papa.parse(text, {
    header: true, skipEmptyLines: true,
    complete: (r) => processCSV(r.data),
    error:    (err) => alert('CSV parse error: ' + err.message),
  });
};

// ── Navigate to dashboard with a CSV ─────────────────────────────────────────
window.loadDashboardFromPreview = function () {
  const existing = sessionStorage.getItem('portfolio_csv');
  if (existing) {
    const sid = getActiveSessionId();
    saveSession(existing, null, sid || undefined);
    window.location.href = 'dashboard.html';
    return;
  }

  const holdings = window._getHoldings ? window._getHoldings() : null;
  if (holdings && Object.keys(holdings).length > 0) {
    const rows = Object.values(holdings).map(h =>
      [h.ticker, h.totalQty, h.avgBuy.toFixed(4), h.earliestDate || '', h.upstoxTicker || ''].join(',')
    );
    const csv = 'ticker,quantity,average_buy_price,buy_date,upstox_ticker\n' + rows.join('\n');
    try { sessionStorage.setItem('portfolio_csv', csv); } catch (_e) {}
    saveSession(csv);
    window.location.href = 'dashboard.html';
  } else {
    window.showUploadError('No holdings found. Please add at least one stock before loading the dashboard.');
  }
};

// ── UI visibility helpers ────────────────────────────────────────────────────
function showUploadUI() {
  const ul = document.getElementById('upload-layout');
  const tb = document.getElementById('trust-bar-wrap');
  if (ul) ul.style.display = '';
  if (tb) tb.style.display = '';
}

function hideUploadUI() {
  const ul = document.getElementById('upload-layout');
  const tb = document.getElementById('trust-bar-wrap');
  if (ul) ul.style.display = 'none';
  if (tb) tb.style.display = 'none';
}

// ── Session panel rendering ──────────────────────────────────────────────────
function renderSessionPanel() {
  const container = document.getElementById('session-list');
  const panel     = document.getElementById('session-panel');
  if (!container || !panel) return;

  const sessions = loadSessions();
  if (!sessions.length) {
    panel.style.display = 'none';
    showUploadUI();
    return;
  }

  panel.style.display = 'block';
  // Hide upload form when sessions exist — user picks a session or clicks "Start Fresh"
  hideUploadUI();

  const activeSid = getActiveSessionId();

  container.innerHTML = sessions.slice().reverse().map(s => {
    const isActive = s.id === activeSid;
    return `
    <div class="session-card ${isActive ? 'session-card--active' : ''}" data-sid="${s.id}">
      <div class="session-card-body" onclick="window._loadSession('${s.id}')">
        <div class="session-card-name" id="sname-${s.id}">${escHtml(s.label)}</div>
        <div class="session-card-meta">${fmtSessionDate(s.updatedAt)}</div>
        ${isActive ? '<span class="session-badge">Active</span>' : ''}
      </div>
      <div class="session-card-actions">
        <button class="session-action-btn" title="Rename" onclick="event.stopPropagation();window._renameSession('${s.id}')">✏️</button>
        <button class="session-action-btn session-action-btn--danger" title="Delete" onclick="event.stopPropagation();window._deleteSession('${s.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window._loadSession = function (sid) {
  const csv = activateSession(sid);
  if (!csv) return;
  try { sessionStorage.setItem('portfolio_csv', csv); } catch (_e) {}
  window.location.href = 'dashboard.html';
};

window._deleteSession = function (sid) {
  if (!confirm('Delete this saved session?')) return;
  deleteSession(sid);
  const remaining = loadSessions();
  if (!remaining.length) {
    // No sessions left — show upload form
    const panel = document.getElementById('session-panel');
    if (panel) panel.style.display = 'none';
    showUploadUI();
  } else {
    renderSessionPanel();
  }
};

window._renameSession = function (sid) {
  const nameEl = document.getElementById(`sname-${sid}`);
  const current = nameEl ? nameEl.textContent : '';
  const newName = prompt('Rename session:', current);
  if (newName && newName.trim()) {
    renameSession(sid, newName.trim());
    renderSessionPanel();
  }
};

// ── Error modal helpers ───────────────────────────────────────────────────────
window.showUploadError = function (msg, title) {
  document.getElementById('upload-err-title').textContent = title || 'Unable to load file';
  document.getElementById('upload-err-body').textContent  = msg;
  document.getElementById('upload-err-modal').style.display = 'flex';
};
window.closeUploadError = function () {
  document.getElementById('upload-err-modal').style.display = 'none';
};

// ── DOMContentLoaded ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const forceUpload = sessionStorage.getItem('force_upload');

  if (forceUpload) {
    // User explicitly chose "Start Fresh" or went back from dashboard
    sessionStorage.removeItem('force_upload');
    renderSessionPanel(); // render panel (hidden if 0 sessions) but also show upload form
    showUploadUI();       // always show upload form in this mode
    initFileHandlers();
    _bindUploadUI();
    return;
  }

  // Auto-redirect: if there's an active session, go straight to dashboard.
  if (hasSessions()) {
    const activeCSV = getActiveCSV();
    if (activeCSV) {
      try { sessionStorage.setItem('portfolio_csv', activeCSV); } catch (_e) {}
      window.location.href = 'dashboard.html';
      return; // stop — navigating away
    }
  }

  // No active session but may have old sessions to pick from
  renderSessionPanel();
  initFileHandlers();
  _bindUploadUI();
});

function _bindUploadUI() {
  const browseBtn = document.getElementById('browse-btn');
  const fileInput = document.getElementById('file-input');
  const demoBtn   = document.getElementById('demo-btn');

  if (browseBtn) browseBtn.addEventListener('click', () => fileInput.click());
  if (demoBtn)   demoBtn.addEventListener('click', () => loadMyPortfolio());

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      setTimeout(() => { fileInput.value = ''; }, 500);
    });
  }

  const dz = document.getElementById('drop-zone');
  if (dz) {
    ['dragenter', 'dragover'].forEach(ev =>
      dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag-over'); })
    );
    ['dragleave', 'drop'].forEach(ev =>
      dz.addEventListener(ev, () => dz.classList.remove('drag-over'))
    );
  }
}