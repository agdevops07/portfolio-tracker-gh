// ═══════════════════════════════════════════════════════════════
// DATA SOURCE PANEL
// Self-contained UI widget for switching data source preferences.
// Call initDataSourcePanel() once after DOM is ready.
// The panel injects itself into #data-source-panel-host if present,
// or appends to .dashboard-toolbar as a fallback.
// ═══════════════════════════════════════════════════════════════

import {
  getHistoricalSources,
  getLiveSources,
  setHistoricalSources,
  setLiveSources,
  getAllPrefs,
  SOURCE_LABELS,
} from './dataSourceConfig.js';

import { showToast } from './utils.js';

// ── Inline styles (no external CSS dependency) ───────────────
const PANEL_STYLES = `
#ds-panel-wrap {
  position: relative;
  display: inline-block;
}
#ds-panel-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border, #333);
  background: var(--bg2, #1e1e2e);
  color: var(--text2, #aaa);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}
#ds-panel-btn:hover {
  background: var(--bg3, #2a2a3a);
  color: var(--text, #fff);
}
#ds-panel-btn .ds-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--accent, #6366f1);
  flex-shrink: 0;
}
#ds-dropdown {
  display: none;
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 9999;
  min-width: 300px;
  background: var(--bg2, #1e1e2e);
  border: 1px solid var(--border, #333);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.45);
  padding: 16px;
}
#ds-dropdown.open { display: block; }
.ds-section-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text3, #666);
  margin-bottom: 8px;
  margin-top: 4px;
}
.ds-section-title:not(:first-child) { margin-top: 16px; }
.ds-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.ds-label {
  font-size: 12px;
  color: var(--text2, #aaa);
  flex-shrink: 0;
}
.ds-select {
  flex: 1;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--border, #333);
  background: var(--bg3, #2a2a3a);
  color: var(--text, #fff);
  font-size: 12px;
  cursor: pointer;
  outline: none;
  max-width: 150px;
}
.ds-select:focus { border-color: var(--accent, #6366f1); }
.ds-sme-note {
  font-size: 11px;
  color: var(--text3, #666);
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--bg3, #2a2a3a);
  border-left: 3px solid var(--gold, #f59e0b);
  line-height: 1.5;
}
.ds-apply-btn {
  margin-top: 14px;
  width: 100%;
  padding: 8px;
  border-radius: 8px;
  border: none;
  background: var(--accent, #6366f1);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.ds-apply-btn:hover { opacity: 0.85; }
.ds-status-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.ds-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 99px;
  border: 1px solid var(--border, #333);
  color: var(--text2, #aaa);
  background: var(--bg3, #2a2a3a);
}
.ds-badge.primary { border-color: var(--accent, #6366f1); color: var(--accent, #6366f1); }
`;

function injectStyles() {
  if (document.getElementById('ds-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'ds-panel-styles';
  style.textContent = PANEL_STYLES;
  document.head.appendChild(style);
}

// ── Build the panel HTML ─────────────────────────────────────
function buildPanelHTML() {
  const hist = getHistoricalSources();
  const live = getLiveSources();

  return `
  <div id="ds-panel-wrap">
    <button id="ds-panel-btn" title="Data Source Settings">
      <span class="ds-dot"></span>
      Data Sources
    </button>
    <div id="ds-dropdown">
      <!-- Historical -->
      <div class="ds-section-title">📈 Historical Price Data</div>

      <div class="ds-row">
        <span class="ds-label">Primary</span>
        <select class="ds-select" id="ds-hist-primary">
          <option value="upstox" ${hist.primary === 'upstox' ? 'selected' : ''}>Upstox</option>
          <option value="yahoo"  ${hist.primary === 'yahoo'  ? 'selected' : ''}>Yahoo Finance</option>
        </select>
      </div>

      <div class="ds-row">
        <span class="ds-label">Fallback</span>
        <select class="ds-select" id="ds-hist-fallback">
          <option value="upstox" ${hist.fallback === 'upstox' ? 'selected' : ''}>Upstox</option>
          <option value="yahoo"  ${hist.fallback === 'yahoo'  ? 'selected' : ''}>Yahoo Finance</option>
        </select>
      </div>

      <!-- Live -->
      <div class="ds-section-title">⚡ Live Price Data</div>

      <div class="ds-row">
        <span class="ds-label">Primary</span>
        <select class="ds-select" id="ds-live-primary">
          <option value="yahoo"    ${live.primary === 'yahoo'    ? 'selected' : ''}>Yahoo Finance</option>
          <option value="screener" ${live.primary === 'screener' ? 'selected' : ''}>Screener.in</option>
        </select>
      </div>

      <div class="ds-row">
        <span class="ds-label">Fallback</span>
        <select class="ds-select" id="ds-live-fallback">
          <option value="yahoo"    ${live.fallback === 'yahoo'    ? 'selected' : ''}>Yahoo Finance</option>
          <option value="screener" ${live.fallback === 'screener' ? 'selected' : ''}>Screener.in</option>
        </select>
      </div>

      <!-- SME note -->
      <div class="ds-sme-note">
        ⚠️ <strong>NSE SME stocks</strong> always use <strong>Upstox</strong> for historical data
        regardless of the selection above.
      </div>

      <button class="ds-apply-btn" id="ds-apply-btn">Apply &amp; Refresh</button>
    </div>
  </div>`;
}

// ── Validation helpers ───────────────────────────────────────
function validateSelects() {
  const histP = document.getElementById('ds-hist-primary').value;
  const histF = document.getElementById('ds-hist-fallback').value;
  const liveP = document.getElementById('ds-live-primary').value;
  const liveF = document.getElementById('ds-live-fallback').value;

  const errors = [];
  if (histP === histF) errors.push('Historical primary and fallback must differ.');
  if (liveP === liveF) errors.push('Live-price primary and fallback must differ.');
  return errors;
}

// ── Sync fallback selects so they exclude the selected primary ─
function syncFallbackOptions(primaryId, fallbackId) {
  const primarySel  = document.getElementById(primaryId);
  const fallbackSel = document.getElementById(fallbackId);
  if (!primarySel || !fallbackSel) return;

  const chosenPrimary = primarySel.value;
  const currentFallback = fallbackSel.value;

  // If same, auto-pick the other option
  if (chosenPrimary === currentFallback) {
    const otherOption = [...fallbackSel.options].find(o => o.value !== chosenPrimary);
    if (otherOption) fallbackSel.value = otherOption.value;
  }
}

// ── Wire up events ───────────────────────────────────────────
function wireEvents() {
  const btn      = document.getElementById('ds-panel-btn');
  const dropdown = document.getElementById('ds-dropdown');
  const applyBtn = document.getElementById('ds-apply-btn');

  // Toggle dropdown
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!document.getElementById('ds-panel-wrap')?.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });

  // Auto-sync fallback when primary changes
  document.getElementById('ds-hist-primary')?.addEventListener('change', () => {
    syncFallbackOptions('ds-hist-primary', 'ds-hist-fallback');
  });
  document.getElementById('ds-live-primary')?.addEventListener('change', () => {
    syncFallbackOptions('ds-live-primary', 'ds-live-fallback');
  });

  // Apply button
  applyBtn.addEventListener('click', async () => {
    const errors = validateSelects();
    if (errors.length) {
      showToast('⚠️ ' + errors.join(' '));
      return;
    }

    const histP = document.getElementById('ds-hist-primary').value;
    const histF = document.getElementById('ds-hist-fallback').value;
    const liveP = document.getElementById('ds-live-primary').value;
    const liveF = document.getElementById('ds-live-fallback').value;

    setHistoricalSources(histP, histF);
    setLiveSources(liveP, liveF);

    dropdown.classList.remove('open');
    showToast('✓ Data sources updated — refreshing…');

    // Trigger full refresh so new sources are used
    // Small delay gives the toast time to render
    setTimeout(() => {
      if (typeof window.refreshDashboard === 'function') {
        window.refreshDashboard();
      }
    }, 400);
  });
}

// ── Public init ──────────────────────────────────────────────
/**
 * Call once after DOMContentLoaded.
 * Looks for #data-source-panel-host first; falls back to .dashboard-toolbar.
 */
export function initDataSourcePanel() {
  injectStyles();

  // Find mount point
  let host = document.getElementById('data-source-panel-host');
  if (!host) {
    // Fallback: try to attach to toolbar
    const toolbar = document.querySelector('.dashboard-toolbar');
    if (toolbar) {
      host = document.createElement('div');
      host.id = 'data-source-panel-host';
      toolbar.appendChild(host);
    }
  }

  if (!host) {
    console.warn('[DataSourcePanel] No mount point found (#data-source-panel-host or .dashboard-toolbar)');
    return;
  }

  host.innerHTML = buildPanelHTML();
  wireEvents();
  console.log('[DataSourcePanel] Mounted successfully');
}

/**
 * Re-render the panel dropdowns with current prefs (call after external pref change).
 */
export function refreshDataSourcePanel() {
  const host = document.getElementById('data-source-panel-host');
  if (!host) return;
  const wasOpen = document.getElementById('ds-dropdown')?.classList.contains('open');
  host.innerHTML = buildPanelHTML();
  wireEvents();
  if (wasOpen) document.getElementById('ds-dropdown')?.classList.add('open');
}
