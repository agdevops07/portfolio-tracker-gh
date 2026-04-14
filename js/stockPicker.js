// ═══════════════════════════════════════════════
// STOCK PICKER MODAL
// Search NSE/BSE stocks, add rows, submit to processCSV
// ═══════════════════════════════════════════════

import { processCSV } from './fileHandler.js';

// ── State ───────────────────────────────────────
let stocksDB = null;        // loaded once on first open
let pickerRows = [];        // rows being built [{stock, qty, avg, date}]
let searchTimeout = null;

// ── Public: open modal ──────────────────────────
export function openStockPicker() {
  const modal = document.getElementById('stock-picker-modal');
  modal.style.display = 'flex';
  if (!stocksDB) {
    loadStocksDB();
  }
  if (pickerRows.length === 0) {
    addPickerRow();
  }
  renderPickerRows();
  document.getElementById('sp-search-0')?.focus();
}

export function closeStockPicker() {
  document.getElementById('stock-picker-modal').style.display = 'none';
  closeDropdown();
}

// ── Load stocks DB ──────────────────────────────
async function loadStocksDB() {
  const statusEl = document.getElementById('sp-db-status');
  try {
    statusEl.textContent = 'Loading stock database…';
    statusEl.style.display = 'block';
    // Support both gh-pages root path and local
    const base = document.location.pathname.replace(/\/[^/]*$/, '') || '';
    const url = base + '/data/stocks_db.json';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load');
    stocksDB = await res.json();
    statusEl.textContent = `✓ ${stocksDB.length.toLocaleString()} stocks loaded (NSE + BSE)`;
    statusEl.style.color = 'var(--green)';
    setTimeout(() => { statusEl.style.display = 'none'; }, 2000);
  } catch (e) {
    statusEl.textContent = '⚠ Could not load stock database. You can still type tickers manually.';
    statusEl.style.color = 'var(--red)';
  }
}

// ── Row management ──────────────────────────────
function makeRow() {
  return {
    id: Date.now() + Math.random(),
    stock: null,
    manualTicker: '',
    exchange: 'NSE',
    qty: '',
    avg: '',
    date: '',
    owner: 'User 1',  // ADD THIS
  };
}

function addPickerRow() {
  pickerRows.push(makeRow());
  renderPickerRows();
  const rows = document.querySelectorAll('.sp-row');
  const last = rows[rows.length - 1];
  last?.querySelector('.sp-search-input')?.focus();
}

function removePickerRow(id) {
  pickerRows = pickerRows.filter(r => String(r.id) !== String(id));
  if (pickerRows.length === 0) addPickerRow();
  else renderPickerRows();
}

// ── Render all rows ─────────────────────────────
function renderPickerRows() {
  const container = document.getElementById('sp-rows');
  container.innerHTML = '';
  pickerRows.forEach((row, idx) => {
    const div = document.createElement('div');
    div.className = 'sp-row';
    div.dataset.id = row.id;

    const stockLabel = row.stock
      ? `<div class="sp-selected-stock">
           <span class="sp-badge sp-badge-${row.stock.exchange.toLowerCase().replace('-','')}">${row.stock.exchange}</span>
           <strong>${row.stock.symbol}</strong>
           <span class="sp-company-name">${row.stock.company}</span>
           <button class="sp-clear-btn" onclick="window._spClearRow('${row.id}')" title="Clear">✕</button>
         </div>`
      : '';

    div.innerHTML = `
      <div class="sp-row-header">
        <span class="sp-row-num">${idx + 1}</span>
        <button class="sp-remove-btn" onclick="window._spRemoveRow('${row.id}')" title="Remove row">🗑</button>
      </div>

      <div class="sp-field sp-field-search">
        <label class="sp-label">Stock</label>
        <div class="sp-search-wrap" data-row-id="${row.id}">
          ${stockLabel}
          ${!row.stock ? `
          <div class="sp-exchange-toggle">
            <button class="sp-exch-btn${row.exchange==='NSE'?' active':''}" onclick="window._spSetExchange('${row.id}','NSE')">NSE</button>
            <button class="sp-exch-btn${row.exchange==='BSE'?' active':''}" onclick="window._spSetExchange('${row.id}','BSE')">BSE</button>
          </div>
          <input type="text" class="sp-search-input" id="sp-search-${row.id}"
            placeholder="Search symbol or company name…"
            value="${row.manualTicker}"
            oninput="window._spSearch(this, '${row.id}')"
            onkeydown="window._spKeydown(event,'${row.id}')"
            autocomplete="off" />
          <div class="sp-dropdown" id="sp-dropdown-${row.id}" style="display:none"></div>
          ` : ''}
        </div>
      </div>

      <div class="sp-fields-row">
        <div class="sp-field">
          <label class="sp-label">Shares / Qty</label>
          <input type="number" class="sp-input" id="sp-qty-${row.id}" name="sp-qty-${row.id}" min="0.001" step="any"
            placeholder="e.g. 100"
            value="${row.qty}"
            oninput="window._spUpdateField('${row.id}','qty',this.value)" />
        </div>
        <div class="sp-field">
          <label class="sp-label">Avg Buy Price (₹)</label>
          <input type="number" class="sp-input" id="sp-avg-${row.id}" name="sp-avg-${row.id}" min="0" step="any"
            placeholder="e.g. 1500.00"
            value="${row.avg}"
            oninput="window._spUpdateField('${row.id}','avg',this.value)" />
        </div>
        <div class="sp-field">
          <label class="sp-label">Buy Date</label>
          <input type="date" class="sp-input" id="sp-date-${row.id}" name="sp-date-${row.id}"
            value="${row.date}"
            oninput="window._spUpdateField('${row.id}','date',this.value)" />
        </div>
        <div class="sp-field">
          <label class="sp-label">Owner</label>
          <select class="sp-input" id="sp-owner-${row.id}" onchange="window._spUpdateField('${row.id}','owner',this.value)">
            <option value="User 1" ${row.owner === 'User 1' ? 'selected' : ''}>User 1</option>
            <option value="User 2" ${row.owner === 'User 2' ? 'selected' : ''}>User 2</option>
            <option value="User 3" ${row.owner === 'User 3' ? 'selected' : ''}>User 3</option>
            <option value="User 4" ${row.owner === 'User 4' ? 'selected' : ''}>User 4</option>
          </select>
        </div>
      </div>

      ${row.stock ? `
      <div class="sp-ticker-info">
        <span class="sp-ticker-chip">Yahoo: <code>${getYahooTicker(row)}</code></span>
        ${row.stock.isin ? `<span class="sp-ticker-chip">ISIN: <code>${row.stock.isin}</code></span>` : ''}
        ${row.stock.bseCode ? `<span class="sp-ticker-chip">BSE Code: <code>${row.stock.bseCode}</code></span>` : ''}
        ${row.stock.screenerSymbol ? `<span class="sp-ticker-chip">Screener: <code>${row.stock.screenerSymbol}</code></span>` : ''}
      </div>` : ''}
    `;
    container.appendChild(div);
  });
}

function getYahooTicker(row) {
  if (!row.stock) return row.manualTicker || '—';
  if (row.exchange === 'BSE') {
    return row.stock.bseTicker || row.stock.yahooTicker.replace('.NS', '.BO');
  }
  return row.stock.yahooTicker;
}

// ── Search results cache (avoids JSON-in-HTML-attribute) ────────────────
// Keyed by `${rowId}:${index}` → stock object
const _searchResultCache = new Map();

// ── Search logic ────────────────────────────────
let activeDropdownId = null;

function closeDropdown() {
  if (activeDropdownId) {
    const dd = document.getElementById(`sp-dropdown-${activeDropdownId}`);
    if (dd) dd.style.display = 'none';
    activeDropdownId = null;
  }
}

window._spSearch = function(input, rowId) {
  const row = pickerRows.find(r => String(r.id) === rowId);
  if (!row) return;
  row.manualTicker = input.value;

  clearTimeout(searchTimeout);
  const q = input.value.trim().toUpperCase();
  const dd = document.getElementById(`sp-dropdown-${rowId}`);

  if (!q || q.length < 1) { dd.style.display = 'none'; return; }

  searchTimeout = setTimeout(() => {
    if (!stocksDB) {
      // fallback: no DB yet
      dd.innerHTML = '<div class="sp-dd-hint">Loading database…</div>';
      dd.style.display = 'block';
      return;
    }

    const exch = row.exchange;
    const results = stocksDB.filter(s => {
      // Exchange filter
      const matchExch = exch === 'NSE'
        ? s.exchange === 'NSE' || s.exchange === 'NSE-SME'
        : s.exchange === 'BSE' || (s.exchange === 'NSE' && s.bseCode);
      if (!matchExch) return false;
      return s.symbol.startsWith(q) || s.company.toUpperCase().includes(q);
    }).slice(0, 12);

    if (!results.length) {
      dd.innerHTML = '<div class="sp-dd-hint">No results. You can type the ticker directly.</div>';
      dd.style.display = 'block';
      activeDropdownId = rowId;
      return;
    }

    // Cache results by safe key; pass only the index in the HTML attribute
    results.forEach((s, i) => _searchResultCache.set(`${rowId}:${i}`, s));

    dd.innerHTML = results.map((s, i) =>
      `<div class="sp-dd-item" data-idx="${i}"
         onmousedown="window._spSelectStock('${rowId}', ${i})">
         <span class="sp-badge sp-badge-${s.exchange.toLowerCase().replace('-','')}">${s.exchange}</span>
         <span class="sp-dd-sym">${s.symbol}</span>
         <span class="sp-dd-name">${s.company}</span>
       </div>`
    ).join('');

    dd.style.display = 'block';
    activeDropdownId = rowId;
  }, 150);
};

window._spKeydown = function(e, rowId) {
  const dd = document.getElementById(`sp-dropdown-${rowId}`);
  if (!dd || dd.style.display === 'none') return;
  const items = dd.querySelectorAll('.sp-dd-item');
  let focused = dd.querySelector('.sp-dd-item.focused');
  let idx = focused ? parseInt(focused.dataset.idx) : -1;

  if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); }
  else if (e.key === 'Enter' && focused) {
    e.preventDefault();
    focused.dispatchEvent(new Event('mousedown'));
    return;
  } else if (e.key === 'Escape') { closeDropdown(); return; }
  else return;

  items.forEach(i => i.classList.remove('focused'));
  if (items[idx]) items[idx].classList.add('focused');
};

window._spSelectStock = function(rowId, idx) {
  const stock = _searchResultCache.get(`${rowId}:${idx}`);
  if (!stock) return;
  const row = pickerRows.find(r => String(r.id) === rowId);
  if (!row) return;
  row.stock = stock;
  row.manualTicker = '';
  // Set exchange based on what was selected
  if (stock.exchange === 'BSE') row.exchange = 'BSE';
  else row.exchange = 'NSE';
  closeDropdown();
  renderPickerRows();
  // focus qty field
  document.querySelector(`[data-id="${rowId}"] .sp-input`)?.focus();
};

window._spClearRow = function(rowId) {
  const row = pickerRows.find(r => String(r.id) === rowId);
  if (!row) return;
  row.stock = null;
  row.manualTicker = '';
  renderPickerRows();
  document.getElementById(`sp-search-${rowId}`)?.focus();
};

window._spRemoveRow = function(rowId) {
  removePickerRow(rowId);
};

window._spSetExchange = function(rowId, exch) {
  const row = pickerRows.find(r => String(r.id) === rowId);
  if (!row) return;
  row.exchange = exch;
  renderPickerRows();
  document.getElementById(`sp-search-${rowId}`)?.focus();
};

window._spUpdateField = function(rowId, field, value) {
  const row = pickerRows.find(r => String(r.id) === rowId);
  if (!row) return;
  row[field] = value;
};

// ── Add row button ──────────────────────────────
window._spAddRow = function() {
  addPickerRow();
};

// ── Submit ──────────────────────────────────────
window._spSubmit = function() {
  const errors = [];
  const csvRows = [];

  pickerRows.forEach((row, i) => {
    const n = i + 1;
    const ticker = row.stock
      ? getYahooTicker(row)
      : row.manualTicker.trim().toUpperCase();

    if (!ticker) { errors.push(`Row ${n}: No stock selected`); return; }
    if (!row.qty || parseFloat(row.qty) <= 0) { errors.push(`Row ${n}: Invalid quantity`); return; }
    if (!row.avg || parseFloat(row.avg) <= 0) { errors.push(`Row ${n}: Invalid average price`); return; }

    csvRows.push({
      ticker,
      quantity: row.qty,
      average_buy_price: row.avg,
      buy_date: row.date || '',
      upstox_ticker: row.stock?.isin || '',
      user: row.owner || 'User 1',  // ADD THIS
    });
  });

  const errEl = document.getElementById('sp-errors');
  if (errors.length) {
    errEl.innerHTML = errors.map(e => `<div>⚠ ${e}</div>`).join('');
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';

  closeStockPicker();
  processCSV(csvRows);
};

// ── Reset ───────────────────────────────────────
window._spReset = function() {
  pickerRows = [];
  addPickerRow();
};

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.sp-search-wrap')) closeDropdown();
});
