/* ── State ───────────────────────────────────────────────────── */
let allScreeners = [];
let activeSlug = null;
let chartDaily = null;
let chartSector = null;
let chartOapi = null;
let signalsState = { enabled: false, status: 'disabled', stocks: [], backtest: {} };
let signalsPoll = null;

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

  // Momentum signals controls
  const toggleBtn = document.getElementById('btn-signals-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      const target = !signalsState.enabled;
      try {
        await fetch(`${API_BASE}/api/signals/toggle?value=${target}`, { method: 'POST' });
        await loadSignals();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    });
  }
  const refreshBtn = document.getElementById('btn-signals-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', loadSignals);

  const runPipelineBtn = document.getElementById('btn-pipeline-run');
  if (runPipelineBtn) {
    runPipelineBtn.addEventListener('click', async () => {
      runPipelineBtn.textContent = 'Running...';
      runPipelineBtn.disabled = true;
      try {
        const res = await fetch(API_BASE + '/api/pipeline/run', { method: 'POST' });
        const data = await res.json();
        alert('Pipeline complete: ' + JSON.stringify(data));
        await loadPipeline();
      } catch (e) {
        alert('Error: ' + e.message);
      } finally {
        runPipelineBtn.textContent = 'Run EOD';
        runPipelineBtn.disabled = false;
      }
    });
  }
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
  const signalsEl = document.getElementById('signals-tab');
  const pipelineEl = document.getElementById('pipeline-tab');

  if (tab === 'charting') {
    dashboardEl.classList.add('hidden');
    chartingEl.classList.remove('hidden');
    signalsEl.classList.add('hidden');
    pipelineEl.classList.add('hidden');
  } else if (tab === 'signals') {
    dashboardEl.classList.add('hidden');
    chartingEl.classList.add('hidden');
    signalsEl.classList.remove('hidden');
    pipelineEl.classList.add('hidden');
    if (!signalsPoll) {
      loadSignals();
      signalsPoll = setInterval(loadSignals, 15000);
    }
  } else if (tab === 'pipeline') {
    dashboardEl.classList.add('hidden');
    chartingEl.classList.add('hidden');
    signalsEl.classList.add('hidden');
    pipelineEl.classList.remove('hidden');
    if (signalsPoll) {
      clearInterval(signalsPoll);
      signalsPoll = null;
    }
    loadPipeline();
  } else {
    dashboardEl.classList.remove('hidden');
    chartingEl.classList.add('hidden');
    signalsEl.classList.add('hidden');
    pipelineEl.classList.add('hidden');
    if (signalsPoll) {
      clearInterval(signalsPoll);
      signalsPoll = null;
    }
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

/* ── Momentum signals ──────────────────────────────────────────── */

async function loadSignals() {
  try {
    const data = await api('/api/signals');
    signalsState = data;
    renderSignals(data);
  } catch (e) {
    const empty = document.getElementById('signals-empty');
    const table = document.getElementById('signals-table');
    empty.textContent = 'Error: ' + e.message;
    empty.classList.remove('hidden');
    table.classList.add('hidden');
  }
}

/* ── Pipeline ─────────────────────────────────────────────────── */
let pipelineState = { regime: [], stats: [], ranked: [], summary: [] };

async function loadPipeline() {
  try {
    const [regimeRes, statsRes, summaryRes] = await Promise.all([
      api('/api/pipeline/regime'),
      api('/api/pipeline/stats/summary'),
      api('/api/pipeline/summary'),
    ].map((p) => p.catch((e) => null)));

  const regimeData = regimeRes?.entries || [];
  const statsData = statsRes || [];
  const summaryData = summaryRes || [];

  pipelineState = { regime: regimeData, stats: statsData, summary: summaryData };
  renderPipelineSummary(summaryData);
  renderRegimeChart(regimeData);
  renderPipelineStats(statsData);

    // Try to load ranked signals
    try {
      const rankedRes = await api('/api/pipeline/ranked');
      if (rankedRes && Array.isArray(rankedRes.signals?.ranked)) {
        renderRankedSignals(rankedRes.signals.ranked);
      }
    } catch (e) {
      document.getElementById('pipeline-ranked-empty').textContent = 'No gated signals available.';
      document.getElementById('pipeline-ranked-empty').classList.remove('hidden');
    }
  } catch (e) {
    console.error('[pipeline] error:', e);
  }
}

function renderPipelineSummary(summary) {
  const cards = document.getElementById('pipeline-stat-cards');
  if (!cards) return;

  const latest = summary[0] || {};
  const totalDays = summary.length;
  const gatedTotal = summary.reduce((s, d) => s + (d.gated || 0), 0);
  const riskOnDays = summary.filter((d) => d.regime === 'risk-on').length;

  cards.innerHTML = '';
  const card = (label, value) => {
    const div = document.createElement('div');
    div.className = 'stat-card blue';
    div.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
    return div;
  };
  cards.append(
    card('Pipeline Runs', totalDays),
    card('Total Gated', gatedTotal),
    card('Risk-On Days', riskOnDays),
    card('Latest Regime', latest.regime || '—')
  );
}

function renderRegimeChart(regimeData) {
  const ctx = document.getElementById('chart-regime');
  if (!ctx || !regimeData.length) return;

  if (window.chartRegime) window.chartRegime.destroy();

  const sorted = [...regimeData].sort((a, b) => (a.date > b.date ? 1 : -1));
  const dates = sorted.map((r) => r.date);
  const breadths = sorted.map((r) => r.breadth * 100);
  const regimes = sorted.map((r) => (r.regime === 'risk-on' ? 1 : 0));

  const chart = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels: dates,
      datasets: [
        {
          label: 'Breadth %',
          data: breadths,
          borderColor: '#0ea5e5',
          backgroundColor: 'rgba(14, 165, 233, 0.1)',
          tension: 0.2,
          yAxisID: 'y',
        },
        {
          label: 'Regime (risk-on=1, risk-off=0)',
          data: regimes,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.2)',
          tension: 0,
          stepped: 'after',
          yAxisID: 'y1',
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          grid: { color: 'rgba(0,0,0,0.05)' },
          maxTicks: 12,
          ticks: {
            maxRotation: 45,
            minRotation: 45,
            autoSkip: true,
            maxTicksLimit: 12,
          },
        },
        y: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'Breadth %' },
          max: 100,
          min: 0,
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'Regime' },
          max: 1,
          min: 0,
          ticks: { display: false },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
  window.chartRegime = chart;
}

function renderPipelineStats(stats) {
  const tbody = document.getElementById('pipeline-stats-tbody');
  const empty = document.getElementById('pipeline-stats-empty');
  if (!tbody) return;

  if (stats.length === 0) {
    empty.textContent = 'No stats available.';
    empty.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');
  tbody.innerHTML = stats.map((s) => `
    <tr>
      <td>${s.signalType || '—'}</td>
      <td>${s.horizon || '—'}</td>
      <td class="num">${s.occurrences || 0}</td>
      <td class="num">${((s.hitRate || 0) * 100).toFixed(1)}%</td>
      <td class="num">${(s.avgReturn || 0).toFixed(2)}%</td>
      <td class="num">${((s.wilsonLower || 0) * 100).toFixed(1)}%</td>
    </tr>
  `).join('');
}

function renderRankedSignals(ranked) {
  const tbody = document.getElementById('pipeline-ranked-tbody');
  const empty = document.getElementById('pipeline-ranked-empty');
  if (!tbody) return;

  if (ranked.length === 0) {
    empty.textContent = 'No gated signals available.';
    empty.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');
  tbody.innerHTML = ranked.map((r, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${r.scanName || r.signalType || '—'}</td>
      <td>${r.nseCode || '—'}</td>
      <td>${r.regime || '—'}</td>
      <td class="num">${r.gate?.bestHorizon || r.horizon || '—'}</td>
      <td class="num">${r.score?.score?.toFixed(4) || '—'}</td>
      <td class="num">${r.gate?.stats?.hitRate ? (r.gate.stats.hitRate * 100).toFixed(0) + '%' : '—'}</td>
      <td class="num">${r.gate?.stats?.avgNetReturn?.toFixed(2) || '—'}%</td>
      <td class="num">${r.gate?.stats?.profitFactor ? (Number.isFinite(r.gate.stats.profitFactor) ? r.gate.stats.profitFactor.toFixed(2) : '∞') : '—'}</td>
    </tr>
  `).join('');
}

function formatRecentMatch(rec) {
  if (!rec) return '<span class="muted">—</span>';
  const last = rec.lastDate ? new Date(rec.lastDate).toLocaleDateString('en-IN') : '—';
  return `<span class="recent-match" title="Matched on ${rec.days} of last ${rec.ofLast} trade days; ${rec.total} total"> ${rec.days}/${rec.ofLast} days · last ${last}</span>`;
}

function formatBacktest(bt) {
  if (!bt) return '<span class="muted">no backtest</span>';
  if (bt.cacheError) {
    return `<span class="muted" title="${bt.cacheError}">${bt.cacheError}</span>`;
  }
  const s = bt.summary || {};
  const occ = s.totalSignalOccurrences ?? 0;
  const days = s.activeDays ?? 0;
  const hit = s.hitRate != null ? `${(s.hitRate * 100).toFixed(0)}%` : '—';
  return `<span title="Occurrences ${occ} · active days ${days} · hit-rate ${hit}">${occ} occ · ${days} days · ${hit} hit</span>`;
}

function renderSignals(data) {
  const badge = document.getElementById('signals-badge');
  const statusText = document.getElementById('signals-status');
  const toggleBtn = document.getElementById('btn-signals-toggle');
  const table = document.getElementById('signals-table');
  const empty = document.getElementById('signals-empty');

  if (toggleBtn) {
    toggleBtn.textContent = data.enabled ? 'Disable' : 'Enable';
    toggleBtn.className = data.enabled ? 'btn-toggle-on' : 'btn-toggle-off';
  }
  if (badge) {
    badge.textContent = data.status || 'unknown';
    badge.className = 'status-badge ' + (data.status === 'scanning' ? 'status-active' : data.status === 'disabled' ? 'status-inactive' : '');
  }
  if (statusText) statusText.textContent = data.message || '';

  if (!data.stocks || data.stocks.length === 0) {
    const msg = data.needsAuth
      ? 'No stocks returned — Chartink requires a session. Add cookies to fetch live scans.'
      : 'No stocks matched the momentum scans right now.';
    empty.textContent = msg;
    empty.classList.remove('hidden');
    table.classList.add('hidden');
  } else {
    renderSignalsTable(data.stocks || [], data.backtest || {});
    table.classList.remove('hidden');
    empty.classList.add('hidden');
  }
}

function renderSignalsTable(stocks, backtest) {
  const tbody = document.getElementById('signals-tbody');
  tbody.innerHTML = stocks
    .map((s, i) => {
      const chg = Number(s.pctChange) || 0;
      const cls = chg > 0 ? 'change-pos' : chg < 0 ? 'change-neg' : '';
      const sign = chg > 0 ? '+' : '';
      const vol = Number(s.volume).toLocaleString('en-IN');
      return `
        <tr>
          <td class="num">${i + 1}</td>
          <td><span class="tag">${s.signal || ''}</span></td>
          <td><span class="nse-code">${s.symbol || ''}</span></td>
          <td>${s.name || ''}</td>
          <td class="num">₹${(Number(s.ltp) || 0).toFixed(2)}</td>
          <td class="num ${cls}">${sign}${chg.toFixed(2)}%</td>
          <td class="num muted">${vol}</td>
          <td><span class="badge badge-${s.strength || 'none'}">${s.strength || ''}</span></td>
          <td class="num muted">${((Number(s.confidence) || 0) * 100).toFixed(0)}%</td>
          <td>${formatBacktest(backtest[s.type])}</td>
          <td>${formatRecentMatch(s.recentMatch)}</td>
        </tr>`;
    })
    .join('');
}

