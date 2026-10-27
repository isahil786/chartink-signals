# Chartink Signals Dashboard

Fetches Chartink screener data, runs backtests, and serves a dashboard for Indian stock market signals.

## Run & Operate

- `cd chartink-scraper && npm install` — install dependencies
- `cd chartink-scraper && npm run server` — start the dashboard server (port 3000)
- `cd chartink-scraper && npm start` — run the pipeline
- `cd chartink-scraper && npm test` — run tests

## Stack

- Node.js, Express 5, Cheerio
- Chartink API (undocumented internal endpoints)
- OHLCV daily candles (~200 days)

## Where things live

- `chartink-scraper/` — main project
  - `src/` — source modules (chartink, processor, signals, ohlcv, store, backtest-engine, etc.)
  - `public/` — frontend assets (index.html, app.js, style.css)
  - `server.js` — Express server
  - `pipeline-runner.js` — CLI entry point for pipelines
  - `config/` — configuration files (scans.yaml, settings.yaml, holidays.yaml)
  - `state/` — runtime caches and latest snapshot
  - `responses/` — raw API response archives
  - `processed/` — processed CSV/JSON outputs
  - `test-step*.mjs` — checkpoint tests
  - `test-runner.mjs` — unified test runner

## Gotchas

- All times are IST on NSE trading days
- Max 1 request per 2 seconds; retry with exponential backoff
- Set `CHARTINK_COOKIE` environment variable for authenticated requests
