import { getSettings } from './config.js';
import { getOhlcv, getSignalLog } from './store.js';

const settings = getSettings();
const cost = settings.cost_model;
const btCfg = settings.backtest;
const wfCfg = settings.walk_forward;
const sanityCfg = settings.sanity_check;
const corpCfg = settings.corporate_action;
const horizons = btCfg.exit_horizons || [1, 3, 5, 10];
const MAX_HORIZON = Math.max(...horizons);

// ─── Date helpers (IST) ────────────────────────────────────────────────

const HOLIDAYS = new Set([
  '2025-01-15','2025-01-26','2025-03-03','2025-03-26','2025-03-31','2025-04-03',
  '2025-04-14','2025-05-01','2025-05-28','2025-06-26','2025-09-14','2025-10-02',
  '2025-10-20','2025-11-10','2025-11-24','2025-12-25',
  '2026-01-15','2026-01-26','2026-03-03','2026-03-26','2026-03-31','2026-04-03',
  '2026-04-14','2026-05-01','2026-05-28','2026-06-26','2026-09-14','2026-10-02',
  '2026-10-20','2026-11-10','2026-11-24','2026-12-25',
]);

function isTradingDay(y, m, d) {
  const dt = new Date(y, m - 1, d);
  const wd = dt.getDay();
  if (wd === 0 || wd === 6) return false;
  return !HOLIDAYS.has(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
}

function addTradingDays(dateStr, n) {
  let [y, m, d] = dateStr.split('-').map(Number);
  let count = 0;
  while (count < n) {
    d++;
    const dim = new Date(y, m, 0).getDate();
    if (d > dim) { d = 1; m++; if (m > 12) { m = 1; y++; } }
    if (isTradingDay(y, m, d)) count++;
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysBetween(d1, d2) {
  const a = new Date(d1 + 'T00:00:00+05:30');
  const b = new Date(d2 + 'T00:00:00+05:30');
  return (b - a) / (1000 * 60 * 60 * 24);
}

// ─── Cost model ────────────────────────────────────────────────────────
// Total cost as fraction of entry price, per round-trip trade.
function computeCostFraction(entryPrice) {
  const brokerageFrac = cost.brokerage_inr / entryPrice;
  const exchangeFrac = cost.exchange_charges_pct / 100;
  const gstFrac = cost.gst_pct * (brokerageFrac + exchangeFrac);
  const stampFrac = cost.stamp_duty_pct / 100;
  const slippageFrac = cost.slippage_pct_per_side / 100;
  // Two sides for brokerage/exchange/gst/stamp/slippage; STT is sell-side only
  return (
    2 * (brokerageFrac + exchangeFrac + gstFrac + stampFrac + slippageFrac) +
    cost.stt_pct / 100
  );
}

// ─── ATR14 ────────────────────────────────────────────────────────────

function computeATR(ohlcv, entryDate) {
  const sorted = [...ohlcv].sort((a, b) => (a.date > b.date ? 1 : -1));
  const entryIdx = sorted.findIndex((r) => r.date === entryDate);
  if (entryIdx < 1) return null;
  const start = Math.max(0, entryIdx - 14);
  const window = sorted.slice(start, entryIdx);
  if (window.length < 2) return null;

  let trSum = 0;
  let count = 0;
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1];
    const curr = window[i];
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    trSum += tr;
    count++;
  }
  return count > 0 ? trSum / count : null;
}

// ─── Corporate action guard ───────────────────────────────────────────

export function detectCorporateActions(ohlcv) {
  const sorted = [...ohlcv].sort((a, b) => (a.date > b.date ? 1 : -1));
  const flagged = new Set();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev.close || !curr.close) continue;
    const chg = (curr.close - prev.close) / prev.close;
    // NSE circuit bands are typically 5/10/20%. If price moved beyond
    // 60% up or 35% down and is NOT a circuit move, flag it.
    const isCircuit = Math.abs(chg) >= 0.05;
    if (chg < -corpCfg.drop_threshold_pct / 100 && !isCircuit) flagged.add(curr.date);
    if (chg > corpCfg.spike_threshold_pct / 100 && !isCircuit) flagged.add(curr.date);
  }
  return flagged;
}

// ─── Single trade ─────────────────────────────────────────────────────

export function computeTrade(signal, ohlcv) {
  const sorted = ohlcv.sort((a, b) => (a.date > b.date ? 1 : -1));
  const signalDate = signal.date;
  const sigIdx = sorted.findIndex((r) => r.date === signalDate);
  if (sigIdx < 0) return null;

  // Entry = OPEN of next trading day after signal date
  const entryIdx = sigIdx + 1;
  if (entryIdx >= sorted.length) return null;
  const entry = sorted[entryIdx];
  const entryPrice = entry.open;

  // ATR14 from 14 days before entry
  const atr = computeATR(sorted, entry.date);
  if (!atr) return null;
  const stopPrice = entryPrice - btCfg.stop_multiplier_atr * atr;

  // Corporate action dates to exclude
  const flagged = detectCorporateActions(sorted);

  const returns = {};
  for (const h of horizons) {
    const exitDate = addTradingDays(entry.date, h);
    const exitIdx = sorted.findIndex((r) => r.date === exitDate);

     if (exitIdx < 0) {
       returns[h] = { netReturn: null, hit: null, error: 'missing_day', exitDate };
       continue;
     }

    // Check stop hit & corporate actions within window
    let stopHit = false;
    for (let i = entryIdx + 1; i <= exitIdx; i++) {
      if (flagged.has(sorted[i].date)) {
        returns[h] = { netReturn: null, hit: null, error: 'corporate_action' };
        stopHit = false;
        break;
      }
      if (sorted[i].low <= stopPrice) {
        stopHit = true;
      }
    }

    let exitPrice;
    if (stopHit) {
      exitPrice = stopPrice;
    } else {
      exitPrice = sorted[exitIdx].close;
    }

     const gross = (exitPrice - entryPrice) / entryPrice;
     const costFrac = computeCostFraction(entryPrice);
     const net = gross - costFrac;
     returns[h] = { netReturn: net, hit: net > 0, exitPrice, stopHit: !!stopHit, exitDate };
  }

  return {
    signal_date: signalDate,
    entry_date: entry.date,
    entry_price: entryPrice,
    stop_price: stopPrice,
    atr14: atr,
    returns,
    signal_type: signal.scan_name,
    nse_code: signal.nse_code,
  };
}

// ─── Overlapping signal deduplication ──────────────────────────────────

export function deduplicateSignals(trades, horizon = MAX_HORIZON) {
  const byStock = {};
  for (const t of trades) {
    (byStock[t.nse_code] = byStock[t.nse_code] || []).push(t);
  }
  const deduped = [];
  for (const sym of Object.keys(byStock)) {
    const sorted = byStock[sym].sort((a, b) =>
      a.signal_date > b.signal_date ? 1 : -1
    );
    let lastDate = null;
    for (const t of sorted) {
      if (lastDate && daysBetween(lastDate, t.signal_date) < horizon) continue;
      deduped.push(t);
      lastDate = t.signal_date;
    }
  }
  return deduped;
}

// ─── Statistics ────────────────────────────────────────────────────────

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function wilsonLower(hits, n, z = 1.96) {
  if (n === 0) return 0;
  const p = hits / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const spread = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  return Math.max(0, center - spread);
}

export function computeStats(trades, horizon) {
  const valid = trades.filter(
    (t) => t && t.returns[horizon] && !t.returns[horizon].error
  );
  const returns = valid.map((t) => t.returns[horizon].netReturn);
  const hits = returns.filter((r) => r > 0).length;

  const grossUp = returns.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const grossDown = Math.abs(returns.filter((r) => r <= 0).reduce((a, b) => a + b, 0));
  const profitFactor = grossDown > 0 ? grossUp / grossDown : grossUp > 0 ? Infinity : 0;

  let cumEq = 1;
  let peak = 1;
  let maxDD = 0;
  for (const r of returns) {
    cumEq *= 1 + r;
    peak = Math.max(peak, cumEq);
    maxDD = Math.max(maxDD, (peak - cumEq) / peak);
  }

  const distinctDays = new Set(valid.map((t) => t.signal_date)).size;
  const hitRate = returns.length ? hits / returns.length : 0;
  const avgExp = mean(returns);

  return {
    signal_type: valid[0]?.signal_type || '',
    nse_code: valid[0]?.nse_code || '',
    as_of_date: valid[valid.length - 1]?.signal_date || '',
    regime: 'unknown',
    horizon: `day+${horizon}`,
    occurrences: returns.length,
    distinct_days: distinctDays,
    hit_rate: hitRate,
    avg_net_return: avgExp,
    median_net_return: median(returns),
    profit_factor: profitFactor,
    max_drawdown: maxDD,
    wilson_lower: wilsonLower(hits, returns.length),
    sample_scope: 'out-of-sample',
    avg_return: avgExp,
  };
}

// ─── Walk-forward ──────────────────────────────────────────────────────

export function walkForward(trades) {
  const sorted = [...trades].sort((a, b) =>
    a.signal_date > b.signal_date ? 1 : -1
  );
  const splitIdx = Math.floor(sorted.length * (wfCfg?.train_frac || 0.70));
  const train = sorted.slice(0, splitIdx);
  const test = sorted.slice(splitIdx);

  // Choose best horizon on training data (by avg net return)
  let bestH = horizons[1] || 3;
  let bestExp = -Infinity;
  for (const h of horizons) {
    const s = computeStats(train, h);
    if (s.avg_net_return > bestExp) {
      bestExp = s.avg_net_return;
      bestH = h;
    }
  }

  // Report on test data
  const testStats = computeStats(test, bestH);
  testStats.suggested_hold_days = bestH;
  testStats.train_expectancy = bestExp;
  testStats.train_occurrences = train.length;
  return testStats;
}

// ─── Sanity check ────────────────────────────────────────────────────

export function runSanityCheck(stats) {
  const issues = [];
  for (const [key, s] of Object.entries(stats)) {
    if (s.hit_rate > sanityCfg.max_hit_rate_threshold &&
        s.occurrences > sanityCfg.min_occurrences_for_check) {
      issues.push({
        key,
        hit_rate: s.hit_rate,
        occurrences: s.occurrences,
        message: `Hit rate ${(s.hit_rate * 100).toFixed(1)}% on ${s.occurrences} ` +
          `exceeds ${(sanityCfg.max_hit_rate_threshold * 100)}% threshold`,
      });
    }
  }
  return issues;
}

// ─── Main: run backtest for one or all signals ────────────────────────

export async function runBacktestEngine(scanName, nseCode) {
  // Get replayed signals (from backtest seeding)
  const allSignals = getSignalLog();
  const replayed = allSignals.filter(
    (s) => s.source === 'replayed' &&
      (!scanName || s.scan_name === scanName) &&
      (!nseCode || s.nse_code === nseCode)
  );

  if (!replayed.length) return { error: 'no replayed signals found' };

  // Deduplicate overlapping signals per stock within max horizon
  const deduped = deduplicateSignals(replayed, MAX_HORIZON);

  // Group by (scan_name, nse_code)
  const groups = {};
  for (const s of deduped) {
    const key = `${s.scan_name}|${s.nse_code}`;
    (groups[key] = groups[key] || []).push(s);
  }

  const results = {
    trades: {},
    stats_per_stock: {},
    stats_per_signal: {},
    dropped_trades: 0,
    corporate_actions: [],
    sanity_issues: [],
    summary: {},
  };

  let totalTrades = 0;
  let dropped = 0;

  for (const [key, groupSignals] of Object.entries(groups)) {
    const [, sym] = key.split('|');
    const ohlcv = getOhlcv(sym);
    if (!ohlcv.length) {
      console.warn(`  [skip] ${sym}: no OHLCV data`);
      continue;
    }

    const trades = [];
    for (const sig of groupSignals) {
      const t = computeTrade(sig, ohlcv);
      if (!t) {
        dropped++;
        continue;
      }
      let anyDropped = false;
      for (const h of horizons) {
        if (t.returns[h]?.error) anyDropped = true;
      }
      if (anyDropped) dropped++;
      trades.push(t);
      totalTrades++;
    }

    results.trades[key] = trades;

    // Walk-forward per stock
    const oosStats = walkForward(trades);
    results.stats_per_stock[key] = oosStats;

    // Track corporate actions
    const flagged = detectCorporateActions(ohlcv);
    if (flagged.size) {
      results.corporate_actions.push({ symbol: sym, dates: [...flagged] });
    }
  }

  results.dropped_trades = dropped;

  // Aggregate per signal (across all stocks)
  const signalGroups = {};
  for (const [key, trades] of Object.entries(results.trades)) {
    const scan = key.split('|')[0];
    (signalGroups[scan] = signalGroups[scan] || []).push(...trades);
  }

  for (const [scan, allTrades] of Object.entries(signalGroups)) {
    const oosStats = walkForward(allTrades);
    // Enrich with per-stock breakdown
    const stockKeys = Object.keys(results.stats_per_stock).filter((k) => k.startsWith(scan + '|'));
    oosStats.per_stock_keys = stockKeys;
    results.stats_per_signal[scan] = oosStats;
  }

  // Sanity check across all stats
  const allStats = { ...results.stats_per_signal, ...results.stats_per_stock };
  results.sanity_issues = runSanityCheck(allStats);

  // Summary
  results.summary = {
    total_signals_seeded: deduped.length,
    total_trades: totalTrades,
    dropped_trades: dropped,
    stocks_tested: Object.keys(results.stats_per_stock).length,
    signals_tested: Object.keys(results.stats_per_signal).length,
    corporate_actions_flagged: results.corporate_actions.length,
    sanity_passed: results.sanity_issues.length === 0,
  };

  return results;
}
