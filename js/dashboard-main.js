// ═══════════════════════════════════════════════
// DASHBOARD-MAIN — Entry point for dashboard.html
// ═══════════════════════════════════════════════

import { openStockPicker, closeStockPicker } from './stockPicker.js';
import { getActiveCSV, saveSession, getActiveSessionId } from './session.js';

import { 
  loadDashboard, refreshDashboard, refreshPricesOnly, toggleRefreshPause, 
  setRefreshInterval, stopAutoRefresh, renderDashboard, switchDashUser, 
  sortHoldingsTable, setHoldingsView, toggleChartSection, restoreChartSection,
  toggleMainView , setPortfolioView , renderAllPortfolios, setAllPortfoliosView,
  sortAllPortfoliosTable
} from './dashboard.js';

import { setTimeFilter } from './charts.js';
import { showDashboard } from './utils.js';
import { exportPreviewHoldings, exportPortfolioCSV, exportPDF, toggleExportMenu } from './export.js';
import { openDrilldown } from './drilldown.js';
import { state } from './state.js';
import { processCSV } from './fileHandler.js';
import { fmt, pct, colorPnl } from './utils.js';
import { COLORS, destroyAllCharts } from './charts.js';
import { toggleBenchmark } from './charts.js';

import { toggleChartDisplayMode, restoreChartDisplayMode } from './charts.js';

import { restoreBenchmarks } from './charts.js';

import { initDataSourcePanel } from './dataSourcePanel.js';

// Add to window exports
window.toggleBenchmark = toggleBenchmark;
window.restoreBenchmarks = restoreBenchmarks;


// Expose globals
window.sortAllPortfoliosTable  = sortAllPortfoliosTable 
window.setAllPortfoliosView  = setAllPortfoliosView
window.renderAllPortfolios = renderAllPortfolios
window.toggleChartDisplayMode = toggleChartDisplayMode;
window.restoreChartDisplayMode = restoreChartDisplayMode;
window.toggleBenchmark = toggleBenchmark;
window.toggleMainView = toggleMainView;
window.toggleChartSection = toggleChartSection;
window.restoreChartSection = restoreChartSection;
window.setPortfolioView = setPortfolioView;
window.sortHoldingsTable = sortHoldingsTable;
window.setHoldingsView = setHoldingsView;
window.openStockPicker    = openStockPicker;
window.closeStockPicker   = closeStockPicker;
window.loadDashboard      = loadDashboard;
window.refreshDashboard   = refreshDashboard;
window.refreshPricesOnly  = refreshPricesOnly;
window.toggleRefreshPause = toggleRefreshPause;
window.setRefreshInterval = setRefreshInterval;
window.showDashboard      = showDashboard;
window.setTimeFilter      = setTimeFilter;
window.exportPreviewHoldings = exportPreviewHoldings;
window.exportPortfolioCSV    = exportPortfolioCSV;
window.exportPDF          = exportPDF;
window.toggleExportMenu   = toggleExportMenu;
window.openDrilldown      = openDrilldown;
window._destroyAllCharts  = destroyAllCharts;
window._stopAutoRefresh   = stopAutoRefresh;
window.switchDashUser     = switchDashUser;

// Update window.switchDashTab in dashboard-main.js
window.switchDashTab = function(tab, btn) {
  // Update active tab button
  document.querySelectorAll('.dash-tab').forEach(b => {
    b.classList.remove('active');
  });
  btn.classList.add('active');
  
  // Show/hide content
  const portfolioContent = document.getElementById('dash-tab-portfolio');
  const allPortfoliosContent = document.getElementById('dash-tab-all-portfolios');
  const userTabs = document.getElementById('dash-user-tabs');
  
  if (tab === 'portfolio') {
    if (portfolioContent) portfolioContent.style.display = 'block';
    if (allPortfoliosContent) allPortfoliosContent.style.display = 'none';
    // Show user tabs
    if (userTabs) {
      // Check if there are multiple users before showing
      const users = state.users || [];
      userTabs.style.display = users.length > 1 ? 'flex' : 'none';
    }
    
    // Force re-render dashboard with current data
    setTimeout(() => {
      if (typeof renderDashboard === 'function') {
        renderDashboard();
      } else if (typeof window.renderDashboard === 'function') {
        window.renderDashboard();
      }
      // Also force chart refresh
      if (typeof renderPortfolioDayChart === 'function') {
        renderPortfolioDayChart();
      }
      if (typeof renderTodayPnlChart === 'function') {
        const holdings = Object.values(state.holdings);
        renderTodayPnlChart(holdings);
      }
    }, 50);
  } else {
    if (portfolioContent) portfolioContent.style.display = 'none';
    if (allPortfoliosContent) allPortfoliosContent.style.display = 'block';
    // Hide user tabs
    if (userTabs) userTabs.style.display = 'none';
    
    // Render all portfolios
    setTimeout(() => {
      if (typeof renderAllPortfolios === 'function') {
        renderAllPortfolios();
      } else if (typeof window.renderAllPortfolios === 'function') {
        window.renderAllPortfolios();
      }
    }, 50);
  }
  
  // Save preference
  try {
    sessionStorage.setItem('dashboard_current_tab', tab);
  } catch(e) {}
};

// Update the switchDashUser function
window.switchDashUser = async function(user) {
  // First switch to portfolio tab
  const portfolioTab = document.querySelector('.dash-tab[data-tab="portfolio"]');
  if (portfolioTab) {
    window.switchDashTab('portfolio', portfolioTab);
  }
  
  // Then switch user
  if (typeof switchDashUser === 'function') {
    await switchDashUser(user);
  }
  
  // Ensure user tabs are visible
  const userTabs = document.getElementById('dash-user-tabs');
  if (userTabs) userTabs.style.display = 'flex';
};

// Update the DOMContentLoaded event handler - add this function after processCSV
// Add this helper function
// Fallback responsive handler (the real one lives in dashboard.js).
// On mobile: always card, no exceptions. On desktop: restore preference.
window.handleResponsiveAllPortfoliosView = function() {
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    if (typeof setAllPortfoliosView === 'function') setAllPortfoliosView('card');
    if (typeof setHoldingsView === 'function') setHoldingsView('card');
  } else {
    // Restore desktop preferences
    const apView = sessionStorage.getItem('all_portfolios_view') || 'table';
    const hView  = sessionStorage.getItem('holdings_view') || 'table';
    if (typeof setAllPortfoliosView === 'function') setAllPortfoliosView(apView);
    if (typeof setHoldingsView === 'function') setHoldingsView(hView);
  }
};

// Also add window.restoreChartSection properly
window.restoreChartSection = restoreChartSection;
window.handleResponsiveAllPortfoliosView = handleResponsiveAllPortfoliosView;

// Make sure updateAllPortfoliosStats is also exposed if needed
window.updateAllPortfoliosStats = function() {
  // This will be defined in dashboard.js
  if (typeof updateAllPortfoliosStats !== 'undefined') {
    updateAllPortfoliosStats();
  }
};

async function loadStocksDB() {
  return new Promise((resolve) => {
    if (window._stocksDb) {
      resolve();
      return;
    }
    const base = document.location.pathname.replace(/\/[^/]*$/, '') || '';
    fetch(base + '/data/stocks_db.json')
      .then(r => r.json())
      .then(db => {
        window._stocksDb = db;
        resolve();
      })
      .catch(() => resolve());
  });
}

// Function to conditionally show/hide All Portfolios tab based on number of users
function updateAllPortfoliosTabVisibility() {
  const users = state.users || [];
  const allPortfoliosTab = document.querySelector('.dash-tab[data-tab="all-portfolios"]');
  if (allPortfoliosTab) {
    if (users.length <= 1) {
      allPortfoliosTab.style.display = 'none';
      // If we're currently on this tab and it's hidden, switch to portfolio
      const currentTab = sessionStorage.getItem('dashboard_current_tab');
      if (currentTab === 'all-portfolios') {
        const portfolioTab = document.querySelector('.dash-tab[data-tab="portfolio"]');
        if (portfolioTab) {
          window.switchDashTab('portfolio', portfolioTab);
        }
      }
    } else {
      allPortfoliosTab.style.display = '';
    }
  }
}

// Set default tab based on number of users
function setDefaultTab() {
  const users = state.users || [];
  const defaultTab = users.length > 1 ? 'all-portfolios' : 'portfolio';
  
  // Only switch if current tab is not already set or is default
  const currentTab = sessionStorage.getItem('dashboard_current_tab');
  if (!currentTab || (currentTab !== 'all-portfolios' && currentTab !== 'portfolio')) {
    sessionStorage.setItem('dashboard_current_tab', defaultTab);
    const tabBtn = document.querySelector(`.dash-tab[data-tab="${defaultTab}"]`);
    if (tabBtn) {
      window.switchDashTab(defaultTab, tabBtn);
    }
  }
}

// Main DOMContentLoaded - ONLY ONE
document.addEventListener('DOMContentLoaded', async () => {
  await loadStocksDB();
  
  // Try sessionStorage first, then fall back to localStorage session
  let csv = sessionStorage.getItem('portfolio_csv');
  if (!csv) {
    csv = getActiveCSV(); // restore from saved session
    if (csv) {
      try { sessionStorage.setItem('portfolio_csv', csv); } catch (_e) {}
    }
  }

  if (!csv) {
    const holdingValues = Object.values(state.holdings);
    if (holdingValues.length > 0) {
      const rows = holdingValues.map(h =>
        `${h.ticker},${h.totalQty},${h.avgBuy.toFixed(4)},${h.earliestDate || ''},${h.upstoxTicker || ''}`
      );
      csv = 'ticker,quantity,average_buy_price,buy_date,upstox_ticker\n' + rows.join('\n');
      try { sessionStorage.setItem('portfolio_csv', csv); } catch (_e) {}
    } else {
      window.location.href = 'index.html';
      return;
    }
  }

  // Add resize listener for responsive views
  window.addEventListener('resize', () => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      // Mobile: always card, no table allowed
      if (typeof setAllPortfoliosView === 'function') setAllPortfoliosView('card');
      if (typeof setHoldingsView === 'function') setHoldingsView('card');
    } else {
      // Desktop: run the soft responsive handler (respects saved prefs)
      handleResponsiveAllPortfoliosView();
    }
  });

  // Parse CSV first to get user count BEFORE loading dashboard
  let userCount = 0;
  let parsedUsers = [];
  
  await new Promise((resolve) => {
    Papa.parse(csv, {
      header: true,
      skipEmptyLines: true,
      complete: async (r) => {
        // Process just enough to get users
        const rows = r.data;
        const userSet = new Set();
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rawUser = (row.user || row.User || row.USER || '').trim();
          const user = rawUser || 'User 1';
          userSet.add(user);
        }
        parsedUsers = Array.from(userSet);
        userCount = parsedUsers.length;
        
        // Now process the full CSV
        await processCSV(r.data);
        resolve();
      },
    });
  });
  
  // Determine default tab based on user count
  const defaultTab = userCount > 1 ? 'all-portfolios' : 'portfolio';
  
  // Check if there's a saved tab preference
  let savedTab = defaultTab;
  try {
    const stored = sessionStorage.getItem('dashboard_current_tab');
    if (stored && (stored === 'portfolio' || stored === 'all-portfolios')) {
      savedTab = stored;
    }
  } catch(e) {}
  
  // Set the tab in sessionStorage before dashboard loads
  try {
    sessionStorage.setItem('dashboard_current_tab', savedTab);
  } catch(e) {}
  
  // Show/hide All Portfolios tab based on user count
  const allPortfoliosTab = document.querySelector('.dash-tab[data-tab="all-portfolios"]');
  if (allPortfoliosTab) {
    if (userCount > 1) {
      allPortfoliosTab.style.display = '';  // Show the tab
    } else {
      allPortfoliosTab.style.display = 'none';  // Hide the tab
    }
  }
  
  // Update the active tab button visually before dashboard renders
  const tabBtn = document.querySelector(`.dash-tab[data-tab="${savedTab}"]`);
  if (tabBtn) {
    document.querySelectorAll('.dash-tab').forEach(b => {
      if (b.dataset && b.dataset.tab === savedTab) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
  }
  
  // Also hide/show the content containers before rendering
  const portfolioContent = document.getElementById('dash-tab-portfolio');
  const allPortfoliosContent = document.getElementById('dash-tab-all-portfolios');
  
  if (portfolioContent) {
    portfolioContent.style.display = savedTab === 'portfolio' ? 'block' : 'none';
  }
  if (allPortfoliosContent) {
    allPortfoliosContent.style.display = savedTab === 'all-portfolios' ? 'block' : 'none';
  }
  
  // Hide user tabs when on All Portfolios view
  const userTabs = document.getElementById('dash-user-tabs');
  if (userTabs) {
    userTabs.style.display = savedTab === 'all-portfolios' ? 'none' : 'flex';
  }
  
  await new Promise(r => setTimeout(r, 100));
  await loadDashboard();  // This will use the preset tab
  initDataSourcePanel();
  
  document.addEventListener('click', e => {
    const card = e.target.closest('.holding-card[data-ticker]');
    if (!card) return;
    if (e.ctrlKey || e.metaKey) {
      const ticker = card.dataset.ticker;
      const base = window.location.pathname.replace(/\/[^/]*$/, '') || '';
      window.open(base + '/screener.html?ticker=' + encodeURIComponent(ticker), '_blank');
      e.stopPropagation();
    }
  });
});

// Remove the duplicate DOMContentLoaded that was trying to restore the tab
// The modal-related functions can stay but aren't used
const modalSort = { key: 'currentVal', asc: false };

export function sortHoldingsModal(key) {
  if (modalSort.key === key) { modalSort.asc = !modalSort.asc; } else { modalSort.key = key; modalSort.asc = false; }
  renderHoldingsTable();
}

export function openHoldingsModal() {
  const modal = document.getElementById('holdings-modal');
  modal.style.display = 'flex';
  renderHoldingsTable();
  modal.addEventListener('refreshTable', renderHoldingsTable, { passive: true });
}

export function closeHoldingsModal() {
  const modal = document.getElementById('holdings-modal');
  modal.style.display = 'none';
  modal.removeEventListener('refreshTable', renderHoldingsTable);
}

function computeRow(h, totalCurrent, i) {
  const lp = state.livePrices[h.ticker];
  const pc = state.prevClosePrices[h.ticker];
  const currentVal = lp ? lp * h.totalQty : null;
  const pnlAbs = currentVal != null ? currentVal - h.invested : null;
  const pnlPct = pnlAbs != null ? (pnlAbs / h.invested) * 100 : null;
  const allocPct = totalCurrent && currentVal ? (currentVal / totalCurrent) * 100 : null;
  const dayChgAbs = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;
  const dayChgPct = (lp && pc && pc > 0) ? ((lp - pc) / pc) * 100 : null;
  return { h, lp, pc, currentVal, pnlAbs, pnlPct, allocPct, dayChgAbs, dayChgPct, color: COLORS[i % COLORS.length] };
}

function renderHoldingsTable() {
  const holdings = Object.values(state.holdings);
  let totalCurrent = 0;
  holdings.forEach(h => { const lp = state.livePrices[h.ticker]; if (lp) totalCurrent += lp * h.totalQty; });
  const rows = holdings.map((h, i) => computeRow(h, totalCurrent, i));
  rows.sort((a, b) => {
    let va, vb;
    switch (modalSort.key) {
      case 'ticker':     va = a.h.ticker;   vb = b.h.ticker;   break;
      case 'totalQty':   va = a.h.totalQty; vb = b.h.totalQty; break;
      case 'avgBuy':     va = a.h.avgBuy;   vb = b.h.avgBuy;   break;
      case 'livePrice':  va = a.lp ?? -Infinity; vb = b.lp ?? -Infinity; break;
      case 'prevClose':  va = a.pc ?? -Infinity; vb = b.pc ?? -Infinity; break;
      case 'invested':   va = a.h.invested; vb = b.h.invested; break;
      case 'currentVal': va = a.currentVal ?? -Infinity; vb = b.currentVal ?? -Infinity; break;
      case 'pnlAbs':     va = a.pnlAbs ?? -Infinity; vb = b.pnlAbs ?? -Infinity; break;
      case 'pnlPct':     va = a.pnlPct ?? -Infinity; vb = b.pnlPct ?? -Infinity; break;
      case 'dayChgAbs':  va = a.dayChgAbs ?? -Infinity; vb = b.dayChgAbs ?? -Infinity; break;
      case 'dayChgPct':  va = a.dayChgPct ?? -Infinity; vb = b.dayChgPct ?? -Infinity; break;
      case 'allocPct':   va = a.allocPct ?? -Infinity; vb = b.allocPct ?? -Infinity; break;
      default:           va = a.currentVal ?? -Infinity; vb = b.currentVal ?? -Infinity;
    }
    if (typeof va === 'string') return modalSort.asc ? va.localeCompare(vb) : vb.localeCompare(va);
    return modalSort.asc ? va - vb : vb - va;
  });

  document.querySelectorAll('.sortable-th').forEach(th => {
    const key = th.id.replace('mth-', '');
    const base = th.textContent.replace(/ [↑↓]$/, '');
    th.textContent = key === modalSort.key ? base + (modalSort.asc ? ' ↑' : ' ↓') : base;
  });

  const tbody = document.getElementById('holdings-modal-tbody');
  tbody.innerHTML = '';
  rows.forEach(({ h, lp, pc, currentVal, pnlAbs, pnlPct, allocPct, dayChgAbs, dayChgPct, color }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><div style="display:flex;align-items:center;gap:8px;"><div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></div><strong>${h.ticker}</strong></div></td>
      <td>${h.totalQty}</td>
      <td>${h.avgBuy.toFixed(2)}</td>
      <td>${lp ? lp.toFixed(2) : '—'}</td>
      <td style="color:var(--text2)">${pc ? pc.toFixed(2) : '—'}</td>
      <td>${fmt(h.invested)}</td>
      <td>${currentVal ? fmt(currentVal) : '—'}</td>
      <td style="color:${pnlAbs != null ? colorPnl(pnlAbs) : 'var(--text2)'}">${pnlAbs != null ? (pnlAbs >= 0 ? '+' : '') + fmt(Math.abs(pnlAbs)) : '—'}</td>
      <td style="color:${pnlPct != null ? colorPnl(pnlPct) : 'var(--text2)'}">${pnlPct != null ? pct(pnlPct) : '—'}</td>
      <td style="color:${dayChgAbs != null ? colorPnl(dayChgAbs) : 'var(--text2)'}">${dayChgAbs != null ? (dayChgAbs >= 0 ? '+' : '') + fmt(Math.abs(dayChgAbs)) : '—'}</td>
      <td style="color:${dayChgPct != null ? colorPnl(dayChgPct) : 'var(--text2)'}">${dayChgPct != null ? pct(dayChgPct) : '—'}</td>
      <td>${allocPct != null ? allocPct.toFixed(1) + '%' : '—'}</td>`;
    tr.style.cursor = 'pointer';
    tr.title = 'Click to view stock detail';
    tr.onclick = () => { closeHoldingsModal(); import('./drilldown.js').then(m => m.openDrilldown(h.ticker)); };
    tbody.appendChild(tr);
  });
}