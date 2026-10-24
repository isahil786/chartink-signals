# AGENTS.md - Development Guide

## Commands

### Lint
```bash
cd chartink-scraper && npm run lint
```

### Start dashboard server (port 3000, base path `/dashboard`)
```bash
cd chartink-scraper && npm run server
```

### Run all tests
```bash
cd chartink-scraper && npm test
```

## Project Structure
- `config/` — configuration files (scans.yaml, settings.yaml, holidays.yaml)
- `src/` — source modules (chartink.js, custom.js, backtest.js, processor.js, signals.js, ohlcv.js, store.js, backtest-engine.js, stats.js, regime.js, score.js, scheduler.js, nifty-filter.js, config.js)
- `public/` — frontend assets (index.html, app.js, style.css)
- `state/` — runtime caches and latest snapshot
- `responses/` — raw API response archives
- `processed/` — processed CSV/JSON outputs
- `test-step*.mjs` — checkpoint tests for each pipeline step
- `test-runner.mjs` — unified test runner

## Assumptions
- All times are IST on NSE trading days (weekends/holidays skipped)
- Chartink endpoints are undocumented internal APIs; check Chartink's terms of use for automated access
- Max 1 request per 2 seconds; retry with exponential backoff
- OHLCV fetched from `/api/oapi` with `timeframe=1+day` and `size=200` (~200 daily candles)
- No Nifty/index data; no external notifications (Telegram/email/WhatsApp)
