import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSettings } from './config.js';
import { getScans, getHolidayList } from './config.js';
import { getSignalLog, appendSignalLog } from './store.js';
import { getOhlcv, upsertOhlcv } from './store.js';
import { runCustomQuery } from './custom.js';
import { fetchOhlcv } from './ohlcv.js';
import { runBacktestEngine } from './backtest-engine.js';
import { computePointInTimeStats, saveStats } from './stats.js';
import { fetchRegime } from './regime.js';
import { enrichSignal, rankSignals } from './score.js';
import { appendRunLog } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, '..', 'state');
const RUN_FLAG = path.join(STATE_DIR, 'scheduler_done_today.txt');

const settings = getSettings();

// ─── Trading day check ────────────────────────────────────────────────────

export function isTradingDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const wd = dt.getDay();
  if (wd === 0 || wd === 6) return false;
  const holidays = getHolidayList();
  return !holidays.includes(dateStr);
}

function loadCookies() {
  const env = process.env.CHARTINK_COOKIE;
  if (env) return env.trim();
  const fp = path.join(__dirname, '..', 'cookies.txt');
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8').trim() : '';
}

// ─── Idempotency check ────────────────────────────────────────────────────

function alreadyRanToday(dateStr) {
  return fs.existsSync(RUN_FLAG) && fs.readFileSync(RUN_FLAG, 'utf8').trim() === dateStr;
}

function markDone(dateStr) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(RUN_FLAG, dateStr, 'utf8');
}

// ─── Step 1: Fetch fresh signals ─────────────────────────────────────────

async function fetchSignals(dateStr) {
  const scans = getScans();
  const allSignals = [];

  for (const scan of scans) {
    const scanName = scan.id;
    try {
       const cookies = loadCookies();
       const raw = await runCustomQuery(scan.scan, cookies);

      // Parse Chartink response
      const rows = raw.data?.data || [];
      const parsed = rows.map((r) => ({
        date: dateStr,
        scan_name: scanName,
        nse_code: r.nsecode || r.symbol || '',
        name: r.name || r.companyname || '',
        close: r.close || r.ltp || 0,
        per_chg: r.per_chg || r.pchange || 0,
        volume: r.volume || r.vol || 0,
        sr: r.sr || 0,
        scan_run_time: new Date().toISOString(),
        source: 'live',
      }));

      const result = appendSignalLog(parsed);
      allSignals.push(...parsed);
      console.log(`[scheduler] ${scanName}: ${parsed.length} signals (${result.added} new, ${result.skipped} dupes)`);

      appendRunLog({
        run_time: new Date().toISOString(),
        scan: scanName,
        rows_returned: parsed.length,
        success: true,
      });

      // Rate limit between scans
      await new Promise((r) => setTimeout(r, settings.rate_limit.global_delay_ms));
    } catch (e) {
      console.error(`[scheduler] ${scanName}: ${e.message}`);
      appendRunLog({
        run_time: new Date().toISOString(),
        scan: scanName,
        rows_returned: 0,
        success: false,
        error: e.message,
      });
    }
  }

  return allSignals;
}

// ─── Step 2: Fetch OHLCV for new symbols ─────────────────────────────────

async function fetchOhlcvForSymbols(signals) {
  const existing = getOhlcv();
  const existingSymbols = new Set(existing.map((r) => r.nse_code));

  const newSymbols = new Set();
  for (const s of signals) {
    if (!existingSymbols.has(s.nse_code)) {
      newSymbols.add(s.nse_code);
    }
  }

  console.log(`[scheduler] OHLCV: ${newSymbols.size} new symbols to fetch`);

  for (const sym of newSymbols) {
    try {
      const candles = await fetchOhlcv(sym, settings.ohlcv.size || 200);
      const rows = candles.map((c) => ({
        date: c.date,
        nse_code: sym,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));
      const result = upsertOhlcv(rows);
      console.log(`[scheduler] OHLCV: ${sym} — ${result.upserted} candles cached`);

      await new Promise((r) => setTimeout(r, settings.rate_limit.per_symbol_delay_ms));
    } catch (e) {
      console.error(`[scheduler] OHLCV ${sym}: ${e.message}`);
    }
  }
}

// ─── Step 3: Run backtest engine ──────────────────────────────────────────

async function runBacktest() {
  console.log('[scheduler] Running backtest engine...');
  const results = await runBacktestEngine();

  if (results.error) {
    console.error(`[scheduler] Backtest error: ${results.error}`);
    return null;
  }

  console.log(`[scheduler] Backtest summary:`, JSON.stringify(results.summary));
  return results;
}

// ─── Step 4: Compute PIT stats ───────────────────────────────────────────

function computeStats(trades) {
  // Flatten trades
  const flatTrades = [];
   for (const tradeList of Object.values(trades)) {
    for (const t of tradeList) {
      for (const h of settings.backtest.exit_horizons) {
        const r = t.returns[h];
        if (r && r.netReturn !== null && r.exitDate) {
          flatTrades.push({
            signalType: t.signal_type,
            nseCode: t.nse_code,
            entryDate: t.entry_date,
            exitDate: r.exitDate,
            horizon: h,
            netReturnPct: r.netReturn * 100,
            hit: r.hit,
          });
        }
      }
    }
  }

  if (flatTrades.length === 0) {
    console.log('[scheduler] No trades to compute stats');
    return [];
  }

  // Generate as_of_date list
  const exitDates = flatTrades.map((t) => t.exitDate).sort();
  const firstExit = exitDates[0];
  const lastExit = exitDates[exitDates.length - 1];

  const asOfDates = [];
  const d = new Date(firstExit);
  d.setDate(d.getDate() + 1);
  const end = new Date(lastExit);
  while (d <= end) {
    asOfDates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 7);
  }

  console.log(`[scheduler] Computing PIT stats for ${asOfDates.length} dates`);
  const stats = computePointInTimeStats(flatTrades, asOfDates);
  console.log(`[scheduler] Computed ${stats.length} stat rows`);

  saveStats(stats);
  return stats;
}

// ─── Step 5: Fetch regime ─────────────────────────────────────────────────

async function updateRegime(dateStr) {
  try {
    const entry = await fetchRegime(dateStr);
    console.log(`[scheduler] Regime: ${entry.date} → ${entry.regime} (breadth=${entry.breadth.toFixed(3)})`);
    return entry;
  } catch (e) {
    console.error(`[scheduler] Regime fetch failed: ${e.message}`);
    return null;
  }
}

// ─── Step 6: Enrich + gate + score today's signals ────────────────────────

export function enrichTodaySignals(dateStr) {
  const allSignals = getSignalLog();
  const today = allSignals.filter(
    (s) => s.date === dateStr && s.source === 'live'
  );

  console.log(`[scheduler] ${today.length} live signals to enrich`);

  const gated = [];
  const rejected = [];

  for (const sig of today) {
    const ohlcv = getOhlcv(sig.nse_code);
    if (!ohlcv.length) {
      rejected.push({ nseCode: sig.nse_code, reason: 'no_ohlcv' });
      continue;
    }

    const result = enrichSignal(sig, ohlcv);
    if (result.gate.gate) {
      gated.push(result);
    } else {
      rejected.push({ nseCode: sig.nse_code, reasons: result.gate.reasons });
    }
  }

  const ranked = rankSignals(gated);
  console.log(`[scheduler] Gated: ${gated.length} / Rejected: ${rejected.length}`);

  return { gated: ranked, rejected };
}

// ─── Step 7: Save results ─────────────────────────────────────────────────

function saveResults(dateStr, backtestResults, stats, regime, signals) {
  const OUTPUT_DIR = path.join(STATE_DIR, 'daily_results');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const output = {
    date: dateStr,
    runTime: new Date().toISOString(),
    backtest: backtestResults?.summary || null,
    stats: { count: stats?.length || 0 },
    regime: regime ? { regime: regime.regime, breadth: regime.breadth } : null,
    signals: {
      gated: signals.gated.length,
      rejected: signals.rejected.length,
      ranked: signals.gated.map((s) => ({
        nseCode: s.nseCode,
        name: s.name,
        signalDate: s.signalDate,
        scanName: s.scanName,
        score: s.score?.score,
        regime: s.regime,
        bestHorizon: s.gate?.bestHorizon,
      })),
    },
  };

  const filePath = path.join(OUTPUT_DIR, `${dateStr}.json`);
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[scheduler] Results saved to ${filePath}`);
}

// ─── Main EOD pipeline ───────────────────────────────────────────────────

export async function runEODPipeline(dateStr = null) {
  const today = dateStr || new Date().toISOString().slice(0, 10);

  // Check trading day
  if (!isTradingDay(today)) {
    console.log(`[scheduler] ${today} is not a trading day (weekend/holiday). Skipping.`);
    return { skipped: true, reason: 'weekend_or_holiday' };
  }

  // Check idempotency
  if (alreadyRanToday(today)) {
    console.log(`[scheduler] Already ran for ${today}. Skipping.`);
    return { skipped: true, reason: 'already_ran' };
  }

  console.log(`\n[scheduler] === EOD Pipeline for ${today} ===\n`);

  // 1. Fetch fresh signals
  const signals = await fetchSignals(today);

  // 2. Fetch OHLCV for new symbols
  const allSignals = [...getSignalLog().filter((s) => s.source === 'live' && s.date === today), ...signals];
  await fetchOhlcvForSymbols(allSignals);

  // 3. Run backtest engine
  const backtestResults = await runBacktest();

  // 4. Compute PIT stats
  let stats = [];
  if (backtestResults && backtestResults.trades) {
    stats = computeStats(backtestResults.trades) || [];
  }

  // 5. Update regime
  const regime = await updateRegime(today);

  // 6. Enrich + gate + score today's signals
  const signalResults = enrichTodaySignals(today);

  // 7. Save results
  saveResults(today, backtestResults, stats, regime, signalResults);

  markDone(today);
  console.log(`\n[scheduler] === Pipeline complete for ${today} ===\n`);

  return {
    date: today,
    signalsFetched: signals.length,
    backtestSummary: backtestResults?.summary || null,
    statsRows: stats.length,
    regime: regime?.regime,
    gatedCount: signalResults.gated.length,
    rejectedCount: signalResults.rejected.length,
  };
}
