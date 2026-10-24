import fs from 'fs';
import path from 'path';
import { getRawChartinkDir } from './config.js';
import { isNiftySymbol } from './nifty-filter.js';

const STATE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'state');
const RAW_DIR = getRawChartinkDir();

// ─── Ensure directories ──────────────────────────────────────────────

function ensureDirs() {
  [STATE_DIR, RAW_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));
}

// ─── Nifty / index symbol filter ─────────────────────────────────────

function filterNiftySymbols(rows) {
  return rows.filter((r) => !isNiftySymbol(r.nse_code || r.symbol));
}

// ─── Raw response archive ────────────────────────────────────────────

function saveRawResponse(source, data, prefix = 'raw') {
  ensureDirs();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fn = `${prefix}_${source.replace(/[^a-z0-9_-]/gi, '_')}_${ts}.json`;
  const fp = path.join(RAW_DIR, fn);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
  return fp;
}

// ─── signal_log.jsonl ────────────────────────────────────────────────
// Schema: { date, scan_name, nse_code, name, close, per_chg, volume, sr, scan_run_time, source }
// Unique on (date, scan_name, nse_code). Appending checks for existing key.

const SIGNAL_LOG = path.join(STATE_DIR, 'signal_log.jsonl');

function loadSignalLog() {
  if (!fs.existsSync(SIGNAL_LOG)) return [];
  const lines = fs.readFileSync(SIGNAL_LOG, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

function signalKey(r) {
  return `${r.date}|${r.scan_name}|${r.nse_code}`;
}

export function appendSignalLog(rows) {
  ensureDirs();
  const existing = new Set(loadSignalLog().map(signalKey));
  let added = 0;
  let skipped = 0;
  const fh = fs.openSync(SIGNAL_LOG, 'a');
  for (const r of rows) {
    if (existing.has(signalKey(r))) {
      skipped++;
      continue;
    }
    fs.writeSync(fh, JSON.stringify(r) + '\n');
    existing.add(signalKey(r));
    added++;
  }
  fs.closeSync(fh);
  return { added, skipped };
}

export function getSignalLog(date, scanName) {
  return loadSignalLog().filter((r) => (!date || r.date === date) && (!scanName || r.scan_name === scanName));
}

export function getAllSignalLogDates() {
  const seen = new Set();
  for (const r of loadSignalLog()) seen.add(r.date);
  return [...seen].sort();
}

// ─── ohlcv_daily.json ────────────────────────────────────────────────
// Schema: { date, nse_code, open, high, low, close, volume }
// Unique on (date, nse_code). Overwrite on re-run.

const OHLCV_FILE = path.join(STATE_DIR, 'ohlcv_daily.json');

function loadOhlcv() {
  if (!fs.existsSync(OHLCV_FILE)) return {};
  return JSON.parse(fs.readFileSync(OHLCV_FILE, 'utf8'));
}

export function upsertOhlcv(rows) {
  ensureDirs();
  const store = loadOhlcv();
  let upserted = 0;
  for (const r of rows) {
    const key = `${r.date}|${r.nse_code}`;
    store[key] = r;
    upserted++;
  }
  fs.writeFileSync(OHLCV_FILE, JSON.stringify(store, null, 2), 'utf8');
  return { upserted };
}

export function getOhlcv(symbol, fromDate, toDate) {
  const store = loadOhlcv();
  const keys = Object.keys(store).filter((k) => {
    const [d, s] = k.split('|');
    return (!symbol || s === symbol) && (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
  });
  return keys
    .map((k) => store[k])
    .sort((a, b) => (a.date > b.date ? 1 : -1));
}

// ─── backtest_stats.json ──────────────────────────────────────────────
// Schema per entry:
//   { signal_type, nse_code, as_of_date, regime, horizon,
//     occurrences, distinct_days, hit_rate, avg_net_return, median_net_return,
//     profit_factor, max_drawdown, wilson_lower, sample_scope }
// Unique on (signal_type, nse_code, as_of_date, regime, horizon).

const BT_STATS_FILE = path.join(STATE_DIR, 'backtest_stats.json');

function loadBacktestStats() {
  if (!fs.existsSync(BT_STATS_FILE)) return {};
  return JSON.parse(fs.readFileSync(BT_STATS_FILE, 'utf8'));
}

function btStatsKey(r) {
  return `${r.signal_type}|${r.nse_code}|${r.as_of_date}|${r.regime}|${r.horizon}`;
}

export function upsertBacktestStats(rows) {
  ensureDirs();
  const store = loadBacktestStats();
  let upserted = 0;
  for (const r of rows) {
    store[btStatsKey(r)] = r;
    upserted++;
  }
  fs.writeFileSync(BT_STATS_FILE, JSON.stringify(store, null, 2), 'utf8');
  return { upserted };
}

export function getBacktestStats(signalType, nseCode, asOfDate) {
  const store = loadBacktestStats();
  const keys = Object.keys(store).filter((k) => {
    const [st, sym, asof] = k.split('|');
    return (!signalType || st === signalType) && (!nseCode || sym === nseCode) && (!asOfDate || asof === asOfDate);
  });
  return keys.map((k) => store[k]);
}

// ─── chartink_backtest.json (reference only) ──────────────────────────
// Chartink's own strategy-level figures. NEVER used for gating or ranking.

const CHARTINK_BT_FILE = path.join(STATE_DIR, 'chartink_backtest.json');

export function saveChartinkBacktest(scanName, raw) {
  ensureDirs();
  let store = {};
  if (fs.existsSync(CHARTINK_BT_FILE)) store = JSON.parse(fs.readFileSync(CHARTINK_BT_FILE, 'utf8'));
  // Store reference figures only — hit_rate, occurrences, etc. from Chartink.
  const summary = raw.data?.summary || {};
  const metaData = raw.data?.metaData?.[0] || {};
  store[scanName] = {
    scanClause: raw.scanClause,
    fetchedAt: raw.fetchedAt,
    maxRows: raw.maxRows,
    tradeTimes: metaData.tradeTimes || [],
    chartinkSummary: summary,
    source: 'chartink-backtest',
  };
  fs.writeFileSync(CHARTINK_BT_FILE, JSON.stringify(store, null, 2), 'utf8');
  return store[scanName];
}

export function getChartinkBacktest(scanName) {
  const store = {};
  if (fs.existsSync(CHARTINK_BT_FILE)) {
    Object.assign(store, JSON.parse(fs.readFileSync(CHARTINK_BT_FILE, 'utf8')));
  }
  return scanName ? store[scanName] : store;
}

// ─── run_log.jsonl ───────────────────────────────────────────────────
// Schema: { run_time, scan, rows_returned, success, error }

const RUN_LOG = path.join(STATE_DIR, 'run_log.jsonl');

export function appendRunLog(entry) {
  ensureDirs();
  const fh = fs.openSync(RUN_LOG, 'a');
  fs.writeSync(fh, JSON.stringify(entry) + '\n');
  fs.closeSync(fh);
}

export function getRunLog(scan, limit = 100) {
  if (!fs.existsSync(RUN_LOG)) return [];
  const lines = fs.readFileSync(RUN_LOG, 'utf8').trim().split('\n').filter(Boolean);
  let entries = lines.map((l) => JSON.parse(l));
  if (scan) entries = entries.filter((e) => e.scan === scan);
  return entries.slice(-limit).reverse();
}

// ─── Row-count summaries for checkpoint ──────────────────────────────

export function rowCounts() {
  const counts = {};
  counts.signal_log = loadSignalLog().length;
  counts.ohlcv_daily = Object.keys(loadOhlcv()).length;
  counts.backtest_stats = Object.keys(loadBacktestStats()).length;
  counts.chartink_backtest = Object.keys(getChartinkBacktest()).length;
  const rlLines = fs.existsSync(RUN_LOG) ? fs.readFileSync(RUN_LOG, 'utf8').trim().split('\n').filter(Boolean) : [];
  counts.run_log = rlLines.length;
  const rawFiles = fs.existsSync(RAW_DIR) ? fs.readdirSync(RAW_DIR).filter((f) => f.endsWith('.json')) : [];
  counts.raw_chartink = rawFiles.length;
  return counts;
}

export { filterNiftySymbols, saveRawResponse };
