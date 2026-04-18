# 📈 Portfolio Tracker — GitHub Pages Edition

A fully client-side portfolio tracker. No server, no backend. Works from any static host including GitHub Pages.

## 🚀 Deploy in 3 steps

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/portfolio-tracker.git
git push -u origin main
```

### 2. Enable GitHub Pages

In your repo on GitHub:

- Go to **Settings → Pages**
- Under **Source**, select **GitHub Actions**
- Save — that's it. The workflow in `.github/workflows/deploy.yml` handles the rest automatically.

### 3. Access your tracker

GitHub will give you a URL like:
```
https://YOUR_USERNAME.github.io/portfolio-tracker-gh/
```

Every time you `git push` to `main`, the site redeploys automatically.

---

## 📁 Updating your portfolio

Edit `data/my_portfolio.csv` with your actual holdings:

```csv
ticker,quantity,average_buy_price,buy_date,upstoxTicker
RELIANCE.NS,10,2400.50,2023-06-01,INE002A01018
TCS.NS,5,3800.00,2023-04-15,
AAPL,15,175.00,2023-03-01,
```

| Column | Required | Notes |
|---|---|---|
| `ticker` | ✅ | Yahoo Finance ticker (e.g. `RELIANCE.NS`, `TCS.NS`, `AAPL`) |
| `quantity` | ✅ | Number of shares |
| `average_buy_price` | ✅ | Your average purchase price |
| `buy_date` | Optional | Format: `YYYY-MM-DD` |
| `upstoxTicker` | Optional | ISIN for Upstox data (ignored in this version) |

After editing the CSV, commit and push — the site updates within a minute.

---

## 🔧 How it works

This version calls **Yahoo Finance directly from the browser** via a public CORS proxy (`corsproxy.io`). This removes the need for any server or serverless functions.

| Feature | Method |
|---|---|
| Live prices | Yahoo Finance v8 API (proxied) |
| Historical data | Yahoo Finance v8 API (proxied) |
| Intraday 5-min | Yahoo Finance v8 API (proxied) |
| Your portfolio CSV | Fetched from `data/my_portfolio.csv` in the repo |

---

## 📊 Features

- Live prices & previous close (auto-refresh every 1–10 min)
- Portfolio value over time chart (1M / 3M / 1Y / ALL)
- Today's intraday chart (5-min candles)
- Allocation doughnut chart
- Overall P&L by stock
- Today's P&L by stock
- Per-stock drilldown with price history (default: 31 Mar – today, fully customisable) + intraday
- Fundamentals from Screener.in: Key Ratios, P&L, Balance Sheet, Cash Flow, Quarterly Results
- Standalone / Consolidated toggle for all fundamental views
- Maximize button on all charts (opens a full-screen overlay)
- Full holdings modal with sortable table
- Export chart as PNG
- Load your CSV from the repo or drag-drop any CSV

### 🔍 Stock Search tab
- Search any NSE/BSE stock by name or ticker (5,000+ stock database, no portfolio needed)
- Identical view to the per-stock drilldown — price history, intraday, full fundamentals
- Clear (✕) button on the search bar for quick reset on mobile

---

## 🔀 PR Preview Deployments

Every pull request automatically gets a live preview URL so you can test before merging.

### How it works

1. Open a PR targeting `main` or `master`
2. The `pr-preview.yml` workflow builds and deploys to the `gh-pages-previews` branch under `pr-{number}/`
3. A bot comment appears on the PR with the preview URL:
   ```
   https://YOUR_USERNAME.github.io/portfolio-tracker/pr-42/
   ```
4. When the PR is closed/merged, the preview is automatically removed

### One-time setup

Enable the `gh-pages-previews` branch as an **additional** GitHub Pages source isn't needed — the workflow pushes files there automatically. You only need:

- `GROQ_API_KEY` set in **Settings → Secrets → Actions**
- GitHub Pages enabled on the repo (for the main `gh-pages` branch)
- The repo's **Actions** tab must have write permissions: **Settings → Actions → General → Workflow permissions → Read and write**

---

## 💾 Session Management

The app now persists up to **3 portfolio sessions** in `localStorage` so your data survives browser restarts.

| Action | Result |
|---|---|
| Upload/load a portfolio | Automatically saved as a session |
| Revisit the site | Redirected straight to dashboard |
| Click **Portfolio ▾** in dashboard | Switch between saved sessions |
| Click **Start Fresh** on upload page | Show upload form without losing saved sessions |
| Delete a session | Permanently removed from localStorage |

Sessions are stored entirely in your browser — no data leaves your device.
