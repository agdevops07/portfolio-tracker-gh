// ═══════════════════════════════════════════════
// EXPORT — Chart PNG + structured PDF export
// Uses canvas-based PDF rendering to ensure
// charts don't span across pages.
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { showToast } from './utils.js';

// ── Export holdings as CSV (with live prices) ──
export function exportHoldingsCSV() {
  const holdings = Object.values(state.holdings);
  
  if (!holdings || !holdings.length) {
    showToast('No holdings data to export.');
    closeExportMenu();
    return;
  }

  // Calculate total current value for allocation
  let totalCurrent = 0;
  holdings.forEach(h => {
    const lp = state.livePrices[h.ticker];
    if (lp) totalCurrent += lp * h.totalQty;
  });

  // CSV Header
  const header = ['Ticker', 'Quantity', 'Avg Buy Price', 'Invested (₹)', 'Live Price (₹)', 'Current Value (₹)', 'P&L (₹)', 'P&L (%)', 'Day Change (₹)', 'Day Change (%)', 'Allocation (%)'];
  
  // Build rows with live data
  const rows = holdings.map(h => {
    const lp = state.livePrices[h.ticker];
    const pc = state.prevClosePrices[h.ticker];
    const currentVal = lp ? lp * h.totalQty : null;
    const pnlAbs = currentVal != null ? currentVal - h.invested : null;
    const pnlPct = pnlAbs != null ? (pnlAbs / h.invested) * 100 : null;
    const allocPct = totalCurrent && currentVal ? (currentVal / totalCurrent) * 100 : null;
    const dayChgAbs = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;
    const dayChgPct = (lp && pc && pc > 0) ? ((lp - pc) / pc) * 100 : null;
    
    return [
      h.ticker,
      h.totalQty,
      h.avgBuy.toFixed(2),
      h.invested.toFixed(2),
      lp ? lp.toFixed(2) : 'N/A',
      currentVal ? currentVal.toFixed(2) : 'N/A',
      pnlAbs ? (pnlAbs >= 0 ? '+' : '') + pnlAbs.toFixed(2) : 'N/A',
      pnlPct ? (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2) : 'N/A',
      dayChgAbs ? (dayChgAbs >= 0 ? '+' : '') + dayChgAbs.toFixed(2) : 'N/A',
      dayChgPct ? (dayChgPct >= 0 ? '+' : '') + dayChgPct.toFixed(2) : 'N/A',
      allocPct ? allocPct.toFixed(2) : 'N/A'
    ];
  });

  // Convert to CSV string
  const csvContent = [header, ...rows].map(row => row.join(',')).join('\n');
  
  // Download file
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().slice(0, 10);
  a.download = `portfolio-holdings-${ts}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('Holdings exported as CSV!');
  closeExportMenu();
}

// ── Export full dashboard as PDF ─────────────────
// Uses a structured approach: captures each chart card
// as a canvas image and builds a clean multi-page PDF
// using only browser APIs (no external libs needed).
export async function exportPDF() {
  closeExportMenu();
  showToast('Preparing PDF…');

  // Small delay to let the menu close
  await new Promise(r => setTimeout(r, 100));

  // Collect all chart canvases from visible cards
  const chartIds = [
    { id: 'portfolioChart',    title: 'Portfolio Value Over Time' },
    { id: 'portfolioDayChart', title: 'Portfolio Today (Intraday)' },
    { id: 'pieChart',          title: 'Allocation' },
    { id: 'pnlChart',          title: 'P&L by Stock (Overall)' },
    { id: 'todayPnlChart',     title: "Today's P&L" },
  ];

  // Build a hidden print container
  const printWin = window.open('', '_blank', 'width=900,height=700');
  if (!printWin) {
    showToast('Pop-up blocked — please allow pop-ups for PDF export');
    return;
  }

  // Gather stat card data
  const statCardsHtml = document.getElementById('stat-cards')?.innerHTML || '';

  // Capture each chart canvas as a data URL
  const chartImgs = [];
  for (const { id, title } of chartIds) {
    const canvas = document.getElementById(id);
    if (!canvas) continue;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      chartImgs.push({ title, dataUrl });
    } catch (e) { /* skip if canvas is tainted */ }
  }

  // Build holdings table HTML from state with live data
  const holdings = Object.values(state.holdings);
  let totalCurrent = 0;
  holdings.forEach(h => {
    const lp = state.livePrices[h.ticker];
    if (lp) totalCurrent += lp * h.totalQty;
  });
  
  let holdingsRows = '';
  holdings.forEach(h => {
    const lp  = state.livePrices[h.ticker];
    const pc  = state.prevClosePrices[h.ticker];
    const cv  = lp ? lp * h.totalQty : null;
    const pnl = cv != null ? cv - h.invested : null;
    const pnlPct = pnl != null ? (pnl / h.invested * 100).toFixed(2) : '—';
    const dayChgAbs = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;
    const dayChgPct = (lp && pc && pc > 0) ? ((lp - pc) / pc * 100).toFixed(2) : '—';
    const allocPct = totalCurrent && cv ? (cv / totalCurrent * 100).toFixed(1) : '—';
    const pnlColor = pnl != null ? (pnl >= 0 ? '#22c55e' : '#ef4444') : '#888';
    holdingsRows += `<tr>
      <td><strong>${h.ticker}</strong></td>
      <td>${h.totalQty}</td>
      <td>₹${h.avgBuy.toFixed(2)}</td>
      <td>${lp ? '₹' + lp.toFixed(2) : '—'}</td>
      <td>₹${h.invested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
      <td>${cv ? '₹' + cv.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}</td>
      <td style="color:${pnlColor}">${pnl != null ? (pnl >= 0 ? '+' : '') + '₹' + Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}</td>
      <td style="color:${pnlColor}">${pnl != null ? (pnl >= 0 ? '+' : '') + pnlPct + '%' : '—'}</td>
      <td style="color:${dayChgPct !== '—' ? (parseFloat(dayChgPct) >= 0 ? '#22c55e' : '#ef4444') : '#888'}">${dayChgAbs ? (dayChgAbs >= 0 ? '+' : '') + '₹' + Math.abs(dayChgAbs).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}</td>
      <td style="color:${dayChgPct !== '—' ? (parseFloat(dayChgPct) >= 0 ? '#22c55e' : '#ef4444') : '#888'}">${dayChgPct !== '—' ? (parseFloat(dayChgPct) >= 0 ? '+' : '') + dayChgPct + '%' : '—'}</td>
      <td>${allocPct !== '—' ? allocPct + '%' : '—'}</td>
    </tr>`;
  });

  // Chart image blocks — each forced onto its own page section
  const chartBlocks = chartImgs.map(({ title, dataUrl }) => `
    <div class="chart-block">
      <h3 class="chart-block-title">${title}</h3>
      <img src="${dataUrl}" alt="${title}" />
    </div>`).join('');

  const exportDate = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  printWin.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Portfolio Report — ${exportDate}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; background: white; font-size: 12px; }

    /* ── Cover / Header ── */
    .cover { padding: 32px 40px 20px; border-bottom: 2px solid #e5e5e5; margin-bottom: 24px; }
    .cover h1 { font-size: 24px; font-weight: 700; color: #1a1a1a; }
    .cover p  { color: #666; margin-top: 6px; font-size: 12px; }

    /* ── Stat summary grid ── */
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; padding: 0 40px; margin-bottom: 28px; }
    .stat-item { border: 1px solid #e5e5e5; border-radius: 8px; padding: 12px 16px; }
    .stat-item .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 4px; }
    .stat-item .val { font-size: 18px; font-weight: 700; }

    /* ── Charts — each on its own block, never split ── */
    .charts-section { padding: 0 40px; }
    .chart-block {
      break-inside: avoid;
      page-break-inside: avoid;
      margin-bottom: 28px;
      border: 1px solid #e8e8e8;
      border-radius: 8px;
      overflow: hidden;
    }
    .chart-block-title {
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 600;
      color: #333;
      background: #f7f7f7;
      border-bottom: 1px solid #e8e8e8;
    }
    .chart-block img {
      display: block;
      width: 100%;
      height: auto;
      max-height: 280px;
      object-fit: contain;
      background: white;
      padding: 8px;
    }

    /* ── Holdings table ── */
    .holdings-section { padding: 0 40px; break-before: page; page-break-before: always; }
    .holdings-section h2 { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #f0f0f0; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 8px 10px; text-align: left; border-bottom: 2px solid #ddd; }
    td { padding: 7px 10px; border-bottom: 1px solid #eee; }
    tr:last-child td { border-bottom: none; }
    .text-right { text-align: right; }

    /* ── Print rules ── */
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .chart-block { break-inside: avoid; page-break-inside: avoid; }
      .holdings-section { break-before: page; }
    }
  </style>
</head>
<body>

<div class="cover">
  <h1>📈 Portfolio Report</h1>
  <p>Generated on ${exportDate}</p>
</div>

<div class="stat-grid">
  ${statCardsHtml.replace(/style="[^"]*color:[^"]*"/g, 'style="color:#111"')}
</div>

<div class="charts-section">
  ${chartBlocks}
</div>

<div class="holdings-section">
  <h2>Holdings Detail</h2>
  <table>
    <thead>
      <tr>
        <th>Ticker</th><th>Qty</th><th>Avg Buy</th><th>Live Price</th>
        <th>Invested</th><th>Current Val</th><th>P&L (₹)</th><th>P&L %</th><th>Day P&L</th><th>Day %</th><th>Allocation</th>
      </tr>
    </thead>
    <tbody>${holdingsRows}</tbody>
   </table>
</div>

<script>
  window.onload = function() { window.print(); };
</script>
</body>
</html>`);

  printWin.document.close();
  showToast('PDF ready — print dialog opening');
}

// ── Export dropdown toggle ───────────────────────
export function toggleExportMenu() {
  const menu = document.getElementById('export-menu');
  if (!menu) return;
  
  const isOpen = menu.style.display === 'block';
  menu.style.display = isOpen ? 'none' : 'block';
  
  if (!isOpen) {
    // Close menu when clicking outside
    const closeHandler = (e) => {
      const dropdown = document.getElementById('export-dropdown');
      if (dropdown && !dropdown.contains(e.target)) {
        menu.style.display = 'none';
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closeHandler);
    }, 100);
  }
}

export function closeExportMenu() {
  const menu = document.getElementById('export-menu');
  if (menu) menu.style.display = 'none';
}