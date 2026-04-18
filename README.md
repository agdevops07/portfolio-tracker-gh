# 📈 Portfolio Tracker — GitHub Pages Edition

A fully client-side portfolio tracker. No server, no backend, no login. Works from any static host including GitHub Pages. Your data never leaves your browser.

---

## 🚀 Deploy in 3 steps

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/portfolio-tracker-gh.git
git push -u origin main
```

### 2. Enable GitHub Pages

Go to your repo → **Settings → Pages → Source → GitHub Actions** → Save.

### 3. Add your API key secret

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|---|---|
| `GROQ_API_KEY` | Your Groq API key (free at [console.groq.com](https://console.groq.com)) — powers AI analysis in the Stock Screener |

Your site will be live at:
```
https://YOUR_USERNAME.github.io/portfolio-tracker-gh/
```

Every `git push` to `main` redeploys automatically.

---

## 📁 CSV Format

Upload a CSV (drag-drop, browse, or paste text). Only 3 columns are required:

```csv
ticker,quantity,average_buy_price,buy_date,user
RELIANCE.NS,10,2400.50,2023-06-01,Alice
TCS.NS,5,3800.00,2023-04-15,Alice
INFY.NS,20,1500.00,2023-01-10,Bob
HDFCBANK.NS,8,1650.00,2023-09-20,Bob
AAPL,15,175.00,2023-03-01,Alice
```

| Column | Required | Notes |
|---|---|---|
| `ticker` | ✅ | Yahoo Finance ticker. NSE: `RELIANCE.NS`. BSE: `RELIANCE.BO`. US: `AAPL`, `MSFT` |
| `quantity` | ✅ | Number of shares held |
| `average_buy_price` | ✅ | Your average purchase price |
| `buy_date` | Optional | `YYYY-MM-DD`. Used for CAGR calculation |
| `user` | Optional | Owner name for multi-user portfolios (e.g. `Alice`, `Bob`). Defaults to `User 1` if omitted |
| `upstox_ticker` | — | **No longer required.** ISIN is auto-looked up from the built-in stocks database |

### Multiple rows per ticker

Multiple rows for the same ticker are automatically aggregated using weighted average price:

```csv
ticker,quantity,average_buy_price,buy_date,user
TCS.NS,5,3200.00,2022-11-01,Alice
TCS.NS,3,4100.00,2024-02-15,Alice
```

### Default portfolio

Edit `data/my_portfolio.csv` in the repo and push — it's what loads when you click **"Try Sample Portfolio"** on the upload screen.

---

## 📊 Features

### Dashboard
- **Live prices** — auto-refreshed every 1–10 min (configurable). ~15-min delayed
- **Stat cards** — Total Invested, Current Value, Overall P&L, Today's P&L, Portfolio vs ATH
- **Holdings table** — sortable by any column; toggle between table and card view
- **Allocation doughnut** chart
- **Portfolio value over time** — 1W / 1M / 3M / 1Y / ALL filters with benchmark comparison (NIFTY 50, SENSEX, Gold, S&P 500)
- **Intraday chart** — today's 5-min portfolio value
- **P&L chart** — overall gain/loss per stock
- **Today's P&L chart** — daily change per stock
- **Drawdown chart** — max drawdown from ATH over time

### Multi-user portfolios
When your CSV has a `user` column with multiple names:
- **All Portfolios tab** — side-by-side summary of every user (invested, current value, P&L, day change)
- **Per-user tabs** — switch to see individual holdings and charts per person

### Per-stock drilldown
Click any holding to open a detailed view:
- Price history (default last 12 months, customisable date range)
- Intraday 5-min chart
- Your holding context: qty, avg buy, P&L, CAGR
- Full fundamentals from Screener.in — Key Ratios, P&L, Balance Sheet, Cash Flow, Quarterly Results
- Standalone / Consolidated toggle

### Stock Screener tab
- Search any NSE/BSE stock by name or ticker (5,000+ stock database — no portfolio needed)
- Same drilldown view as holdings
- AI-powered stock analysis via Groq

---

## 💾 Sessions

The app saves up to **5 portfolio sessions** in `localStorage` — your data survives browser restarts and tab closes without re-uploading.

| Scenario | Behaviour |
|---|---|
| Upload or load a portfolio | Automatically saved as a session |
| Revisit the site | Redirected straight to the dashboard |
| **Portfolio ▾** button in dashboard | Switch between up to 5 saved sessions |
| **Start Fresh** on upload page | Shows upload form; saved sessions are preserved |
| Rename a session | Click ✏️ next to any session card |
| Delete a session | Click 🗑️ — permanent, cannot be undone |

All session data lives entirely in your browser — nothing is sent to any server.

---

## 📥 Export

From the **Export ▾** button in the dashboard header.

### Export Holdings CSV

Downloads a CSV with full detail. When a multi-user portfolio is loaded, the file contains **one section per user** — a header block with that user's summary totals, followed by their individual holdings rows, making per-person reconciliation easy.

| Column | Description |
|---|---|
| User | Owner of this holding |
| Ticker | Yahoo Finance ticker |
| Quantity | Total shares held |
| Avg Buy Price | Weighted average purchase price |
| Buy Date | Earliest purchase date for this holding |
| Invested | Total cost (qty × avg buy price) |
| Live Price | Latest fetched market price |
| Current Value | Live price × quantity |
| P&L (₹) | Current value − invested |
| P&L (%) | Return percentage |
| Day Change (₹) | Today's absolute change in portfolio value |
| Day Change (%) | Today's percentage change |
| Allocation (%) | This holding as % of total portfolio value |

### Download as PDF

Captures all visible charts + the holdings table as a printable PDF. Opens a new tab with the browser print dialog.

---

## 🔀 PR Preview Deployments

Every pull request automatically gets a live Netlify preview URL so you can test before merging.

### How it works

1. Open a PR targeting `main`
2. The `pr-preview.yml` workflow deploys the branch to Netlify
3. A bot comments on the PR:
   ```
   🔗 Open Preview → https://pr-38--YOUR-SITE.netlify.app
   ```
4. When the PR is closed/merged the preview comment is cleaned up

### One-time setup

**a)** Create a free site at [netlify.com](https://netlify.com) → **Add new site → Deploy manually** (don't link the repo, just create it)

**b)** Add two GitHub Secrets at **Settings → Secrets and variables → Actions**:

| Secret | Where to find it |
|---|---|
| `NETLIFY_AUTH_TOKEN` | Netlify → User Settings → Applications → Personal access tokens |
| `NETLIFY_SITE_ID` | Netlify → Your site → Site configuration → Site ID |

**c)** Enable write permissions: **Settings → Actions → General → Workflow permissions → Read and write**

---

## 🗂️ Project structure

```
portfolio-tracker-gh/
├── index.html               # Upload / session picker screen
├── dashboard.html           # Main dashboard
├── screener.html            # Stock screener
├── config.js                # Config (GROQ_API_KEY injected at deploy time)
├── data/
│   ├── my_portfolio.csv     # Default sample portfolio — edit this
│   ├── stocks_db.json       # 5,000+ NSE/BSE stocks with ISIN lookup
│   └── bse_codes.json       # BSE code mapping
├── js/
│   ├── session.js           # localStorage session manager (up to 5 sessions)
│   ├── state.js             # Shared app state
│   ├── fileHandler.js       # CSV parsing & holding aggregation
│   ├── dashboard.js         # Dashboard render logic
│   ├── dashboard-main.js    # Dashboard entry point
│   ├── index-main.js        # Upload page entry point
│   ├── charts.js            # Chart.js wrappers & benchmark logic
│   ├── api.js               # Yahoo Finance + Screener.in fetch helpers
│   ├── export.js            # CSV + PDF export
│   ├── drilldown.js         # Per-stock detail view
│   ├── preview.js           # CSV preview table before loading dashboard
│   ├── stockPicker.js       # Manual holdings entry modal
│   ├── stockSearch.js       # Stock search autocomplete
│   ├── screener-main.js     # Screener page + AI analysis
│   ├── timeSeries.js        # Portfolio time-series builder
│   └── utils.js             # Formatting helpers (fmt, pct, colorPnl)
├── styles/
│   └── main.css
└── .github/workflows/
    ├── deploy.yml           # Deploy main → GitHub Pages
    └── pr-preview.yml       # Deploy PRs → Netlify preview URL
```

---

## ⚠️ Known limitations

- Prices are ~15-min delayed via Yahoo Finance's public API — not for real-time trading
- The CORS proxy (`corsproxy.io`) may occasionally be slow; hit **⟳ Refresh** to retry
- Fundamentals (Screener.in) are only available for Indian-listed companies
- US tickers (`AAPL`, `MSFT` etc.) have full price/chart data but no Screener.in fundamentals
- PDF export captures charts as images — very long holdings tables may be truncated