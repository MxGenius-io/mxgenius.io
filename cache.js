/**
 * MXGenius — IndexedDB Cache Layer
 * 
 * Transparent caching wrapper around fetch() with configurable TTLs.
 * Stores API responses in IndexedDB to minimize JetNet/FAA API calls.
 *
 * Usage:
 *   const data = await cachedFetch(url, { method:'POST', body:... }, 15 * 60 * 1000);
 */

const MXCache = (() => {
  const DB_NAME = 'mxgenius_cache';
  const STORE = 'api_cache';
  const DB_VERSION = 1;
  let _db = null;

  // ── Open / Init DB ──────────────────────────────
  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror = (e) => { console.warn('[Cache] DB open failed:', e); resolve(null); };
    });
  }

  // ── Hash key from URL + body ────────────────────
  function cacheKey(url, options) {
    const body = options?.body || '';
    const method = options?.method || 'GET';
    return `${method}::${url}::${typeof body === 'string' ? body : JSON.stringify(body)}`;
  }

  // ── Get from cache ──────────────────────────────
  async function get(key) {
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const req = store.get(key);
        req.onsuccess = () => {
          const entry = req.result;
          if (!entry) return resolve(null);
          const age = Date.now() - entry.timestamp;
          if (age > entry.ttl) {
            // Expired — delete async, return null
            del(key);
            return resolve(null);
          }
          resolve(entry);
        };
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  // ── Put to cache ────────────────────────────────
  async function put(key, data, ttl) {
    const db = await openDB();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, data, timestamp: Date.now(), ttl });
    } catch (e) { console.warn('[Cache] Write failed:', e); }
  }

  // ── Delete entry ────────────────────────────────
  async function del(key) {
    const db = await openDB();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
    } catch {}
  }

  // ── Clear all cache ─────────────────────────────
  async function clearAll() {
    const db = await openDB();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      console.log('[Cache] All entries cleared');
    } catch (e) { console.warn('[Cache] Clear failed:', e); }
  }

  // ── Stats ───────────────────────────────────────
  async function stats() {
    const db = await openDB();
    if (!db) return { entries: 0 };
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).count();
        req.onsuccess = () => resolve({ entries: req.result });
        req.onerror = () => resolve({ entries: 0 });
      } catch { resolve({ entries: 0 }); }
    });
  }

  // ── cachedFetch — the main API ──────────────────
  // Drop-in replacement for fetch() that checks cache first.
  // ttlMs = time-to-live in milliseconds (default 15 min)
  async function cachedFetch(url, options = {}, ttlMs = 15 * 60 * 1000) {
    const key = cacheKey(url, options);

    // Check cache
    const cached = await get(key);
    if (cached) {
      console.log(`[Cache] HIT (${Math.round((Date.now() - cached.timestamp) / 1000)}s old): ${url.split('/').slice(-2).join('/')}`);
      return cached.data;
    }

    // Cache miss — real fetch
    console.log(`[Cache] MISS: ${url.split('/').slice(-2).join('/')}`);
    const res = await fetch(url, options);
    const data = await res.json();

    // Only cache successful responses
    if (data && (!data.responsestatus || data.responsestatus === 'SUCCESS' || data.responsestatus === 'Success')) {
      await put(key, data, ttlMs);
    }

    return data;
  }

  // ── TTL Presets ─────────────────────────────────
  const TTL = {
    UTILITY: 24 * 60 * 60 * 1000,   // 24 hours — reference data
    BULK:    15 * 60 * 1000,         // 15 minutes — fleet data
    DETAIL:  30 * 60 * 1000,         // 30 minutes — aircraft detail
    SHORT:    5 * 60 * 1000,         //  5 minutes — frequently changing
  };

  return { cachedFetch, clearAll, stats, TTL, openDB };
})();
