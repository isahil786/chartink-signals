import axios from 'axios';
import { getSettings } from './config.js';
import { upsertOhlcv, getOhlcv } from './store.js';

const BASE_URL = 'https://chartink.com';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function tsToDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Fetch daily OHLCV from Chartink's /oapi.
 * One symbol per call (as required by spec).
 * Caches results in ohlcv_daily.json with overwrite semantics.
 */
export async function fetchOhlcv(symbol, cookies = '') {
  const settings = getSettings();
  const timeframe = settings.ohlcv?.timeframe || '1+day';
  const size = settings.ohlcv?.size || 200;
  const limit = size;
  const endTime = Math.floor(Date.now() / 1000) * 1000;
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'User-Agent': BROWSER_UA,
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (cookies) headers.Cookie = cookies;

  const form = new URLSearchParams({
    query: `select open, high, low, close, volume where symbol='${symbol}'`,
    use_live: '0',
    limit: String(limit),
    size: String(size),
    widget_id: '-1',
    end_time: String(endTime),
    timeframe,
    symbol,
  });

  // Under load Chartink can answer 200 with empty groupData; retry once.
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await axios.post(`${BASE_URL}/oapi`, form.toString(), {
        headers,
        timeout: 30000,
      });
      if (response.data?.groupData?.length) break;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      if (attempt === 1) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const data = response.data;
  const tradeTimes = data.metaData?.[0]?.tradeTimes || [];
  const results = data.groupData?.[0]?.results || [];

  const rows = [];
  if (tradeTimes.length && results.length) {
    const fields = ['open', 'high', 'low', 'close', 'volume'];
    for (let i = 0; i < tradeTimes.length; i++) {
      const row = {
        date: tsToDate(tradeTimes[i]),
        nse_code: symbol,
        open: 0, high: 0, low: 0, close: 0, volume: 0,
      };
      for (const r of results) {
        for (const f of fields) {
          if (r[f] && Array.isArray(r[f]) && r[f][i] != null) {
            row[f] = r[f][i];
          }
        }
      }
      if (row.close > 0) rows.push(row);
    }
  }

  if (rows.length) {
    upsertOhlcv(rows);
  }

  return rows;
}

/**
 * Fetch OHLCV for multiple symbols with rate limiting (1 req / 2s).
 */
export async function fetchOhlcvBatch(symbols, cookies = '') {
  const settings = getSettings();
  const delayMs = settings.rate_limit?.per_symbol_delay_ms || 2000;
  const results = {};
  let cachedCount = 0;
  let fetchedCount = 0;

  for (const sym of symbols) {
    // Check cache first
    const existing = getOhlcv(sym);
    if (existing.length > 0) {
      results[sym] = existing;
      cachedCount++;
      continue;
    }

    // Rate limit before each fetch
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      const rows = await fetchOhlcv(sym, cookies);
      results[sym] = rows;
      fetchedCount++;
    } catch (e) {
      console.error(`[ohlcv] ${sym}: ${e.message}`);
      results[sym] = [];
    }
  }

  return { results, cached: cachedCount, fetched: fetchedCount };
}
