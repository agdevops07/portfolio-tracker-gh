// ═══════════════════════════════════════════════
// EXPORT
// 1. exportPreviewHoldings — re-importable flat CSV
// 2. exportPortfolioCSV    — live snapshot with P&L (All + per user)
// 3. exportPDF             — professional jsPDF report
// ═══════════════════════════════════════════════

import { state } from './state.js';
import { showToast } from './utils.js';

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT 1 — Re-importable holdings (raw lots, flat)
// ─────────────────────────────────────────────────────────────────────────────
export function exportPreviewHoldings() {
  const rawRows = state.rawRows || [];
  if (!rawRows.length) { showToast('No holdings data to export.'); closeExportMenu(); return; }

  const HEADER = ['ticker', 'quantity', 'average_buy_price', 'buy_date', 'upstox_ticker', 'user'];
  const esc    = (v) => { const s = String(v ?? ''); return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toRow  = (r) => [r.ticker || '', r.qty ?? '', r.avg ?? '', r.date || '', r.upstoxTicker || '', r.user || 'User 1'].map(esc).join(',');

  const lines = [HEADER.join(',')];
  rawRows.forEach((r) => lines.push(toRow(r)));

  _downloadCSV(lines.join('\n'), `holdings-${_isoDate()}.csv`);
  showToast('Holdings exported');
  closeExportMenu();
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT 2 — Portfolio snapshot (aggregated, All + per user)
// ─────────────────────────────────────────────────────────────────────────────
export function exportPortfolioCSV() {
  const rawRows = state.rawRows || [];
  const users   = state.users   || [];

  if (!rawRows.length && !Object.keys(state.holdings).length) {
    showToast('No holdings data to export.');
    return;
  }

  const HEADER = ['Section', 'Ticker', 'Qty', 'Avg Buy', 'Invested', 'Live Price', 'Current Value', 'P&L', 'P&L %', 'Day Change', 'Day Change %', 'Allocation %'];
  const sign   = (v) => v != null ? (v >= 0 ? '+' : '') + v.toFixed(2) : 'N/A';
  const { getFilteredHoldings } = _getAggFns();

  const buildRows = (holdings, label) => {
    let totalCurrent = 0;
    holdings.forEach((h) => { const lp = state.livePrices[h.ticker]; if (lp) totalCurrent += lp * h.totalQty; });
    return holdings.map((h) => {
      const lp  = state.livePrices[h.ticker];
      const pc  = state.prevClosePrices[h.ticker];
      const cv  = lp ? lp * h.totalQty : null;
      const pnl = cv != null ? cv - h.invested : null;
      return [
        label, h.ticker, h.totalQty,
        h.avgBuy   != null ? h.avgBuy.toFixed(2)   : 'N/A',
        h.invested != null ? h.invested.toFixed(2)  : 'N/A',
        lp ? lp.toFixed(2) : 'N/A',
        cv ? cv.toFixed(2) : 'N/A',
        sign(pnl),
        sign(pnl != null ? (pnl / h.invested) * 100 : null),
        sign((lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null),
        sign((lp && pc && pc > 0) ? ((lp - pc) / pc) * 100   : null),
        (totalCurrent && cv) ? (cv / totalCurrent * 100).toFixed(2) : 'N/A',
      ].join(',');
    });
  };

  const lines = [HEADER.join(',')];

  if (users.length > 1) {
    // All aggregate first
    buildRows(Object.values(getFilteredHoldings(rawRows, 'all')), 'All').forEach((r) => lines.push(r));
    // Then per user
    users.forEach((user) => {
      const h = Object.values(getFilteredHoldings(rawRows, user));
      if (h.length) buildRows(h, user).forEach((r) => lines.push(r));
    });
  } else {
    const holdings = Object.values(state.holdings);
    buildRows(holdings, users[0] || holdings[0]?.users?.[0] || 'User 1').forEach((r) => lines.push(r));
  }

  _downloadCSV(lines.join('\n'), `portfolio-${_isoDate()}.csv`);
  showToast('Portfolio exported');
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT 3 — Professional PDF via jsPDF + autotable
// ─────────────────────────────────────────────────────────────────────────────
export async function exportPDF() {
  closeExportMenu();

  const exportBtn = document.getElementById('export-btn');
  _setPdfBtnState(exportBtn, true);
  showToast('Building PDF...');

  // Capture charts first (UI must be live)
  const chartImgs = await _captureAllCharts();

  try {
    const JsPDF = await _loadJsPDF();
    const doc   = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const users   = state.users || [];
    const isMulti = users.length > 1;
    const { getFilteredHoldings } = _getAggFns();
    const exportDate = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

    // Cover band
    _drawCoverBand(doc, exportDate);
    let y = 52;

    // Summary — all portfolio
    const allHoldings = Object.values(isMulti ? getFilteredHoldings(state.rawRows, 'all') : state.holdings);
    y = _drawSummaryCards(doc, _computeSummary(allHoldings), y);

    // Charts
    if (chartImgs.length) y = _drawCharts(doc, chartImgs, y);

    // Holdings tables
    if (isMulti) {
      // All combined
      doc.addPage();
      y = _drawSectionHeader(doc, 'All Portfolios — Combined Holdings', 14);
      _drawHoldingsTable(doc, allHoldings, y);

      // Per user
      users.forEach((user) => {
        const userHoldings = Object.values(getFilteredHoldings(state.rawRows, user));
        if (!userHoldings.length) return;
        doc.addPage();
        y = _drawSectionHeader(doc, `${user}`, 14);
        y = _drawSummaryCards(doc, _computeSummary(userHoldings), y, true);
        _drawHoldingsTable(doc, userHoldings, y);
      });
    } else {
      if (y > 180) { doc.addPage(); y = 14; }
      y = _drawSectionHeader(doc, 'Holdings', y);
      _drawHoldingsTable(doc, allHoldings, y);
    }

    _addPageNumbers(doc);
    doc.save(`portfolio-report-${_isoDate()}.pdf`);
    showToast('PDF downloaded');
  } catch (err) {
    console.error('PDF export error:', err);
    showToast('PDF export failed — check console');
  } finally {
    _setPdfBtnState(exportBtn, false);
  }
}

// =============================================================================
// PDF DRAWING HELPERS
// =============================================================================

const C = {
  navy  : [15,  23,  42],
  accent: [99,  102, 241],
  green : [34,  197, 94],
  red   : [239, 68,  68],
  white : [255, 255, 255],
  bg    : [248, 250, 252],
  border: [226, 232, 240],
  text  : [15,  23,  42],
  muted : [100, 116, 139],
};
const PAGE_W = 210;
const L_MAR  = 14;
const R_MAR  = 14;
const BODY_W = PAGE_W - L_MAR - R_MAR;

function _drawCoverBand(doc, exportDate) {
  doc.setFillColor(...C.navy);
  doc.rect(0, 0, PAGE_W, 42, 'F');
  doc.setFillColor(...C.accent);
  doc.rect(0, 40, PAGE_W, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...C.white);
  doc.text('Folio', L_MAR, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(180, 190, 210);
  doc.text('Portfolio Report', L_MAR, 24);

  doc.setFontSize(9);
  doc.setTextColor(160, 170, 195);
  doc.text(`Generated: ${exportDate}`, PAGE_W - R_MAR, 24, { align: 'right' });
}

function _drawSummaryCards(doc, s, startY, compact = false) {
  const cardH = compact ? 16 : 20;
  const gap   = 4;
  const cardW = (BODY_W - gap * 3) / 4;

  const cards = [
    { label: 'Invested',      value: `${_fmtIN(s.totalInvested)}`,  color: C.text },
    { label: 'Current Value', value: `${_fmtIN(s.totalCurrent)}`,   color: C.text },
    { label: 'Overall P&L',   value: `${_fmtIN(Math.abs(s.totalPnl))}`, color: s.totalPnl >= 0 ? C.green : C.red, prefix: s.totalPnl >= 0 ? '+' : '-' },
    { label: 'Day Change',    value: `${_fmtIN(Math.abs(s.totalDayChg))}`, color: s.totalDayChg >= 0 ? C.green : C.red, prefix: s.totalDayChg >= 0 ? '+' : '-' },
  ];

  cards.forEach((card, i) => {
    const x = L_MAR + i * (cardW + gap);
    doc.setFillColor(...C.bg);
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, startY, cardW, cardH, 2, 2, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...C.muted);
    doc.text(card.label.toUpperCase(), x + 3, startY + 5.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(compact ? 8.5 : 9.5);
    doc.setTextColor(...card.color);
    const displayVal = `${card.prefix || ''}${card.value}`;
    doc.text(displayVal, x + 3, startY + cardH - 4.5);

    if (i === 2 && s.totalInvested > 0) {
      const pct = s.totalPnl / s.totalInvested * 100;
      doc.setFontSize(7);
      doc.text(` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`, x + 3 + doc.getTextWidth(displayVal), startY + cardH - 4.5);
    }
  });

  return startY + cardH + 8;
}

function _drawCharts(doc, chartImgs, startY) {
  let y = startY;
  const wide  = chartImgs.filter((c) => !c.title.includes('P&L') && !c.title.includes('Allocation'));
  const pairs = chartImgs.filter((c) =>  c.title.includes('P&L') ||  c.title.includes('Allocation'));

  wide.forEach((img) => {
    if (y + 60 > 275) { doc.addPage(); y = 14; }
    _drawChartBlock(doc, img, L_MAR, y, BODY_W, 60);
    y += 65;
  });

  for (let i = 0; i < pairs.length; i += 2) {
    const colW = (BODY_W - 4) / 2;
    if (y + 55 > 275) { doc.addPage(); y = 14; }
    _drawChartBlock(doc, pairs[i], L_MAR, y, colW, 55);
    if (pairs[i + 1]) _drawChartBlock(doc, pairs[i + 1], L_MAR + colW + 4, y, colW, 55);
    y += 60;
  }
  return y;
}

function _drawChartBlock(doc, img, x, y, w, h) {
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 2, 2, 'FD');

  doc.setFillColor(...C.bg);
  doc.roundedRect(x, y, w, 7, 2, 2, 'F');
  doc.rect(x, y + 4, w, 3, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.text);
  doc.text(img.title, x + 3, y + 5);

  try { doc.addImage(img.dataUrl, 'PNG', x + 2, y + 9, w - 4, h - 11, '', 'FAST'); } catch (_) {}
}

function _drawSectionHeader(doc, title, y) {
  doc.setFillColor(...C.accent);
  doc.rect(L_MAR, y, 3, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...C.navy);
  doc.text(title, L_MAR + 6, y + 5.5);
  return y + 12;
}

function _drawHoldingsTable(doc, holdings, startY) {
  if (!holdings.length) return startY;

  let totalCurrent = 0;
  holdings.forEach((h) => { const lp = state.livePrices[h.ticker]; if (lp) totalCurrent += lp * h.totalQty; });

  const head = [['Ticker', 'Qty', 'Avg Buy', 'Live', 'Invested', 'Cur. Val', 'P&L', 'P&L %', 'Day Chg', 'Day %', 'Alloc']];
  const body = holdings.map((h) => {
    const lp  = state.livePrices[h.ticker];
    const pc  = state.prevClosePrices[h.ticker];
    const cv  = lp ? lp * h.totalQty : null;
    const pnl = cv != null ? cv - h.invested : null;
    const pnlPct    = pnl != null ? (pnl / h.invested * 100) : null;
    const dayChgAbs = (lp && pc && pc > 0) ? (lp - pc) * h.totalQty : null;
    const dayChgPct = (lp && pc && pc > 0) ? ((lp - pc) / pc * 100) : null;
    const alloc     = totalCurrent && cv ? (cv / totalCurrent * 100) : null;
    const s = (v, abs) => v != null ? `${v >= 0 ? '+' : ''}${abs ? _fmtIN(Math.abs(v)) : v.toFixed(1) + '%'}` : '—';
    return [
      h.ticker,
      h.totalQty,
      h.avgBuy ? `${h.avgBuy.toFixed(1)}` : '—',
      lp  ? `${lp.toFixed(1)}`  : '—',
      h.invested ? `${_fmtIN(h.invested)}` : '—',
      cv  ? `${_fmtIN(cv)}`  : '—',
      pnl != null ? `${pnl >= 0 ? '+' : '-'}${_fmtIN(Math.abs(pnl))}` : '—',
      pnlPct != null ? s(pnlPct, false) : '—',
      dayChgAbs != null ? `${dayChgAbs >= 0 ? '+' : '-'}${_fmtIN(Math.abs(dayChgAbs))}` : '—',
      dayChgPct != null ? s(dayChgPct, false) : '—',
      alloc ? `${alloc.toFixed(1)}%` : '—',
    ];
  });

  doc.autoTable({
    head, body, startY,
    margin      : { left: L_MAR, right: R_MAR },
    styles      : { font: 'helvetica', fontSize: 7.5, cellPadding: { top: 3, bottom: 3, left: 2, right: 2 }, lineColor: C.border, lineWidth: 0.1, overflow: 'ellipsize' },
    headStyles  : { fillColor: C.navy, textColor: C.white, fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 22 },
      1: { halign: 'right', cellWidth: 12 },
      2: { halign: 'right', cellWidth: 18 },
      3: { halign: 'right', cellWidth: 18 },
      4: { halign: 'right', cellWidth: 20 },
      5: { halign: 'right', cellWidth: 20 },
      6: { halign: 'right', cellWidth: 20 },
      7: { halign: 'right', cellWidth: 14 },
      8: { halign: 'right', cellWidth: 18 },
      9: { halign: 'right', cellWidth: 13 },
      10:{ halign: 'right', cellWidth: 13 },
    },
    didParseCell(data) {
      if (data.section !== 'body') return;
      const raw = String(data.cell.raw);
      const col = data.column.index;
      if (col === 6 || col === 7) {
        data.cell.styles.textColor = raw.startsWith('+') ? C.green : raw.startsWith('-') ? C.red : C.text;
        data.cell.styles.fontStyle = 'bold';
      }
      if (col === 8 || col === 9) {
        data.cell.styles.textColor = raw.startsWith('+') ? C.green : raw.startsWith('-') ? C.red : C.text;
      }
    },
  });

  return doc.lastAutoTable.finalY + 8;
}

function _addPageNumbers(doc) {
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.2);
    doc.line(L_MAR, 288, PAGE_W - R_MAR, 288);
    doc.text('Folio Portfolio Report', L_MAR, 292);
    doc.text(`${i} / ${total}`, PAGE_W - R_MAR, 292, { align: 'right' });
  }
}

// =============================================================================
// CHART CAPTURE
// =============================================================================

async function _captureAllCharts() {
  const wasHoldings  = document.getElementById('holdings-main-view')?.style.display !== 'none';
  const prevChartBtn = document.querySelector('#charts-subtoggles .chart-toggle-btn.active')?.id;
  const imgs = [];

  const click = async (id, ms) => { const b = document.getElementById(id); if (b) { b.click(); await _sleep(ms); } };

  await click('main-toggle-charts-btn', 300);

  await click('toggle-intraday-btn', 500);
  await _waitCanvas('portfolioDayChart');
  _captureHiRes('portfolioDayChart', 'Portfolio Today (Intraday)', imgs);

  await click('toggle-historical-btn', 500);
  await _waitCanvas('portfolioChart');
  _captureHiRes('portfolioChart', 'Portfolio Value Over Time', imgs);

  await click('toggle-pnl-btn', 600);
  await _waitCanvas('pnlChart');
  _captureHiRes('pieChart',      'Allocation',           imgs);
  _captureHiRes('pnlChart',      'Overall P&L by Stock', imgs);
  _captureHiRes('todayPnlChart', "Today's P&L by Stock", imgs);

  // Restore
  if (wasHoldings) await click('main-toggle-holdings-btn', 100);
  else if (prevChartBtn) document.getElementById(prevChartBtn)?.click();

  return imgs;
}

function _captureHiRes(canvasId, title, out) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || canvas.width === 0 || canvas.height === 0) return;
  try {
    // Use Chart.js instance for best quality
    const KEY = { portfolioChart: 'portfolioChartInstance', portfolioDayChart: 'portfolioDayChartInstance', pieChart: 'pieChartInstance', pnlChart: 'pnlChartInstance', todayPnlChart: 'todayPnlChartInstance' };
    const inst = KEY[canvasId] && state[KEY[canvasId]];
    if (inst?.toBase64Image) {
      const url = inst.toBase64Image('image/png', 1);
      if (url?.length > 1000) { out.push({ title, dataUrl: url }); return; }
    }
    // Fallback: 2x offscreen canvas
    const off = Object.assign(document.createElement('canvas'), { width: canvas.width * 2, height: canvas.height * 2 });
    const ctx = off.getContext('2d');
    ctx.scale(2, 2);
    ctx.drawImage(canvas, 0, 0);
    const url = off.toDataURL('image/png', 1);
    if (url?.length > 1000) out.push({ title, dataUrl: url });
  } catch (_) {}
}

async function _waitCanvas(id, max = 1200) {
  let t = 0;
  while (t < max) { const c = document.getElementById(id); if (c?.width > 0 && c?.height > 0) return; await _sleep(80); t += 80; }
}

// =============================================================================
// SHARED UTILS
// =============================================================================

function _computeSummary(holdings) {
  let totalInvested = 0, totalCurrent = 0, totalPnl = 0, totalDayChg = 0;
  holdings.forEach((h) => {
    const lp = state.livePrices[h.ticker];
    const pc = state.prevClosePrices[h.ticker];
    totalInvested += h.invested || 0;
    if (lp) {
      const cv = lp * h.totalQty;
      totalCurrent += cv;
      totalPnl     += cv - h.invested;
      if (pc && pc > 0) totalDayChg += (lp - pc) * h.totalQty;
    }
  });
  return { totalInvested, totalCurrent, totalPnl, totalDayChg };
}

function _fmtIN(n) { return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
function _isoDate() { return new Date().toISOString().slice(0, 10); }
function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function _downloadCSV(content, filename) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

function _setPdfBtnState(btn, loading) {
  if (!btn) return;
  btn.disabled    = loading;
  btn.innerHTML   = loading ? '<span style="opacity:.6">⏳ Building PDF…</span>' : '⬇ Export ▾';
}

async function _loadJsPDF() {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  const load = (src) => new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = Object.assign(document.createElement('script'), { src });
    s.onload = res; s.onerror = () => rej(new Error(`Failed: ${src}`));
    document.head.appendChild(s);
  });
  await load('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  await load('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
  if (!window.jspdf?.jsPDF) throw new Error('jsPDF failed to initialise');
  return window.jspdf.jsPDF;
}

function _getAggFns() {
  function aggregateHoldings(rows) {
    const map = {};
    rows.forEach((r) => {
      if (!map[r.ticker]) map[r.ticker] = { ticker: r.ticker, totalQty: 0, totalCost: 0, dates: [], users: [], upstoxTicker: r.upstoxTicker || null };
      map[r.ticker].totalQty  += r.qty;
      map[r.ticker].totalCost += r.qty * r.avg;
      if (r.date) map[r.ticker].dates.push(r.date);
      if (r.user && !map[r.ticker].users.includes(r.user)) map[r.ticker].users.push(r.user);
    });
    Object.values(map).forEach((h) => {
      h.avgBuy       = h.totalCost / h.totalQty;
      h.invested     = h.totalCost;
      h.earliestDate = h.dates.length ? h.dates.sort()[0] : null;
    });
    return map;
  }
  function getFilteredHoldings(rawRows, user) {
    if (!user || user === 'all') return aggregateHoldings(rawRows);
    return aggregateHoldings(rawRows.filter((r) => r.user === user));
  }
  return { aggregateHoldings, getFilteredHoldings };
}

export function toggleExportMenu() {
  const menu = document.getElementById('export-menu');
  if (!menu) return;
  const isOpen = menu.style.display === 'block';
  menu.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    const h = (e) => { if (!document.getElementById('export-dropdown')?.contains(e.target)) { menu.style.display = 'none'; document.removeEventListener('click', h); } };
    setTimeout(() => document.addEventListener('click', h), 100);
  }
}

export function closeExportMenu() {
  const el = document.getElementById('export-menu');
  if (el) el.style.display = 'none';
}