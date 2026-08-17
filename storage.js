// storage.js — database-swappable storage layer (specs/architecture.md A5,
// specs/phase1.md B2.11). Currently backed by localStorage. All keys are
// namespaced `ma.*` and versioned (`ma.v`, schema v1). A future IndexedDB or
// server adapter can replace this file without touching any other module —
// nothing outside this file calls localStorage or sessionStorage directly.

import { logger } from './utils.js';

const PREFIX = 'ma.';
const SCHEMA_VERSION = 1;
const KEY_VERSION = 'ma.v';
const MAX_COLLECTION_ENTRIES = 200; // bounded LRU for quote/candle caches
const WRITE_DEBOUNCE_MS = 50;

// pending writes: logicalKey -> JSON string (null means remove)
const pending = new Map();
let flushTimer = null;

function logicalKey(name) {
  return String(name).replace(/^ma\./, '');
}

function physicalKey(name) {
  return PREFIX + logicalKey(name);
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, WRITE_DEBOUNCE_MS);
}

export function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pending.size === 0) return;
  for (const [key, serialized] of pending) {
    try {
      if (serialized === null) localStorage.removeItem(key);
      else localStorage.setItem(key, serialized);
    } catch (err) {
      logger.warn('storage: write failed (quota?)', { key, error: err && err.message });
    }
  }
  pending.clear();
}

// Flush pending writes when the tab is being hidden/closed.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

function parse(raw, name) {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    logger.warn('storage: corrupted value recovered (reset)', { name });
    return undefined;
  }
}

export const storage = {
  get(name) {
    const key = physicalKey(name);
    if (pending.has(key)) return parse(pending.get(key), name);
    return parse(localStorage.getItem(key), name);
  },

  set(name, value) {
    const key = physicalKey(name);
    pending.set(key, JSON.stringify(value));
    scheduleFlush();
  },

  remove(name) {
    pending.set(physicalKey(name), null);
    scheduleFlush();
  },

  // Returns logical names whose physical key starts with `ma.` + prefix.
  keys(prefix = '') {
    const out = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX + prefix)) out.push(k.slice(PREFIX.length));
    }
    // include pending-only keys
    for (const k of pending.keys()) {
      if (k.startsWith(PREFIX + prefix) && !out.includes(k.slice(PREFIX.length))) {
        out.push(k.slice(PREFIX.length));
      }
    }
    return out.sort();
  },

  // Document-style collection over a single `ma.<name>` array of {id, ...}.
  // LRU-bounded: put()/get() move the item to the end; overflow evicts the head.
  collection(name, maxEntries = MAX_COLLECTION_ENTRIES) {
    const collKey = logicalKey(name);

    function load() {
      const rows = storage.get(collKey);
      return Array.isArray(rows) ? rows : [];
    }

    function persist(rows) {
      storage.set(collKey, rows);
      return rows;
    }

    function idxOf(rows, id) {
      for (let i = 0; i < rows.length; i += 1) {
        if (rows[i] && rows[i].id === id) return i;
      }
      return -1;
    }

    return {
      all() {
        return load();
      },
      get(id) {
        const rows = load();
        const i = idxOf(rows, id);
        if (i === -1) return undefined;
        // LRU: move to end
        const item = rows.splice(i, 1)[0];
        rows.push(item);
        persist(rows);
        return item;
      },
      put(item) {
        if (!item || item.id == null) return undefined;
        const rows = load();
        const i = idxOf(rows, item.id);
        let previous;
        if (i !== -1) {
          previous = rows[i];
          rows.splice(i, 1);
        }
        rows.push(item);
        while (rows.length > maxEntries) rows.shift();
        persist(rows);
        return previous;
      },
      remove(id) {
        const rows = load();
        const i = idxOf(rows, id);
        if (i === -1) return false;
        rows.splice(i, 1);
        persist(rows);
        return true;
      },
      clear() {
        persist([]);
      },
    };
  },

  migrate() {
    // v1: no migrations required, just stamp the version.
    if (storage.get(KEY_VERSION) === undefined) {
      storage.set(KEY_VERSION, SCHEMA_VERSION);
    }
    logger.info('storage: migrate complete', { version: SCHEMA_VERSION });
  },
};

export { SCHEMA_VERSION };