/* ── State ───────────────────────────────────────────────────── */
let allScreeners = [];
let activeSlug = null;
let chartDaily = null;
let chartSector = null;
let chartOapi = null;

/* ── Boot ────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  loadScreenerList();
  document.getElementById('btn-refresh').addEventListener('click', () => {
    if (activeSlug) loadScreener(activeSlug);
  });
  document.getElementById('fetch-url-btn').addEventListener('click', fetchByUrl);
  document.getElementById('fetch-url-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fetchByUrl();
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Charting fetch
  document.getElementById('btn-fetch-chart').addEventListener('click', fetchOapi);
});

/* ── Base path (injected by server into <meta name="base-path">) ── */
const BASE = (document.querySelector('meta[name="base-path"]') || {}).content || '';

const API_BASE = BASE || window.location.pathname.split('/').slice(0, 2).join('/');

/* ── Fetch helpers ───────────────────────────────────────────── */
async function api(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/* ── Fetch by URL ─────────────────────────────────────────────── */
async function fetchByUrl() {
  const input = document.getElementById('fetch-url-input');
  const url = input.value.trim();
  if (!url || !url.startsWith('http')) {
    alert('Please enter a valid URL');
    return;
  }
  const btn = document.getElementById('fetch-url-btn');
  const originalText = btn.textContent;
  btn.textContent = 'Fetching...';
  btn.disabled = true;
  try {
    const data = await api(`/fetch?screener=${encodeURIComponent(url)}`);
    if (!data.success) throw new Error(data.error || 'Fetch failed');
    const result = data.data[0].result;
    allScreeners.unshift({ slug: result.screenerName, ...result.summary });
    showScreener(result);
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
    input.value = '';
  }
}

function showScreener(result) {
  activeSlug = result.screenerName;
  window.lastStocks = result.stocks;
  document.getElementById('welcome').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('dash-title').textContent = slugToTitle(result.screenerName);
  document.getElementById('dash-date-range').textContent = '';
  document.getElementById('bt-range').textContent = '';
  renderStats({ summary: result.summary }, { summary: {} });
  renderStocksTable(result.stocks);
}

/* ── Sidebar ─────────────────────────────────────────────────── */
async function loadScreenerList() {
  const nav = document.getElementById('nav-list');
  try {
    allScreeners = await api('/api/screeners');
    nav.innerHTML = '';
    allScreeners.forEach((s) => {
      const btn = document.createElement('button');
      btn.className = 'nav-item';
      btn.dataset.slug = s.slug;

      const label = slugToTitle(s.slug);
      const stocks = s.totalStocks ?? '—';
      btn.innerHTML = `
        <div>${label}</div>
        <div class="nav-meta">${stocks} stocks today</div>
      `;
      btn.addEventListener('click', () => loadScreener(s.slug));
      nav.appendChild(btn);
    });

    if (allScreeners.length > 0) loadScreener(allScreeners[0].slug);
  } catch (e) {
    nav.innerHTML = `<div class="nav-loading" style="color:#ef4444">Error: ${e.message}</div>`;
  }
}

function slugToTitle(slug) {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/* ── Main dashboard loader ───────────────────────────────────── */
async function loadScreener(slug) {
  activeSlug = slug;

  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.slug === slug);
  });

  document.getElementById('welcome').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');

  document.getElementById('dash-title').textContent = slugToTitle(slug);
  document.getElementById('dash-date-range').textContent = 'Loading…';

  try {
    const [screenerData, backtestMeta, dailyData, sectorData] = await Promise.all([
      api(`/api/screeners/${slug}`),
      api(`/api/backtests/${slug}`),
      api(`/api/backtests/${slug}/daily`),
      api(`/api/backtests/${slug}/sectors`),
    ]);

    renderStats(screenerData, backtestMeta);
    renderStocksTable(screenerData.stocks);
    renderDailyChart(dailyData);
    renderSectorChart(sectorData);
    renderTopSymbols(backtestMeta.summary.topSymbols ?? []);

    const r = backtestMeta.summary.dateRange ?? {};
    document.getElementById('dash-date-range').textContent =
      r.from && r.to ? `Backtest range: ${r.from} → ${r.to}` : '';
    document.getElementById('bt-range').textContent = r.from && r.to ? `${r.from} → ${r.to}` : '';
  } catch (e) {
    document.getElementById('dash-date-range').textContent = 'Error loading data: ' + e.message;
  }
}

/* ── Stat cards ──────────────────────────────────────────────── */
function renderStats(screener, backtest) {
  const s = screener.summary ?? {};
  const b = backtest.summary ?? {};

  const cards = [
    {
      label: 'Stocks Today',
      value: s.totalStocks ?? 0,
      sub: `${s.gainers ?? 0} up · ${s.losers ?? 0} down`,
      color: '',
    },
    {
      label: 'Avg % Change',
      value:
        (s.avgPercentChange ?? 0) > 0
          ? `+${(s.avgPercentChange ?? 0).toFixed(2)}%`
          : `${(s.avgPercentChange ?? 0).toFixed(2)}%`,
      sub: s.topGainer ? `Best: ${s.topGainer.nsecode} (${s.topGainer.per_chg}%)` : '',
      color: (s.avgPercentChange ?? 0) >= 0 ? 'green' : 'red',
    },
    {
      label: 'Total Signals',
      value: (b.totalSignalOccurrences ?? 0).toLocaleString(),
      sub: `Over ${b.totalDays ?? 0} trading days`,
      color: 'blue',
    },
    {
      label: 'Active Days',
      value: b.activeDays ?? 0,
      sub: `Avg ${b.avgSignalsPerActiveDay ?? 0} signals/day`,
      color: 'purple',
    },
    {
      label: 'Peak Date',
      value: b.peakDate ?? '—',
      sub: `${b.peakDaySignalCount ?? 0} signals on peak day`,
      color: '',
    },
  ];

  const container = document.getElementById('stat-cards');
  container.innerHTML = cards
    .map(
      (c) => `
      <div class="stat-card ${c.color}">
        <div class="label">${c.label}</div>
        <div class="value">${c.value}</div>
        <div class="sub">${c.sub}</div>
      </div>`
    )
    .join('');
}

/* ── Stocks table ────────────────────────────────────────────── */
let sortState = { col: null, dir: 'asc' };
let sortHeadersSetup = false;

function renderStocksTable(stocks) {
  const tbody = document.getElementById('stocks-tbody');
  const empty = document.getElementById('stocks-empty');
  const table = document.getElementById('stocks-table');

  if (!stocks || stocks.length === 0) {
    tbody.innerHTML = '';
    table.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  table.classList.remove('hidden');
  empty.classList.add('hidden');

  const sorted = sortState.col
    ? [...stocks].sort((a, b) => {
        let va = a[sortState.col] ?? '';
        let vb = b[sortState.col] ?? '';
        if (sortState.col === 'Close (₹)') {
          va = parseFloat(va) || 0;
          vb = parseFloat(vb) || 0;
        } else if (sortState.col === '% Change') {
          va = parseFloat(va) || 0;
          vb = parseFloat(vb) || 0;
        } else if (sortState.col === 'Volume') {
          va = parseInt(va) || 0;
          vb = parseInt(vb) || 0;
        } else {
          va = String(va).toLowerCase();
          vb = String(vb).toLowerCase();
        }
        return sortState.dir === 'asc'
          ? va > vb
            ? 1
            : va < vb
              ? -1
              : 0
          : va < vb
            ? 1
            : va > vb
              ? -1
              : 0;
      })
    : stocks;

  tbody.innerHTML = sorted
    .map((s) => {
      const chg = parseFloat(s['% Change'] ?? 0);
      const cls = chg > 0 ? 'change-pos' : chg < 0 ? 'change-neg' : '';
      const sign = chg > 0 ? '+' : '';
      const vol = parseInt(s['Volume'] ?? 0).toLocaleString('en-IN');
      return `
        <tr>
          <td>${s['Sr'] ?? ''}</td>
          <td><span class="nse-code">${s['NSE Code'] ?? ''}</span></td>
          <td>${s['Company Name'] ?? ''}</td>
          <td>${s['BSE Code'] ?? ''}</td>
          <td class="num">₹${parseFloat(s['Close (₹)'] ?? 0).toFixed(2)}</td>
          <td class="num ${cls}">${sign}${chg.toFixed(2)}%</td>
          <td class="num">${vol}</td>
        </tr>`;
    })
    .join('');
}

function setupSortHeaders() {
  if (sortHeadersSetup) return;
  sortHeadersSetup = true;
  const headers = document.querySelectorAll('#stocks-table th');
  const cols = ['Sr', 'NSE Code', 'Company Name', 'BSE Code', 'Close (₹)', '% Change', 'Volume'];
  headers.forEach((th, i) => {
    if (!cols[i]) return;
    th.classList.add('sortable');
    th.innerHTML = `<span>${th.textContent}</span><span class="sort-indicator"></span>`;
    th.addEventListener('click', () => {
      const col = cols[i];
      if (sortState.col === col) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.col = col;
        sortState.dir = 'asc';
      }
      updateSortIndicators();
      renderStocksTable(window.lastStocks || []);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupSortHeaders();
});

function updateSortIndicators() {
  document.querySelectorAll('#stocks-table th').forEach((th) => th.classList.remove('sort-active'));
  const ths = document.querySelectorAll('#stocks-table th');
  const cols = ['Sr', 'NSE Code', 'Company Name', 'BSE Code', 'Close (₹)', '% Change', 'Volume'];
  const idx = cols.indexOf(sortState.col);
  if (idx >= 0) {
    ths[idx].classList.add('sort-active');
    ths[idx].querySelector('.sort-indicator').textContent = sortState.dir === 'asc' ? '▲' : '▼';
  }
}

/* ── Daily signals chart ─────────────────────────────────────── */
function renderDailyChart(daily) {
  const ctx = document.getElementById('chart-daily');
  if (chartDaily) {
    chartDaily.destroy();
    chartDaily = null;
  }

  const labels = daily.map((d) => d.date);
  const values = daily.map((d) => d.total);

  chartDaily = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Daily Signals',
          data: values,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.10)',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items[0].label,
            label: (item) => ` ${item.raw} signals`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: '#64748b',
            maxTicksLimit: 10,
            maxRotation: 0,
          },
          grid: { color: '#1e2433' },
        },
        y: {
          ticks: { color: '#64748b' },
          grid: { color: '#1e2433' },
          beginAtZero: true,
        },
      },
    },
  });
}

/* ── Sector bar chart ────────────────────────────────────────── */
function renderSectorChart(sectors) {
  const ctx = document.getElementById('chart-sector');
  if (chartSector) {
    chartSector.destroy();
    chartSector = null;
  }

  const sorted = [...sectors].sort((a, b) => a.total - b.total);
  const labels = sorted.map((s) => s.sector);
  const values = sorted.map((s) => s.total);

  const palette = [
    '#3b82f6',
    '#6366f1',
    '#8b5cf6',
    '#a78bfa',
    '#06b6d4',
    '#10b981',
    '#22c55e',
    '#84cc16',
    '#f59e0b',
    '#f97316',
    '#ef4444',
    '#ec4899',
    '#14b8a6',
    '#0ea5e9',
    '#64748b',
  ];

  chartSector = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Signals',
          data: values,
          backgroundColor: labels.map((_, i) => palette[i % palette.length]),
          borderRadius: 4,
          borderWidth: 0,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (item) => ` ${item.raw} signals` },
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748b' },
          grid: { color: '#1e2433' },
          beginAtZero: true,
        },
        y: {
          ticks: { color: '#94a3b8', font: { size: 11 } },
          grid: { display: false },
        },
      },
    },
  });
}

/* ── Top symbols list ────────────────────────────────────────── */
function renderTopSymbols(symbols) {
  const container = document.getElementById('top-symbols');
  if (!symbols.length) {
    container.innerHTML = '';
    return;
  }

  const max = symbols[0]?.appearances ?? 1;
  container.innerHTML = `
    <h3>Top Symbols</h3>
    ${symbols
      .map((s) => {
        const pct = Math.round((s.appearances / max) * 100);
        return `
          <div class="sym-row">
            <span class="sym-name">${s.symbol}</span>
            <div class="sym-bar-wrap"><div class="sym-bar" style="width:${pct}%"></div></div>
            <span class="sym-count">${s.appearances}×</span>
          </div>`;
      })
      .join('')}`;
}

/* ── Tab switching ───────────────────────────────────────────── */

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));

  const dashboardEl = document.getElementById('dashboard');
  const chartingEl = document.getElementById('charting-tab');

  if (tab === 'charting') {
    dashboardEl.classList.add('hidden');
    chartingEl.classList.remove('hidden');
  } else {
    dashboardEl.classList.remove('hidden');
    chartingEl.classList.add('hidden');
  }
}

/* ── Fetch scanner metadata ──────────────────────────────────── */

async function fetchScannerMeta(slug) {
  return api(`/api/scanner/${slug}`);
}

/* ── Fetch oapi indicator data ───────────────────────────────── */

async function fetchOapi() {
  const symbol = document.getElementById('chart-symbol').value.trim();
  const slug = document.getElementById('chart-screener-slug').value.trim();
  const timeframe = document.getElementById('chart-timeframe').value;
  const size = document.getElementById('chart-size').value;

  const errorEl = document.getElementById('chart-error');
  const metaEl = document.getElementById('scanner-meta');
  errorEl.classList.add('hidden');
  metaEl.innerHTML = '';

  if (!symbol) {
    errorEl.textContent = 'Please enter a symbol';
    errorEl.classList.remove('hidden');
    return;
  }

  // The chart data only needs a symbol + timeframe now, but the (optional)
  // screener slug still surfaces its scan clause / scan-run-token for reference.
  // If the slug is missing or invalid, keep going and load the chart anyway.
  let scanRunToken = '';
  let scanId = '';
  if (slug) {
    try {
      const meta = await fetchScannerMeta(slug);
      scanRunToken = meta.scanRunToken || '';
      scanId = meta.scanId || '';
      metaEl.innerHTML = `
      <div class="meta-row"><span>Scan Clause</span><span>${meta.scanClause || 'N/A'}</span></div>
      <div class="meta-row"><span>Scan Run Token</span><span>${meta.scanRunToken || 'N/A'}</span></div>
      <div class="meta-row"><span>Scan ID</span><span>${meta.scanId || 'N/A'}</span></div>
    `;
    } catch {
      metaEl.innerHTML = `<div class="meta-row"><span>Screener</span><span style="color:#f87171">unavailable (chart still loads)</span></div>`;
    }
  }

  try {
    const params = new URLSearchParams({
      symbol,
      timeframe,
      scan_run_token: scanRunToken,
      scan_id: scanId,
      size: size,
    });

    const oapiData = await api(`/api/oapi?${params.toString()}`);

    renderOapiData(oapiData, timeframe);
  } catch (e) {
    errorEl.textContent = 'Error: ' + e.message;
    errorEl.classList.remove('hidden');
  }
}

/* ── Render oapi data ────────────────────────────────────────── */

function renderOapiData(data, timeframe) {
  const tbody = document.getElementById('oapi-tbody');
  const emptyEl = document.getElementById('oapi-empty');
  const container = document.getElementById('oapi-table');

  // Parse Chartink oapi format: groupData has arrays of values per field
  const tradeTimes = data.metaData?.[0]?.tradeTimes || [];
  const groupData = data.groupData || [];

  // Flatten groupData into row objects
  const rows = [];
  if (groupData.length > 0 && tradeTimes.length > 0) {
    const results = groupData[0].results || [];
    const fields = ['open', 'high', 'low', 'close', 'volume'];

    for (let i = 0; i < tradeTimes.length; i++) {
      const row = { timestamp: tradeTimes[i] };
      results.forEach((r) => {
        fields.forEach((f) => {
          if (r[f] && Array.isArray(r[f])) {
            row[f] = r[f][i];
          }
        });
      });
      rows.push(row);
    }
  }

  if (!rows.length) {
    emptyEl.textContent = 'No data returned';
    emptyEl.classList.remove('hidden');
    container.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  container.classList.remove('hidden');

  tbody.innerHTML = rows
    .map((r) => {
      const ts = r.timestamp || r.time || r.datetime || r.date || '';
      const dateStr = ts ? new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '';
      return `
        <tr>
          <td>${dateStr}</td>
          <td>${r.open ?? '—'}</td>
          <td>${r.high ?? '—'}</td>
          <td>${r.low ?? '—'}</td>
          <td>${r.close ?? '—'}</td>
          <td>${r.volume ?? '—'}</td>
        </tr>`;
    })
    .join('');

  renderOapiChart(rows, timeframe);
}

/* ── Render oapi chart ───────────────────────────────────────── */

function renderOapiChart(rows, timeframe) {
  const ctx = document.getElementById('chart-oapi');
  if (chartOapi) {
    chartOapi.destroy();
    chartOapi = null;
  }

  const labels = rows.map((r) => {
    const ts = r.timestamp || r.time || r.datetime || r.date || '';
    return ts ? new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '';
  });
  const values = rows.map((r) => parseFloat(r.close ?? r.c) || 0);

  chartOapi = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: `Close (${timeframe})`,
          data: values,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.10)',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true },
        tooltip: {
          callbacks: {
            title: (items) => items[0].label,
            label: (item) => ` Close: ${item.raw}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748b' },
          grid: { color: '#1e2433' },
        },
        y: {
          ticks: { color: '#64748b' },
          grid: { color: '#1e2433' },
        },
      },
    },
  });
}

