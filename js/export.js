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

  const element = document.getElementById("dashboard-screen");

  if (!element) {
    console.error("Dashboard element not found");
    return;
  }

  // Dynamically load html2pdf if not already loaded
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) return resolve();

      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  const CDN = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";

  loadScript(CDN).then(() => {
    const filename = `portfolio-${new Date().toISOString().slice(0, 10)}.pdf`;

    const opt = {
      margin: 10,
      filename,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: {
        scale: 2,              // improves resolution
        useCORS: true,
        scrollY: 0
      },
      jsPDF: {
        unit: "mm",
        format: "a4",
        orientation: "portrait"
      }
    };

    // Small delay ensures charts/layout fully rendered
    setTimeout(() => {
      window.html2pdf()
        .set(opt)
        .from(element)
        .save();
    }, 300);
  }).catch(err => {
    console.error("Failed to load PDF library", err);
  });
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
