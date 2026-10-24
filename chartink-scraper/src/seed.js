import fs from 'fs';
import path from 'path';
import { getScans, getSettings } from './config.js';
import { isNiftySymbol } from './nifty-filter.js';
import { runCustomQuery } from './custom.js';
import { runCustomBacktest } from './backtest.js';
import { processScreener, processBacktest } from './processor.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const COOKIE_FILE = path.join(__dirname, '..', 'cookies.txt');

function loadCookies() {
  const envCookie = process.env.CHARTINK_COOKIE;
  if (envCookie) return envCookie.trim();
  if (fs.existsSync(COOKIE_FILE)) return fs.readFileSync(COOKIE_FILE, 'utf8').trim();
  return '';
}

/**
 * Fetch today's live signals for all configured scans.
 * Writes raw response to raw_chartink/ and appends to signal_log (source="live").
 * Filters out Nifty/index symbols.
 */
export async function fetchLiveSignals(scanIdFilter) {
  const queries = getScans();
  const scans = scanIdFilter ? queries.filter((q) => q.id === scanIdFilter) : queries;
  const cookies = loadCookies();
  const settings = getSettings();
  const now = new Date();
  const todayDate = now.toISOString().slice(0, 10);

  const results = [];
  for (const q of scans) {
    try {
      const raw = await runCustomQuery(q.scan, cookies);
      // Archive raw response
      const { saveRawResponse } = await import('./store.js');
      saveRawResponse(`screener-${q.id}`, raw, 'screener');

      const proc = processScreener(raw);
      const stocks = proc.csvRows || [];

      const signalRows = [];
      for (const s of stocks) {
        const nseCode = s[1];
        if (!nseCode || isNiftySymbol(nseCode)) continue;
        signalRows.push({
          date: todayDate,
          scan_name: q.id,
          nse_code: nseCode,
          name: s[3] || '',
          close: parseFloat(s[4]) || 0,
          per_chg: parseFloat(s[5]) || 0,
          volume: parseInt(s[6]) || 0,
          sr: parseInt(s[0]) || 0,
          scan_run_time: now.toISOString(),
          source: 'live',
        });
      }

      const { appendSignalLog } = await import('./store.js');
      const { added, skipped } = appendSignalLog(signalRows);
      const { appendRunLog } = await import('./store.js');
      appendRunLog({
        run_time: now.toISOString(),
        scan: q.id,
        rows_returned: signalRows.length,
        success: true,
        error: null,
      });

      results.push({ scan: q.id, raw_count: stocks.length, stored: added, skipped });
    } catch (e) {
      const { appendRunLog } = await import('./store.js');
      appendRunLog({
        run_time: now.toISOString(),
        scan: q.id,
        rows_returned: 0,
        success: false,
        error: e.message,
      });
      console.error(`[seed] ${q.id}: ${e.message}`);
      results.push({ scan: q.id, error: e.message });
    }

    // Rate limit: max 1 req/2s
    await new Promise((r) => setTimeout(r, settings.rate_limit?.global_delay_ms || 2000));
  }

  return results;
}

/**
 * Seed signal_log from Chartink /backtest/process (case b = dated stock lists).
 * For each scan, ingest (date, scan_name, nse_code) with source="replayed".
 * Chartink's own hit-rate/occurrence figures are stored separately in chartink_backtest
 * and NEVER used as our statistics.
 */
export async function seedFromBacktest(scanIdFilter, maxRows) {
  const queries = getScans();
  const scans = scanIdFilter ? queries.filter((q) => q.id === scanIdFilter) : queries;
  const cookies = loadCookies();
  const settings = getSettings();
  const rows = maxRows || settings.backtest?.max_rows_default || 60;

  const results = [];
  for (const q of scans) {
    try {
      const raw = await runCustomBacktest(q.scan, rows, cookies, q.id);
      const { saveChartinkBacktest, saveRawResponse, appendSignalLog } = await import('./store.js');

      // Store Chartink's reference figures separately (never used for gating/ranking)
      saveChartinkBacktest(q.id, raw);

      // Archive raw response
      saveRawResponse(`backtest-${q.id}`, raw, 'backtest');

      // Process the backtest response into dated stock rows
      const proc = processBacktest(raw);
      if (!proc.dailyRows || !proc.dailyRows.length) {
        results.push({ scan: q.id, replayed: 0, note: 'empty backtest' });
      } else {
        const replayRows = [];
        for (const row of proc.dailyRows) {
          // row = [date, symbol, cap, sector]
          const date = row[0];
          const symbol = row[1];
          if (!symbol || isNiftySymbol(symbol)) continue;
          replayRows.push({
            date,
            scan_name: q.id,
            nse_code: symbol,
            name: '',
            close: 0,
            per_chg: 0,
            volume: 0,
            sr: 0,
            scan_run_time: null,
            source: 'replayed',
          });
        }

        const { added, skipped } = appendSignalLog(replayRows);
        results.push({ scan: q.id, replayed: replayRows.length, stored: added, skipped });
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, settings.rate_limit?.global_delay_ms || 2000));
    } catch (e) {
      console.error(`[seed] backtest ${q.id}: ${e.message}`);
      results.push({ scan: q.id, error: e.message });
    }
  }

  return results;
}
