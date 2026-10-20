import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runCustomQuery } from './custom.js';
import { runCustomBacktest } from './backtest.js';
import { processBacktest } from './processor.js';

// All runtime paths anchored to chartink-scraper/ (server boots with that as cwd).
const __signalsDir = path.dirname(fileURLToPath(import.meta.url));
const CHARTINK_DIR = path.join(__signalsDir, '..');
const STATE_DIR = path.join(CHARTINK_DIR, 'state');
const BACKTEST_CACHE_DIR = path.join(STATE_DIR, 'momentum-backtest');
const FLAG_FILE = path.join(STATE_DIR, 'momentum-flag.json');
const LATEST_FILE = path.join(STATE_DIR, 'momentum-latest.json');
const COOKIE_FILE = path.join(CHARTINK_DIR, 'cookies.txt');
const QUERIES_FILE = path.join(CHARTINK_DIR, 'momentum-queries.json');
const WATCHLIST_FILE = path.join(CHARTINK_DIR, 'watchlist.txt');

const STATUS_INTERVAL = 30_000;
const RUN_INTERVAL = 150_000;
const BACKTEST_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ROWS = 60;
const IST = 'Asia/Kolkata';

// Momentum history weighting: how strongly backtest history influences ranking.
// score = MOMENTUM_HISTORY_W * confidence + (1 - MOMENTUM_HISTORY_W) * strengthNorm
const MOMENTUM_HISTORY_W = 0.6;

// NSE equity (equity + equity derivatives + SLB) trading holidays for 2026.
// Source: NSE "Trading Holidays 2026" (equity segment). Update annually.
const NSE_HOLIDAYS_2026 = new Set([
  '2026-01-15',
  '2026-01-26',
  '2026-03-03',
  '2026-03-26',
  '2026-03-31',
  '2026-04-03',
  '2026-04-14',
  '2026-05-01',
  '2026-05-28',
  '2026-06-26',
  '2026-09-14',
  '2026-10-02',
  '2026-10-20',
  '2026-11-10',
  '2026-11-24',
  '2026-12-25',
]);

export const signalsRouter = express.Router();

let statusTimer = null;
let runTimer = null;

let fetching = false;
let backtestFetching = false;

const state = {
  enabled: false,
  marketOpen: false,
  queries: [],
  watchlist: null,
};

const signalsCache = {
  enabled: false,
  marketOpen: false,
  status: 'disabled',
  stocks: [],
  backtest: {},
  lastGenerated: null,
  nextRun: null,
  cacheAgeMs: 0,
  fetchErrors: {},
};

// ─── Loaders ──────────────────────────────────────────────────────

function loadQueries() {
  try {
    if (fs.existsSync(QUERIES_FILE)) {
      const q = JSON.parse(fs.readFileSync(QUERIES_FILE, 'utf8'));
      if (Array.isArray(q)) return q;
    }
  } catch (e) {
    console.error('[signals] failed to load momentum-queries.json:', e.message);
  }
  return [];
}

function loadWatchlist() {
  try {
    if (fs.existsSync(WATCHLIST_FILE)) {
      const lines = fs.readFileSync(WATCHLIST_FILE, 'utf8').split('\n');
      const wl = lines
        .map((l) => l.trim().toUpperCase())
        .filter((l) => l && !l.startsWith('#'));
      return wl.length ? wl : null;
    }
  } catch (e) {
    console.error('[signals] failed to load watchlist.txt:', e.message);
  }
  return null;
}

function loadCookies() {
  try {
    if (fs.existsSync(COOKIE_FILE)) return fs.readFileSync(COOKIE_FILE, 'utf8').trim();
  } catch (e) {
    console.error('[signals] failed to load cookies.txt:', e.message);
  }
  return '';
}

function loadFlag() {
  const env = process.env.MOMENTUM_SIGNALS;
  if (env === 'true' || env === '1') return true;
  if (env === 'false' || env === '0') return false;
  try {
    if (fs.existsSync(FLAG_FILE)) {
      const f = JSON.parse(fs.readFileSync(FLAG_FILE, 'utf8'));
      return !!f.enabled;
    }
  } catch (e) {
    console.error('[signals] failed to load momentum-flag.json:', e.message);
  }
  return false;
}

function saveFlag(enabled) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(
    FLAG_FILE,
    JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

// ─── IST helpers (market-hours gate, 09:15–16:00 Mon–Fri) ───────────

function istField(date, options) {
  try {
    return new Intl.DateTimeFormat('en-IN', { timeZone: IST, ...options }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', options).format(date);
  }
}

function todayIST(now = new Date()) {
  const y = istField(now, { year: 'numeric' });
  const m = istField(now, { month: '2-digit' });
  const d = istField(now, { day: '2-digit' });
  return `${y}-${m}-${d}`;
}

function isMarketOpen(now = new Date()) {
  const today = todayIST(now);
  if (NSE_HOLIDAYS_2026.has(today)) return false;
  const wd = istField(now, { weekday: 'short' });
  if (wd === 'Sat' || wd === 'Sun') return false;
  const h24 = Number(istField(now, { hour12: false, hour: '2-digit' }));
  const m = Number(istField(now, { minute: '2-digit' }));
  const mins = h24 * 60 + m;
  // 09:15 = 555  ..  16:00 = 960
  return mins >= 555 && mins < 960;
}

function strengthFromPct(pct) {
  const p = Number(pct) || 0;
  if (p >= 5) return 'high';
  if (p >= 2) return 'medium';
  if (p > 0) return 'low';
  return 'none';
}

function strengthNorm(pct) {
  return Math.max(0, Math.min(1, (Number(pct) || 0) / 10));
}

// Historical-fitness confidence (0..1) from backtest context.
// Blends the signal type's backtest hit-rate with this stock's recent frequency
// of matching the scan (days matched / trade days in the window). Falls back
// gracefully when no backtest cache exists — current momentum still ranks via score.
function confidenceFor(hitRate, rec) {
  const typeHit = Number(hitRate) || 0;
  if (rec && rec.ofLast) {
    return Math.round((0.5 * typeHit + 0.5 * (rec.days / rec.ofLast)) * 1000) / 1000;
  }
  return Math.round(typeHit * 1000) / 1000;
}

// ─── Persistence ────────────────────────────────────────────────────

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(BACKTEST_CACHE_DIR, { recursive: true });
}

function writeLatest() {
  ensureDirs();
  fs.writeFileSync(LATEST_FILE, JSON.stringify(signalsCache, null, 2), 'utf8');
}

function loadBacktestCaches() {
  try {
    if (!fs.existsSync(BACKTEST_CACHE_DIR)) return;
    const files = fs.readdirSync(BACKTEST_CACHE_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      try {
        const c = JSON.parse(fs.readFileSync(path.join(BACKTEST_CACHE_DIR, f), 'utf8'));
        if (!c?.type) continue;
        const stale =
          !c.cachedAt || Date.now() - new Date(c.cachedAt).getTime() > BACKTEST_TTL_MS;
        signalsCache.backtest[c.type] = {
          summary: c.summary || null,
          cachedAt: c.cachedAt || null,
          cacheStale: stale || !!c.cacheError,
          cacheError: c.cacheError || null,
          symbolRecent: c.symbolRecent || {},
        };
      } catch (e) {
        console.error('[signals] failed to load backtest cache', f, e.message);
      }
    }
  } catch (e) {
    console.error('[signals] failed to read backtest cache dir:', e.message);
  }
}

function loadLatestSnapshot() {
  try {
    if (fs.existsSync(LATEST_FILE)) {
      const s = JSON.parse(fs.readFileSync(LATEST_FILE, 'utf8'));
      Object.assign(signalsCache, s);
    }
  } catch (e) {
    console.error('[signals] failed to load momentum-latest.json:', e.message);
  }
  loadBacktestCaches();
}

// ─── Backtest cache builder ───────────────────────────────────────

function classifyError(e) {
  const msg = (e && e.message) || String(e);
  if (/40[13]\b|auth|login|unauthorized|forbidden/i.test(msg)) return 'auth required';
  return `backtest failed: ${msg}`;
}

function detectEmpty(raw, proc) {
  const data = raw && raw.data;
  const emptyList = !(data && data.aggregatedStockList && data.aggregatedStockList.length);
  const totalDays = proc.totalDays || 0;
  const totalSignals = proc.totalSignalOccurrences || 0;
  if (totalDays === 0) return 'no backtest data (login may be required)';
  if (totalSignals === 0 && emptyList) return 'no backtest data (login may be required)';
  return null;
}

export async function buildBacktestCache(type, maxRows = DEFAULT_MAX_ROWS, cookies) {
  const q = state.queries.find((x) => x.id === type);
  if (!q) return { type, ok: false, cacheError: `unknown signal type: ${type}` };

  const today = todayIST();
  const cachedAt = new Date().toISOString();

  try {
    const raw = await runCustomBacktest(q.scan, maxRows, cookies || loadCookies(), type);
    const proc = processBacktest(raw);

    if (!proc || !proc.summary) {
      throw Object.assign(new Error('unexpected backtest response shape'), { code: 'EMPTY' });
    }

    const symbolRecent = {};
    for (const row of proc.dailyRows) {
      const date = row[0];
      const symbol = row[1];
      if (!symbol) continue;
      const rec = (symbolRecent[symbol] =
        symbolRecent[symbol] || { days: new Set(), total: 0, lastDate: '' });
      rec.days.add(date);
      rec.total += 1;
      if (date > rec.lastDate) rec.lastDate = date;
    }
    for (const sym in symbolRecent) {
      const r = symbolRecent[sym];
      r.days = r.days.size;
      r.ofLast = proc.totalDays;
    }

    const hitRate = proc.totalDays ? proc.summary.activeDays / proc.totalDays : 0;
    const summary = { ...proc.summary, hitRate };
    const cacheError = detectEmpty(raw, proc);

    ensureDirs();
    const cache = { type, today, summary, symbolRecent, cachedAt, cacheError: cacheError || null };
    fs.writeFileSync(
      path.join(BACKTEST_CACHE_DIR, `${type}-${today}.json`),
      JSON.stringify(cache, null, 2),
      'utf8'
    );

    signalsCache.backtest[type] = {
      summary,
      cachedAt,
      cacheStale: Boolean(cacheError),
      cacheError: cacheError || null,
      symbolRecent,
    };
    refreshRecentMatches();
    writeLatest();

    return { type, ok: !cacheError, summary, cachedAt, cacheError: cacheError || null };
  } catch (e) {
    const cacheError = classifyError(e);
    console.error(`[signals] backtest build failed for ${type}:`, e.message);
    signalsCache.backtest[type] = {
      summary: null,
      cachedAt,
      cacheStale: true,
      cacheError,
      symbolRecent: {},
    };
    writeLatest();
    return { type, ok: false, cachedAt, cacheError };
  }
}

function refreshRecentMatches() {
  for (const stock of signalsCache.stocks) {
    const entry = signalsCache.backtest[stock.type];
    if (!entry || !entry.symbolRecent) {
      stock.recentMatch = null;
      continue;
    }
    const rec = entry.symbolRecent[stock.symbol];
    const totalDays = entry.summary ? entry.summary.totalDays || 0 : 0;
    stock.recentMatch = rec
      ? { days: rec.days, ofLast: totalDays, total: rec.total, lastDate: rec.lastDate }
      : null;
  }
}

// ─── Live momentum generation ─────────────────────────────────────

export async function generateSignals() {
  const cookies = loadCookies();
  const watchlist = loadWatchlist();
  const stocks = [];
  const fetchErrors = {};

  for (const q of state.queries) {
    try {
      const result = await runCustomQuery(q.scan, cookies);
      const rows = result.data?.data ?? [];
      const entry = signalsCache.backtest[q.id] || {};
      const symbolRecent = entry.symbolRecent || {};
      const recentTotalDays = entry.summary ? entry.summary.totalDays || 0 : 0;
      const hitRate = entry.summary ? entry.summary.hitRate || 0 : 0;

      for (const r of rows) {
        const symbol = r.nsecode;
        if (!symbol) continue;
        if (watchlist && !watchlist.includes(symbol.toUpperCase())) continue;

        const pct = Number(r.per_chg) || 0;
        const rec = symbolRecent[symbol];
        const confidence = confidenceFor(hitRate, rec);
        const score = Math.round((MOMENTUM_HISTORY_W * confidence + (1 - MOMENTUM_HISTORY_W) * strengthNorm(pct)) * 1000) / 1000;

        stocks.push({
          symbol,
          name: r.name || '',
          ltp: Number(r.close) || 0,
          pctChange: pct,
          volume: Number(r.volume) || 0,
          sr: Number(r.sr) || 0,
          signal: q.name,
          type: q.id,
          strength: strengthFromPct(pct),
          confidence,
          score,
          recentMatch: rec
            ? { days: rec.days, ofLast: recentTotalDays, total: rec.total, lastDate: rec.lastDate }
            : null,
          generatedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      fetchErrors[q.id] = e.message;
      console.error(`[signals] live scan failed for ${q.id}:`, e.message);
    }
  }

  // Backtest-informed ranking: historical fitness (confidence) first, then live momentum.
  stocks.sort((a, b) => {
    const d = (b.score || 0) - (a.score || 0);
    return d !== 0 ? d : (b.pctChange || 0) - (a.pctChange || 0);
  });

  signalsCache.stocks = stocks;
  signalsCache.lastGenerated = new Date().toISOString();
  signalsCache.fetchErrors = fetchErrors;
  writeLatest();
}

// ─── Status + cycle ───────────────────────────────────────────────

export function refreshStatus() {
  state.marketOpen = isMarketOpen();
  state.enabled = loadFlag();
  const now = new Date();
  signalsCache.enabled = state.enabled;
  signalsCache.marketOpen = state.marketOpen;

  signalsCache.nextRun = signalsCache.lastGenerated
    ? new Date(new Date(signalsCache.lastGenerated).getTime() + RUN_INTERVAL).toISOString()
    : null;

  signalsCache.cacheAgeMs = signalsCache.lastGenerated
    ? now.getTime() - new Date(signalsCache.lastGenerated).getTime()
    : 0;

  if (!state.enabled) {
    signalsCache.status = 'disabled';
  } else if (!state.marketOpen) {
    signalsCache.status = 'market-closed';
  } else if (fetching) {
    signalsCache.status = 'running';
  } else {
    signalsCache.status = 'idle';
  }
}

async function refreshStaleBacktests() {
  if (!state.enabled || !state.marketOpen) return;
  if (backtestFetching) return;
  backtestFetching = true;
  try {
    for (const q of state.queries) {
      const entry = signalsCache.backtest[q.id];
      const stale =
        !entry ||
        !entry.cachedAt ||
        entry.cacheStale ||
        Date.now() - new Date(entry.cachedAt).getTime() > BACKTEST_TTL_MS ||
        !!entry.cacheError;
      if (stale) {
        await buildBacktestCache(q.id);
      }
    }
  } finally {
    backtestFetching = false;
  }
}

async function runCycle() {
  refreshStatus();
  if (state.enabled && state.marketOpen && !fetching) {
    fetching = true;
    try {
      await generateSignals();
    } catch (e) {
      console.error('[signals] cycle failed:', e.message);
    } finally {
      fetching = false;
    }
    refreshStatus();
    void refreshStaleBacktests();
  }
}

// ─── Snapshot (served to frontend) ────────────────────────────────

export function snapshot() {
  const backtestView = {};
  for (const [type, entry] of Object.entries(signalsCache.backtest)) {
    backtestView[type] = {
      summary: entry.summary || null,
      cachedAt: entry.cachedAt || null,
      cacheStale: entry.cacheStale ?? true,
      cacheError: entry.cacheError || null,
    };
  }
  return {
    enabled: signalsCache.enabled,
    marketOpen: signalsCache.marketOpen,
    status: signalsCache.status,
    lastGenerated: signalsCache.lastGenerated || null,
    nextRun: signalsCache.nextRun || null,
    cacheAgeMs: signalsCache.cacheAgeMs,
    backtest: backtestView,
    stocks: signalsCache.stocks,
    fetchErrors: signalsCache.fetchErrors || {},
  };
}

// ─── Express routes ───────────────────────────────────────────────

function parseEnabled(req) {
  if (req.query.value !== undefined) return String(req.query.value) === 'true';
  if (req.body && typeof req.body.enabled !== 'undefined')
    return req.body.enabled === true || req.body.enabled === 'true';
  return true;
}

signalsRouter.get('/', (_req, res) => {
  refreshStatus();
  res.json(snapshot());
});

signalsRouter.get('/status', (_req, res) => {
  refreshStatus();
  res.json({
    enabled: signalsCache.enabled,
    marketOpen: signalsCache.marketOpen,
    status: signalsCache.status,
    nextRun: signalsCache.nextRun || null,
  });
});

signalsRouter.post('/toggle', express.json(), (req, res) => {
  const enabled = parseEnabled(req);
  state.enabled = enabled;
  saveFlag(enabled);
  signalsCache.enabled = enabled;
  res.json({ enabled });
});

signalsRouter.post('/backtest/:type', express.json(), async (req, res) => {
  const type = req.params.type;
  const maxRows = Number(req.query.max_rows) || DEFAULT_MAX_ROWS;
  const result = await buildBacktestCache(type, maxRows);
  res.json(result);
});

// ─── Boot ─────────────────────────────────────────────────────────

export function startTimers() {
  if (statusTimer) clearInterval(statusTimer);
  if (runTimer) clearInterval(runTimer);
  statusTimer = setInterval(refreshStatus, STATUS_INTERVAL);
  runTimer = setInterval(runCycle, RUN_INTERVAL);
  console.log(
    `[signals] timers started (status=${STATUS_INTERVAL}ms, cycle=${RUN_INTERVAL}ms)`
  );
}

export function init() {
  ensureDirs();
  state.queries = loadQueries();
  state.watchlist = loadWatchlist();
  state.marketOpen = isMarketOpen();
  state.enabled = loadFlag();
  loadLatestSnapshot();
  refreshStatus();
  startTimers();
  console.log(
    `[signals] initialized: ${state.queries.length} queries · enabled=${state.enabled} · marketOpen=${state.marketOpen}`
  );
}

export default { signalsRouter, init, startTimers, generateSignals, buildBacktestCache, refreshStatus, snapshot };
