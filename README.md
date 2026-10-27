# Chartink Fetcher

A Node.js tool that fetches data from Chartink screener and backtest APIs, saving all responses as JSON files.

## Setup

```bash
cd chartink-scraper
npm install
```

---

## Screener — `node index.js`

Fetches the current stock list from a screener.

### Configure `screeners.json`

```json
[
  "https://chartink.com/screener/copy-fibonacci-61-8-buy-daily-55",
  "https://chartink.com/screener/another-screener"
]
```

### Run

```bash
node index.js

# Or pass URLs directly as arguments:
node index.js https://chartink.com/screener/copy-fibonacci-61-8-buy-daily-55
```

### Output

Saved in `responses/` as timestamped JSON files:

```
responses/
  copy-fibonacci-61-8-buy-daily-55_2024-05-17_10-30-00.json
```

Each file contains:

- `screenerUrl` — original URL
- `screenerName` — slug from the URL
- `scanClause` — scan formula extracted from the page
- `fetchedAt` — ISO timestamp
- `totalResults` — number of stocks returned
- `data` — full Chartink response (stock symbols, prices, % change, volume)

---

## Backtest — `node backtest.js`

Runs the screener formula against historical data via Chartink's backtest API.

### Configure `backtests.json`

```json
[
  {
    "url": "https://chartink.com/screener/copy-fibonacci-61-8-buy-daily-55",
    "max_rows": 160
  }
]
```

- `url` — screener URL (screener or backtest URL, both work)
- `max_rows` — number of historical rows to return (default: 160)

### Run

```bash
node backtest.js

# Or pass screener URLs directly:
node backtest.js https://chartink.com/screener/copy-fibonacci-61-8-buy-daily-55
```

### Output

Saved in `responses/backtests/` as timestamped JSON files:

```
responses/
  backtests/
    copy-fibonacci-61-8-buy-daily-55_2024-05-17_10-31-00.json
```

Each file contains:

- `sourceUrl` — input URL
- `screenerUrl` — screener page used for CSRF + scan clause
- `screenerName` — slug
- `scanClause` — scan formula
- `maxRows` — rows requested
- `fetchedAt` — ISO timestamp
- `sectorGroups` — number of sectors in the response
- `data` — full backtest response (sector-grouped time-series: how many stocks per sector triggered the condition on each historical day)

---

## Private Screeners / Login Required

If you see errors about CSRF or missing scan clauses, you need to provide session cookies:

1. Open Chrome and log in to [chartink.com](https://chartink.com)
2. Open DevTools → Application → Cookies → `https://chartink.com`
3. Copy the value of the `chartink_session` cookie
4. Create a file called `cookies.txt` in this folder:

```
chartink_session=<your-cookie-value>
```

Both scripts automatically load `cookies.txt` if it exists.

---

## Notes

- The screener script waits 1.5 seconds between requests; backtest waits 2 seconds — to avoid rate limiting
- Chartink does not provide an official public API; this tool uses the same endpoints the website uses internally
- Public screeners work without login; private or deleted screeners may require cookies

---

## Custom Query — `node custom-query.js`

Run custom scan clauses without needing a screener URL.

### Configure `custom-queries.json`

Add query definitions with `id`, `name`, and `scan` fields:

```json
[
  {
    "id": "large-caps",
    "name": "Large Cap Stocks",
    "scan": "(close > 100) and (volume > 500000)"
  }
]
```

> Note: Query results depend on current market conditions. Some predefined queries may return 0 results if no stocks match the technical criteria. Use broader scans like `(close > 50) and (volume > 200000)` for guaranteed results.

### Run

```bash
# Use predefined query
npm run query -- ma-alignment

# Or pass scan clause directly
npm run query -- "(close > 100) and (volume > 200000)"

# Using node directly
node custom-query.js ma-alignment
node custom-query.js "(close > 100) and (volume > 200000)"
```

### Output

Saved in `responses/` as JSON files named after the query.

> Note: Query results depend on current market conditions. Some predefined queries may return 0 results if no stocks match the technical criteria.

---

## Custom Backtest — `node backtest.js`

Run backtests on custom scan clauses.

### Run

```bash
# Use predefined query (from custom-queries.json)
npm run backtest -- ma-alignment

# Or pass scan clause directly
npm run backtest -- "(close > 100) and (volume > 200000)"

# Using node directly
node backtest.js ma-alignment
node backtest.js "(close > 100) and (volume > 200000)"
```

### Output

Same as regular backtest, saved in `responses/backtests/`.

---

## Pipeline Processor — `node pipeline-runner.js`

Multi-timeframe stock filtering pipeline with probability prediction engine. Implements the plan from `plan.md` for day trading and weekly swing setups.

### Pipeline Stages

| Stage   | Day Trading                                 | Weekly Swing         |
| ------- | ------------------------------------------- | -------------------- |
| Stage 0 | 5-min setup detection (NR7, volume squeeze) | Daily base building  |
| Stage 1 | 5-min early expansion (volume breakout)     | Daily impulse candle |
| Stage 2 | 15-min confirmation (VWAP, ADX)             | Weekly confirmation  |
| Stage 3 | 30-min validation (Supertrend, MACD)        | -                    |

### Run

```bash
# Run day trading pipeline
npm run pipeline:day

# Run weekly swing pipeline
npm run pipeline:weekly

# Run all pipelines
node pipeline-runner.js

# Check pipeline status
node pipeline-runner.js --status
```

### Pipeline Configuration

Default screeners are configured in `pipeline-runner.js`. Override by setting `SCRAPER_URLS` environment variable or modify the config object.

### State & Probability

- **State**: `state/pipeline-state.json` - tracks stock progression through stages
- **Probability**: `state/probability/lookup-table.json` - historical success rates for scanner sequences

### Entry Criteria

A stock enters only when:

1. Appears in Stage 3 screener within configured time window
2. Probability ≥ 60% based on historical backtest data
3. Position size calculated using 1-2% risk per trade

### Commands

| Command                     | Description                      |
| --------------------------- | -------------------------------- |
| `npm run pipeline`          | Run all pipelines                |
| `npm run pipeline:day`      | Day trading pipeline             |
| `npm run pipeline:weekly`   | Weekly swing pipeline            |
| `npm run pipeline:status`   | Show pipeline status             |
| `npm run train:probability` | Train probability from backtests |

---

## Notes

| Tool         | Command                    | Status                                |
| ------------ | -------------------------- | ------------------------------------- |
| Screener     | `npm run fetch`            | ✓ Public screeners fetch successfully |
| Backtest     | `npm run backtest <url>`   | ✓ Backtests run with 26 sector groups |
| Backtest     | `npm run backtest <query>` | ✓ Custom queries work                 |
| Custom Query | `npm run query <query>`    | ✓ On-demand scans work                |
| Indicators   | `/indicators/batch`        | ✓ 11 indicator types supported        |

## Available Custom Queries

`custom-queries.json` contains 28 predefined queries:

| ID                      | Name                     | Description                    |
| ----------------------- | ------------------------ | ------------------------------ |
| `ma-alignment`          | MA Alignment             | Short-term EMA > long-term EMA |
| `rsi-divergence`        | RSI Divergence           | Bullish RSI divergence setup   |
| `bollinger-squeeze`     | Bollinger Squeeze        | Bollinger Bands contraction    |
| `volume-spike`          | Volume Spike             | 3x average volume              |
| `morning-star`          | Morning Star             | Bullish reversal pattern       |
| `ema-crossover`         | EMA Crossover            | EMA 9 > EMA 21                 |
| `macd-bullish`          | MACD Bullish             | MACD turning positive          |
| `price-channel`         | Price Channel            | Breaking 20-period high        |
| `low-float`             | Low Float Stocks         | Small range high volume        |
| `fibonacci-retracement` | Fibonacci Retracement    | 38-50% retracement zone        |
| `fib-buy`               | Fibonacci Buy Zone       | Above 61.8% retracement        |
| `fib-sell`              | Fibonacci Sell Zone      | 38-50% retracement zone        |
| `fib-rally`             | Fibonacci Rally          | 50-70% of recent high          |
| `positive-fib`          | Positive Fibonacci       | RSI > 60, volume > 500k        |
| `fib-618-buy`           | Fibonacci 61.8% Buy      | At 61.8% retracement           |
| `large-caps`            | Large Cap Stocks         | Close > 100, volume > 500k     |
| `green-stocks`          | Green Stocks             | Above 200 SMA                  |
| `volatile-stocks`       | Volatile Stocks          | 5%+ intraday range             |
| `active-stocks`         | Active Stocks            | High volume growth             |
| `mid-caps`              | Mid Cap Stocks           | Close 50-500, high volume      |
| `breakout-52wk`         | 52 Week High Breakout    | New 52-week high               |
| `strong-volume`         | Strong Volume            | High volume growth             |
| `low-price-high-volume` | Low Price High Volume    | Affordable active stocks       |
| `moving-average-rising` | Moving Average Rising    | Multiple MAs up                |
| `near-52wk-high`        | Near 52 Week High        | Within 5% of 52wk high         |
| `fib-252-50`            | Fibonacci 252 High 50%   | Near 250-day high              |
| `fib-252-618`           | Fibonacci 252 High 61.8% | Near 250-day high              |
| `fib-252-78`            | Fibonacci 252 High 78%   | Near 250-day high              |
| `fib-252-highlow`       | Fibonacci 252 High/Low   | Near 250-day high              |

## API Server — `node server.js`

Runs an Express server with endpoints for fetching and serving screener data.

### CORS

The API supports cross-origin requests. All endpoints include `Access-Control-Allow-Origin: *` header.

### API Endpoints

| Endpoint                                         | Description                        |
| ------------------------------------------------ | ---------------------------------- |
| `GET /api/fetch?screener=<url>`                  | Fetch screener(s) by URL (no save) |
| `GET /api/fetch?screener=<url1>&screener=<url2>` | Multiple URLs supported            |
| `GET /api/screeners`                             | List available processed screeners |
| `GET /api/screeners/:slug`                       | Get stocks for a screener          |
| `GET /api/backtests/:slug`                       | Get backtest summary               |
| `GET /api/backtests/:slug/daily`                 | Get daily signal counts            |
| `GET /api/backtests/:slug/sectors`               | Get sector totals                  |
| `GET /api/backtests/:slug/stocks`                | Get daily stocks list              |

### API: Fetch Screener by URL

```bash
# Single URL
curl "http://localhost:3000/dashboard/api/fetch?screener=https://chartink.com/screener/ma-alignment"

# Multiple URLs
curl "http://localhost:3000/dashboard/api/fetch?screener=URL1&screener=URL2&screener=URL3"

# With session cookies (for private screeners)
curl "http://localhost:3000/dashboard/api/fetch?screener=URL&cookies=chartink_session=VALUE"
```

Note: CSRF token is extracted automatically from the page. Only use `cookies` parameter for private screeners requiring login.

Returns:

```json
{
  "success": true,
  "data": [
    {
      "url": "https://chartink.com/screener/...",
      "result": { "screenerName": "...", "totalResults": N, "data": [...] }
    }
  ]
}
```
