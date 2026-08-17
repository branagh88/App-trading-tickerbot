// utils.js — event bus, formatting, debounce/throttle, timing, redaction, logger
// (specs/phase1.md B2.13). No module reaches into fetch/localStorage directly;
// formatting helpers here are pure.

// ---------------------------------------------------------------------------
// Tiny pub/sub event bus (A1: modules communicate via on/emit/once)
// ---------------------------------------------------------------------------
const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  const set = listeners.get(event);
  if (set) set.delete(fn);
}

export function once(event, fn) {
  const remove = on(event, (...args) => {
    remove();
    fn(...args);
  });
  return remove;
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(payload);
    } catch (err) {
      logger.error(`event handler failed for "${event}"`, err);
    }
  }
}

export const bus = { on, off, once, emit };

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
const currencyFmtCache = new Map();

function fractionDigits(value) {
  const abs = Math.abs(value);
  if (abs >= 1000) return 2;
  if (abs >= 1) return 2;
  if (abs >= 0.0001) return 6;
  return 10;
}

// fmtPrice uses Intl currency formatting — never a hard-coded symbol or price.
export function fmtPrice(value, currency = 'USD') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const num = Number(value);
  const code = String(currency || 'USD').toUpperCase();
  let nf = currencyFmtCache.get(code);
  if (!nf) {
    try {
      nf = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 10,
      });
    } catch {
      nf = null; // non-ISO currency (e.g. BTC): fall back to plain number
    }
    currencyFmtCache.set(code, nf);
  }
  if (nf) {
    // Rebuild with per-value precision (crypto needs more decimals than stocks).
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: fractionDigits(num),
      }).format(num);
    } catch {
      /* fallthrough */
    }
  }
  return `${code} ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: fractionDigits(num) })}`;
}

export function fmtPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const num = Number(value);
  const sign = num > 0 ? '+' : num < 0 ? '\u2212' : '';
  return `${sign}${Math.abs(num).toFixed(2)}%`;
}

export function fmtVolume(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const num = Number(value);
  if (num >= 1e12) return `${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return String(num);
}

export function fmtTime(epochMs) {
  if (epochMs == null || !Number.isFinite(Number(epochMs))) return '—';
  const d = new Date(Number(epochMs));
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ---------------------------------------------------------------------------
// Timing / misc helpers
// ---------------------------------------------------------------------------
export function debounce(fn, ms) {
  let t = 0;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function throttle(fn, ms) {
  let last = 0;
  let t = 0;
  return (...args) => {
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else {
      clearTimeout(t);
      t = setTimeout(() => {
        last = Date.now();
        fn(...args);
      }, remaining);
    }
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let uidCounter = 0;
export function uid(prefix = 'id') {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Escaping for DOM injection
// ---------------------------------------------------------------------------
export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Redaction + logger. NEVER print an API key to console/DOM/logs.
// ---------------------------------------------------------------------------
export function redact(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/(api[-_]?key|apikey|authorization|token|secret)/i.test(k)) {
      out[k] = '••••••••';
    } else if (v && typeof v === 'object') {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Redact secrets that can appear inside URL strings / log lines.
export function redactText(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/([?&](?:api[_-]?key|key|token)=)[^&\s]+/gi, '$1••••••••')
    .replace(/(Authorization:\s*Bearer\s+)[^\s,]+/gi, '$1••••••••');
}

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let logLevel = LOG_LEVELS.info;

export function setLogLevel(level) {
  if (level in LOG_LEVELS) logLevel = LOG_LEVELS[level];
}

function log(level, ...args) {
  if (LOG_LEVELS[level] < logLevel) return;
  const redactedArgs = args.map((a) => (typeof a === 'string' ? redactText(a) : redact(a)));
  const prefix = `[ma:${level}]`;
  const out = [prefix, ...redactedArgs];
  if (level === 'error') console.error(...out);
  else if (level === 'warn') console.warn(...out);
  else console.log(...out);
}

export const logger = {
  debug: (...args) => log('debug', ...args),
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
  level: (lvl) => setLogLevel(lvl),
};