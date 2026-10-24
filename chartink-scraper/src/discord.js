import fs from 'fs';
import path from 'path';

function loadEnv() {
  try {
    const p = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      }
    }
  } catch {}
}
loadEnv();

function getWebhook() {
  if (process.env.DISCORD_WEBHOOK_URL) return process.env.DISCORD_WEBHOOK_URL;
  try {
    const p = path.resolve(process.cwd(), 'state', 'discord-webhook.txt');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  } catch {}
  return null;
}

const WEBHOOK = getWebhook();

export async function notifyDiscord(content, embeds) {
  if (!WEBHOOK) return false;
  const body = { content, embeds };
  try {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (e) {
    console.error('Discord notify failed:', e.message);
    return false;
  }
}

export function formatSignalEmbeds(stocks, type = 'Momentum') {
  if (!stocks || !stocks.length) return null;
  return stocks.slice(0, 10).map(s => ({
    title: `${s.symbol}  —  ${s.signal ?? type}`,
    color: 0x00b894,
    fields: [
      { name: 'PRICE', value: `₹${s.ltp ?? '-'}`, inline: true },
      { name: 'CHANGE', value: `${s.pctChange ?? '-'}%`, inline: true },
      { name: 'VOLUME', value: `${s.volume ?? '-'}`, inline: true },
      { name: 'SIGNAL', value: s.signal ?? type, inline: true },
      { name: 'STRENGTH', value: s.strength ?? '-', inline: true },
      { name: 'RECENT MATCH', value: s.recentMatch ? `${s.recentMatch.days}/${s.recentMatch.ofLast} days` : 'n/a', inline: true },
    ],
    timestamp: new Date().toISOString(),
  }));
}
