import fs from 'fs';
import path from 'path';
import { getBreadthScans, getSettings } from './config.js';
import { runCustomQuery } from './custom.js';
import { saveRawResponse } from './store.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const STATE_DIR = path.join(__dirname, '..', 'state');
const REGIME_FILE = path.join(STATE_DIR, 'regime_history.json');

const settings = getSettings();
const delay = settings.rate_limit?.global_delay_ms || 2000;

// ─── Run breadth scans via /screener/process ──────────────────────────
// Uses only Chartink scan counts — never per-symbol /oapi calls.
function loadCookies() {
  const env = process.env.CHARTINK_COOKIE;
  if (env) return env.trim();
  const fp = path.join(__dirname, '..', 'cookies.txt');
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8').trim() : '';
}

export async function fetchRegime(dateStr = null) {
  const breadth = getBreadthScans();
  const cookies = loadCookies();
  const today = dateStr || new Date().toISOString().slice(0, 10);

  const counts = {};
  for (const [scanId, scanDef] of Object.entries(breadth)) {
    try {
      const raw = await runCustomQuery(scanDef.scan, cookies);

      // Archive raw
      saveRawResponse(`screener-${scanId}`, raw, 'regime');

      const rows = raw.data?.data || [];
      counts[scanId] = rows.length;
    } catch (e) {
      console.error(`[regime] ${scanId}: ${e.message}`);
      counts[scanId] = 0;
    }
    await new Promise((r) => setTimeout(r, delay));
  }

  const scanAKey = Object.keys(breadth)[0];  // "scanA"
  const scanBKey = Object.keys(breadth)[1];  // "scanB"
  const total = counts[scanBKey] || 0;
  const aboveSma = counts[scanAKey] || 0;
  const breadthValue = total > 0 ? aboveSma / total : 0;
  const regime = breadthValue > 0.5 ? 'risk-on' : 'risk-off';

  const entry = {
    date: today,
    scan_a_name: breadth[scanAKey].name,
    scan_b_name: breadth[scanBKey].name,
    scan_a_count: aboveSma,
    scan_b_count: total,
    total_count: total,
    breadth: breadthValue,
    regime,
    fetchedAt: new Date().toISOString(),
  };

  saveRegimeHistory(entry);
  return entry;
}

// ─── Regime history persistence ───────────────────────────────────────

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function loadRegimeHistory() {
  if (!fs.existsSync(REGIME_FILE)) return [];
  const lines = fs.readFileSync(REGIME_FILE, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

function saveRegimeHistory(entry) {
  ensureDirs();
  const history = loadRegimeHistory();
  // Upsert by date
  const idx = history.findIndex((e) => e.date === entry.date);
  if (idx >= 0) history[idx] = entry;
  else history.push(entry);
  history.sort((a, b) => (a.date > b.date ? 1 : -1));
  fs.writeFileSync(REGIME_FILE, history.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

export function getRegime(dateStr) {
  const history = loadRegimeHistory();
  if (dateStr) return history.find((e) => e.date === dateStr) || null;
  return history[history.length - 1] || null;
}

export function getRegimeHistory() {
  return loadRegimeHistory();
}
