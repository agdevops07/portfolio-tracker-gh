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
  if (!element) return;

  // Store original styles so we can restore later
  const originalStyles = new Map();

  // Fix canvas (Chart.js) stretching
  const canvases = element.querySelectorAll("canvas");
  canvases.forEach((canvas) => {
    originalStyles.set(canvas, {
      width: canvas.style.width,
      height: canvas.style.height
    });

    // Lock actual rendered size
    canvas.style.width = canvas.offsetWidth + "px";
    canvas.style.height = canvas.offsetHeight + "px";
  });

  // Fix images stretching
  const images = element.querySelectorAll("img");
  images.forEach((img) => {
    originalStyles.set(img, {
      maxWidth: img.style.maxWidth,
      height: img.style.height
    });

    img.style.maxWidth = "100%";
    img.style.height = "auto";
    img.style.objectFit = "contain";
  });

  // Prevent page-break chaos inside cards/sections
  const blocks = element.querySelectorAll("div, section");
  blocks.forEach((el) => {
    originalStyles.set(el, {
      breakInside: el.style.breakInside
    });
    el.style.breakInside = "avoid";
  });

  // Small delay to let layout settle
  setTimeout(() => {
    window.print();

    // Restore everything after print dialog opens
    setTimeout(() => {
      originalStyles.forEach((styles, el) => {
        Object.keys(styles).forEach((key) => {
          el.style[key] = styles[key] || "";
        });
      });
    }, 500);
  }, 300);
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
