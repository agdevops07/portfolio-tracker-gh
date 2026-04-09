# 📈 Portfolio Tracker — GitHub Pages Edition

A fully client-side portfolio tracker. No server, no backend. Works from any static host including GitHub Pages.

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

In your repo on GitHub:

- Go to **Settings → Pages**
- Under **Source**, select **GitHub Actions**
- Save — that's it. The workflow in `.github/workflows/deploy.yml` handles the rest automatically.

### 3. Access your tracker

GitHub will give you a URL like:
```
https://YOUR_USERNAME.github.io/portfolio-tracker/
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
- Per-stock drilldown with price history + intraday
- Full holdings modal with sortable table
- Export chart as PNG
- Load your CSV from the repo or drag-drop any CSV
