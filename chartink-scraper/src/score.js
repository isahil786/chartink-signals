import { getSettings } from './config.js';
import { loadStats } from './stats.js';
import { getRegime } from './regime.js';
import { isNiftySymbol } from './nifty-filter.js';

const settings = getSettings();
const gates = settings.gate;
const shrinkageK = settings.shrinkage.k;
const liquidity = settings.liquidity;

export function checkLiquidity(ohlcv) {
  if (!ohlcv || ohlcv.length === 0) return { pass: false, reason: 'no_ohlcv' };

  const sorted = [...ohlcv].sort((a, b) => (a.date > b.date ? 1 : -1));
  const latest = sorted[sorted.length - 1];

  if (latest.close < liquidity.min_price_inr) {
    return { pass: false, reason: 'price_below_min' };
  }

  // 20-day average daily traded value
  const window = sorted.slice(-20);
  const avgValue = window.reduce((s, r) => s + r.close * r.volume, 0) / window.length;
  if (avgValue < liquidity.min_avg_daily_value_inr) {
    return { pass: false, reason: 'value_below_min' };
  }

  return { pass: true, avgValue };
}

// ─── Gate checks ─────────────────────────────────────────────────────────
// Returns { gate: true/false, reasons: [...], bestHorizon, ... }
export function gateSignal(signal, ohlcv, _statsStore = null) {
  const nseCode = signal.nse_code;

  // Nifty / index filter
  if (isNiftySymbol(nseCode)) {
    return { gate: false, reasons: ['nifty_or_index'] };
  }

  // Liquidity filter
  const liq = checkLiquidity(ohlcv, nseCode);
  if (!liq.pass) {
    return { gate: false, reasons: [liq.reason] };
  }

  // Regime check
  const signalDate = signal.date;
  const regimeEntry = getRegime(signalDate);
  if (!regimeEntry) {
    return { gate: false, reasons: ['no_regime_history'] };
  }
   const regime = regimeEntry.regime;
  // Normalize: YAML uses risk_on/risk_off, regime values use risk-on/risk-off
  const regimeKey = regime.replace(/-/g, '_');
  const regimeAllowed = gates.regime_gates[regimeKey];
  if (!regimeAllowed) {
    return { gate: false, reasons: [`regime_${regime}_blocked`] };
  }

  // Load PIT stats for signal-level aggregation
  const store = loadStats();

  // Use all historical stats up to and including signal date
  const asOfDate = signalDate;
  const eligibleStats = store.filter((s) =>
    s.signalType === signal.scan_name &&
    s.asOfDate <= asOfDate
  );

  // Group by horizon (regime is already part of the stats key)

  // Signal-level aggregation: combine across stocks
  // Group by (horizon, regime) and aggregate
  const horizonGroups = {};
  for (const s of eligibleStats) {
    if (s.regime !== regime) continue;
    const hk = `${s.horizon}`;
    if (!horizonGroups[hk]) {
      horizonGroups[hk] = { occurrences: 0, wins: 0, totalReturn: 0, totalWinReturn: 0, totalLossAbs: 0, days: new Set() };
    }
    horizonGroups[hk].occurrences += s.occurrences;
    // Reconstruct from stats: hits = hitRate * occurrences
    const hits = Math.round(s.hitRate * s.occurrences);
    horizonGroups[hk].wins += hits;
    horizonGroups[hk].totalReturn += s.avgNetReturn * s.occurrences;
    horizonGroups[hk].totalWinReturn += s.avgNetReturn > 0 ? s.avgNetReturn * s.occurrences : 0;
    horizonGroups[hk].totalLossAbs += s.avgNetReturn <= 0 ? Math.abs(s.avgNetReturn) * s.occurrences : 0;
    horizonGroups[hk].days.add(s.asOfDate);
  }

  // Compute aggregate stats per horizon
  const horizonStats = {};
  for (const [h, agg] of Object.entries(horizonGroups)) {
    const n = agg.occurrences;
    if (n === 0) continue;
    const hitRate = agg.wins / n;
    const avgReturn = agg.totalReturn / n;
    const pf = agg.totalLossAbs > 0 ? agg.totalWinReturn / agg.totalLossAbs : agg.totalWinReturn > 0 ? Infinity : 0;

    // Wilson lower bound
    const z = 1.96;
    const phat = hitRate;
    const denom = 1 + z * z / n;
    const center = phat + (z * z) / (2 * n);
    const spread = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n);
    const wilsonLower = (center - spread) / denom;

    // Confidence factor (shrinkage)
    const confidenceFactor = Math.sqrt(n / (n + shrinkageK));

    horizonStats[h] = {
      occurrences: n,
      hitRate,
      avgNetReturn: avgReturn,
      profitFactor: pf,
      wilsonLower: Math.max(0, wilsonLower),
      confidenceFactor,
    };
  }

  if (Object.keys(horizonStats).length === 0) {
    return { gate: false, reasons: ['no_eligible_stats'] };
  }

  // Pick best horizon by Wilson lower bound × (1 + avg_return)
  let bestHorizon = null;
  let bestScore = -Infinity;
  for (const [h, s] of Object.entries(horizonStats)) {
    const score = s.wilsonLower * (1 + s.avgNetReturn / 100);
    if (score > bestScore) {
      bestScore = score;
      bestHorizon = parseInt(h);
    }
  }

  const hs = horizonStats[String(bestHorizon)];

  // ─── Gate checks ────────────────────────────────────────────────────
  const reasons = [];

  if (hs.wilsonLower < gates.min_wilson_hit_rate_lower) {
    reasons.push(`wilson_lower_${hs.wilsonLower.toFixed(3)}<${gates.min_wilson_hit_rate_lower}`);
  }

  if (eligibleStats.length < gates.min_signal_occurrences) {
    reasons.push(`occurrences_${eligibleStats.length}<${gates.min_signal_occurrences}`);
  }

  const distinctDays = new Set(eligibleStats.map((s) => s.asOfDate)).size;
  if (distinctDays < gates.min_signal_distinct_days) {
    reasons.push(`distinct_days_${distinctDays}<${gates.min_signal_distinct_days}`);
  }

  if (hs.profitFactor < gates.min_profit_factor) {
    reasons.push(`profit_factor_${hs.profitFactor.toFixed(2)}<${gates.min_profit_factor}`);
  }

  // Blended expectancy = hit_rate × avg_win - (1 - hit_rate) × avg_loss
  // Approximate avg_win and avg_loss from avgReturn and hitRate
  const avgWin = hs.avgNetReturn > 0 ? hs.avgNetReturn * 2 : 0;
  const avgLoss = hs.avgNetReturn <= 0 ? Math.abs(hs.avgNetReturn) : Math.abs(hs.avgNetReturn);
  const expectancy = (hs.hitRate * avgWin) - ((1 - hs.hitRate) * avgLoss);
  if (expectancy < gates.min_blended_expectancy_pct) {
    reasons.push(`expectancy_${expectancy.toFixed(2)}<${gates.min_blended_expectancy_pct}`);
  }

  if (reasons.length > 0) {
    return {
      gate: false,
      reasons,
      bestHorizon,
      stats: hs,
      regime,
      confidenceFactor: hs.confidenceFactor,
    };
  }

  return {
    gate: true,
    reasons: [],
    bestHorizon,
    stats: hs,
    regime,
    confidenceFactor: hs.confidenceFactor,
  };
}

// ─── Score a gated signal ────────────────────────────────────────────────
// composite = wilson_lower × (1 + avg_return_pct/100) × confidence_factor
export function scoreSignal(gateResult) {
  const s = gateResult.stats;
  if (!s) return { score: 0, gate: false };

  const z = 1.96;
  const n = s.occurrences;
  const phat = s.hitRate;
  const denom = 1 + z * z / n;
  const center = phat + (z * z) / (2 * n);
  const spread = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n);
  const wilsonLower = (center - spread) / denom;

  const confidenceFactor = Math.sqrt(n / (n + shrinkageK));
  const returnFactor = 1 + s.avgNetReturn / 100;
  const score = wilsonLower * returnFactor * confidenceFactor;

  return {
    score,
    wilsonLower: Math.max(0, wilsonLower),
    confidenceFactor,
    returnFactor,
    avgNetReturn: s.avgNetReturn,
    hitRate: s.hitRate,
    profitFactor: s.profitFactor,
    occurrences: s.occurrences,
  };
}

// ─── Full pipeline: enrich + gate + score ───────────────────────────────
export function enrichSignal(signal, ohlcv) {
  const liq = checkLiquidity(ohlcv, signal.nse_code);
  const regimeEntry = getRegime(signal.date);
  const gateResult = gateSignal(signal, ohlcv);
  let scoring = null;

  if (gateResult.gate) {
    scoring = scoreSignal(gateResult);
  }

  return {
    nseCode: signal.nse_code,
    name: signal.name,
    signalDate: signal.date,
    scanName: signal.scan_name,
    close: signal.close,
    regime: regimeEntry?.regime || 'unknown',
    liquidity: liq,
    gate: gateResult,
    score: scoring,
  };
}

export function rankSignals(enrichedList) {
  return [...enrichedList]
    .filter((e) => e.score)
    .sort((a, b) => b.score.score - a.score.score);
}
