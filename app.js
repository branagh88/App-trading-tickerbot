// In app.js
// app.js
import { on, logger, esc, fmtPrice, fmtPct, fmtVolume, fmtTime } from './utils.js';
import { storage } from './storage.js';
import { loadConfig, saveConfig, isConfigured, isValidHttpUrl, API_CONFIG, DEFAULTS } from './config.js';

// 1. UPDATED IMPORT: We import MassiveAPI instead of MarketAPI
import { MassiveAPI } from './api.js'; 

import { MarketData } from './market-data.js';
import { AssetsController } from './assets.js';
import { ChartController } from './charts.js';
import { toast } from './notifications.js';

const $ = (sel) => document.querySelector(sel);

let api = null;
let assets = null;
let marketData = null;
let chart = null;
let currentRoute = '';
let currentSymbol = null;
let pendingConfirm = null;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function boot() {
  storage.migrate();
  const config = loadConfig();

  // 2. UPDATED INSTANTIATION: We use MassiveAPI here
  api = new MassiveAPI(config);
  
  assets = new AssetsController(api);
  marketData = new MarketData({ api, getAssets: () => assets.getWatchlist() });
  chart = new ChartController({
    mainEl: $('#main-chart'),
    rsiEl: $('#rsi-chart'),
    wrapEl: $('#chart-wrap'),
    timeframeEl: $('#timeframe-bar'),
    indicatorEl: $('#indicator-bar'),
    emptyEl: $('#chart-empty'),
    tooltipEl: $('#chart-tooltip'),
    statusEl: $('#chart-status'),
    api,
    getAsset: (sym) => assets.getAsset(sym),
  });

  wireSearch();
  wireSettings();
  wireWatchlistControls();
  wireConfirmModal();
  wireEvents();

  if (!isConfigured(config)) {
    $('#settings-onboarding').hidden = false;
    if (!window.location.hash || window.location.hash === '#/' || window.location.hash === '#') {
      window.location.hash = '#/settings';
    }
  }

  router();
  window.addEventListener('hashchange', router);
  if (isConfigured(config)) marketData.start();
}

import { loadConfig, saveConfig, isConfigured } from './config.js';
import { MassiveAPI } from './api.js';

// Remove old generic fields from the form parser
function fillSettingsForm() {
  const cfg = loadConfig();
  const set = (name, value) => {
    const el = document.querySelector(`[name="${name}"]`);
    if (el) el.value = value == null ? '' : String(value);
  };
  set('baseURL', cfg.baseURL);
  set('apiKey', cfg.apiKey);
  set('pollInterval', cfg.settings.pollInterval);
}

function readSettingsForm() {
  const current = loadConfig();
  const val = (name) => {
    const el = document.querySelector(`[name="${name}"]`);
    return el ? el.value.trim() : '';
  };
  return {
    ...current,
    baseURL: val('baseURL') || current.baseURL,
    apiKey: val('apiKey'),
    settings: { ...current.settings, pollInterval: Number(val('pollInterval')) || 30 },
  };
}

// Implement the specific Automated Testing Suite
async function testConnection() {
  const resultEl = document.querySelector('#settings-test-result');
  const next = readSettingsForm();
  
  if (!next.baseURL || !next.apiKey) {
    resultEl.hidden = false;
    resultEl.className = 'settings-test-result err';
    resultEl.innerHTML = 'API not configured — enter Base URL and Key first.';
    return;
  }

  resultEl.hidden = false;
  resultEl.className = 'settings-test-result';
  resultEl.innerHTML = 'Testing connection sequence...<br>';

  const testApi = new MassiveAPI(next);
  
  const tests = [
    { label: 'STOCK TEST 1', fn: () => testApi.getStockSnapshot('AAPL') },
    { label: 'STOCK TEST 2', fn: () => testApi.getStockSnapshot('GME') },
    { label: 'CRYPTO TEST', fn: () => testApi.getCryptoLastTrade('BTC', 'USD') }
  ];

  for (const test of tests) {
    try {
      const res = await test.fn();
      resultEl.innerHTML += `
        <div style="margin-top: 10px; border-left: 3px solid green; padding-left: 8px;">
          <strong>${test.label}</strong><br>
          Endpoint: <code>${res._debug.url}</code><br>
          Status: 200 CONNECTED<br>
          Symbol: ${res.symbol} | Price: ${res.price} | Timestamp: ${res.timestamp}
        </div>
      `;
    } catch (err) {
      resultEl.innerHTML += `
        <div style="margin-top: 10px; border-left: 3px solid red; padding-left: 8px;">
          <strong>${test.label} FAILED</strong><br>
          Error: ${err.message}<br>
          Status: ${err.status || 'N/A'}
        </div>
      `;
      break; // Stop cascade testing on auth/network failure
    }
  }
}