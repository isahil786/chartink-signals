import fs from 'fs';
import path from 'path';
import { getRegime } from './regime.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const STATE_DIR = path.join(__dirname, '..', 'state');
const STATS_FILE = path.join(STATE_DIR, 'backtest_stats.json');

// Max lookback window: 3 years in milliseconds
const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000;

/**
 * Point-in-time (PIT) stats computation.
 *
 * For a signal on date t, stats may ONLY include trades whose EXIT date
 * is strictly before t. Expanding window capped at 3 years.
 *
 * Stats are stored per as_of_date so any past day can be reproduced exactly.
 *
 * @param {Array} allTrades  — flat array of trade objects:
 *   { signalId, signalType, nseCode, entryDate(ISO), exitDate(ISO),
 *     horizon, netReturnPct, exitPrice, entryPrice }
 *
 * @param {Array} dateList — sorted ISO date strings for which to compute stats
 */
export function computePointInTimeStats(allTrades, dateList) {
  const results = [];

  for (const asOfDate of dateList) {
    const windowStart = new Date(new Date(asOfDate).getTime() - THREE_YEARS_MS);

    // Filter: exitDate strictly before asOfDate AND within 3-year window
    const eligible = allTrades.filter((t) => {
      const exit = new Date(t.exitDate);
      return exit < new Date(asOfDate) && exit >= windowStart;
    });

    // Group by (signalType, nseCode, horizon, regime)
    const groups = groupBy(eligible, (t) => {
      const regime = getRegime(t.exitDate)?.regime || 'unknown';
      return `${t.signalType}|${t.nseCode}|${t.horizon}|${regime}`;
    });

    for (const [key, trades] of Object.entries(groups)) {
      const [signalType, nseCode, horizon, regime] = key.split('|');
      const stats = computeStats(trades);

      results.push({
        signalType,
        nseCode,
        asOfDate,
        regime,
        horizon: parseInt(horizon),
        ...stats,
      });
    }
  }

  return results;
}

function groupBy(arr, fn) {
  const map = {};
  arr.forEach((item) => {
    const k = fn(item);
    if (!map[k]) map[k] = [];
    map[k].push(item);
  });
  return map;
}

function computeStats(trades) {
  const n = trades.length;
  if (n === 0) {
    return {
      occurrences: 0,
      hitRate: 0,
      avgNetReturn: 0,
      medianNetReturn: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      wilsonLower: 0,
      sampleScope: 'empty',
    };
  }

  const returns = trades.map((t) => t.netReturnPct);
  const wins = trades.filter((t) => t.netReturnPct > 0);
  const losses = trades.filter((t) => t.netReturnPct <= 0);

  const totalWin = wins.reduce((s, t) => s + t.netReturnPct, 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + t.netReturnPct, 0));

  const pf = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0;

  // Max drawdown: running cumulative return series
  let peak = 0;
  let cum = 0;
  let maxDd = 0;
  for (const t of trades.sort((a, b) => new Date(a.exitDate) - new Date(b.exitDate))) {
    cum += t.netReturnPct;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) maxDd = dd;
  }

  // Wilson score interval lower bound (95% confidence)
  const z = 1.96;
  const phat = n > 0 ? wins.length / n : 0;
  const denom = 1 + z * z / n;
  const center = phat + (z * z) / (2 * n);
  const spread = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n);
  const wilsonLower = (center - spread) / denom;

  const sorted = [...returns].sort((a, b) => a - b);
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];

  return {
    occurrences: n,
    distinctDays: new Set(trades.map((t) => t.exitDate.slice(0, 10))).size,
    hitRate: wins.length / n,
    avgNetReturn: returns.reduce((s, r) => s + r, 0) / n,
    medianNetReturn: median,
    profitFactor: pf,
    maxDrawdown: maxDd,
    wilsonLower: Math.max(0, wilsonLower),
    sampleScope: 'expanding_3y',
  };
}

// ─── Persistence ────────────────────────────────────────────────────────

export function saveStats(statsArray) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATS_FILE, JSON.stringify(statsArray, null, 2), 'utf8');
}

export function loadStats() {
  if (!fs.existsSync(STATS_FILE)) return [];
  return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
}
