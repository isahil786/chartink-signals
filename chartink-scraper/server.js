import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runScreener, extractScanClause, extractCsrfToken } from './src/chartink.js';
import * as signals from './src/signals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3000;
const BASE = (process.env.BASE_PATH || '/dashboard').replace(/\/$/, '');

const PROCESSED = path.join(__dirname, 'processed');
const SCREENERS_DIR = path.join(PROCESSED, 'screeners');
const BACKTESTS_DIR = path.join(PROCESSED, 'backtests');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCsv(filePath) {
  if (!fs.existsSync(filePath)) return { headers: [], rows: [] };
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  if (lines.length < 2) return { headers: [], rows: [] };

  function splitLine(line) {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur);
    return result;
  }

  const headers = splitLine(lines[0]);
  const rows = lines
    .slice(1)
    .filter(Boolean)
    .map((l) => {
      const vals = splitLine(l);
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = vals[i] ?? '';
      });
      return obj;
    });
  return { headers, rows };
}

// ─── Fetch HTML from Chartink with optional session cookies ────────────────────

async function fetchHtml(url, cookies = '') {
  const jarConfig = {};
  if (cookies) {
    jarConfig.headers = { Cookie: cookies };
  }

  const response = await axios.get(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...jarConfig.headers,
    },
    timeout: 15000,
  });

  return response.data;
}

// ─── Slugs ────────────────────────────────────────────────────────────────────

function getAllSlugs() {
  if (!fs.existsSync(SCREENERS_DIR)) return [];
  return fs
    .readdirSync(SCREENERS_DIR)
    .filter((f) => f.endsWith('_summary.json'))
    .map((f) => f.replace('_summary.json', ''))
    .sort();
}

// ─── Root redirect ────────────────────────────────────────────────────────────

if (BASE) {
  app.get('/', (_req, res) => res.redirect(BASE + '/'));
}

// ─── Static files ─────────────────────────────────────────────────────────────

app.use(BASE, express.static(path.join(__dirname, 'public')));

// ─── Inject BASE_PATH into index.html dynamically ────────────────────────────

app.get(`${BASE}/`, (_req, res) => {
  const html = fs
    .readFileSync(path.join(__dirname, 'public/index.html'), 'utf8')
    .replace('</head>', `  <meta name="base-path" content="${BASE}" />\n</head>`);
  res.type('html').send(html);
});

// ─── API: list screeners ──────────────────────────────────────────────────────

app.get(`${BASE}/api/screeners`, (req, res) => {
  const slugs = getAllSlugs();
  const screeners = slugs.map((slug) => {
    const summaryPath = path.join(SCREENERS_DIR, `${slug}_summary.json`);
    const summary = fs.existsSync(summaryPath)
      ? JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
      : {};
    return { slug, ...summary };
  });
  res.json(screeners);
});

// ─── API: screener stocks (today) ─────────────────────────────────────────────

app.get(`${BASE}/api/screeners/:slug`, (req, res) => {
  const { slug } = req.params;
  const summaryPath = path.join(SCREENERS_DIR, `${slug}_summary.json`);
  const csvPath = path.join(SCREENERS_DIR, `${slug}.csv`);

  if (!fs.existsSync(summaryPath)) {
    return res.status(404).json({ error: 'Screener not found' });
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const { rows: stocks } = parseCsv(csvPath);

  res.json({ slug, summary, stocks });
});

// ─── API: fetch screener by URL (no save) ─────────────────────────────────────

app.get(`${BASE}/fetch`, (req, res) => {
  res.redirect(`${BASE}/api/fetch${req.url.slice(BASE.length + 6)}`);
});

app.get(`${BASE}/api/fetch`, async (req, res) => {
  const screenerParam = req.query.screener;
  const cookies = req.query.cookies || '';

  if (!screenerParam) {
    return res.status(400).json({ error: 'Missing required query parameter: screener' });
  }

  const urls = Array.isArray(screenerParam) ? screenerParam : [screenerParam];

  if (urls.length > 5) {
    return res.status(400).json({ error: 'Maximum 5 screeners per request' });
  }

  try {
    const results = [];
    for (const url of urls) {
      if (!url.startsWith('http')) {
        return res.status(400).json({ error: `Invalid URL: ${url}` });
      }
      const result = await runScreener(url, cookies);
      const rawData = result.data?.data || [];
      const stocks = rawData.map((d) => ({
        sr: d.sr,
        'NSE Code': d.nsecode || '',
        'Company Name': d.name || '',
        'BSE Code': d.bsecode || '',
        'Close (₹)': d.close || 0,
        '% Change': d.per_chg || 0,
        Volume: d.volume || 0,
      }));
      const gains = stocks.filter((s) => (s['% Change'] || 0) > 0).length;
      const losers = stocks.filter((s) => (s['% Change'] || 0) < 0).length;
      const avgChg =
        stocks.reduce((sum, s) => sum + (s['% Change'] || 0), 0) / (stocks.length || 1);
      const topGainer = stocks.reduce(
        (best, s) =>
          Math.max(best?.['% Change'] || 0, s['% Change'] || 0) === (s['% Change'] || 0) ? s : best,
        null
      );
      const summary = {
        totalStocks: stocks.length,
        gains: gains,
        losers: losers,
        avgPercentChange: avgChg,
        topGainer: topGainer
          ? { nsecode: topGainer['NSE Code'], per_chg: topGainer['% Change'] }
          : null,
      };
      results.push({
        url,
        result: { ...result, summary, stocks },
      });
    }
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: scanner metadata (scan_run_token, scan clause) ──────────────────────

app.get(`${BASE}/api/scanner/:slug`, async (req, res) => {
  const slug = req.params.slug;
  const url = `https://chartink.com/screener/${slug}`;

  try {
    const html = await fetchHtml(url, req.query.cookies || '');
    const $ = cheerio.load(html);

    const scanClause = extractScanClause(html);

    // HTML entities like &quot; in the page
    const scanRunTokenMatch =
      html.match(/scan_run_token["']\s*:\s*["']([^"']+)["']/) ||
      html.match(/scan_run_token&quot;:&quot;([^&"]+)/);

    const scanIdMatch = html.match(/scan_id["']\s*:\s*["']([^"']+)["']/) ||
      html.match(/scan_id&quot;:&quot;([^&"]+)/);

    res.json({
      slug,
      url,
      scanClause: scanClause || null,
      scanRunToken: scanRunTokenMatch ? scanRunTokenMatch[1] : null,
      scanId: scanIdMatch ? scanIdMatch[1] : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: oapi — proxy Chartink indicator data ──────────────────────────────────

app.get(`${BASE}/api/oapi`, async (req, res) => {
  const symbol = (req.query.symbol || 'AURUS').toUpperCase();
  const timeframe = req.query.timeframe || '15 minutes';
  const size = req.query.size || '200';
  const limit = req.query.limit || size;
  const end_time = req.query.end_time || Math.floor(Date.now() / 1000) * 1000;

  // Historical OHLCV is what the charting tab renders. Chartink returns an empty
  // `groupData` for live intraday (`use_live=1`) requests, so history is the default.
  const useLive = req.query.use_live === '1' ? '1' : '0';

  // Minimal query: the five OHLCV columns only. The previous version aliased `Close`
  // with a hardcoded indicator-set UUID and sent `scan_link` derived from the
  // screener's scan_run_token; Chartink now rejects that combination with
  // 404 ("Scan not found"), so the indicator alias / scan_link are dropped (the
  // frontend only consumes open/high/low/close/volume + tradeTimes).
  const form = {
    query: `select open, high, low, close, volume where symbol='${symbol}'`,
    use_live: useLive,
    limit,
    size,
    widget_id: '-1',
    end_time,
    timeframe,
    symbol,
  };

  const post = (extra = {}) =>
    axios.post('https://chartink.com/oapi', new URLSearchParams({ ...form, ...extra }).toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': BROWSER_UA,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: 30000,
    });

  try {
    let response = await post();
    // Under load Chartink can answer 200 with an empty groupData; retry once so a
    // transient empty response doesn't render as "No data".
    if (!response.data?.groupData?.length) {
      await new Promise((r) => setTimeout(r, 1000));
      response = await post();
    }
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: backtest summary ────────────────────────────────────────────────────

app.get(`${BASE}/api/backtests/:slug`, (req, res) => {
  const { slug } = req.params;
  const summaryPath = path.join(BACKTESTS_DIR, `${slug}_summary.json`);

  if (!fs.existsSync(summaryPath)) {
    return res.status(404).json({ error: 'Backtest not found' });
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  res.json({ slug, summary });
});

// ─── API: backtest daily signal counts (for line chart) ──────────────────────

app.get(`${BASE}/api/backtests/:slug/daily`, (req, res) => {
  const { slug } = req.params;
  const csvPath = path.join(BACKTESTS_DIR, `${slug}_sector_counts.csv`);

  if (!fs.existsSync(csvPath)) {
    return res.status(404).json({ error: 'Sector counts not found' });
  }

  const { rows } = parseCsv(csvPath);
  const daily = rows.map((r) => ({
    date: r['Date'],
    total: Number(r['Total Signals']) || 0,
  }));

  res.json(daily);
});

// ─── API: backtest sector totals (for bar chart) ──────────────────────────────

app.get(`${BASE}/api/backtests/:slug/sectors`, (req, res) => {
  const { slug } = req.params;
  const summaryPath = path.join(BACKTESTS_DIR, `${slug}_summary.json`);

  if (!fs.existsSync(summaryPath)) {
    return res.status(404).json({ error: 'Not found' });
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const sectors = (summary.sectorTotals ?? []).filter((s) => s.total > 0);
  res.json(sectors);
});

// ─── API: backtest daily stocks list ─────────────────────────────────────────

app.get(`${BASE}/api/backtests/:slug/stocks`, (req, res) => {
  const { slug } = req.params;
  const csvPath = path.join(BACKTESTS_DIR, `${slug}_daily_stocks.csv`);

  if (!fs.existsSync(csvPath)) {
    return res.status(404).json({ error: 'Daily stocks not found' });
  }

  const { rows } = parseCsv(csvPath);
  res.json(rows);
});

// ─── API: Momentum Signals ────────────────────────────────────────────────────
// Mount the signals engine under /api/signals. The router is self-contained:
// it reads cookies.txt, runs live scans, caches backtests, and starts timers.

app.use(`${BASE}/api/signals`, signals.signalsRouter);

// ─── Start ────────────────────────────────────────────────────────────────────
// Seed in-memory cache from state/momentum-latest.json and start the status/cycle
// timers at boot.

signals.init();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Chartink Dashboard running at http://localhost:${PORT}${BASE}/`);
  console.log(`API ready at http://localhost:${PORT}${BASE}/api/screeners`);
  console.log(`Signals: http://localhost:${PORT}${BASE}/api/signals/status`);
});
