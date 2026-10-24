import { runBacktestEngine } from './src/backtest-engine.js';
import { computePointInTimeStats, saveStats, loadStats } from './src/stats.js';
import { getRegimeHistory, getRegime } from './src/regime.js';
import { getSettings } from './src/config.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, 'state');

const settings = getSettings();
const horizons = settings.backtest.exit_horizons;

// ─── Run backtest engine ───────────────────────────────────────────────
console.log('[step5] Running backtest engine...');
const results = await runBacktestEngine();

if (results.error) {
  console.error(`[step5] ERROR: ${results.error}`);
  process.exit(1);
}

console.log(`[step5] Engine summary: ${JSON.stringify(results.summary, null, 2)}`);

// ─── Flatten trades for PIT computation ────────────────────────────────
// Each trade has returns per horizon. We need a flat array:
// { signalType, nseCode, entryDate, exitDate, horizon, netReturnPct }
const flatTrades = [];
for (const [key, trades] of Object.entries(results.trades)) {
  for (const t of trades) {
    for (const h of horizons) {
      const r = t.returns[h];
      if (r && r.netReturn !== null && r.exitDate) {
        flatTrades.push({
          signalType: t.signal_type,
          nseCode: t.nse_code,
          entryDate: t.entry_date,
          exitDate: r.exitDate,
          horizon: h,
          netReturnPct: r.netReturn * 100, // convert to %
          hit: r.hit,
        });
      }
    }
  }
}
console.log(`[step5] Flattened ${flatTrades.length} trade-horizon entries`);

// ─── Compute date list for PIT stats ───────────────────────────────────
const exitDates = flatTrades.map((t) => t.exitDate).sort();
const firstExit = exitDates[0];
const lastExit = exitDates[exitDates.length - 1];
console.log(`[step5] Trade exit dates: ${firstExit} → ${lastExit}`);

const asOfDates = [];
const d = new Date(firstExit);
d.setDate(d.getDate() + 1);
const end = new Date(lastExit);
while (d <= end) {
  asOfDates.push(d.toISOString().slice(0, 10));
  d.setDate(d.getDate() + 7);
}
console.log(`[step5] Computing PIT stats for ${asOfDates.length} as_of_dates`);

// ─── Compute PIT stats ─────────────────────────────────────────────────
const stats = computePointInTimeStats(flatTrades, asOfDates);
console.log(`[step5] Computed ${stats.length} stat rows`);

const sample = stats.slice(0, 5);
for (const s of sample) {
  const pfStr = Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞';
  console.log(`  ${s.signalType} | ${s.nseCode} | ${s.horizon}d | ${s.regime} | hit=${(s.hitRate * 100).toFixed(1)}% | avg=${s.avgNetReturn.toFixed(2)}% | PF=${pfStr} | occ=${s.occurrences}`);
}

// ─── Regime info ───────────────────────────────────────────────────────
const history = getRegimeHistory();
console.log(`[step5] Regime history: ${history.length} entries`);
if (history.length > 0) {
  const latest = history[history.length - 1];
  console.log(`  Latest: ${latest.date} → ${latest.regime} (breadth=${latest.breadth.toFixed(3)})`);
}

// ─── Save stats ────────────────────────────────────────────────────────
saveStats(stats);
console.log('[step5] SAVED state/backtest_stats.json with PIT stats');

// ─── Verify determinism ────────────────────────────────────────────────
const loaded = loadStats();
const sampleCheck = stats[0];
const freshCheck = loaded.find((s) =>
  s.signalType === sampleCheck.signalType &&
  s.nseCode === sampleCheck.nseCode &&
  s.horizon === sampleCheck.horizon &&
  s.asOfDate === sampleCheck.asOfDate &&
  s.regime === sampleCheck.regime
);
if (freshCheck && freshCheck.occurrences === sampleCheck.occurrences && freshCheck.hitRate === sampleCheck.hitRate) {
  console.log('[step5] VERIFIED: PIT stats deterministic and reproducible');
} else {
  console.error('[step5] ERROR: PIT stats non-deterministic');
}

// ─── Verify PIT constraint (exitDate < as_of_date) ─────────────────────
let pitOk = true;
for (const stat of stats) {
  const matchingTrades = flatTrades.filter(
    (t) => t.signalType === stat.signalType &&
      t.nseCode === stat.nseCode &&
      t.horizon === stat.horizon &&
      new Date(t.exitDate) < new Date(stat.asOfDate)
  );
  // Regime splits trades into groups by exit-date regime
  const tradeRegime = getRegime(matchingTrades[0]?.exitDate)?.regime || 'unknown';
  if (matchingTrades.length > 0 && stat.occurrences > 0) {
    const sameRegimeTrades = matchingTrades.filter(
      (t) => (getRegime(t.exitDate)?.regime || 'unknown') === stat.regime
    );
    if (sameRegimeTrades.length !== stat.occurrences) {
      console.error(`[step5] PIT violation: ${stat.signalType}/${stat.nseCode} ${stat.asOfDate} regime=${stat.regime} has ${stat.occurrences} in stats but ${sameRegimeTrades.length} eligible trades`);
      pitOk = false;
      break;
    }
  }
}
console.log(pitOk ? '[step5] VERIFIED: all stats rows respect PIT constraint (exitDate < asOfDate)' : '[step5] ERROR: PIT constraint violated');

// ─── Verify 3-year cap ─────────────────────────────────────────────────
const threeYearsMs = 3 * 365 * 24 * 60 * 60 * 1000;
let capOk = true;
for (const stat of stats) {
  const matchingTrades = flatTrades.filter(
    (t) => t.signalType === stat.signalType &&
      t.nseCode === stat.nseCode &&
      t.horizon === stat.horizon &&
      new Date(t.exitDate) < new Date(stat.asOfDate) &&
      new Date(t.exitDate) >= new Date(new Date(stat.asOfDate).getTime() - threeYearsMs)
  );
  if (matchingTrades.length > 0 && stat.occurrences > matchingTrades.length) {
    console.error(`[step5] 3-year cap violation: ${stat.signalType}/${stat.nseCode} ${stat.asOfDate}`);
    capOk = false;
    break;
  }
}
console.log(capOk ? '[step5] VERIFIED: all stats rows respect 3-year lookback cap' : '[step5] ERROR: 3-year cap violated');

console.log('\n[step5] DONE');
