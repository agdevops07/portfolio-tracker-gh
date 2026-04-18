// ═══════════════════════════════════════════════
// EXPORT — Chart PNG + structured PDF export
// Uses canvas-based PDF rendering to ensure
// charts don't span across pages.
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { showToast } from './utils.js';

// ── Export holdings as CSV (with live prices) ──
// ── Helper: compute one holding row ──────────────────
function _buildHoldingRow(h, totalCurrent) {
  const lp  = state.livePrices[h.ticker];
  const pc  = state.prevClosePrices[h.ticker];
  const cv  = lp ? lp * h.totalQty : null;
  const pnl = cv != null ? cv - h.invested : null;
  const pnlPct    = pnl != null ? (pnl / h.invested) * 100 : null;
  const alloc     = totalCurrent && cv ? (cv / totalCurrent) * 100 : null;
  const dayChgAbs = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;
  const dayChgPct = (lp && pc && pc > 0) ? ((lp - pc) / pc) * 100 : null;
  const sign = v => v != null ? (v >= 0 ? '+' : '') + v.toFixed(2) : 'N/A';
  return [
    (h.users && h.users.length ? h.users.join('/') : (h.user || 'User 1')),
    h.ticker,
    h.earliestDate || 'N/A',
    h.totalQty,
    h.avgBuy.toFixed(2),
    h.invested.toFixed(2),
    lp   ? lp.toFixed(2)  : 'N/A',
    cv   ? cv.toFixed(2)  : 'N/A',
    sign(pnl),
    sign(pnlPct),
    sign(dayChgAbs),
    sign(dayChgPct),
    alloc ? alloc.toFixed(2) : 'N/A',
  ];
}

export function exportHoldingsCSV() {
  const rawRows = state.rawRows || [];
  const users   = state.users  || [];

  if (!rawRows.length && !Object.keys(state.holdings).length) {
    showToast('No holdings data to export.');
    closeExportMenu();
    return;
  }

  const HEADER = [
    'User', 'Ticker', 'Buy Date', 'Quantity', 'Avg Buy Price',
    'Invested', 'Live Price', 'Current Value',
    'P&L', 'P&L (%)', 'Day Change', 'Day Change (%)', 'Allocation (%)',
  ];

  const lines = [];
  const exportDate = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  lines.push([`# Portfolio Export — ${exportDate}`]);
  lines.push([]);

  // ── Multi-user: one section per user ──────────────────────────────────────
  if (users.length > 1) {
    const { aggregateHoldings, getFilteredHoldings } = _getAggFns();

    users.forEach(user => {
      const userHoldings = Object.values(getFilteredHoldings(rawRows, user));
      if (!userHoldings.length) return;

      // Compute user totals
      let totalInvested = 0, totalCurrent = 0, totalPnl = 0, totalDayChg = 0;
      userHoldings.forEach(h => {
        const lp = state.livePrices[h.ticker];
        const pc = state.prevClosePrices[h.ticker];
        totalInvested += h.invested;
        if (lp) {
          const cv = lp * h.totalQty;
          totalCurrent += cv;
          totalPnl     += cv - h.invested;
          if (pc && pc > 0) totalDayChg += (lp - pc) * h.totalQty;
        }
      });
      const pnlPct = totalInvested ? (totalPnl / totalInvested * 100) : 0;

      lines.push([`## ${user}`]);
      lines.push([
        `Invested: ${totalInvested.toFixed(2)}`,
        `Current: ${totalCurrent ? totalCurrent.toFixed(2) : 'N/A'}`,
        `P&L: ${totalPnl ? (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(2) : 'N/A'} (${(pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2)}%)`,
        `Day Change: ${totalDayChg ? (totalDayChg >= 0 ? '+' : '') + totalDayChg.toFixed(2) : 'N/A'}`,
      ]);
      lines.push(HEADER);
      userHoldings.forEach(h => lines.push(_buildHoldingRow(h, totalCurrent)));
      lines.push([]); // blank separator
    });

  } else {
    // ── Single user / no user column ─────────────────────────────────────────
    const holdings = Object.values(state.holdings);
    let totalCurrent = 0;
    holdings.forEach(h => { const lp = state.livePrices[h.ticker]; if (lp) totalCurrent += lp * h.totalQty; });
    lines.push(HEADER);
    holdings.forEach(h => lines.push(_buildHoldingRow(h, totalCurrent)));
  }

  const csvContent = lines.map(row => row.join ? row.join(',') : row).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `portfolio-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  showToast('Holdings exported!');
  closeExportMenu();
}

// Lazy import aggregation helpers to avoid circular deps
function _getAggFns() {
  // fileHandler exports are available via dynamic import but for simplicity
  // we inline a minimal aggregation here using state.rawRows
  function aggregateHoldings(rows) {
    const map = {};
    rows.forEach(r => {
      if (!map[r.ticker]) {
        map[r.ticker] = { ticker: r.ticker, totalQty: 0, totalCost: 0, dates: [], users: [], upstoxTicker: r.upstoxTicker || null };
      }
      map[r.ticker].totalQty  += r.qty;
      map[r.ticker].totalCost += r.qty * r.avg;
      if (r.date) map[r.ticker].dates.push(r.date);
      if (r.user && !map[r.ticker].users.includes(r.user)) map[r.ticker].users.push(r.user);
    });
    Object.values(map).forEach(h => {
      h.avgBuy       = h.totalCost / h.totalQty;
      h.invested     = h.totalCost;
      h.earliestDate = h.dates.length ? h.dates.sort()[0] : null;
    });
    return map;
  }
  function getFilteredHoldings(rawRows, user) {
    if (!user || user === 'all') return aggregateHoldings(rawRows);
    return aggregateHoldings(rawRows.filter(r => r.user === user));
  }
  return { aggregateHoldings, getFilteredHoldings };
}

// ── Capture a canvas by ID → { title, dataUrl } or null ──
function captureCanvas(canvasId, title) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
  try {
    const dataUrl = canvas.toDataURL('image/png');
    // dataUrl shorter than ~1KB means a blank/empty canvas — skip it
    return dataUrl && dataUrl.length > 1000 ? { title, dataUrl } : null;
  } catch (e) {
    return null;
  }
}

// ── Click a button and wait ms ──
async function clickAndWait(btn, ms = 400) {
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, ms));
}

// ── Poll until a canvas has painted content (up to maxMs) ──
async function waitForCanvas(canvasId, maxMs = 1200) {
  const step = 80;
  let waited = 0;
  while (waited < maxMs) {
    const canvas = document.getElementById(canvasId);
    if (canvas && canvas.width > 0 && canvas.height > 0) return;
    await new Promise(r => setTimeout(r, step));
    waited += step;
  }
}

// ── Export full dashboard as PDF ─────────────────
export async function exportPDF() {
  closeExportMenu();
  showToast('Preparing PDF — capturing all charts…');
  await new Promise(r => setTimeout(r, 150));

  // ── Remember current UI state so we can restore it ──
  const wasHoldingsActive = document.getElementById('holdings-main-view')?.style.display !== 'none';
  const activeChartBtnId  = document.querySelector('#charts-subtoggles .chart-toggle-btn.active')?.id;

  const chartImgs = [];

  // ── 1. Switch to Charts main view ──
  await clickAndWait(document.getElementById('main-toggle-charts-btn'), 300);

  // ── 2. Capture Intraday ──
  await clickAndWait(document.getElementById('toggle-intraday-btn'), 500);
  await waitForCanvas('portfolioDayChart');
  const intradayImg = captureCanvas('portfolioDayChart', 'Portfolio Today (Intraday)');
  if (intradayImg) chartImgs.push(intradayImg);

  // ── 3. Capture Historical ──
  await clickAndWait(document.getElementById('toggle-historical-btn'), 500);
  await waitForCanvas('portfolioChart');
  const historicalImg = captureCanvas('portfolioChart', 'Portfolio Value Over Time');
  if (historicalImg) chartImgs.push(historicalImg);

  // ── 4. Capture P&L charts ──
  await clickAndWait(document.getElementById('toggle-pnl-btn'), 600);
  await waitForCanvas('pnlChart');
  const pieImg      = captureCanvas('pieChart',      'Allocation');
  const pnlImg      = captureCanvas('pnlChart',      'Overall P&L by Stock');
  const todayPnlImg = captureCanvas('todayPnlChart', "Today's P&L by Stock");
  if (pieImg)      chartImgs.push(pieImg);
  if (pnlImg)      chartImgs.push(pnlImg);
  if (todayPnlImg) chartImgs.push(todayPnlImg);

  // ── 5. Restore original UI state ──
  if (wasHoldingsActive) {
    await clickAndWait(document.getElementById('main-toggle-holdings-btn'), 100);
  } else if (activeChartBtnId) {
    document.getElementById(activeChartBtnId)?.click();
  }

  // ── 6. Build PDF window ──
  const printWin = window.open('', '_blank', 'width=900,height=700');
  if (!printWin) {
    showToast('Pop-up blocked — please allow pop-ups for PDF export');
    return;
  }

  const statCardsHtml = document.getElementById('stat-cards')?.innerHTML || '';

  // Holdings table rows
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
    const pnlPct    = pnl != null ? (pnl / h.invested * 100).toFixed(2) : '—';
    const dayChgAbs = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;
    const dayChgPct = (lp && pc && pc > 0) ? ((lp - pc) / pc * 100).toFixed(2) : '—';
    const allocPct  = totalCurrent && cv ? (cv / totalCurrent * 100).toFixed(1) : '—';
    const pnlColor  = pnl != null ? (pnl >= 0 ? '#22c55e' : '#ef4444') : '#888';
    const dayColor  = dayChgPct !== '—' ? (parseFloat(dayChgPct) >= 0 ? '#22c55e' : '#ef4444') : '#888';
    holdingsRows += `<tr>
      <td><strong>${h.ticker}</strong></td>
      <td>${h.totalQty}</td>
      <td>₹${h.avgBuy.toFixed(2)}</td>
      <td>${lp ? '₹' + lp.toFixed(2) : '—'}</td>
      <td>₹${h.invested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
      <td>${cv ? '₹' + cv.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}</td>
      <td style="color:${pnlColor}">${pnl != null ? (pnl >= 0 ? '+' : '') + '₹' + Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}</td>
      <td style="color:${pnlColor}">${pnl != null ? (pnl >= 0 ? '+' : '') + pnlPct + '%' : '—'}</td>
      <td style="color:${dayColor}">${dayChgAbs ? (dayChgAbs >= 0 ? '+' : '') + '₹' + Math.abs(dayChgAbs).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}</td>
      <td style="color:${dayColor}">${dayChgPct !== '—' ? (parseFloat(dayChgPct) >= 0 ? '+' : '') + dayChgPct + '%' : '—'}</td>
      <td>${allocPct !== '—' ? allocPct + '%' : '—'}</td>
    </tr>`;
  });

  const chartBlocks = chartImgs.length
    ? chartImgs.map(({ title, dataUrl }) => `
        <div class="chart-block">
          <h3 class="chart-block-title">${title}</h3>
          <img src="${dataUrl}" alt="${title}" />
        </div>`).join('')
    : '<p style="padding:20px;color:#888;font-style:italic;">No charts captured.</p>';

  const exportDate = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  printWin.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Portfolio Report — ${exportDate}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; background: white; font-size: 12px; }
    .cover { padding: 32px 40px 20px; border-bottom: 2px solid #e5e5e5; margin-bottom: 24px; }
    .cover h1 { font-size: 24px; font-weight: 700; color: #1a1a1a; }
    .cover p  { color: #666; margin-top: 6px; font-size: 12px; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; padding: 0 40px; margin-bottom: 28px; }
    .stat-item { border: 1px solid #e5e5e5; border-radius: 8px; padding: 12px 16px; }
    .stat-item .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 4px; }
    .stat-item .val { font-size: 18px; font-weight: 700; }
    .charts-section { padding: 0 40px; }
    .chart-block { break-inside: avoid; page-break-inside: avoid; margin-bottom: 28px; border: 1px solid #e8e8e8; border-radius: 8px; overflow: hidden; }
    .chart-block-title { padding: 10px 16px; font-size: 13px; font-weight: 600; color: #333; background: #f7f7f7; border-bottom: 1px solid #e8e8e8; }
    .chart-block img { display: block; width: 100%; height: auto; max-height: 300px; object-fit: contain; background: white; padding: 8px; }
    .holdings-section { padding: 0 40px; break-before: page; page-break-before: always; }
    .holdings-section h2 { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #f0f0f0; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 8px 10px; text-align: left; border-bottom: 2px solid #ddd; }
    td { padding: 7px 10px; border-bottom: 1px solid #eee; }
    tr:last-child td { border-bottom: none; }
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
  <div class="charts-section">${chartBlocks}</div>
  <div class="holdings-section">
    <h2>Holdings Detail</h2>
    <table>
      <thead>
        <tr>
          <th>Ticker</th><th>Qty</th><th>Avg Buy</th><th>Live Price</th>
          <th>Invested</th><th>Current Val</th><th>P&L (₹)</th><th>P&L %</th>
          <th>Day P&L</th><th>Day %</th><th>Allocation</th>
        </tr>
      </thead>
      <tbody>${holdingsRows}</tbody>
    </table>
  </div>
  <script>window.onload = function() { window.print(); };<\/script>
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
    const closeHandler = (e) => {
      const dropdown = document.getElementById('export-dropdown');
      if (dropdown && !dropdown.contains(e.target)) {
        menu.style.display = 'none';
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 100);
  }
}

export function closeExportMenu() {
  const menu = document.getElementById('export-menu');
  if (menu) menu.style.display = 'none';
}