// ═══════════════════════════════════════════════
// PREVIEW
// Preview table rendering + column sorting + user tabs.
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { showScreen } from './utils.js';
import { getFilteredHoldings } from './fileHandler.js';

const COLUMN_LABELS = {
  ticker: 'Ticker',
  upstoxTicker: 'ISIN',
  totalQty: 'Qty',
  avgBuy: 'Avg Buy Price',
  invested: 'Invested',
  earliestDate: 'Buy Date',
  user: 'Owner',
};

// ── Public ───────────────────────────────────────
export function showPreview() {
  if (!document.getElementById("preview-table")) return;
  
  // Make sure we have holdings to show
  if (Object.keys(state.holdings).length === 0) {
    console.warn('No holdings to preview');
    return;
  }
  
  renderUserTabs();
  const holdings = getSortedHoldings();
  renderRows(holdings);
  updateSortIndicators();

  const totalInvested = holdings.reduce((s, h) => s + (h.invested || 0), 0);
  const summaryEl = document.getElementById('preview-summary');
  if (summaryEl) {
    summaryEl.textContent = `${holdings.length} stocks · Total invested: ₹${totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }

  showScreen('preview-screen');
}

export function sortPreview(key) {
  if (state.previewSort.key === key) {
    state.previewSort.asc = !state.previewSort.asc;
  } else {
    state.previewSort.key = key;
    state.previewSort.asc = true;
  }
  renderRows(getSortedHoldings());
  updateSortIndicators();
}

// Feature 3: User tab switching
export function switchPreviewUser(user) {
  state.activeUser = user;
  // Use the filtered holdings based on selected user
  const filtered = getFilteredHoldings(state.rawRows, user);
  state.holdings = filtered;
  
  // Update tab active states
  document.querySelectorAll('.preview-user-tab').forEach(t => {
    const isActive = t.dataset.user === user;
    t.classList.toggle('active', isActive);
    if (isActive) {
      t.style.background = 'var(--accent)';
      t.style.color = '#fff';
    } else {
      t.style.background = 'var(--bg3)';
      t.style.color = 'var(--text2)';
    }
  });
  
  const holdings = getSortedHoldings();
  renderRows(holdings);
  updateSortIndicators();
  
  const totalInvested = holdings.reduce((s, h) => s + (h.invested || 0), 0);
  const summaryEl = document.getElementById('preview-summary');
  if (summaryEl) {
    summaryEl.textContent = `${holdings.length} stocks · Total invested: ₹${totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }
}

// ── Sorting ──────────────────────────────────────
function getSortedHoldings() {
  return sortHoldings(Object.values(state.holdings));
}

export function sortHoldings(holdings) {
  const { key, asc } = state.previewSort;
  return [...holdings].sort((a, b) => {
    let valA = a[key];
    let valB = b[key];
    
    if (valA == null) return 1;
    if (valB == null) return -1;
    
    if (typeof valA === 'number') {
      return asc ? valA - valB : valB - valA;
    }
    if (key === 'earliestDate') {
      const dateA = valA ? new Date(valA) : new Date(0);
      const dateB = valB ? new Date(valB) : new Date(0);
      return asc ? dateA - dateB : dateB - dateA;
    }
    return asc 
      ? String(valA).localeCompare(String(valB))
      : String(valB).localeCompare(String(valA));
  });
}

// Feature 3: User tab strip
function renderUserTabs() {
  const users = state.users || [];
  let wrap = document.getElementById('preview-user-tabs');
  
  if (!wrap) {
    const tableWrap = document.querySelector('.preview-table-wrap');
    if (!tableWrap) return;
    wrap = document.createElement('div');
    wrap.id = 'preview-user-tabs';
    wrap.style.cssText = 'display:flex;gap:8px;padding:0 0 12px 0;flex-wrap:wrap;';
    tableWrap.parentNode.insertBefore(wrap, tableWrap);
  }
  
  if (users.length <= 1) { 
    wrap.style.display = 'none'; 
    return; 
  }
  
  wrap.style.display = 'flex';
  const active = state.activeUser || 'all';
  const tabs = ['all', ...users];
  
  wrap.innerHTML = tabs.map(u => `
    <button class="preview-user-tab${u === active ? ' active' : ''}" data-user="${u}"
      onclick="switchPreviewUser('${u}')"
      style="padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;border:1px solid var(--border2);
             background:${u === active ? 'var(--accent)' : 'var(--bg3)'};
             color:${u === active ? '#fff' : 'var(--text2)'};cursor:pointer;transition:all 0.2s;">
      ${u === 'all' ? '👥 All' : u}
    </button>`).join('');
}

// ── Rendering ────────────────────────────────────
function renderRows(holdings) {
  const tbody = document.querySelector('#preview-table tbody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (!holdings || holdings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;">No holdings found</td></tr>';
    return;
  }
  
  holdings.forEach((h, index) => {
    const tr = document.createElement('tr');
    if (index < 3) tr.style.background = 'rgba(99,102,241,0.08)';
    
    // Get owner display string
    let ownerStr = '—';
    if (h.users && h.users.length > 0) {
      ownerStr = h.users.length > 1 ? h.users.join(', ') : h.users[0];
    }
    
    tr.innerHTML = `
      <td><strong>${h.ticker || '—'}</strong></td>
      <td>${h.upstoxTicker || '—'}</td>
      <td>${h.totalQty || 0}</td>
      <td>${h.avgBuy ? h.avgBuy.toFixed(2) : '—'}</td>
      <td>${h.invested ? '₹' + h.invested.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}</td>
      <td>${h.earliestDate || '—'}</td>
      <td style="color:var(--text2);font-size:12px">${ownerStr}</td>`;
    
    tbody.appendChild(tr);
  });
}

function updateSortIndicators() {
  Object.keys(COLUMN_LABELS).forEach((col) => {
    const th = document.getElementById(`th-${col}`);
    if (!th) return;
    th.innerHTML = state.previewSort.key === col
      ? `${COLUMN_LABELS[col]} ${state.previewSort.asc ? '↑' : '↓'}`
      : COLUMN_LABELS[col];
  });
}