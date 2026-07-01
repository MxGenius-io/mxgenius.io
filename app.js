// MXGenius - Frontend Application
// Auto-login, tab routing, API calls, dynamic rendering

const API = 'https://mxg-api.kindbush-8fee3a17.centralus.azurecontainerapps.io'; // Live Azure Rust Backend Proxy
let TOKEN = '';
let BEARER = '';

// ═══════════════════════════════════════════════════
//  FAA Airworthiness Directives — Predictive Maintenance
//  5,434 ADs covering Bombardier, Dassault, Gulfstream, Textron
//  Loaded on-demand from faa_data/faa_ads_slim.json
// ═══════════════════════════════════════════════════

const FAA_ADS = {
  data: null,
  loaded: false,

  // Manufacturer name normalization — FAA uses messy names
  MFR_MAP: {
    'bombardier':  /bombardier|c\s*series|csalp/i,
    'dassault':    /dassault/i,
    'gulfstream':  /gulfstream/i,
    'textron':     /textron|cessna|beech|hawker|raytheon/i,
  },

  async load() {
    if (this.loaded) return;
    try {
      const resp = await fetch('faa_data/faa_ads_slim.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.data = await resp.json();
      this.loaded = true;
      console.log(`[FAA] Loaded ${this.data.length} Airworthiness Directives`);
    } catch (e) {
      console.warn('[FAA] AD data not available:', e.message);
      this.data = [];
    }
  },

  // Match a fleet aircraft ICAO/model against FAA AD manufacturer+title
  searchByAircraft(icaoOrModel) {
    if (!this.data) return [];
    const q = icaoOrModel.toLowerCase();
    return this.data.filter(ad => {
      const model = (ad.model || '').toLowerCase();
      const title = (ad.title || '').toLowerCase();
      return model.includes(q) || title.includes(q);
    });
  },

  // Search ADs by keyword (for AI copilot context)
  searchByKeyword(query) {
    if (!this.data) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) return [];
    return this.data.filter(ad => {
      const haystack = ((ad.model || '') + ' ' + (ad.title || '') + ' ' + (ad.abs || '')).toLowerCase();
      return terms.every(t => haystack.includes(t));
    }).slice(0, 10);  // Cap at 10 results
  },

  // Scan fleet types against ADs (for dashboard card)
  scanFleet(fleetIcaoCodes) {
    if (!this.data || !fleetIcaoCodes?.length) return { total: 0, byType: {} };
    // Normalize fleet ICAO codes to searchable terms
    const searchTerms = [...new Set(fleetIcaoCodes.map(c => c.toLowerCase()))];
    const byType = {};
    let total = 0;

    // Also map ICAO to manufacturer for broader matching
    const icaoToMfr = {
      'galx': 'gulfstream', 'g150': 'gulfstream', 'g200': 'gulfstream', 'g280': 'gulfstream',
      'glex': 'bombardier', 'gl5t': 'bombardier', 'gl7t': 'bombardier',
      'cl30': 'bombardier', 'cl35': 'bombardier', 'cl60': 'bombardier',
      'f2th': 'dassault', 'fa50': 'dassault', 'fa7x': 'dassault', 'fa8x': 'dassault',
      'f900': 'dassault', 'c525': 'textron', 'c560': 'textron', 'c680': 'textron',
      'c750': 'textron', 'be20': 'textron', 'be30': 'textron', 'be40': 'textron',
    };

    for (const icao of searchTerms) {
      const mfr = icaoToMfr[icao];
      const regex = mfr ? this.MFR_MAP[mfr] : null;
      const matches = this.data.filter(ad => {
        const model = (ad.model || '').toLowerCase();
        const title = (ad.title || '').toLowerCase();
        // Try exact ICAO match in title, or manufacturer-level match
        if (title.includes(icao) || model.includes(icao)) return true;
        if (regex && regex.test(ad.model)) return true;
        return false;
      });
      if (matches.length > 0) {
        byType[icao.toUpperCase()] = matches.length;
        total += matches.length;
      }
    }
    return { total, byType };
  },

  // Get recent ADs (last 90 days) for a manufacturer
  getRecent(manufacturer, days = 90) {
    if (!this.data) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const regex = this.MFR_MAP[manufacturer.toLowerCase()];
    if (!regex) return [];
    return this.data.filter(ad => ad.pub >= cutoffStr && regex.test(ad.model)).slice(0, 20);
  }
};

// ═══════════════════════════════════════════════════
//  RAG — On-demand search over display_index library
//  92 aircraft, 111K+ chapters of maintenance manuals
//  Loads aircraft files on-demand, caches in memory
// ═══════════════════════════════════════════════════

const RAG = {
  catalog: null,         // catalog.json — aircraft manifest
  aircraftCache: {},     // { aircraftId: parsedJSON } — loaded on demand
  imageMap: null,        // { "CHAPTER 27  FLIGHT CONTROLS_p209": "rag_images/abc.jpeg" }
  loaded: false,
  loading: false,

  STOP: new Set(['the','a','an','is','are','was','were','of','in','to','for','with','on','at','from','by','and','or','but','not','this','that','it','what','how','do','does','can','i','my','me','we','us','they','them','its','be','been','has','have','had','will','would','should','could','may','might','check','procedure','info','about','need','help','tell']),

  tokenize(text) {
    const terms = text.toLowerCase().match(/[a-z0-9][\w\-\.\/]*[a-z0-9]|[a-z0-9]/g) || [];
    return terms.filter(t => !this.STOP.has(t) && t.length > 1);
  },

  async load() {
    if (this.loaded || this.loading) return;
    this.loading = true;
    try {
      const [catResp, imgResp] = await Promise.all([
        fetch('display_index/catalog.json'),
        fetch('rag_image_map.json'),
      ]);
      if (catResp.ok) this.catalog = await catResp.json();
      if (imgResp.ok) this.imageMap = await imgResp.json();
      this.loaded = true;
      console.log(`[RAG] Catalog loaded: ${this.catalog?.length || 0} aircraft, ${Object.keys(this.imageMap || {}).length} image mappings`);
    } catch (e) {
      console.warn('[RAG] Catalog not available:', e.message);
    }
    this.loading = false;
  },

  // Extract aircraft identifier from user query by matching against catalog
  detectAircraft(query) {
    if (!this.catalog) return null;
    const q = query.toLowerCase().replace(/[-_]/g, ' ');

    // Build match candidates sorted longest-first so "global express xrs" beats "global express"
    const candidates = this.catalog.map(entry => {
      const names = [
        entry.aircraft.toLowerCase(),
        entry.id.replace(/_/g, ' '),
        entry.manufacturer.toLowerCase() + ' ' + entry.aircraft.toLowerCase(),
      ];
      // Add common aliases
      const ac = entry.aircraft.toLowerCase();
      if (ac.startsWith('cl'))  names.push('challenger ' + ac.replace('cl',''));
      if (ac.startsWith('gl'))  names.push('global ' + ac.replace('gl',''));
      if (ac === 'global express') names.push('glex');
      if (ac === 'global express xrs') names.push('glex xrs', 'xrs');
      // Strip "Series", "SN", etc. suffixes for broader matching
      const stripped = ac.replace(/\s+series.*$/i, '').replace(/\s+sn\s+.*$/i, '').trim();
      if (stripped !== ac) names.push(stripped);
      // Add manufacturer-stripped combos (e.g., "king air 200" without "textron/beech")
      if (entry.manufacturer.includes('/')) {
        const parts = entry.manufacturer.split('/');
        for (const p of parts) names.push(p.toLowerCase() + ' ' + ac);
      }
      return { entry, names };
    });

    // Sort by longest name first for greedy matching
    const allNames = [];
    for (const c of candidates) {
      for (const n of c.names) {
        allNames.push({ name: n, entry: c.entry });
      }
    }
    allNames.sort((a, b) => b.name.length - a.name.length);

    for (const { name, entry } of allNames) {
      if (q.includes(name)) return entry;
    }

    // Fallback: try token overlap (e.g., "7500 fuel leak" → gl7500)
    const qTokens = this.tokenize(query);
    for (const entry of this.catalog) {
      const acTokens = this.tokenize(entry.aircraft + ' ' + entry.manufacturer);
      const overlap = qTokens.filter(t => acTokens.some(a => a.includes(t) || t.includes(a)));
      if (overlap.length > 0) return entry;
    }
    return null;
  },

  // Load an aircraft's display_index file (on demand, cached)
  async loadAircraft(entry) {
    if (this.aircraftCache[entry.id]) return this.aircraftCache[entry.id];
    try {
      console.log(`[RAG] Loading ${entry.manufacturer} ${entry.aircraft} (${entry.size_mb}MB)...`);
      const resp = await fetch('display_index/' + entry.file);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      // Keep only the last loaded aircraft in cache to limit memory
      this.aircraftCache = { [entry.id]: data };
      console.log(`[RAG] Loaded ${entry.aircraft}: ${Object.keys(data.manuals).length} manuals`);
      return data;
    } catch (e) {
      console.warn(`[RAG] Failed to load ${entry.file}:`, e.message);
      return null;
    }
  },

  // Search chapters within a loaded aircraft data object
  searchChapters(data, query, topK = 2) {
    const qTerms = this.tokenize(query);
    if (qTerms.length === 0) return [];

    const results = [];
    for (const [manualName, chapters] of Object.entries(data.manuals)) {
      for (const [chapterName, chapter] of Object.entries(chapters)) {
        if (typeof chapter !== 'object' || !chapter.text) continue;

        // Score: keyword matches in chapter name + ATA code + text (first 2000 chars)
        const chLower = chapterName.toLowerCase();
        const ataStr = String(chapter.ata || '').toLowerCase();
        const textPreview = chapter.text.substring(0, 2000).toLowerCase();

        let score = 0;
        for (const term of qTerms) {
          if (chLower.includes(term)) score += 10;  // Chapter name match — very relevant
          if (ataStr.includes(term)) score += 8;     // ATA code match
          // Count occurrences in text preview
          let pos = 0, count = 0;
          while ((pos = textPreview.indexOf(term, pos)) !== -1) { count++; pos += term.length; }
          score += Math.min(count, 5);               // Cap text hits at 5
        }

        if (score > 0) {
          results.push({
            score,
            manual: manualName,
            chapter: chapterName,
            ata: chapter.ata || '',
            source: chapter.source || '',
            text: chapter.text,
            images: chapter.images || [],
          });
        }
      }
    }

    // Sort by score descending, take topK
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  },

  // Strip metadata headers from chapter text — extract actual procedural steps
  cleanChapterText(rawText, maxLen = 1200) {
    if (!rawText) return '';
    let text = rawText;

    // Remove page headers ("07-25 Page 1", "--- Page N ---")
    text = text.replace(/---\s*Page\s+\d+\s*---/g, '');
    text = text.replace(/^\d{2}-\d{2}\s+Page\s+\d+\s*$/gm, '');

    // Remove metadata block (DMC, Language, Issue Date, Security, Originator, etc.)
    text = text.replace(/^(DMC|Language|Issue\s*no|Issue\s*Date|Title|Security\s*Classification|Responsible\s*Partner|Originator|Applicability|Quality\s*Assurance)\s*:\s*.*$/gim, '');

    // Remove BD700 DMC codes on their own line
    text = text.replace(/^BD\d{2,3}-[A-Z]-[A-Z0-9\-]+\s*$/gm, '');

    // Remove table of contents and boilerplate
    text = text.replace(/^(Table of contents|List of (tables|figures)).*$/gim, '');
    text = text.replace(/^\d+\s*$/gm, '');
    text = text.replace(/^sx\/US\s*$/gm, '');
    text = text.replace(/first\s*verificationCleared.*$/gim, '');
    text = text.replace(/Bombardier\/\w+/g, '');

    // Remove reference/equipment/consumable table blocks (noise, not procedures)
    text = text.replace(/Table \d+ (?:References|Support equipment|Consumables[^]*?|Spares)[\s\S]*?(?=\n(?:Safety|CAUTION|WARNING|Procedure|\d+\n(?:Make|Do |In |Check)))/gi, '');

    // Collapse multiple blank lines
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    // Find numbered steps — the real procedures
    const stepMatch = text.match(/\n(\d+)\n(Make sure|Do |In |Get |Check |Install|Remove|Open |Close|Connect|Disconnect|Apply|Set |Start |Stop |Verify)/);
    if (stepMatch) {
      const idx = text.indexOf(stepMatch[0]);
      // Include CAUTION/safety note before steps if present
      const lookback = text.substring(Math.max(0, idx - 300), idx);
      const cautionIdx = lookback.search(/\b(CAUTION|WARNING|Safety)\b/);
      const startAt = cautionIdx >= 0 ? (Math.max(0, idx - 300) + cautionIdx) : idx;
      const lineStart = text.lastIndexOf('\n', startAt);
      text = text.substring(lineStart > 0 ? lineStart : startAt).trim();
    } else {
      // Fallback: take back 60% where procedures typically live
      text = text.substring(Math.floor(text.length * 0.4)).trim();
    }

    // Truncate at step/sentence boundary near maxLen
    if (text.length > maxLen) {
      const region = text.substring(maxLen - 100, Math.min(text.length, maxLen + 100));
      const stepBoundary = region.search(/\n\d+\n/);
      const sentEnd = region.search(/[.!?]\s/);
      const cutAt = stepBoundary >= 0 ? (maxLen - 100 + stepBoundary) :
                     sentEnd >= 0 ? (maxLen - 100 + sentEnd + 1) : maxLen;
      text = text.substring(0, cutAt).trim();
    }

    return text || rawText.substring(rawText.length - maxLen);
  },

  // Main entry point: detect aircraft, load file, search, return context
  async buildContextAsync(query) {
    if (!this.loaded) await this.load();

    const entry = this.detectAircraft(query);
    const images = [];
    let ctx = '';
    let allHits = [];

    if (entry) {
      const data = await this.loadAircraft(entry);
      if (data) {
        const hits = this.searchChapters(data, query, 2);
        allHits = hits;
        if (hits.length > 0) {
          ctx = '\n\n--- MAINTENANCE MANUAL (' + entry.manufacturer + ' ' + entry.aircraft + ') ---\n';
          for (const h of hits) {
            // Strip metadata headers and extract actual procedural content
            const excerpt = RAG.cleanChapterText(h.text, 600);
            ctx += `\n[${h.chapter}]\n${excerpt}\n`;
            // Collect images — display_index stores images as raw path strings
            if (h.images && Array.isArray(h.images)) {
              for (const img of h.images) {
                if (typeof img === 'string') {
                  const pageMatch = img.match(/_p(\d+)_img/);
                  const page = pageMatch ? parseInt(pageMatch[1]) : 0;
                  const mapKey = h.chapter + '_p' + page;
                  const resolvedSrc = this.imageMap?.[mapKey] || ('rag_images/' + img.split('/').pop());
                  images.push({
                    src: resolvedSrc,
                    page,
                    caption: `${h.chapter} p.${page}`,
                    section: h.chapter,
                    manual: h.manual
                  });
                } else if (typeof img === 'object' && img.src) {
                  images.push({ ...img, section: h.chapter, manual: h.manual });
                }
              }
            }
          }
          ctx += '--- END MANUAL ---\n';
          console.log(`[RAG] Found ${hits.length} chapters for "${query}" in ${entry.aircraft}, ${images.length} images`);
        } else {
          console.log(`[RAG] No chapter matches for "${query}" in ${entry.aircraft}`);
        }
      }
    } else {
      // No aircraft detected — try a broad search across any cached aircraft
      for (const [id, data] of Object.entries(this.aircraftCache)) {
        const hits = this.searchChapters(data, query, 2);
        if (hits.length > 0) {
          allHits = hits;
          ctx = '\n\n--- MAINTENANCE MANUAL (' + data.manufacturer + ' ' + data.aircraft + ') ---\n';
          for (const h of hits) {
            const excerpt = RAG.cleanChapterText(h.text, 600);
            ctx += `\n[${h.chapter}]\n${excerpt}\n`;
            if (h.images && Array.isArray(h.images)) {
              for (const img of h.images) {
                if (typeof img === 'string') {
                  const pageMatch = img.match(/_p(\d+)_img/);
                  const page = pageMatch ? parseInt(pageMatch[1]) : 0;
                  const mapKey = h.chapter + '_p' + page;
                  const resolvedSrc = this.imageMap?.[mapKey] || ('rag_images/' + img.split('/').pop());
                  images.push({
                    src: resolvedSrc,
                    page,
                    caption: `${h.chapter} p.${page}`,
                    section: h.chapter,
                    manual: h.manual
                  });
                } else if (typeof img === 'object' && img.src) {
                  images.push({ ...img, section: h.chapter, manual: h.manual });
                }
              }
            }
          }
          ctx += '--- END MANUAL ---\n';
          console.log(`[RAG] Broad search: ${hits.length} chapters in cached ${data.aircraft}`);
          break;
        }
      }
      if (!ctx) console.log(`[RAG] No aircraft detected and no cached data for: "${query}"`);
    }

    return { text: ctx, images, hits: allHits };
  },

  renderImages(images, container) {
    if (!images || images.length === 0) return;
    const gallery = document.createElement('div');
    gallery.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;padding:8px;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.15);border-radius:10px;';

    const label = document.createElement('div');
    label.style.cssText = 'width:100%;font-size:11px;color:#8b949e;font-weight:600;letter-spacing:0.5px;margin-bottom:4px;';
    label.textContent = `📎 ${images.length} RELATED DIAGRAM${images.length > 1 ? 'S' : ''} FROM MAINTENANCE MANUALS`;
    gallery.appendChild(label);

    for (const img of images.slice(0, 6)) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:relative;border-radius:8px;overflow:hidden;border:1px solid rgba(99,102,241,0.2);cursor:pointer;max-width:140px;';

      const imgEl = document.createElement('img');
      // Ensure absolute path for Capacitor WebView
      const imgSrc = img.src.startsWith('http') || img.src.startsWith('/') ? img.src : (img.src);
      imgEl.src = imgSrc;
      imgEl.alt = img.caption || 'Maintenance diagram';
      imgEl.style.cssText = 'width:100%;height:auto;display:block;';
      imgEl.loading = 'lazy';
      imgEl.onerror = () => { wrapper.style.display = 'none'; console.warn('[RAG] Image failed:', imgSrc); };

      const cap = document.createElement('div');
      cap.style.cssText = 'font-size:9px;color:#8b949e;padding:3px 6px;background:rgba(13,17,23,0.9);text-align:center;';
      cap.textContent = img.caption || `p.${img.page}`;

      wrapper.appendChild(imgEl);
      wrapper.appendChild(cap);

      wrapper.addEventListener('click', () => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:3000;background:rgba(0,0,0,0.85);display:flex;justify-content:center;align-items:center;padding:20px;';
        const fullImg = document.createElement('img');
        fullImg.src = imgSrc;
        fullImg.style.cssText = 'max-width:90%;max-height:90%;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5);';
        overlay.appendChild(fullImg);
        overlay.addEventListener('click', () => overlay.remove());
        document.body.appendChild(overlay);
      });

      gallery.appendChild(wrapper);
    }
    container.appendChild(gallery);
  }
};

// ═══════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════

function scrollDoc(event, sectionId) {
  event.preventDefault();
  const el = document.getElementById(sectionId);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Update active sidebar link
  document.querySelectorAll('.docs-link').forEach(a => a.classList.remove('active'));
  event.currentTarget.classList.add('active');
}

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ═══════════════════════════════════════════════════
//  API CONSOLE LOG
// ═══════════════════════════════════════════════════

const apiConsole = {
  logs: [],
  counter: 0,
  collapsed: true,

  init() {
    const toggle = document.getElementById('consoleToggle');
    const clearBtn = document.getElementById('consoleClear');
    if (toggle) toggle.addEventListener('click', () => this.toggle());
    if (clearBtn) clearBtn.addEventListener('click', () => this.clear());
  },

  toggle() {
    this.collapsed = !this.collapsed;
    const panel = document.getElementById('consolePanel');
    const arrow = document.getElementById('consoleArrow');
    if (panel) panel.classList.toggle('expanded', !this.collapsed);
    if (arrow) arrow.textContent = this.collapsed ? '▲' : '▼';
  },

  clear() {
    this.logs = [];
    this.counter = 0;
    const el = document.getElementById('consoleLogs');
    const badge = document.getElementById('consoleBadge');
    if (el) el.innerHTML = '<div class="console-empty">API calls will appear here</div>';
    if (badge) badge.textContent = '0';
  },

  log(entry) {
    this.counter++;
    this.logs.unshift(entry);
    if (this.logs.length > 50) this.logs.pop();
    const badge = document.getElementById('consoleBadge');
    if (badge) badge.textContent = this.counter;
    this.render();
  },

  summarize(obj, depth = 0) {
    if (depth > 2) return typeof obj;
    if (obj === null || obj === undefined) return String(obj);
    if (Array.isArray(obj)) {
      if (obj.length === 0) return '[]';
      return `Array(${obj.length}) [${this.summarize(obj[0], depth + 1)}, ...]`;
    }
    if (typeof obj === 'object') {
      const keys = Object.keys(obj);
      const preview = keys.slice(0, 6).map(k => {
        const v = obj[k];
        if (Array.isArray(v)) return `${k}: Array(${v.length})`;
        if (v && typeof v === 'object') return `${k}: {…}`;
        return `${k}: ${JSON.stringify(v)}`;
      });
      if (keys.length > 6) preview.push(`…+${keys.length - 6} more`);
      return `{ ${preview.join(', ')} }`;
    }
    return JSON.stringify(obj);
  },

  render() {
    const el = document.getElementById('consoleLogs');
    if (!el) return;
    el.innerHTML = this.logs.map((log, i) => {
      const methodClass = log.method === 'GET' ? 'method-get' : log.method === 'PUT' ? 'method-put' : 'method-post';
      const statusClass = log.status < 300 ? 'status-ok' : 'status-err';
      const id = `consoleEntry${i}`;
      return `
        <div class="console-entry">
          <div class="console-entry-header" onclick="document.getElementById('${id}').classList.toggle('expanded')">
            <span class="console-method ${methodClass}">${log.method}</span>
            <span class="console-url">${log.url}</span>
            <span class="console-status ${statusClass}">${log.status}</span>
            <span class="console-duration">${log.duration}ms</span>
            <span class="console-time">${log.time}</span>
          </div>
          <div class="console-entry-detail" id="${id}">
            ${log.requestBody ? `<div class="console-section">
              <div class="console-section-label">▸ Request Body</div>
              <pre class="console-json">${JSON.stringify(log.requestBody, null, 2)}</pre>
            </div>` : ''}
            <div class="console-section">
              <div class="console-section-label">▸ Response Shape</div>
              <pre class="console-json">${log.responseShape}</pre>
            </div>
            ${log.responseKeys ? `<div class="console-section">
              <div class="console-section-label">▸ Response Keys</div>
              <pre class="console-json">${log.responseKeys}</pre>
            </div>` : ''}
          </div>
        </div>`;
    }).join('');
  }
};

// Wrap fetch to intercept API calls
const _originalFetch = window.fetch;
window.fetch = async function (url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const urlStr = typeof url === 'string' ? url : (url.url || url.toString());

  // Only log /api/ calls (skip non-API resources)
  const isApi = urlStr.includes('/api/');
  const startTime = performance.now();

  let requestBody = null;
  if (options.body) {
    try { requestBody = JSON.parse(options.body); } catch (e) { requestBody = options.body; }
  }

  // Translate PUT to POST natively and inject Bearer token
  if (isApi) {
    if (method === 'PUT') {
      options.method = 'POST';
    }
    if (BEARER) {
      options.headers = options.headers || {};
      options.headers['Authorization'] = `Bearer ${BEARER}`;
      options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
      options.headers['Accept'] = options.headers['Accept'] || 'application/json';
    }
    // If empty body for POST, provide generic query to prevent 400 error (replicates server.js)
    if (options.method === 'POST' && (!options.body || options.body === '{}')) {
      options.body = JSON.stringify({ "pageSize": 50, "pageNumber": 1, "make": "Gulfstream" });
    }
  }

  const response = await _originalFetch(url, options);

  if (isApi) {
    const duration = Math.round(performance.now() - startTime);
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false });

    // Clone the response to read it without consuming
    const clone = response.clone();
    try {
      const data = await clone.json();
      const keys = Object.keys(data);
      apiConsole.log({
        method,
        url: urlStr.replace(window.location.origin, ''),
        status: response.status,
        duration,
        time,
        requestBody: Object.keys(requestBody || {}).length > 0 ? requestBody : null,
        responseShape: apiConsole.summarize(data),
        responseKeys: keys.length > 0 ? keys.join(', ') : null
      });
    } catch (e) {
      apiConsole.log({
        method,
        url: urlStr.replace(window.location.origin, ''),
        status: response.status,
        duration,
        time,
        requestBody: Object.keys(requestBody || {}).length > 0 ? requestBody : null,
        responseShape: '(non-JSON response)',
        responseKeys: null
      });
    }
  }

  return response;
};

// ═══════════════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // Phase 1: UI + local engines (instant, no network)
  setupNavigation();     // Nav + chat panel + LLM init (all independent of API)
  apiConsole.init();
  RAG.load();            // RAG index (non-blocking)

  // Phase 2: Network-dependent (fire and forget — app works without it)
  login().then(() => loadDashboard()).catch(() => {});
});

async function login() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${API}/api/Admin/APILogin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmailAddress: 'PROD@Advancedaog.com', Password: 'Advancedaog1$' }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await res.json();
    
    if (data.bearerToken && data.apiToken) {
      BEARER = data.bearerToken;
      TOKEN = data.apiToken;
      
      const tokenField = document.getElementById('apiToken');
      if (tokenField) tokenField.value = TOKEN;

      const status = document.getElementById('apiStatus');
      status.classList.add('connected');
      status.querySelector('span:last-child').textContent = `Connected (Live App)`;
    } else {
      throw new Error('No tokens returned from API');
    }
  } catch (e) {
    console.error('Login failed:', e);
    const status = document.getElementById('apiStatus');
    status.classList.remove('connected');
    status.querySelector('span:last-child').textContent = 'Connection Failed';
  }
}

// ═══════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════

function setupNavigation() {
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const mainNav = document.getElementById('mainNav');
  if (hamburgerBtn && mainNav) {
    hamburgerBtn.addEventListener('click', () => {
      mainNav.classList.toggle('nav-open');
    });
  }

  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Search handlers — live search as you type (debounced) + button fallback
  const acFields = ['acMake', 'acReg', 'acSerial', 'acCountry'];
  const compFields = ['compName', 'compCity', 'compCountry'];
  const contFields = ['contFirst', 'contLast', 'contCompany', 'contTitle'];

  const debouncedAircraft = debounce(() => { tabLoaded['aircraft'] = true; loadAircraft(); }, 300);
  const debouncedCompanies = debounce(() => { tabLoaded['companies'] = true; loadCompanies(); }, 300);
  const debouncedContacts = debounce(() => { tabLoaded['contacts'] = true; loadContacts(); }, 300);

  document.getElementById('acSearchBtn')?.addEventListener('click', loadAircraft);
  acFields.forEach(id => document.getElementById(id)?.addEventListener('input', debouncedAircraft));
  document.getElementById('acTypeFilter')?.addEventListener('change', () => { tabLoaded['aircraft'] = true; loadAircraft(); });
  document.getElementById('acForSale')?.addEventListener('change', () => { tabLoaded['aircraft'] = true; loadAircraft(); });

  // Aircraft MRO Scan filters
  document.getElementById('acDirectSearchBtn')?.addEventListener('click', loadAircraft);
  ['acScanUrgency', 'acScanRegion'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { tabLoaded['aircraft'] = true; loadAircraft(); });
  });

  // MRO Intelligence tab
  document.getElementById('mroSearchBtn')?.addEventListener('click', () => { tabLoaded['activity'] = true; loadActivity(); });
  ['mroUrgencyFilter', 'mroTypeFilter', 'mroRegionFilter'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { tabLoaded['activity'] = true; loadActivity(); });
  });


  document.getElementById('compSearchBtn')?.addEventListener('click', loadCompanies);
  compFields.forEach(id => document.getElementById(id)?.addEventListener('input', debouncedCompanies));

  document.getElementById('contSearchBtn')?.addEventListener('click', loadContacts);
  contFields.forEach(id => document.getElementById(id)?.addEventListener('input', debouncedContacts));

  // Modal close handlers
  document.getElementById('acDetailClose')?.addEventListener('click', () => closeModal('acDetailModal'));
  document.getElementById('compDetailClose')?.addEventListener('click', () => closeModal('compDetailModal'));
  document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', () => bd.closest('.modal').classList.add('hidden'));
  });

  setupChatPanel();
}

function setupChatPanel() {
  const panel = document.getElementById('ai-chat-panel');
  const toggleBtn = document.getElementById('chatToggleFab');
  const closeBtn = document.getElementById('closeChatBtn');
  const input = document.getElementById('chatInput');
  const sendBtn = document.querySelector('.chat-send-btn');
  const history = document.getElementById('chatHistory');

  if (!panel || !toggleBtn) return;

  // ── On-Device LLM State ──
  let llamaContext = null;
  let modelReady = false;
  const MODEL_FILENAME = 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf';

  // ── On-Device Token Counter + Cost Savings ──
  // GPT-4o equivalent pricing — what this would cost on cloud
  const CLOUD_COST_PER_M_INPUT = 2.50;
  const CLOUD_COST_PER_M_OUTPUT = 10.00;
  let totalTokensUsed = parseInt(localStorage.getItem('mxgenius_total_tokens') || '0');
  let totalSaved = parseFloat(localStorage.getItem('mxgenius_total_saved') || '0');

  // Inject status dot + cost counter into header
  const chatHeader = panel.querySelector('.chat-header');
  if (chatHeader) {
    const headerControls = document.createElement('span');
    headerControls.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:auto;font-size:11px;';

    const costBadge = document.createElement('span');
    costBadge.id = 'cost-savings-badge';
    costBadge.style.cssText = 'color:#34d399;font-weight:700;letter-spacing:0.3px;cursor:pointer;font-size:12px;text-shadow:0 0 8px rgba(52,211,153,0.3);transition:all 0.3s;';
    costBadge.title = 'Tokens used on-device — tap for details';
    costBadge.textContent = totalTokensUsed > 0 ? `${totalTokensUsed.toLocaleString()} tokens • $${totalSaved.toFixed(2)} saved` : '0 tokens';
    costBadge.addEventListener('click', () => toggleTokenMarketplace());

    const statusDot = document.createElement('span');
    statusDot.id = 'backend-status-dot';
    statusDot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:#888;transition:background 0.3s;cursor:help;';
    statusDot.title = 'LLM: loading... (triple-tap for debug mode)';

    // Triple-tap debug mode toggle
    window._mxDebugMode = false;
    let _tapCount = 0, _tapTimer = null;
    statusDot.addEventListener('click', () => {
      _tapCount++;
      clearTimeout(_tapTimer);
      _tapTimer = setTimeout(() => { _tapCount = 0; }, 800);
      if (_tapCount >= 3) {
        _tapCount = 0;
        window._mxDebugMode = !window._mxDebugMode;
        statusDot.style.boxShadow = window._mxDebugMode ? '0 0 6px 2px #6366f1' : 'none';
        statusDot.title = window._mxDebugMode ? '🔍 DEBUG MODE ON (triple-tap to disable)' : 'LLM: ready (triple-tap for debug mode)';
        // Flash feedback
        const label = document.createElement('div');
        label.textContent = window._mxDebugMode ? '🔍 Debug ON' : '🔍 Debug OFF';
        label.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:rgba(99,102,241,0.9);color:white;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:700;z-index:9999;transition:opacity 0.5s;';
        document.body.appendChild(label);
        setTimeout(() => { label.style.opacity = '0'; setTimeout(() => label.remove(), 500); }, 1200);
      }
    });

    headerControls.appendChild(costBadge);
    headerControls.appendChild(statusDot);
    chatHeader.appendChild(headerControls);

    // ── Auto-Speak Toggle Banner (below header) ──
    let ttsAutoPlay = localStorage.getItem('mxgenius_tts_auto') === 'true';
    const ttsBanner = document.createElement('div');
    ttsBanner.id = 'tts-banner';
    ttsBanner.style.cssText = `display:flex;align-items:center;justify-content:center;gap:10px;padding:8px 12px;
      background:${ttsAutoPlay ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)'};
      border-bottom:1px solid var(--border);cursor:pointer;transition:all 0.2s;`;
    ttsBanner.innerHTML = `
      <span style="font-size:18px;">${ttsAutoPlay ? '🔊' : '🔇'}</span>
      <span style="font-size:12px;font-weight:600;color:${ttsAutoPlay ? '#a5b4fc' : '#8b949e'};">
        Auto-Speak ${ttsAutoPlay ? 'ON' : 'OFF'}
      </span>
      <span style="width:36px;height:20px;border-radius:10px;background:${ttsAutoPlay ? '#6366f1' : '#30363d'};position:relative;display:inline-block;transition:all 0.2s;">
        <span style="position:absolute;top:2px;${ttsAutoPlay ? 'right:2px' : 'left:2px'};width:16px;height:16px;border-radius:50%;background:white;transition:all 0.2s;"></span>
      </span>`;
    ttsBanner.onclick = () => {
      ttsAutoPlay = !ttsAutoPlay;
      localStorage.setItem('mxgenius_tts_auto', ttsAutoPlay);
      ttsBanner.style.background = ttsAutoPlay ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)';
      ttsBanner.querySelector('span:first-child').textContent = ttsAutoPlay ? '🔊' : '🔇';
      const label = ttsBanner.querySelectorAll('span')[1];
      label.textContent = `Auto-Speak ${ttsAutoPlay ? 'ON' : 'OFF'}`;
      label.style.color = ttsAutoPlay ? '#a5b4fc' : '#8b949e';
      const track = ttsBanner.querySelectorAll('span')[2];
      track.style.background = ttsAutoPlay ? '#6366f1' : '#30363d';
      const knob = track.querySelector('span');
      knob.style.left = ttsAutoPlay ? 'auto' : '2px';
      knob.style.right = ttsAutoPlay ? '2px' : 'auto';
    };
    chatHeader.after(ttsBanner);
  }

  function updateCostCounter(inputTokens, outputTokens) {
    const cloudCost = (inputTokens / 1_000_000 * CLOUD_COST_PER_M_INPUT) +
                      (outputTokens / 1_000_000 * CLOUD_COST_PER_M_OUTPUT);
    totalTokensUsed += (inputTokens + outputTokens);
    totalSaved += cloudCost;
    localStorage.setItem('mxgenius_total_tokens', totalTokensUsed.toString());
    localStorage.setItem('mxgenius_total_saved', totalSaved.toFixed(6));
    const badge = document.getElementById('cost-savings-badge');
    if (badge) {
      badge.textContent = `${totalTokensUsed.toLocaleString()} tokens • $${totalSaved.toFixed(2)} saved`;
      badge.style.transform = 'scale(1.2)';
      badge.style.color = '#6ee7b7';
      setTimeout(() => { badge.style.transform = 'scale(1)'; badge.style.color = '#34d399'; }, 400);
    }
  }

  // ── Token Marketplace ──
  function buildTokenMarketplace() {
    const overlay = document.createElement('div');
    overlay.id = 'token-marketplace';
    overlay.style.cssText = `
      position:fixed;top:0;left:0;width:100%;height:100%;z-index:2000;
      background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
      display:none;justify-content:center;align-items:center;padding:20px;
    `;
    overlay.innerHTML = `
      <div style="max-width:440px;width:100%;background:rgba(13,17,23,0.95);border:1px solid rgba(99,102,241,0.3);border-radius:16px;padding:28px;position:relative;">
        <button id="marketplace-close" style="position:absolute;top:12px;right:16px;background:none;border:none;color:#8b949e;font-size:20px;cursor:pointer;">✕</button>
        <h3 style="margin:0 0 4px;color:#e6edf3;font-size:16px;font-weight:600;">Token Marketplace</h3>
        <p style="margin:0 0 20px;color:#8b949e;font-size:12px;">Purchase token packs for on-device AI inference</p>
        
        <div style="display:grid;gap:12px;">
          <div style="background:linear-gradient(135deg,rgba(99,102,241,0.15),rgba(99,102,241,0.05));border:1px solid rgba(99,102,241,0.25);border-radius:12px;padding:16px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="color:#e6edf3;font-weight:600;font-size:14px;">Starter Pack</div>
              <div style="color:#8b949e;font-size:12px;margin-top:2px;">500K tokens • ~250 queries</div>
            </div>
            <button style="background:rgba(99,102,241,0.8);color:white;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;">$4.99</button>
          </div>
          
          <div style="background:linear-gradient(135deg,rgba(52,211,153,0.15),rgba(52,211,153,0.05));border:1px solid rgba(52,211,153,0.25);border-radius:12px;padding:16px;display:flex;justify-content:space-between;align-items:center;position:relative;">
            <div style="position:absolute;top:-8px;right:12px;background:#34d399;color:#0d1117;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;">POPULAR</div>
            <div>
              <div style="color:#e6edf3;font-weight:600;font-size:14px;">Pro Pack</div>
              <div style="color:#8b949e;font-size:12px;margin-top:2px;">2M tokens • ~1,000 queries</div>
            </div>
            <button style="background:rgba(52,211,153,0.8);color:#0d1117;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;">$14.99</button>
          </div>
          
          <div style="background:linear-gradient(135deg,rgba(251,191,36,0.15),rgba(251,191,36,0.05));border:1px solid rgba(251,191,36,0.25);border-radius:12px;padding:16px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="color:#e6edf3;font-weight:600;font-size:14px;">Enterprise Pack</div>
              <div style="color:#8b949e;font-size:12px;margin-top:2px;">10M tokens • ~5,000 queries</div>
            </div>
            <button style="background:rgba(251,191,36,0.8);color:#0d1117;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;">$49.99</button>
          </div>

          <div style="background:linear-gradient(135deg,rgba(168,85,247,0.15),rgba(168,85,247,0.05));border:1px solid rgba(168,85,247,0.25);border-radius:12px;padding:16px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="color:#e6edf3;font-weight:600;font-size:14px;">Unlimited Monthly</div>
              <div style="color:#8b949e;font-size:12px;margin-top:2px;">Unlimited tokens • auto-renew</div>
            </div>
            <button style="background:rgba(168,85,247,0.8);color:white;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;">$99/mo</button>
          </div>
        </div>

        <p style="margin:16px 0 0;color:#484f58;font-size:10px;text-align:center;">Session: ${totalTokensUsed.toLocaleString()} tokens used • $${totalSaved.toFixed(2)} saved vs cloud</p>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('marketplace-close').addEventListener('click', () => toggleTokenMarketplace());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) toggleTokenMarketplace(); });
  }

  function toggleTokenMarketplace() {
    let mp = document.getElementById('token-marketplace');
    if (!mp) { buildTokenMarketplace(); mp = document.getElementById('token-marketplace'); }
    // Update stats each open
    const stats = mp.querySelector('p:last-child');
    if (stats) stats.textContent = `${totalTokensUsed.toLocaleString()} tokens used • $${totalSaved.toFixed(2)} saved vs cloud`;
    mp.style.display = mp.style.display === 'flex' ? 'none' : 'flex';
  }

  function setLLMStatus(ready, detail) {
    modelReady = ready;
    const dot = document.getElementById('backend-status-dot');
    if (dot) {
      dot.style.background = ready ? '#34d399' : '#f59e0b';
      dot.title = ready ? `LLM: on-device — ${detail || 'ready'}` : `LLM: ${detail || 'loading'}`;
    }
  }

  // ── System Prompt — single unified prompt for all queries ──
  const AOG_SYSTEM_PROMPT = `You are MXGenius, an aviation maintenance assistant.
Rules:
1. Answer using the MANUAL text below when available.
2. Cite the chapter name.
3. Be concise and direct. Give the key answer in 2-3 sentences.
4. End with "NEXT STEP:" and one recommendation.
5. If no manual is provided, say what you know or suggest loading the right manual.
6. Never explain your reasoning. Never say "I need to" or "Let me think".`;

  // ── Aggressive model output cleanup (single source of truth) ──
  // 5 layers: think-blocks → special tokens → untagged CoT → pre-fill → whitespace
  function cleanModelOutput(raw) {
    if (!raw) return '';
    let text = raw;

    // 1. Strip completed think blocks (greedy — catches nested/repeated blocks)
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // 2. If still inside an unclosed think block, signal "not ready"
    if (/<think>/i.test(text)) return null;

    // 3. Strip ALL special tokens (various formats the model emits)
    text = text
      .replace(/<\|im_end\|>/gi, '')
      .replace(/<\|im_start\|>[\s\S]*/gi, '')    // Everything after im_start (next turn)
      .replace(/<\|end_of_sentence\|>/gi, '')
      .replace(/<\|endoftext\|>/gi, '')
      .replace(/<\s*\|\s*end[_\s]*of[_\s]*sentence\s*\|\s*>/gi, '')
      .replace(/<[^>]*end[_\s]*of[_\s]*sentence[^>]*>/gi, '')
      .replace(/\|\s*end[_\s]*of[_\s]*sentence\s*\|/gi, '')
      .replace(/<\/s>/gi, '');

    // 4. Strip untagged chain-of-thought (DeepSeek-R1 thinking without tags)
    // These patterns appear when the model ignores the think-skip seed
    const cotPatterns = [
      /^\s*(?:Okay|Ok),?\s+(?:so|let me|I'm|I need|I think|I want|I'll|first)[\s\S]*?(?=(?:Step \d|\d+[.):]\s|The (?:procedure|manual|chapter|leak|fuel|system)|According to|Per the|Make sure|Check |Inspect|Verify|Refer to|CAUTION|WARNING|NEXT STEP))/i,
      /^\s*(?:Let me (?:go through|think|look|check|see|review|figure|try))[\s\S]*?(?=(?:Step \d|\d+[.):]\s|The (?:procedure|manual|chapter)|According to|Per the|Make sure|NEXT STEP))/i,
      /^\s*(?:I'm trying to|I need to|I think|I remember|I've heard|I should|First,? I)[\s\S]*?(?=(?:Step \d|\d+[.):]\s|The (?:procedure|manual|chapter)|According to|Per the|Make sure|NEXT STEP))/i,
    ];
    for (const pattern of cotPatterns) {
      const match = text.match(pattern);
      if (match) {
        text = text.substring(match[0].length).trim();
        console.log('[MXGenius] Stripped untagged CoT:', match[0].substring(0, 80) + '...');
        break;
      }
    }

    // 5. If ENTIRE output is thinking (no procedural content found), strip common preambles
    text = text.replace(/^\s*(?:Okay,?\s+so\s+|Let me\s+|So,?\s+|Well,?\s+|Alright,?\s+)/i, '');
    text = text.replace(/^\s*(?:I'm trying to figure out|I need to figure out|I think I need to)[^.]*\.\s*/i, '');

    // 6. Strip the pre-fill prefix we injected
    text = text.replace(/^(?:Answer|Based on the maintenance documentation|Based on the manual)\s*:\s*/i, '');

    // 7. Strip stray think/end tags that might remain
    text = text.replace(/<\/?think>/gi, '');

    // 8. Clean up whitespace artifacts
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    return text;
  }

  // ── Format model response into polished HTML ──
  function formatMxResponse(text) {
    if (!text) return '';
    // Escape HTML first
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Style NEXT STEP callouts
    html = html.replace(/NEXT\s*STEP[:\s]*(.*?)(?:\.|$)/gi, (match, step) => {
      return `<div style="margin-top:8px;padding:8px 12px;background:linear-gradient(135deg,rgba(99,102,241,0.12),rgba(59,130,246,0.08));border-left:3px solid #6366f1;border-radius:0 8px 8px 0;font-size:12px;">` +
        `<span style="color:#818cf8;font-weight:700;font-size:10px;letter-spacing:0.5px;text-transform:uppercase;">▸ Next Step</span><br>` +
        `<span style="color:#e2e8f0;">${step.trim()}</span></div>`;
    });

    // Style procedure codes (BD700-A-J28..., AMM 27-11-17-220-801, etc.)
    html = html.replace(/\b(BD\d{2,3}-[A-Z]-[A-Z0-9\-]+)/gi, (match, code) => {
      return `<span style="display:inline-block;padding:2px 8px;margin:0 2px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.25);border-radius:12px;font-size:10px;font-weight:600;color:#a5b4fc;">📄 ${code}</span>`;
    });

    // Style ATA chapter citations → pill badges (AMM Ch.28, IPC Ch.32, etc.)
    html = html.replace(/\(?(AMM|AMP|IPC|CMM|SRM|NDT|WDM|TSM|SFP|AIPC)\s+([^,.)]+)/gi, (match, manual, ref) => {
      return `<span style="display:inline-block;padding:2px 8px;margin:0 2px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.25);border-radius:12px;font-size:10px;font-weight:600;color:#a5b4fc;letter-spacing:0.3px;">📘 ${manual} ${ref.trim()}</span>`;
    });

    // Style standalone ATA references like "ATA 32" or "(ATA 28 — Fuel)"
    html = html.replace(/\(?(ATA\s+\d+[^)]*)\)?/gi, (match, ata) => {
      return `<span style="display:inline-block;padding:2px 8px;margin:0 2px;background:rgba(52,211,153,0.12);border:1px solid rgba(52,211,153,0.2);border-radius:12px;font-size:10px;font-weight:600;color:#6ee7b7;letter-spacing:0.3px;">📋 ${ata.trim()}</span>`;
    });

    // Style manual/chapter citations like (Chapter 28, p.12)
    html = html.replace(/\((Chapter\s+\d+[^)]*)\)/gi, (match, ch) => {
      return `<span style="display:inline-block;padding:2px 8px;margin:0 2px;background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.2);border-radius:12px;font-size:10px;font-weight:600;color:#fbbf24;">${ch}</span>`;
    });

    // Style page references (p.12, page 1, etc.)
    html = html.replace(/\b(page\s+\d+|p\.\s*\d+)/gi, (match) => {
      return `<span style="color:#fbbf24;font-weight:600;">${match}</span>`;
    });

    // Style "Smart Fix Plus" and common manual names
    html = html.replace(/\b(Smart\s*Fix\s*Plus|Aircraft\s*Maintenance\s*Publication)\b/gi, (match) => {
      return `<span style="color:#818cf8;font-weight:600;">${match}</span>`;
    });

    // Convert dash-lists to styled bullets
    html = html.replace(/^\s*-\s+/gm, '• ');

    // Convert line breaks to proper spacing
    html = html.replace(/\n\n+/g, '</p><p style="margin:6px 0;">');
    html = html.replace(/\n/g, '<br>');

    // Wrap in paragraph
    html = `<p style="margin:0;line-height:1.6;color:#e2e8f0;font-size:13px;">${html}</p>`;

    return html;
  }

  // ── Format RAG procedure text into collapsible manual reference pills ──
  function formatProcedureBlock(hits) {
    if (!hits || hits.length === 0) return '';

    let html = '';
    for (const hit of hits) {
      const rawText = RAG.cleanChapterText(hit.text, 1500);
      if (!rawText || rawText.length < 20) continue;

      // Collapsible pill wrapper
      html += `<details style="margin-top:10px;background:linear-gradient(135deg,rgba(99,102,241,0.08),rgba(59,130,246,0.04));border:1px solid rgba(99,102,241,0.2);border-radius:10px;overflow:hidden;">`;
      html += `<summary style="cursor:pointer;padding:10px 14px;display:flex;align-items:center;gap:8px;list-style:none;-webkit-tap-highlight-color:transparent;">`;
      html += `<span style="font-size:13px;">📘</span>`;
      html += `<span style="font-size:11px;font-weight:700;color:#818cf8;letter-spacing:0.3px;flex:1;">${escapeHtml(hit.chapter)}</span>`;
      html += `<span style="font-size:10px;color:#6366f1;transition:transform 0.2s;">▼</span>`;
      html += `</summary>`;
      html += `<div style="padding:4px 14px 12px;">`;

      // Process text into formatted steps
      const lines = rawText.split('\n').filter(l => l.trim());
      let stepNum = 0;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (/^(CAUTION|WARNING)$/i.test(trimmed)) {
          html += `<div style="margin:6px 0;padding:6px 10px;background:rgba(251,146,60,0.1);border-left:3px solid #fb923c;border-radius:0 6px 6px 0;font-size:11px;font-weight:700;color:#fb923c;">⚠️ ${trimmed}</div>`;
          continue;
        }

        if (/^(Make sure|Do |In |Check |Apply |Verify|Ensure|Install|Remove|Open |Close|Connect|Disconnect|Start |Stop |Clean |Refer |Re-torque|If )/i.test(trimmed)) {
          stepNum++;
          html += `<div style="display:flex;gap:8px;margin:4px 0;font-size:12px;line-height:1.5;color:#e2e8f0;">`;
          html += `<span style="flex-shrink:0;width:20px;height:20px;background:rgba(99,102,241,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#a5b4fc;">${stepNum}</span>`;
          html += `<span>${escapeHtml(trimmed)}</span>`;
          html += `</div>`;
          continue;
        }

        if (/^\d+\.\d+/.test(trimmed)) {
          html += `<div style="margin:2px 0 2px 28px;font-size:11px;color:#94a3b8;line-height:1.4;">└ ${escapeHtml(trimmed)}</div>`;
          continue;
        }

        if (/^For the .* refer to BD700/i.test(trimmed)) {
          html += `<div style="margin:2px 0 2px 28px;font-size:11px;color:#94a3b8;line-height:1.4;">└ ${escapeHtml(trimmed)}</div>`;
          continue;
        }

        if (trimmed.length > 10) {
          html += `<div style="font-size:12px;color:#94a3b8;line-height:1.4;margin:2px 0;">${escapeHtml(trimmed)}</div>`;
        }
      }

      html += `</div></details>`;
    }
    return html;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Fleet Data Serializer (MRO Signals → LLM Context) ──
  let cachedFleetSignals = [];

  function serializeFleetContext() {
    if (!cachedFleetSignals || cachedFleetSignals.length === 0) return '';

    // Sort by AFTT descending (most urgent first)
    const sorted = [...cachedFleetSignals].sort((a, b) => {
      const afttA = (a.mro || buildMROSignals(a)).aftt;
      const afttB = (b.mro || buildMROSignals(b)).aftt;
      return afttB - afttA;
    });

    const lines = sorted.slice(0, 8).map((ac, i) => {
      const m = ac.mro || buildMROSignals(ac);

      // Pre-compute maintenance urgency so the model doesn't have to
      let urgencyNote = '';
      if (m.aftt > 12000) {
        urgencyNote = `D-check overdue by ${(m.aftt - 12000).toLocaleString()} hrs`;
      } else if (m.aftt > 6000) {
        urgencyNote = `approaching D-check (${(12000 - m.aftt).toLocaleString()} hrs remaining)`;
      } else if (m.aftt > 4000) {
        urgencyNote = `C-check zone (${m.aftt.toLocaleString()} hrs)`;
      } else {
        urgencyNote = 'current — low hours';
      }

      const flags = [];
      if (m.isForSale) flags.push('FOR SALE');
      if (m.isAOG) flags.push('AOG');

      return `${i + 1}. ${ac.regnbr || '?'} | ${ac.make} ${ac.model} | ${ac.yearmfg || '?'} | ${m.aftt.toLocaleString()} hrs | ${ac.baseicao || ac.basecity || '?'} | ${urgencyNote}${flags.length ? ' | ' + flags.join(', ') : ''}`;
    });

    return '\n\n--- FLEET DATA (ranked by maintenance urgency, ' + cachedFleetSignals.length + ' aircraft) ---\n' +
      'Higher hours = more overdue maintenance = better MRO outreach target.\n' +
      'D-check due every 12,000 hrs. C-check due every 4,000-6,000 hrs.\n' +
      lines.join('\n') +
      '\n--- END FLEET DATA ---\n';
  }

  // ── Model Initialization (daisy-chained: LLM first, then TTS) ──
  async function initOnDeviceLLM() {
    // Gate: only run on Capacitor (native) — skip in browser
    if (!window.Capacitor?.Plugins?.CapacitorLlama) {
      console.log('[MXGenius] Not on Capacitor — LLM init skipped');
      setLLMStatus(false, 'browser mode');
      return;
    }

    const statusMsg = document.createElement('div');
    statusMsg.className = 'chat-msg ai-msg';
    statusMsg.id = 'llm-init-msg';
    statusMsg.innerHTML = `<div class="msg-bubble">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:20px;height:20px;border:2px solid rgba(99,102,241,0.3);border-top-color:#6366f1;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
        <div>
          <div style="font-size:13px;font-weight:600;">Loading AI Engine</div>
          <div style="font-size:11px;color:#8b949e;margin-top:2px;">DeepSeek 1.5B • preparing on-device inference</div>
        </div>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    </div>`;
    history.appendChild(statusMsg);
    setLLMStatus(false, 'loading model');

    // Step 1: Load LLM (native side handles Metal detection and GPU layer assignment)
    const LlamaPlugin = window.Capacitor.Plugins.CapacitorLlama;
    const { path: modelPath } = await LlamaPlugin.getBundleModelPath({ filename: MODEL_FILENAME });

    const initResult = await LlamaPlugin.initContext({
      id: 1, model: modelPath, n_ctx: 4096, n_threads: 4, n_gpu_layers: 99
    });

    llamaContext = LlamaPlugin;
    const gpuStatus = initResult?.gpu ? 'Metal GPU' : 'CPU';
    if (document.getElementById('llm-init-msg')) document.getElementById('llm-init-msg').remove();
    console.log(`[MXGenius] LLM ready on ${gpuStatus}`);

    // Step 2: Now that LLM is loaded and stable, init Kokoro TTS
    let ttsStatus = '';
    if (window.Capacitor.Plugins.KokoroTTS) {
      setLLMStatus(false, 'loading voice engine');
      const ttsResult = await window.Capacitor.Plugins.KokoroTTS.initialize();
      ttsStatus = ttsResult.ready ? ' + Kokoro TTS' : '';
      if (!ttsResult.ready) console.warn('[MXGenius] Kokoro TTS init failed:', ttsResult.error || 'unknown');
    }

    // Step 3: All systems go
    setLLMStatus(true, `DeepSeek 1.5B (${gpuStatus})${ttsStatus}`);
    const readyMsg = document.createElement('div');
    readyMsg.className = 'chat-msg ai-msg';
    readyMsg.innerHTML = '<div class="msg-bubble">MXGenius AI is <strong>online</strong> — running on-device. No network required.' + (ttsStatus ? ' Voice enabled.' : '') + '</div>';
    history.appendChild(readyMsg);
    history.scrollTop = history.scrollHeight;
  }

  initOnDeviceLLM();

  // ── Starter Prompt Suggestions ──
  const suggestions = [
    '🔧 GL7500 fuel system leak check procedure',
    '✈️ Falcon 8X APU starter generator overhaul',
    '📋 Hydraulic bleeding procedure Falcon 900',
    '🔍 King Air 300 propeller inspection interval'
  ];
  const suggestionsBar = document.createElement('div');
  suggestionsBar.id = 'chat-suggestions';
  suggestionsBar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;';
  suggestions.forEach(s => {
    const pill = document.createElement('button');
    pill.style.cssText = 'background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.3);color:#a5b4fc;border-radius:16px;padding:6px 12px;font-size:12px;cursor:pointer;transition:all 0.2s;white-space:nowrap;';
    pill.textContent = s;
    pill.onmouseenter = () => { pill.style.background = 'rgba(99,102,241,0.25)'; };
    pill.onmouseleave = () => { pill.style.background = 'rgba(99,102,241,0.12)'; };
    pill.onclick = () => {
      input.value = s.replace(/^[^\s]+\s/, ''); // strip emoji
      sendMessage();
      suggestionsBar.remove();
    };
    suggestionsBar.appendChild(pill);
  });
  history.parentElement.insertBefore(suggestionsBar, history.nextSibling);

  window.openChatWith = (text) => {
    if (!panel.classList.contains('open')) {
      togglePanel();
    }
    input.value = text;
    sendMessage();
  };

  function togglePanel() {
    panel.classList.toggle('hidden');
    void panel.offsetWidth;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      toggleBtn.classList.add('hidden');
      input.focus();
    } else {
      toggleBtn.classList.remove('hidden');
    }
  }

  toggleBtn.addEventListener('click', togglePanel);
  closeBtn.addEventListener('click', togglePanel);

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    
    const userMsg = document.createElement('div');
    userMsg.className = 'chat-msg user-msg';
    userMsg.innerHTML = '<div class="msg-bubble">' + text + '</div>';
    history.appendChild(userMsg);
    input.value = '';
    history.scrollTop = history.scrollHeight;

    const aiMsg = document.createElement('div');
    aiMsg.className = 'chat-msg ai-msg';
    aiMsg.innerHTML = '<div class="msg-bubble"><span class="stream-target"><em>MXGenius is thinking...</em></span></div>';
    history.appendChild(aiMsg);
    history.scrollTop = history.scrollHeight;
    const streamTarget = aiMsg.querySelector('.stream-target');

    // ── Cloud Inference (Azure Rust Backend) ──
    try {
      const response = await fetch('http://localhost:3000/api/copilot/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: text,
          fleet_signals: typeof cachedFleetSignals !== 'undefined' ? cachedFleetSignals : []
        })
      });
      
      const data = await response.json();
      
      if (data.answer) {
        streamTarget.innerHTML = formatMxResponse(data.answer);
      } else {
        streamTarget.innerHTML = '<span style="color:#8b949e;font-style:italic;">No response generated</span>';
      }
      
      // ── Speak button on every response ──
      if (data.answer && data.answer.trim()) {
        const speakBtn = document.createElement('button');
        speakBtn.className = 'speak-btn';
        speakBtn.innerHTML = '🔊 Speak';
        speakBtn.onclick = () => alert("TTS is cloud-hosted now! (Not implemented in POC)");
        aiMsg.querySelector('.msg-bubble').appendChild(speakBtn);
      }
      
    } catch (e) {
      console.error('[MXGenius] Inference:', e.message);
      streamTarget.innerHTML = '<em>Inference error: ' + e.message + '</em>';
    }
    history.scrollTop = history.scrollHeight;
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // --- Voice Input (Speech-to-Text) ---
  const micBtn = document.querySelector('.chat-mic-btn');
  let isListening = false;
  let recognition = null;

  function setupVoiceInput() {
    if (!micBtn) return;

    // Use Web Speech API (powered by iOS SFSpeechRecognizer — works offline on iOS 17+)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      micBtn.style.opacity = '0.3';
      micBtn.title = 'Voice input not supported';
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      isListening = true;
      micBtn.style.color = '#ef4444';
      micBtn.classList.add('pulse-mic');
      input.placeholder = 'Listening...';
    };

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      input.value = transcript;

      // Auto-send on final result
      if (event.results[event.results.length - 1].isFinal) {
        setTimeout(() => {
          if (input.value.trim()) sendMessage();
        }, 300);
      }
    };

    recognition.onerror = (event) => {
      console.warn('[Voice] Error:', event.error);
      isListening = false;
      micBtn.style.color = '';
      micBtn.classList.remove('pulse-mic');
      input.placeholder = 'Ask MXGenius...';
      if (event.error === 'not-allowed') {
        input.placeholder = 'Microphone access denied';
      }
    };

    recognition.onend = () => {
      isListening = false;
      micBtn.style.color = '';
      micBtn.classList.remove('pulse-mic');
      input.placeholder = 'Ask MXGenius...';
    };

    micBtn.addEventListener('click', () => {
      if (isListening) {
        recognition.stop();
      } else {
        recognition.start();
      }
    });
  }

  setupVoiceInput();
}

// ═══════════════════════════════════════════════════
//  MODE TOGGLE & SETTINGS
// ═══════════════════════════════════════════════════

function setupModeToggle() {
  // Mode toggle removed — always live
}

async function fetchModeState() {
  // Settings panel removed
}





function reloadCurrentTab() {
  Object.keys(tabLoaded).forEach(k => tabLoaded[k] = false);
  const activeTab = document.querySelector('.nav-tab.active')?.dataset.tab;
  if (activeTab === 'dashboard') {
    loadDashboard();
  } else if (activeTab) {
    tabLoaded[activeTab] = true;
    switch (activeTab) {
      case 'globe': loadGlobe(); break;
      case 'aircraft': loadAircraft(); break;

      case 'companies': loadCompanies(); break;
            case 'contacts': loadContacts(); break;
      case 'outreach': loadCompanies(); loadContacts(); break;
      case 'docs': loadDocs(); break;
    }
  }
}

const tabLoaded = {};

function switchTab(tabId) {
  const mainNav = document.getElementById('mainNav');
  if (mainNav && mainNav.classList.contains('nav-open')) {
    mainNav.classList.remove('nav-open');
  }

  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(`.nav-tab[data-tab="${tabId}"]`).classList.add('active');
  document.getElementById(`tab-${tabId}`).classList.add('active');

  // Reload 3D Viewer iframe to act as a "Home" reset button and break out of WebXR
  if (tabId === '3d-viewer') {
    const frame = document.getElementById('viewer-iframe');
    if (frame) {
      if (frame.dataset.src && (!frame.src || frame.src === 'about:blank' || frame.src === window.location.href)) {
        // First load — set src from data-src
        frame.src = frame.dataset.src;
      } else if (frame.src && frame.src !== 'about:blank') {
        // Already loaded — reload to reset WebXR state
        frame.contentWindow.location.reload();
      }
    }
  }

  // Lazy-load tab data
  if (!tabLoaded[tabId]) {
    tabLoaded[tabId] = true;
    switch (tabId) {
      case 'globe': loadGlobe(); break;
      case 'aircraft': loadAircraft(); break;
      case 'companies': loadCompanies(); break;
            case 'contacts': loadContacts(); break;
      case 'outreach': loadCompanies(); loadContacts(); break;
      case 'docs': loadDocs(); break;
      case '3d-viewer': break;
      case 'store': break; // Static HTML, no loader needed
    }
  }
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function setOutreachMode(mode) {
  var companies = document.getElementById('outreach-companies');
  var contacts = document.getElementById('outreach-contacts');
  var btnCompanies = document.getElementById('outreachModeCompanies');
  var btnContacts = document.getElementById('outreachModeContacts');
  if (mode === 'contacts') {
    companies.style.display = 'none';
    contacts.style.display = '';
    btnCompanies.classList.remove('ac-mode-active');
    btnContacts.classList.add('ac-mode-active');
  } else {
    companies.style.display = '';
    contacts.style.display = 'none';
    btnCompanies.classList.add('ac-mode-active');
    btnContacts.classList.remove('ac-mode-active');
  }
}

// ═══════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════

async function loadDashboard() {
  try {
    // Fetch aggregate stats
    if (!TOKEN) return; // No token — skip dashboard (offline mode)
    const dashTimeout = AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined;
    const [acRes, compRes, contRes] = await Promise.allSettled([
      fetch(`${API}/api/Aircraft/getAircraftList/${TOKEN}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), signal: dashTimeout
      }).then(r => r.json()),
      fetch(`${API}/api/Company/getCompanyList/${TOKEN}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), signal: dashTimeout
      }).then(r => r.json()),
      fetch(`${API}/api/Contact/getContactList/${TOKEN}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), signal: dashTimeout
      }).then(r => r.json()),
    ]);

    const acData = acRes.status === 'fulfilled' ? acRes.value : {};
    const compData = compRes.status === 'fulfilled' ? compRes.value : {};
    const contData = contRes.status === 'fulfilled' ? contRes.value : {};
    const acList = acData.aircraft || [];

    // Compute aggregate stats from live aircraft list
    const totalAircraft = acData.count || acList.length || 0;
    const totalCompanies = compData.count || (compData.companies || []).length || 0;
    const totalContacts = contData.count || (contData.contacts || []).length || 0;
    const forSale = acList.filter(a => a.forsale === true || a.forsale === 'true').length;

    // Aggregate flight hours and records
    let totalHours = 0;
    acList.forEach(a => { totalHours += (a.aftt || a.estaftt || 0); });

    // Fleet breakdown by make and type
    const byMake = {};
    const byType = {};
    acList.forEach(a => {
      const make = a.make || 'Unknown';
      byMake[make] = (byMake[make] || 0) + 1;
      const type = a.maketype || 'Unknown';
      byType[type] = (byType[type] || 0) + 1;
    });

    // Sort and limit to top 6 makes
    const topMakes = Object.fromEntries(
      Object.entries(byMake).sort((a, b) => b[1] - a[1]).slice(0, 6)
    );

    animateNumber('statAircraft', totalAircraft);
    animateNumber('statCompanies', totalCompanies);
    animateNumber('statHours', totalHours, true);
    animateNumber('statForSale', forSale);

    // ── FAA AD Fleet Scan — Predictive Maintenance ──
    (async () => {
      await FAA_ADS.load();
      const fleetIcaos = [...new Set(acList.map(a => (a.icao || a.maketype || '')).filter(Boolean))];
      const adScan = FAA_ADS.scanFleet(fleetIcaos);
      const adEl = document.getElementById('statADs');
      if (adEl) {
        animateNumber('statADs', adScan.total);
        adEl.title = Object.entries(adScan.byType).map(([k, v]) => `${k}: ${v}`).join('\n');
      }
      console.log(`[FAA] Fleet AD scan: ${adScan.total} ADs across ${Object.keys(adScan.byType).length} types`);
    })();

    renderBarChart('chartMakes', topMakes, ['#00d4ff', '#0099ff', '#8b5cf6', '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#ec4899']);
    renderBarChart('chartTypes', byType, ['#00d4ff', '#8b5cf6', '#10b981', '#f59e0b']);

    // Fetch dynamic Recent Transactions via Paged endpoint
    try {
      const histRes = await fetch(`${API}/api/Aircraft/getHistoryListPaged/${TOKEN}/10/1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const histData = await histRes.json();
      renderRecentTransactions(histData.history || histData.transactionhistory || []);
    } catch (e) {
      console.warn('Could not fetch paged history for dashboard:', e);
      renderRecentTransactions([]);
    }

  } catch (e) {
    console.error('Dashboard load failed:', e);
  }
}

function animateNumber(id, target, commas = false) {
  const el = document.getElementById(id);
  const duration = 1200;
  const start = performance.now();

  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.floor(eased * target);
    el.textContent = commas ? current.toLocaleString() : current;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderBarChart(containerId, data, colors) {
  const container = document.getElementById(containerId);
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(e => e[1]));

  container.innerHTML = entries.map(([label, value], i) => {
    const pct = Math.round((value / max) * 100);
    const color = colors[i % colors.length];
    return `
      <div class="chart-row">
        <span class="chart-label">${label}</span>
        <div class="chart-bar-bg">
          <div class="chart-bar" style="width: ${pct}%; background: ${color};">${value}</div>
        </div>
      </div>`;
  }).join('');

  // Trigger animation
  setTimeout(() => {
    container.querySelectorAll('.chart-bar').forEach(bar => {
      const w = bar.style.width;
      bar.style.width = '0%';
      requestAnimationFrame(() => { bar.style.width = w; });
    });
  }, 50);
}

function renderRecentTransactions(transactions) {
  const container = document.getElementById('recentTransactions');
  if (!transactions || transactions.length === 0) {
    container.innerHTML = '<div class="empty-state">No recent transactions</div>';
    return;
  }
  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th><th>Make</th><th>Model</th><th>Reg</th><th>Serial</th><th>Type</th><th>Description</th>
        </tr>
      </thead>
      <tbody>
        ${transactions.map(t => `
          <tr>
            <td class="td-dim">${t.actiondate || '—'}</td>
            <td class="td-accent">${t.make}</td>
            <td>${t.model}</td>
            <td class="td-mono">${t.regnbr}</td>
            <td class="td-mono">${t.sernbr}</td>
            <td><span class="badge badge-lifecycle">${t.transtype || '—'}</span></td>
            <td class="td-dim">${t.description || '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

// ═══════════════════════════════════════════════════
//  AIRCRAFT
// ═══════════════════════════════════════════════════

let isAircraftInitialized = false;
let acSearchMode = 'scan'; // 'scan' or 'direct'

function setAcMode(mode) {
  acSearchMode = mode;
  const scanBar = document.getElementById('acScanBar');
  const directBar = document.getElementById('acDirectBar');
  const scanBtn = document.getElementById('acModeScan');
  const directBtn = document.getElementById('acModeDirect');
  const statsRow = document.getElementById('acMROStats');

  if (mode === 'scan') {
    scanBar.style.display = '';
    directBar.style.display = 'none';
    scanBtn.classList.add('ac-mode-active');
    directBtn.classList.remove('ac-mode-active');
    if (statsRow) statsRow.style.display = '';
  } else {
    scanBar.style.display = 'none';
    directBar.style.display = '';
    scanBtn.classList.remove('ac-mode-active');
    directBtn.classList.add('ac-mode-active');
    if (statsRow) statsRow.style.display = 'none';
  }
}

async function loadAircraft() {
  const grid = document.getElementById('aircraftGrid');
  grid.innerHTML = '<div class="loading">Scanning fleet...</div>';

  const body = {};
  let forSale = false;

  if (acSearchMode === 'direct') {
    // Direct Search mode — use text fields
    const make = document.getElementById('acMake').value.trim();
    const regnbr = document.getElementById('acReg').value.trim();
    const sernbr = document.getElementById('acSerial').value.trim();
    const basecountry = document.getElementById('acCountry').value.trim();
    if (make) body.make = make;
    if (regnbr) body.regnbr = regnbr.toUpperCase();
    if (sernbr) body.sernbr = sernbr;
    if (basecountry) body.basecountry = basecountry;
  } else {
    // MRO Scan mode — use scan filters
    const regionFilter = document.getElementById('acScanRegion')?.value || '';
    const urgencyFilter = document.getElementById('acScanUrgency')?.value || '';
    if (regionFilter) body.basecountry = regionFilter;
    if (urgencyFilter === 'for-sale') { body.isForSale = true; forSale = true; }
  }

  // Shared filters
  const typeFilter = document.getElementById('acTypeFilter').value;
  if (typeFilter) body.maketype = typeFilter;
  if (document.getElementById('acForSale').checked) { body.isForSale = true; forSale = true; }

  // Default first load
  if (Object.keys(body).length === 0 && !isAircraftInitialized) {
    body.isForSale = true;
    forSale = true;
    document.getElementById('acForSale').checked = true;
  }

  isAircraftInitialized = true;

  try {
    const res = await fetch(`${API}/api/Aircraft/getAircraftList/${TOKEN}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (data.responsestatus && data.responsestatus !== 'Success' && data.responsestatus !== 'SUCCESS') {
      grid.innerHTML = `<div class="empty-state">API Error: ${data.responsestatus}</div>`;
      return;
    }

    if (!data.aircraft || data.aircraft.length === 0) {
      grid.innerHTML = '<div class="empty-state">No aircraft found matching your criteria</div>';
      return;
    }

    // Store full dataset for infinite scroll
    aircraftScrollState = {
      allAircraft: data.aircraft,
      rendered: 0,
      forSale: forSale,
      CHUNK: 100,
    };

    // Cache for LLM context (outreach mode)
    cachedFleetSignals = data.aircraft.map(ac => ({ ...ac, mro: buildMROSignals(ac) }));

    // Populate MRO stats in Aircraft tab
    if (acSearchMode === 'scan') {
      const htCount = cachedFleetSignals.filter(a => a.mro.isHighTime).length;
      const fsCount = cachedFleetSignals.filter(a => a.mro.isForSale).length;
      const totalAFTT = cachedFleetSignals.reduce((s, a) => s + a.mro.aftt, 0);
      const avgAFTT = cachedFleetSignals.length > 0 ? Math.round(totalAFTT / cachedFleetSignals.length) : 0;
      const statEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = typeof v === 'number' ? v.toLocaleString() : v; };
      statEl('acStatHighTime', htCount);
      statEl('acStatForSale', fsCount);
      statEl('acStatAvgAFTT', avgAFTT);
      statEl('acStatFleet', cachedFleetSignals.length);
    }

    grid.innerHTML = '';
    renderAircraftChunk(grid);
    setupAircraftScroll(grid);
  } catch (e) {
    grid.innerHTML = '<div class="empty-state">Error loading aircraft</div>';
    console.error(e);
  }
}

let aircraftScrollState = null;
let aircraftScrollObserver = null;

function renderAircraftCard(ac, forSale) {
  const year = ac.yearmfg || ac.yearmfr || '—';
  const reg = ac.regnbr || '—';
  const base = ac.baseicao || ac.baseicaocode || ac.basecity || '—';
  const type = ac.maketype || '—';
  const typeClass = (type === 'BusinessJet' || type === 'JetAirliner') ? 'badge-jet' : type === 'Piston' ? 'badge-heli' : 'badge-turbo';
  const mro = buildMROSignals(ac);
  const mroBadge = mro.isAOG ? '<span class="badge badge-aog">AOG</span>'
    : mro.urgency === 'overdue' ? '<span class="badge badge-overdue">HIGH-TIME</span>'
    : mro.isHighTime ? '<span class="badge badge-due-soon">HIGH-TIME</span>' : '';
  return `
    <div class="ac-card" onclick="showAircraftDetail(${ac.aircraftid})">
      <div class="ac-card-header">
        <div>
          <div class="ac-card-make">${ac.make}</div>
          <div class="ac-card-model">${ac.model}</div>
        </div>
        <div class="ac-card-reg">${reg}</div>
      </div>
      <div class="ac-card-details">
        <div class="ac-card-detail">
          <span class="ac-card-detail-label">Year</span>
          <span class="ac-card-detail-value">${year}</span>
        </div>
        <div class="ac-card-detail">
          <span class="ac-card-detail-label">Serial</span>
          <span class="ac-card-detail-value">${ac.sernbr || '—'}</span>
        </div>
        <div class="ac-card-detail">
          <span class="ac-card-detail-label">AFTT</span>
          <span class="ac-card-detail-value ${mro.isHighTime ? 'mro-metric-warn' : ''}">${ac.aftt?.toLocaleString() || ac.estaftt?.toLocaleString() || '—'}</span>
        </div>
        <div class="ac-card-detail">
          <span class="ac-card-detail-label">Base</span>
          <span class="ac-card-detail-value">${base}</span>
        </div>
      </div>
      <div class="ac-card-badges">
        <span class="badge ${typeClass}">${type}</span>
        ${forSale ? '<span class="badge badge-forsale">FOR SALE</span>' : ''}
        ${mroBadge}
        <span class="badge badge-lifecycle">${ac.lifecycle || '—'}</span>
      </div>
    </div>`;
}

function renderAircraftChunk(grid) {
  const s = aircraftScrollState;
  if (!s || s.rendered >= s.allAircraft.length) return;

  const end = Math.min(s.rendered + s.CHUNK, s.allAircraft.length);
  const chunk = s.allAircraft.slice(s.rendered, end);
  const html = chunk.map(ac => renderAircraftCard(ac, s.forSale)).join('');

  // Remove old sentinel
  const oldSentinel = grid.querySelector('#acScrollSentinel');
  if (oldSentinel) {
    if (aircraftScrollObserver) aircraftScrollObserver.unobserve(oldSentinel);
    oldSentinel.remove();
  }

  grid.insertAdjacentHTML('beforeend', html);
  s.rendered = end;

  // Add new sentinel and observe it
  if (s.rendered < s.allAircraft.length) {
    grid.insertAdjacentHTML('beforeend', '<div id="acScrollSentinel" style="grid-column:1/-1;height:1px;"></div>');
    const newSentinel = grid.querySelector('#acScrollSentinel');
    if (aircraftScrollObserver && newSentinel) aircraftScrollObserver.observe(newSentinel);
  }
}

function setupAircraftScroll(grid) {
  if (aircraftScrollObserver) aircraftScrollObserver.disconnect();

  aircraftScrollObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      renderAircraftChunk(grid);
    }
  }, { root: null, rootMargin: '400px' });

  const sentinel = grid.querySelector('#acScrollSentinel');
  if (sentinel) aircraftScrollObserver.observe(sentinel);
}

async function showAircraftDetail(id) {
  const modal = document.getElementById('acDetailModal');
  const body = document.getElementById('acDetailBody');
  modal.classList.remove('hidden');
  body.innerHTML = '<div class="loading">Loading aircraft details...</div>';

  try {
    const [acRes, picRes, engRes] = await Promise.all([
      fetch(`${API}/api/Aircraft/getAircraft/${id}/${TOKEN}`),
      fetch(`${API}/api/Aircraft/getPictures/${id}/${TOKEN}`).catch(() => ({ json: () => ({}) })),
      fetch(`${API}/api/Engines/getEnginesByAircraft/${id}/${TOKEN}`).catch(() => ({ json: () => ({}) }))
    ]);
    
    let data = {};
    try { data = await acRes.json(); } catch (e) { console.warn('acRes JSON parse failed'); }
    
    let picData = {};
    if (picRes.ok) { try { picData = await picRes.json(); } catch(e) {} }
    
    let engData = {};
    if (engRes.ok) { try { engData = await engRes.json(); } catch(e) {} }
    
    const ac = data.aircraft;
    if (!ac) { body.innerHTML = '<div class="empty-state">Aircraft not found (404/401)</div>'; return; }

    const ident = ac.identification || {};
    const af = ac.airframe || {};
    const maint = ac.maintenance || {};
    const apu = ac.apu || {};
    
    const metarHtml = '';

    const pictures = picData.pictures || [];
    const detailedEngines = engData.engines || [];

    const galleryHtml = pictures.length > 0 ? `
      <div class="photo-gallery" style="display:flex; gap:10px; overflow-x:auto; padding-bottom:15px; margin-bottom:15px; border-bottom:1px solid var(--border);">
        ${pictures.map(p => `<img src="${p.pictureurl}" alt="Aircraft" style="height:200px; border-radius:6px; object-fit:cover; border:1px solid var(--border); cursor:pointer;" onclick="openImageLightbox(this.src)" onerror="this.style.display='none'">`).join('')}
      </div>
    ` : '';

    body.innerHTML = `
      ${galleryHtml}
      <div class="detail-header">
        <div class="detail-title-group">
          <div class="detail-make">${ident.make}</div>
          <div class="detail-model">${ident.model}</div>
          <div style="margin-top:4px">
            <span class="badge badge-jet">${ident.maketype || ident.categorysize}</span>
          </div>
        </div>
        <div class="detail-reg" style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          <div>${ident.regnbr}</div>
          ${ident.regnbr && ident.regnbr.toUpperCase().startsWith('N') ? `
            <a href="https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${ident.regnbr.replace(/^N/i, '')}" 
               target="_blank" 
               class="badge badge-heli" 
               style="text-decoration:none; cursor:pointer; font-size:0.65rem;">
               FAA Registry ↗
            </a>
          ` : ''}
        </div>
      </div>

      <div class="detail-sections">
        <div class="detail-section">
          <div class="detail-section-title">Identification</div>
          ${detailRow('Aircraft ID', ident.aircraftid)}
          ${detailRow('Serial Number', ident.sernbr)}
          ${detailRow('Year Manufactured', ident.yearmfg)}
          ${detailRow('Year Delivered', ident.yeardlv)}
          ${detailRow('Category/Size', ident.categorysize)}
          ${detailRow('Purchase Date', ident.purchasedate)}
          ${detailRow('Reg Expires', ident.regnbrexpires)}
        </div>

        <div class="detail-section">
          <div class="detail-section-title">Base Location</div>
          ${detailRow('Airport', ident.baseairport)}
          ${detailRow('ICAO', ident.baseicao)}
          ${detailRow('IATA', ident.baseiata)}
          ${detailRow('City', ident.basecity)}
          ${detailRow('State', ident.basestate)}
          ${detailRow('Country', ident.basecountry)}
          ${metarHtml}
        </div>

        <div class="detail-section">
          <div class="detail-section-title">Airframe</div>
          ${detailRow('AFTT', af.aftt?.toLocaleString())}
          ${detailRow('Landings', af.landings?.toLocaleString())}
          ${detailRow('Est AFTT', af.estaftt?.toLocaleString())}
          ${detailRow('As of Date', af.timesasofdate)}
        </div>

        <div class="detail-section">
          <div class="detail-section-title">Engines</div>
          ${detailedEngines.length > 0 ? detailedEngines.map((e, i) => `
            <div style="margin-top:8px;padding-top:8px;border-top:${i === 0 ? 'none' : '1px solid var(--border)'};">
              <div style="font-size:0.72rem;color:var(--accent-cyan);font-weight:600;">Engine ${e.position}</div>
              ${detailRow('Make/Model', `${e.engine_make} ${e.engine_model}`)}
              ${detailRow('Serial', e.serial_number)}
              ${detailRow('Total Time', e.tsn)}
              ${detailRow('Cycles', e.csn)}
              ${detailRow('Overhaul (TSO)', e.tso)}
              ${detailRow('Program', e.program)}
            </div>
          `).join('') : '<div class="td-dim">No engine details available</div>'}
        </div>

        ${apu ? `
        <div class="detail-section">
          <div class="detail-section-title">APU</div>
          ${detailRow('Model', apu.model)}
          ${detailRow('Serial', apu.sernbr)}
          ${detailRow('TTSNEW', apu.ttsnew)}
          ${detailRow('SOH', apu.soh)}
          ${detailRow('Program', apu.maintenanceprogram)}
        </div>` : ''}

        <div class="detail-section">
          <div class="detail-section-title">Maintenance</div>
          ${detailRow('Maintained', maint.maintained)}
          ${detailRow('AF Program', maint.airframemaintenanceprogram)}
          ${detailRow('Tracking', maint.airframetrackingprogram)}
          ${detailRow('MTOW', maint.weightscapacity)}
          ${detailRow('Certifications', (maint.certifications || []).join(', '))}
        </div>

        <div class="detail-section full-width">
          <div class="detail-section-title">Avionics</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${(ac.avionics || []).map(a => `<span class="badge badge-jet">${a.name}</span>`).join('')}
          </div>
        </div>

        ${ac.companyrelationships && ac.companyrelationships.length > 0 ? `
        <div class="detail-section full-width">
          <div class="detail-section-title">Company Relationships</div>
          <table>
            <thead><tr><th>Company</th><th>Relationship</th><th>Business Type</th><th>Operator</th></tr></thead>
            <tbody>
              ${ac.companyrelationships.map(r => `
                <tr>
                  <td class="td-accent">${r.name}</td>
                  <td>${r.relationtype}</td>
                  <td class="td-dim">${r.businesstype}</td>
                  <td>${r.isoperator === 'Y' ? '✓' : ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>` : ''}

        ${ac.flights && ac.flights.length > 0 ? `
        <div class="detail-section full-width">
          <div class="detail-section-title">Flight Activity</div>
          <table>
            <thead><tr><th>Year</th><th>Month</th><th>Flights</th><th>Hours</th></tr></thead>
            <tbody>
              ${ac.flights.map(f => `
                <tr>
                  <td>${f.flightyear}</td><td>${f.flightmonth}</td>
                  <td class="td-accent">${f.flights}</td><td>${f.flighthours}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>` : ''}

        ${ac.interior && ac.interior.length > 0 ? `
        <div class="detail-section">
          <div class="detail-section-title">Interior</div>
          ${ac.interior.map(i => detailRow(i.name, i.description)).join('')}
        </div>` : ''}

        ${ac.exterior && ac.exterior.length > 0 ? `
        <div class="detail-section">
          <div class="detail-section-title">Exterior</div>
          ${ac.exterior.map(e => detailRow(e.name, e.description)).join('')}
        </div>` : ''}

        <div class="detail-section full-width">
          <div class="detail-section-title">MXGenius AI Chat</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            <button class="badge badge-heli" style="cursor:pointer;border:none;font-size:0.75rem;" onclick="window.openChatWith('${ident.make} ${ident.model} maintenance schedule')">🔧 Maintenance Schedule</button>
            <button class="badge badge-heli" style="cursor:pointer;border:none;font-size:0.75rem;" onclick="window.openChatWith('${ident.make} ${ident.model} common AOG issues')">⚠️ Common AOG Issues</button>
            <button class="badge badge-heli" style="cursor:pointer;border:none;font-size:0.75rem;" onclick="window.openChatWith('${ident.make} ${ident.model} D-check interval')">⏱️ D-Check Interval</button>
            <button class="badge badge-heli" style="cursor:pointer;border:none;font-size:0.75rem;" onclick="window.openChatWith('${ident.make} ${ident.model} engine overhaul cycle')">⚙️ Engine Overhaul</button>
          </div>
        </div>

        <div class="detail-section full-width" id="acDetailADs">
          <div class="detail-section-title" style="color:#fb923c;">⚠️ FAA Airworthiness Directives</div>
          <div id="acDetailADList" style="font-size:0.82rem;color:var(--text-secondary);">Scanning...</div>
        </div>
      </div>
    `;

    // ── Populate FAA AD section asynchronously ──
    (async () => {
      await FAA_ADS.load();
      const adContainer = document.getElementById('acDetailADList');
      if (!adContainer) return;
      
      const makeModel = (ident.make + ' ' + ident.model).toLowerCase();
      // Search by manufacturer name
      let ads = FAA_ADS.data.filter(ad => {
        const model = (ad.model || '').toLowerCase();
        const title = (ad.title || '').toLowerCase();
        const abs = (ad.abs || '').toLowerCase();
        return model.includes(ident.make?.toLowerCase() || '___') || 
               title.includes(ident.make?.toLowerCase() || '___') ||
               title.includes((ident.model || '___').toLowerCase());
      });
      
      // Sort by date descending
      ads.sort((a, b) => (b.pub || '').localeCompare(a.pub || ''));
      ads = ads.slice(0, 15);
      
      if (ads.length === 0) {
        adContainer.innerHTML = '<div style="color:var(--text-muted);font-style:italic;">No ADs found for this aircraft type</div>';
        return;
      }

      adContainer.innerHTML = ads.map(ad => `
        <div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;color:var(--text-primary);font-size:0.78rem;">${ad.ad || ad.doc}</div>
            <div style="color:var(--text-muted);font-size:0.72rem;margin-top:2px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${ad.abs || ad.title || ''}</div>
          </div>
          <div style="flex-shrink:0;text-align:right;">
            <div style="font-size:0.7rem;color:var(--text-muted);">${ad.pub || ''}</div>
            ${ad.url ? '<a href="' + ad.url + '" target="_blank" rel="noopener" style="font-size:0.7rem;color:#fb923c;text-decoration:none;">View ↗</a>' : ''}
          </div>
        </div>
      `).join('');
    })();
  } catch (e) {
    body.innerHTML = '<div class="empty-state">Error loading details</div>';
    console.error(e);
  }
}

function detailRow(label, value) {
  return `<div class="detail-row"><span class="detail-row-label">${label}</span><span class="detail-row-value">${value ?? '—'}</span></div>`;
}

function openImageLightbox(src) {
  let lb = document.getElementById('imageLightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'imageLightbox';
    lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:2000;cursor:pointer;';
    lb.addEventListener('click', () => lb.style.display = 'none');
    document.body.appendChild(lb);
  }
  lb.innerHTML = `<img src="${src}" style="max-width:92vw;max-height:92vh;border-radius:8px;object-fit:contain;">`;
  lb.style.display = 'flex';
}

// ═══════════════════════════════════════════════════
//  COMPANIES
// ═══════════════════════════════════════════════════

let isCompaniesInitialized = false;

async function loadCompanies() {
  const grid = document.getElementById('companiesGrid');
  grid.innerHTML = '<div class="loading">Loading companies...</div>';

  const name = document.getElementById('compName').value.trim();
  const city = document.getElementById('compCity').value.trim();
  const country = document.getElementById('compCountry').value.trim();
  const body = {};
  if (name) body.name = name;
  if (city) body.city = city;
  if (country) body.country = country;

  if (Object.keys(body).length === 0) {
    if (!isCompaniesInitialized) {
      body.name = 'Aero'; // lazy load default
      document.getElementById('compName').value = 'Aero';
    } else {
      grid.innerHTML = '<div class="empty-state" style="color:var(--accent-cyan);">Please enter at least one search parameter (Name, City, or Country) to search the registry.</div>';
      return;
    }
  }

  isCompaniesInitialized = true;

  try {
    const res = await fetch(`${API}/api/Company/getCompanyList/${TOKEN}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!data.companies || data.companies.length === 0) {
      grid.innerHTML = '<div class="empty-state">No companies found</div>';
      return;
    }

    grid.innerHTML = data.companies.map(c => `
      <div class="comp-card" onclick="showCompanyDetail(${c.companyid})">
        <div class="comp-card-name">${c.name}</div>
        <div class="comp-card-type">${c.entitytype || 'Company'}</div>
        <div class="comp-card-info">
          <span>📍 ${[c.city, c.state, c.country].filter(Boolean).join(', ')}</span>
          ${c.email ? `<span>✉ ${c.email}</span>` : ''}
          ${c.website ? `<span>🔗 ${c.website}</span>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {
    grid.innerHTML = '<div class="empty-state">Error loading companies</div>';
    console.error(e);
  }
}

async function showCompanyDetail(id) {
  const modal = document.getElementById('compDetailModal');
  const body = document.getElementById('compDetailBody');
  modal.classList.remove('hidden');
  body.innerHTML = '<div class="loading">Loading company details...</div>';

  try {
    const res = await fetch(`${API}/api/Company/getCompany/${id}/${TOKEN}`);
    const data = await res.json();
    const comp = data.company;
    if (!comp) { body.innerHTML = '<div class="empty-state">Company not found</div>'; return; }

    const ident = comp.identification || {};
    body.innerHTML = `
      <div class="detail-header">
        <div class="detail-title-group">
          <div class="detail-make">${ident.agencytype || 'Company'}</div>
          <div class="detail-model">${ident.name}</div>
        </div>
      </div>

      <div class="detail-sections">
        <div class="detail-section">
          <div class="detail-section-title">Information</div>
          ${detailRow('Company ID', ident.companyid)}
          ${detailRow('Address', [ident.address1, ident.address2].filter(Boolean).join(', '))}
          ${detailRow('City', ident.city)}
          ${detailRow('State', ident.state)}
          ${detailRow('Country', ident.country)}
          ${detailRow('Postal Code', ident.postcode)}
          ${detailRow('Email', ident.email)}
          ${detailRow('Website', ident.website)}
        </div>

        <div class="detail-section">
          <div class="detail-section-title">Phone Numbers</div>
          ${(comp.phonenumbers || []).map(p => detailRow(p.type, p.number)).join('') || '<div class="td-dim">None</div>'}
          <div style="margin-top:16px">
            <div class="detail-section-title">Business Types</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${(comp.businesstypes || []).map(b => `<span class="badge badge-heli">${b}</span>`).join('') || '<span class="td-dim">—</span>'}
            </div>
          </div>
        </div>

        ${comp.contacts && comp.contacts.length > 0 ? `
        <div class="detail-section full-width">
          <div class="detail-section-title">Contacts</div>
          <table>
            <thead><tr><th>Name</th><th>Title</th><th>Email</th></tr></thead>
            <tbody>
              ${comp.contacts.map(c => `
                <tr>
                  <td class="td-accent">${c.firstname} ${c.lastname}</td>
                  <td>${c.title || '—'}</td>
                  <td class="td-dim">${c.email || '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>` : ''}

        ${comp.aircraftrelationships && comp.aircraftrelationships.length > 0 ? `
        <div class="detail-section full-width">
          <div class="detail-section-title">Aircraft Relationships (${comp.aircraftrelationships.length})</div>
          <table>
            <thead><tr><th>Aircraft ID</th><th>Relationship</th><th>Operator</th></tr></thead>
            <tbody>
              ${comp.aircraftrelationships.slice(0, 20).map(a => `
                <tr>
                  <td class="td-mono td-accent" style="cursor:pointer" onclick="closeModal('compDetailModal');showAircraftDetail(${a.aircraftid})">${a.aircraftid}</td>
                  <td>${a.relationtype}</td>
                  <td>${a.isoperator === 'Y' ? '✓ Yes' : 'No'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>` : ''}
      </div>
    `;
  } catch (e) {
    body.innerHTML = '<div class="empty-state">Error loading details</div>';
    console.error(e);
  }
}

// ═══════════════════════════════════════════════════
//  CONTACTS
// ═══════════════════════════════════════════════════

let isContactsInitialized = false;

async function loadContacts() {
  const container = document.getElementById('contactsTable');
  container.innerHTML = '<div class="loading">Loading contacts...</div>';

  const firstname = document.getElementById('contFirst').value.trim();
  const lastname = document.getElementById('contLast').value.trim();
  const companyname = document.getElementById('contCompany').value.trim();
  const title = document.getElementById('contTitle').value.trim();
  const body = {};
  if (firstname) body.firstname = firstname;
  if (lastname) body.lastname = lastname;
  if (companyname) body.companyname = companyname;
  if (title) body.title = title;

  if (Object.keys(body).length === 0) {
    if (!isContactsInitialized) {
      body.companyname = 'Aviation'; // lazy load default
      document.getElementById('contCompany').value = 'Aviation';
    } else {
      container.innerHTML = '<div class="empty-state" style="color:var(--accent-cyan);">Please enter at least one search parameter (e.g., Last Name or Company) to search the contact directory.</div>';
      return;
    }
  }

  isContactsInitialized = true;

  try {
    const res = await fetch(`${API}/api/Contact/getContactList/${TOKEN}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!data.contacts || data.contacts.length === 0) {
      container.innerHTML = '<div class="empty-state">No contacts found</div>';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Title</th><th>Company</th><th>Email</th><th>Phone</th>
          </tr>
        </thead>
        <tbody>
           ${data.contacts.map(c => `
            <tr>
              <td class="td-accent">${[c.sirname, c.firstname, c.lastname, c.suffix].filter(Boolean).join(' ')}</td>
              <td>${c.title || '—'}</td>
              <td>${c.companyname || '—'}</td>
              <td class="td-dim">${c.email || '—'}</td>
              <td class="td-mono">${c.phonenumber || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="padding:12px;color:var(--text-muted);font-size:0.78rem;">
        ${data.count} contacts
      </div>`;
  } catch (e) {
    container.innerHTML = '<div class="empty-state">Error loading contacts</div>';
    console.error(e);
  }
}

// ═══════════════════════════════════════════════════
//  GLOBE
// ═══════════════════════════════════════════════════

let globeInstance = null;
let globeData = null;
let allClusters = [];
let activeUrgencyFilter = null;

// ICAO airport coordinates for plotting aircraft base locations on globe
// Covers major business aviation airports worldwide [lat, lng]
const ICAO_COORDS = {
  // ── USA Major ──
  KATL:[33.64,-84.43],KBOS:[42.36,-71.01],KORD:[41.97,-87.91],KMDW:[41.79,-87.74],
  KDFW:[32.90,-97.04],KDEN:[39.86,-104.67],KDTW:[42.21,-83.35],KEWR:[40.69,-74.17],
  KJFK:[40.64,-73.78],KLGA:[40.78,-73.87],KLAX:[33.94,-118.41],KLAS:[36.08,-115.15],
  KMIA:[25.79,-80.29],KFLL:[26.07,-80.15],KPBI:[26.68,-80.10],KMSP:[44.88,-93.22],
  KMSY:[29.99,-90.26],KBNA:[36.12,-86.68],KIAH:[29.98,-95.34],KHOU:[29.65,-95.28],
  KPHX:[33.44,-112.01],KPHL:[39.87,-75.24],KPIT:[40.49,-80.23],KPDX:[45.59,-122.60],
  KSLC:[40.79,-111.98],KSFO:[37.62,-122.38],KOAK:[37.72,-122.22],KSJC:[37.36,-121.93],
  KSEA:[47.45,-122.31],KSTL:[38.75,-90.37],KTPA:[27.98,-82.53],KIAD:[38.95,-77.46],
  KDCA:[38.85,-77.04],KBWI:[39.18,-76.67],KCLT:[35.21,-80.94],KRDU:[35.88,-78.79],
  KMCO:[28.43,-81.31],KSAT:[29.53,-98.47],KIND:[39.72,-86.29],KCMH:[39.99,-82.89],
  KMKE:[42.95,-87.90],KCVG:[39.05,-84.66],KAUS:[30.19,-97.67],KJAX:[30.49,-81.69],
  KBDL:[41.94,-72.68],KABQ:[35.04,-106.61],KTUL:[36.20,-95.89],KOMA:[41.30,-95.89],
  KSDF:[38.17,-85.74],KRIC:[37.51,-77.32],KBUF:[42.94,-78.73],KANC:[61.17,-150.00],
  PHNL:[21.32,-157.92],
  // ── USA Business Aviation ──
  KTEB:[40.85,-74.06],KHPN:[41.07,-73.71],KSDL:[33.62,-111.91],KVNY:[34.21,-118.49],
  KFXE:[26.20,-80.17],KAPA:[39.57,-104.85],KADS:[32.97,-96.84],KNEW:[30.04,-90.03],
  KOPF:[25.91,-80.28],KPDK:[33.88,-84.30],KPWK:[42.11,-87.90],KDPA:[41.91,-88.25],
  KAPC:[38.21,-122.28],KASH:[42.78,-71.51],KBED:[42.47,-71.29],KBCT:[26.38,-80.11],
  KBJC:[39.91,-105.12],KCGF:[41.57,-81.49],KCRQ:[33.13,-117.28],KDAL:[32.85,-96.85],
  KFRG:[40.73,-73.41],KGJT:[39.12,-108.53],KHND:[35.97,-115.13],KISP:[40.80,-73.10],
  KGAI:[39.17,-77.17],KLUK:[39.10,-84.42],KLNS:[40.12,-76.30],KMMU:[40.80,-74.42],
  KPTK:[42.67,-83.42],KSGR:[29.62,-95.66],KSWF:[41.50,-74.10],KVGT:[36.21,-115.19],
  KORL:[28.55,-81.33],KRVS:[36.04,-95.98],
  // ── Canada ──
  CYYZ:[43.68,-79.63],CYVR:[49.19,-123.18],CYUL:[45.47,-73.74],CYYC:[51.11,-114.02],
  CYOW:[45.32,-75.67],CYEG:[53.31,-113.58],CYWG:[49.91,-97.24],CYHZ:[44.88,-63.51],
  // ── Europe ──
  EGLL:[51.47,-0.46],EGLF:[51.28,-0.78],EGGW:[51.87,-0.37],EGSS:[51.89,0.24],
  EGKB:[51.33,0.03],EGTK:[51.84,-1.32],
  LFPG:[49.01,2.55],LFPB:[48.97,2.44],LFMN:[43.66,7.22],
  EDDF:[50.03,8.57],EDDM:[48.35,11.79],EDDB:[52.36,13.51],EDDH:[53.63,10.01],
  EHAM:[52.31,4.76],EBBR:[50.90,4.48],LSZH:[47.46,8.55],
  LEMD:[40.47,-3.56],LEBL:[41.30,2.08],
  LIRF:[41.80,12.25],LIMC:[45.63,8.72],LIPZ:[45.51,12.35],
  LPPT:[38.77,-9.13],LOWI:[47.26,11.34],LOWW:[48.11,16.57],
  EKCH:[55.62,12.66],ENGM:[60.19,11.10],ESSA:[59.65,17.94],EFHK:[60.32,24.96],
  EPWA:[52.17,20.97],LKPR:[50.10,14.26],LHBP:[47.43,19.26],
  UUEE:[55.97,37.41],UUDD:[55.41,37.91],
  EGPH:[55.95,-3.37],EIDW:[53.42,-6.27],LSGG:[46.24,6.11],
  // ── Middle East ──
  OMDB:[25.25,55.36],OMAA:[24.44,54.65],OEJN:[21.68,39.16],OERK:[24.96,46.70],
  OTHH:[25.27,51.61],OBBI:[26.27,50.64],OIII:[35.69,51.31],OLBA:[33.82,35.49],
  LLBG:[32.01,34.89],
  // ── Asia Pacific ──
  RJTT:[35.55,139.78],RJBB:[34.43,135.24],RJAA:[35.76,140.39],
  VHHH:[22.31,113.91],WSSS:[1.35,103.99],VTBS:[13.69,100.75],
  WIII:[-6.13,106.66],RPLL:[14.51,121.02],VABB:[19.09,72.87],VIDP:[28.57,77.10],
  RKSI:[37.46,126.44],RCTP:[25.08,121.23],ZBAA:[40.08,116.58],ZPPP:[25.10,102.94],
  VMMC:[22.15,113.59],
  // ── Latin America ──
  MMMX:[19.44,-99.07],MMMY:[25.78,-100.11],MMTJ:[32.54,-116.97],MMUN:[21.04,-86.87],
  SBGR:[23.43,-46.47],SBRJ:[-22.91,-43.16],SBSP:[-23.63,-46.66],
  SKBO:[4.70,-74.15],SCEL:[-33.39,-70.79],SEQM:[-0.13,-78.49],SPJC:[-12.02,-77.11],
  SAEZ:[-34.82,-58.54],SVMI:[10.60,-66.99],SBBR:[-15.87,-47.92],
  MROC:[9.99,-84.21],MPTO:[9.07,-79.38],MUHA:[22.99,-82.41],
  // ── Africa ──
  FAOR:[-26.13,28.23],DNMM:[6.58,3.32],HKJK:[-1.32,36.93],GABS:[14.74,-17.49],
  FALE:[-29.61,31.12],FACT:[-33.96,18.60],GOOY:[14.74,-17.49],
  // ── Oceania ──
  YSSY:[-33.95,151.18],YMML:[-37.67,144.84],NZAA:[-37.01,174.79],
  YBBN:[-27.39,153.12],YPPH:[-31.94,115.97],
};

function clusterByAirport(aircraft) {
  const clusters = {};
  const counts = { critical: 0, overdue: 0, hightime: 0, current: 0 };
  aircraft.forEach(ac => {
    const icao = (ac.baseicao || ac.baseicaocode || '').toUpperCase().trim();
    const coords = ICAO_COORDS[icao];
    if (!coords) return;
    if (!clusters[icao]) clusters[icao] = { icao, lat: coords[0], lng: coords[1], aircraft: [], worstUrgency: 'current', hasHighTime: false, city: '', country: '' };
    const c = clusters[icao];
    c.aircraft.push(ac);
    if (!c.city) c.city = ac.basecity || '';
    if (!c.country) c.country = ac.basecountry || ac.country || '';
    const mro = buildMROSignals(ac);
    if (mro.urgency === 'critical') { c.worstUrgency = 'critical'; counts.critical++; }
    else if (mro.urgency === 'overdue') { if (c.worstUrgency !== 'critical') c.worstUrgency = 'overdue'; counts.overdue++; }
    else if (mro.isHighTime) { c.hasHighTime = true; if (c.worstUrgency === 'current') c.worstUrgency = 'high-time'; counts.hightime++; }
    else { counts.current++; }
  });
  return { clusters: Object.values(clusters), counts };
}

function clusterColor(d) {
  if (d.worstUrgency === 'critical') return '#ff4444';
  if (d.worstUrgency === 'overdue') return '#ef4444';
  if (d.hasHighTime) return '#f59e0b';
  return '#10b981';
}
function clusterRadius(d) { return Math.min(0.6, 0.12 + d.aircraft.length * 0.02); }
function clusterAltitude(d) {
  if (d.worstUrgency === 'critical') return 0.03;
  if (d.worstUrgency === 'overdue') return 0.015;
  if (d.hasHighTime) return 0.008;
  return 0.004; // small offset prevents z-fighting
}

function applyGlobeFilters() {
  if (!globeInstance || !allClusters.length) return;
  const q = (document.getElementById('globeSearch')?.value || '').toLowerCase().trim();
  const typeFilter = document.getElementById('globeTypeFilter')?.value || '';
  let filtered = allClusters;
  if (activeUrgencyFilter) {
    filtered = filtered.filter(c => {
      if (activeUrgencyFilter === 'critical') return c.worstUrgency === 'critical';
      if (activeUrgencyFilter === 'overdue') return c.worstUrgency === 'overdue';
      if (activeUrgencyFilter === 'hightime') return c.hasHighTime;
      if (activeUrgencyFilter === 'current') return c.worstUrgency === 'current' && !c.hasHighTime;
      return true;
    });
  }
  if (typeFilter) filtered = filtered.filter(c => c.aircraft.some(ac => (ac.maketype || '') === typeFilter));
  if (q) {
    filtered = filtered.filter(c =>
      c.icao.toLowerCase().includes(q) || (c.city || '').toLowerCase().includes(q) || (c.country || '').toLowerCase().includes(q) ||
      c.aircraft.some(ac => (ac.regnbr || '').toLowerCase().includes(q) || (ac.make || '').toLowerCase().includes(q) || (ac.model || '').toLowerCase().includes(q) || (ac.owner || ac.operator || '').toLowerCase().includes(q))
    );
    if (filtered.length === 1) globeInstance.pointOfView({ lat: filtered[0].lat, lng: filtered[0].lng, altitude: 1.2 }, 600);
  }
  globeInstance.pointsData(filtered);
}

function setupGlobeSheet() {
  const sheet = document.getElementById('globeSheet');
  const handle = document.getElementById('globeSheetHandle');
  if (!sheet || !handle) return;
  const states = ['', 'half', 'full'];
  let currentState = 0;
  handle.addEventListener('click', () => {
    currentState = (currentState + 1) % states.length;
    sheet.className = 'globe-sheet' + (states[currentState] ? ' ' + states[currentState] : '');
  });
  handle.addEventListener('touchstart', (e) => { handle._startY = e.touches[0].clientY; sheet.style.transition = 'none'; }, { passive: true });
  handle.addEventListener('touchmove', (e) => {
    const dy = e.touches[0].clientY - handle._startY;
    const pct = Math.max(0, Math.min(100, (sheet.offsetHeight - 56 + dy) / sheet.offsetHeight * 100));
    sheet.style.transform = `translateY(${pct}%)`;
  }, { passive: true });
  handle.addEventListener('touchend', () => {
    sheet.style.transition = ''; sheet.style.transform = '';
    const visible = window.innerHeight - sheet.getBoundingClientRect().top;
    if (visible > window.innerHeight * 0.45) { currentState = 2; sheet.className = 'globe-sheet full'; }
    else if (visible > 100) { currentState = 1; sheet.className = 'globe-sheet half'; }
    else { currentState = 0; sheet.className = 'globe-sheet'; }
  });
  document.querySelectorAll('.urgency-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const f = pill.dataset.filter;
      if (activeUrgencyFilter === f) { activeUrgencyFilter = null; pill.classList.remove('active'); }
      else { document.querySelectorAll('.urgency-pill').forEach(p => p.classList.remove('active')); activeUrgencyFilter = f; pill.classList.add('active'); }
      applyGlobeFilters();
    });
  });
  const si = document.getElementById('globeSearch');
  if (si) { let db; si.addEventListener('input', () => { clearTimeout(db); db = setTimeout(applyGlobeFilters, 250); }); }
  document.getElementById('globeTypeFilter')?.addEventListener('change', applyGlobeFilters);
  document.getElementById('globeTextureSelect')?.addEventListener('change', (e) => {
    if (globeInstance) globeInstance.globeImageUrl(e.target.value);
  });
}

function handleGlobeClick(point) {
  if (!point || !point.aircraft) return;
  const sheet = document.getElementById('globeSheet');
  const results = document.getElementById('globeSheetResults');
  sheet.className = 'globe-sheet full';
  results.innerHTML = `<div class="drill-header"><span class="drill-icao">${point.icao}</span>${point.city ? '<span>' + point.city + '</span>' : ''}<span class="drill-count">${point.aircraft.length} aircraft</span></div>` +
    point.aircraft.map(ac => {
      const mro = buildMROSignals(ac);
      const ul = mro.urgency === 'critical' ? 'AOG' : mro.urgency === 'overdue' ? 'Overdue' : mro.isHighTime ? 'High-Time' : 'Current';
      const uc = mro.urgency === 'critical' ? 'critical' : mro.urgency === 'overdue' ? 'overdue' : mro.isHighTime ? 'high-time' : 'current';
      return `<div class="drill-card" onclick="showAircraftDetail(${ac.aircraftid})"><span class="drill-reg">${ac.regnbr || '—'}</span><span class="drill-model">${ac.make || ''} ${ac.model || ''}</span><span class="drill-owner">${ac.owner || ac.operator || ''}</span><span class="drill-urgency badge-${uc}">${ul}</span></div>`;
    }).join('');
  globeInstance.pointOfView({ lat: point.lat, lng: point.lng, altitude: 0.8 }, 800);
}

function handleGlobeHover(point) {
  window._lastGlobePoint = point;
  const tooltip = document.getElementById('globeTooltip');
  const container = document.getElementById('globeContainer');
  if (point) {
    globeInstance.controls().autoRotate = false;
    const ul = point.worstUrgency === 'critical' ? '🔴 AOG' : point.worstUrgency === 'overdue' ? '🟠 Overdue' : point.hasHighTime ? '🟡 High-Time' : '🟢 Current';
    tooltip.innerHTML = `<div class="tt-icao">${point.icao}</div><div class="tt-count">${point.aircraft.length} aircraft</div><div class="tt-urgency">Worst: ${ul}${point.city ? ' · ' + point.city : ''}</div>`;
    tooltip.classList.remove('hidden');
    const mh = (e) => { const r = container.getBoundingClientRect(); tooltip.style.left = Math.min(e.clientX - r.left + 15, r.width - tooltip.offsetWidth - 10) + 'px'; tooltip.style.top = Math.min(e.clientY - r.top + 15, r.height - tooltip.offsetHeight - 10) + 'px'; };
    container._globeMouseMove = mh; container.addEventListener('mousemove', mh);
  } else {
    tooltip.classList.add('hidden');
    const rb = document.getElementById('globeRotateToggle');
    globeInstance.controls().autoRotate = rb && rb.classList.contains('active');
    if (container._globeMouseMove) container.removeEventListener('mousemove', container._globeMouseMove);
  }
}

function handleGlobeResize() {
  if (!globeInstance) return;
  const c = document.getElementById('globeViz');
  if (c) globeInstance.width(c.clientWidth).height(c.clientHeight);
}

async function loadGlobe() {
  const container = document.getElementById('globeViz');
  if (!globeInstance) container.innerHTML = '<div class="loading" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:5;">Loading globe...</div>';

  const body = {};
  try {
    const res = await fetch(`${API}/api/Aircraft/getAircraftList/${TOKEN}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.responsestatus && data.responsestatus !== 'Success' && data.responsestatus !== 'SUCCESS') { container.innerHTML = `<div class="empty-state">API Error: ${data.responsestatus}</div>`; return; }
    const aircraft = data.aircraft || [];
    const { clusters, counts } = clusterByAirport(aircraft);
    allClusters = clusters;
    globeData = { totalAircraft: aircraft.length, mappedAircraft: clusters.reduce((s, c) => s + c.aircraft.length, 0), byCountry: {}, counts };
    clusters.forEach(c => { if (c.country) globeData.byCountry[c.country] = true; });
  } catch (e) { console.error('Globe data fetch failed:', e); container.innerHTML = '<div class="empty-state" style="color:var(--text-danger);">Could not load aircraft registry data.</div>'; return; }

  document.getElementById('globeTotal').textContent = globeData.totalAircraft.toLocaleString();
  document.getElementById('globeMapped').textContent = globeData.mappedAircraft.toLocaleString();
  document.getElementById('globeCountries').textContent = Object.keys(globeData.byCountry).length;
  const cn = globeData.counts;
  const pe = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  pe('pillCritical', cn.critical); pe('pillOverdue', cn.overdue); pe('pillHighTime', cn.hightime); pe('pillCurrent', cn.current);

  if (!globeInstance) {
    container.innerHTML = '';
    globeInstance = Globe()
      .globeImageUrl('earth-night.jpg')
      .bumpImageUrl('earth-topology.png')
      .backgroundImageUrl('night-sky.png')
      .pointsData(allClusters).pointLat('lat').pointLng('lng')
      .pointAltitude(clusterAltitude).pointRadius(clusterRadius).pointColor(clusterColor)
      .pointsMerge(false).onPointHover(handleGlobeHover).onPointClick(handleGlobeClick)
      .atmosphereColor('#00d4ff').atmosphereAltitude(0.2).showGraticules(true)
      .width(container.clientWidth).height(container.clientHeight)(container);
    globeInstance.controls().autoRotate = false; globeInstance.controls().autoRotateSpeed = 0.4;
    globeInstance.controls().enableDamping = true; globeInstance.controls().dampingFactor = 0.1;
    globeInstance.pointOfView({ lat: 30, lng: -20, altitude: 2.2 }, 1000);
    window.addEventListener('resize', handleGlobeResize);
    const rotateBtn = document.getElementById('globeRotateToggle');
    rotateBtn.addEventListener('click', () => { const c = globeInstance.controls(); c.autoRotate = !c.autoRotate; rotateBtn.classList.toggle('active', c.autoRotate); });
    const gw = document.getElementById('globeContainer');
    if (!gw._globeClickBound) { gw._globeClickBound = true; gw.addEventListener('click', (e) => { if (e.target.closest('.globe-sheet') || e.target.closest('.globe-tooltip')) return; if (window._lastGlobePoint?.icao) handleGlobeClick(window._lastGlobePoint); }); }
    setupGlobeSheet();
  } else {
    globeInstance.pointsData(allClusters).pointColor(clusterColor).pointRadius(clusterRadius).pointAltitude(clusterAltitude);
  }
}

// ═══════════════════════════════════════════════════
//  DOCS
// ═══════════════════════════════════════════════════

let _docsCatalog = null;
let _docsCurrentView = 'root';
let _docsCurrentAircraft = null;
let _docsCurrentManual = null;

async function loadDocs() {
  if (_docsCatalog) { renderDocsGrid(_docsCatalog); return; }
  try {
    const res = await fetch('display_index/catalog.json');
    _docsCatalog = await res.json();
    const sidebar = document.getElementById('docs-manufacturer-list');
    const mfrs = {};
    _docsCatalog.forEach(a => { const m = a.manufacturer || 'Unknown'; if (!mfrs[m]) mfrs[m] = 0; mfrs[m]++; });
    sidebar.innerHTML = Object.entries(mfrs).sort((a,b) => b[1]-a[1]).map(([m,c]) =>
      `<div style="padding:10px 12px;border-radius:6px;color:var(--text-muted);margin-bottom:6px;cursor:pointer;font-size:0.85rem;" onmouseover="this.style.background='rgba(0,212,255,0.08)'" onmouseout="this.style.background=''" onclick="docsFilterMfr('${m.replace(/'/g,"\\'")}')">${m} <span style="float:right;opacity:0.5;">${c}</span></div>`
    ).join('');
    renderDocsGrid(_docsCatalog);
  } catch(e) { document.getElementById('docs-content').innerHTML = '<div class="empty-state">Could not load catalog. Ensure display_index/catalog.json is present.</div>'; }
}

function renderDocsGrid(list) {
  _docsCurrentView = 'root';
  document.getElementById('docs-breadcrumb').innerHTML = '<span style="color:var(--accent-cyan);font-weight:500;">All Aircraft</span> <span style="margin-left:8px;color:var(--text-muted);">' + list.length + ' aircraft</span>';
  document.getElementById('docs-content').innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">' +
    list.map(a => {
      const mc = a.manual_count || 0, cc = a.total_chapters || 0;
      return `<div class="ac-card" style="cursor:pointer;" onclick="loadAircraftManuals('${a.id}')">
        <div class="ac-card-header"><div><div class="ac-card-make">${a.manufacturer}</div><div class="ac-card-model">${a.aircraft}</div></div><span class="badge badge-jet">${mc} manuals</span></div>
        <div class="ac-card-details"><div class="ac-card-detail"><span class="ac-card-detail-label">Chapters</span><span class="ac-card-detail-value">${cc}</span></div></div></div>`;
    }).join('') + '</div>';
}

async function loadAircraftManuals(id) {
  document.getElementById('docs-content').innerHTML = '<div class="loading">Loading manuals...</div>';
  try {
    const res = await fetch('display_index/' + id + '.json');
    const data = await res.json();
    _docsCurrentAircraft = { id, data };
    _docsCurrentView = 'aircraft';
    document.getElementById('docs-breadcrumb').innerHTML =
      '<span style="cursor:pointer;color:var(--accent-cyan);" onclick="docsNavigate(\'root\')">All Aircraft</span><span style="margin:0 6px;">›</span><span style="color:var(--text-main);font-weight:500;">' + data.manufacturer + ' ' + data.aircraft + '</span>';
    const manuals = data.manuals || {};
    const keys = Object.keys(manuals);
    document.getElementById('docs-content').innerHTML = '<div style="max-width:800px;">' + keys.map((name, idx) => {
      const chapters = Object.keys(manuals[name]);
      const headerId = 'docs-manual-' + idx;
      const listId = 'docs-chapters-' + idx;
      return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;margin-bottom:12px;overflow:hidden;">
        <div class="docs-manual-header" id="${headerId}" aria-expanded="false" onclick="docsToggleManual('${headerId}','${listId}')">
          <div><div style="color:var(--text-main);font-weight:600;">${name}</div><div style="color:var(--text-muted);font-size:0.8rem;margin-top:4px;">${chapters.length} chapters</div></div>
          <span class="docs-chevron">▸</span></div>
        <div class="docs-chapter-list" id="${listId}">` +
        chapters.map(ch => {
          const c = manuals[name][ch];
          return `<div class="docs-chapter-item" onclick="loadChapter('${id}','${name.replace(/'/g,"\\'")}','${ch.replace(/'/g,"\\'")}')">
            <span>${ch}</span>
            <span>${c.ata ? 'ATA '+c.ata : ''} ${((c.char_count||0)/1000).toFixed(0)}K</span></div>`;
        }).join('') + '</div></div>';
    }).join('') + '</div>';
  } catch(e) { document.getElementById('docs-content').innerHTML = '<div class="empty-state">Could not load manuals for this aircraft.</div>'; }
}

function docsToggleManual(headerId, listId) {
  const header = document.getElementById(headerId);
  const list = document.getElementById(listId);
  const isOpen = header.getAttribute('aria-expanded') === 'true';
  header.setAttribute('aria-expanded', !isOpen);
  list.classList.toggle('docs-open', !isOpen);
}

function loadChapter(aircraftId, manualName, chapterKey) {
  if (!_docsCurrentAircraft || _docsCurrentAircraft.id !== aircraftId) return;
  const data = _docsCurrentAircraft.data;
  const chapter = data.manuals?.[manualName]?.[chapterKey];
  if (!chapter) return;
  _docsCurrentView = 'chapter'; _docsCurrentManual = manualName;
  document.getElementById('docs-breadcrumb').innerHTML =
    '<span style="cursor:pointer;color:var(--accent-cyan);" onclick="docsNavigate(\'root\')">All Aircraft</span><span style="margin:0 6px;">›</span>' +
    '<span style="cursor:pointer;color:var(--accent-cyan);" onclick="loadAircraftManuals(\'' + aircraftId + '\')">' + data.manufacturer + ' ' + data.aircraft + '</span><span style="margin:0 6px;">›</span>' +
    '<span style="color:var(--text-main);font-weight:500;">' + chapterKey + '</span>';
  const text = (chapter.text || 'No content available.').replace(/\n/g, '<br>');
  let imagesHtml = '';
  const imgs = chapter.images || [];
  if (imgs.length > 0) {
    const resolved = imgs.map(p => { const ext = p.split('.').pop().toLowerCase(); const hash = _md5(p).substring(0,10); return { src: 'rag_images/' + hash + '.' + ext, caption: p.split('/').pop() }; });
    imagesHtml = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;padding:12px;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.15);border-radius:10px;">
      <div style="width:100%;font-size:11px;color:#8b949e;font-weight:600;letter-spacing:0.5px;margin-bottom:4px;">📎 ${resolved.length} DIAGRAM${resolved.length>1?'S':''} FROM MAINTENANCE MANUALS</div>
      ${resolved.map(img => `<div style="position:relative;border-radius:8px;overflow:hidden;border:1px solid rgba(99,102,241,0.2);cursor:pointer;max-width:160px;" onclick="openImageLightbox('${img.src}')">
        <img src="${img.src}" alt="${img.caption}" style="width:100%;height:auto;display:block;" loading="lazy" onerror="this.parentElement.style.display='none'">
        <div style="font-size:9px;color:#8b949e;padding:3px 6px;background:rgba(13,17,23,0.9);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${img.caption}</div></div>`).join('')}</div>`;
  }
  document.getElementById('docs-content').innerHTML = `<div class="docs-reader">
    <div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border);"><h2 class="docs-reader-title">${chapterKey}</h2>
      <div class="docs-reader-meta">${chapter.ata ? 'ATA ' + chapter.ata + ' • ' : ''}${manualName} • ${(chapter.char_count||0).toLocaleString()} characters${imgs.length ? ' • ' + imgs.length + ' diagrams' : ''}</div>
      ${chapter.source ? '<div class="docs-reader-meta">Source: ' + chapter.source + '</div>' : ''}</div>
    ${imagesHtml}
    <div class="docs-reader-text">${text}</div></div>`;
}

function _md5(s){var h=[0x67452301,0xEFCDAB89,0x98BADCFE,0x10325476],K=[],i;for(i=0;i<64;i++)K[i]=Math.floor(Math.abs(Math.sin(i+1))*4294967296);var S=[[7,12,17,22],[5,9,14,20],[4,11,16,23],[6,10,15,21]];var b=[];for(i=0;i<s.length;i++){b.push(s.charCodeAt(i));}var origLen=b.length*8;b.push(0x80);while(b.length%64!==56)b.push(0);var lo=origLen>>>0,hi=0;b.push(lo&0xff,lo>>>8&0xff,lo>>>16&0xff,lo>>>24&0xff);b.push(hi&0xff,hi>>>8&0xff,hi>>>16&0xff,hi>>>24&0xff);for(var off=0;off<b.length;off+=64){var M=[];for(i=0;i<16;i++)M[i]=(b[off+i*4])|(b[off+i*4+1]<<8)|(b[off+i*4+2]<<16)|(b[off+i*4+3]<<24);var a=h[0],bb=h[1],c=h[2],d=h[3];for(i=0;i<64;i++){var g,F;if(i<16){F=(bb&c)|((~bb)&d);g=i;}else if(i<32){F=(d&bb)|((~d)&c);g=(5*i+1)%16;}else if(i<48){F=bb^c^d;g=(3*i+5)%16;}else{F=c^(bb|(~d));g=(7*i)%16;}var r=Math.floor(i/16);var tmp=d;d=c;c=bb;var x=((a+F+K[i]+(M[g]>>>0))>>>0);var ss=S[r][i%4];bb=(bb+(((x<<ss)|(x>>>(32-ss)))>>>0))>>>0;a=tmp;}h[0]=(h[0]+a)>>>0;h[1]=(h[1]+bb)>>>0;h[2]=(h[2]+c)>>>0;h[3]=(h[3]+d)>>>0;}var hex='';for(i=0;i<4;i++)for(var j=0;j<4;j++)hex+=('0'+((h[i]>>>(j*8))&0xff).toString(16)).slice(-2);return hex;}

function docsNavigate(target) {
  if (target === 'root') { if (_docsCatalog) renderDocsGrid(_docsCatalog); }
  else if (target === 'aircraft' && _docsCurrentAircraft) loadAircraftManuals(_docsCurrentAircraft.id);
}

function docsFilterMfr(mfr) {
  if (!_docsCatalog) return;
  renderDocsGrid(_docsCatalog.filter(a => a.manufacturer === mfr));
}

function docsSearch(q) {
  if (!_docsCatalog) return;
  if (!q) { renderDocsGrid(_docsCatalog); return; }
  q = q.toLowerCase();
  renderDocsGrid(_docsCatalog.filter(a => (a.manufacturer + ' ' + a.aircraft).toLowerCase().includes(q)));
}

// ═══════════════════════════════════════════════════
//  ACTIVITY
// ═══════════════════════════════════════════════════

// ── Shared MRO Signal Builder ──
function buildMROSignals(ac) {
  const aftt = ac.aftt || ac.estaftt || 0;
  const isHighTime = aftt > 8000;
  const isForSale = ac.forsale === true || ac.forsale === 'true';
  const lifecycle = ac.lifecycle || '';
  const isAOG = lifecycle.toUpperCase().includes('AOG');
  
  let urgency = 'current';
  if (isAOG) urgency = 'critical';
  else if (isHighTime && aftt > 12000) urgency = 'overdue';
  else if (isHighTime) urgency = 'due-soon';
  
  return {
    aftt, isHighTime, isForSale, isAOG, lifecycle, urgency,
    maintProgram: ac.maintenance?.airframemaintenanceprogram || ac.maintenanceprogram || '—'
  };
}

async function loadActivity() {
  const feed = document.getElementById('activityFeed');
  feed.innerHTML = '<div class="loading">Scanning fleet for MRO leads...</div>';

  try {
    // Use JetNet aircraft search with MRO filters
    const body = {};
    const urgencyFilter = document.getElementById('mroUrgencyFilter')?.value || '';
    const typeFilter = document.getElementById('mroTypeFilter')?.value || '';
    const regionFilter = document.getElementById('mroRegionFilter')?.value || '';

    if (typeFilter) body.makeType = typeFilter;
    if (regionFilter) body.country = regionFilter;
    if (urgencyFilter === 'for-sale') body.isForSale = true;

    const res = await fetch(API + '/api/aircraft/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': BEARER },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    const acList = data.aircraft || [];

    // Compute MRO signals for each aircraft
    const signals = acList.map(ac => ({ ...ac, mro: buildMROSignals(ac) }));
    // Cache for LLM context injection (dual-role: maintenance + outreach)
    cachedFleetSignals = signals;

    // Apply urgency filter client-side
    let filtered = signals;
    if (urgencyFilter === 'high-time') {
      filtered = signals.filter(ac => ac.mro.isHighTime);
    } else if (urgencyFilter === 'for-sale') {
      filtered = signals.filter(ac => ac.mro.isForSale);
    }

    // Sort by AFTT descending (highest-time aircraft first = most likely to need service)
    filtered.sort((a, b) => b.mro.aftt - a.mro.aftt);

    // Update MRO stats
    const highTimeCount = signals.filter(ac => ac.mro.isHighTime).length;
    const forSaleCount = signals.filter(ac => ac.mro.isForSale).length;
    const totalAFTT = signals.reduce((sum, ac) => sum + ac.mro.aftt, 0);
    const avgAFTT = signals.length > 0 ? Math.round(totalAFTT / signals.length) : 0;

    const statEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = typeof val === 'number' ? val.toLocaleString() : val; };
    statEl('statHighTime', highTimeCount);
    statEl('statMROForSale', forSaleCount);
    statEl('statAvgAFTT', avgAFTT);
    statEl('statMROFleet', signals.length);

    if (filtered.length === 0) {
      feed.innerHTML = '<div class="empty-state">No aircraft matching MRO criteria</div>';
      return;
    }

    // Render MRO lead cards
    feed.innerHTML = filtered.slice(0, 50).map(ac => renderMROCard(ac)).join('');
  } catch (e) {
    feed.innerHTML = '<div class="empty-state">Error scanning fleet: ' + e.message + '</div>';
    console.error(e);
  }
}

function renderMROCard(ac) {
  const m = ac.mro;
  const reg = ac.regnbr || '—';
  const base = ac.baseicao || ac.basecity || '—';
  const year = ac.yearmfg || ac.yearmfr || '—';
  
  const urgencyBadge = m.urgency === 'critical' ? '<span class="badge badge-aog">AOG</span>'
    : m.urgency === 'overdue' ? '<span class="badge badge-overdue">HIGH-TIME 12K+</span>'
    : m.isHighTime ? '<span class="badge badge-due-soon">HIGH-TIME</span>'
    : '<span class="badge badge-current">CURRENT</span>';

  const forSaleBadge = m.isForSale ? '<span class="badge badge-forsale">FOR SALE</span>' : '';

  return `
    <div class="mro-card" onclick="showAircraftDetail(${ac.aircraftid})">
      <div class="mro-card-header">
        <div class="mro-card-aircraft">
          <div class="mro-card-make">${ac.make || '—'}</div>
          <div class="mro-card-model">${ac.model || '—'}</div>
        </div>
        <div class="mro-card-reg">${reg}</div>
      </div>
      <div class="mro-card-metrics">
        <div class="mro-metric">
          <span class="mro-metric-label">AFTT</span>
          <span class="mro-metric-value ${m.isHighTime ? 'mro-metric-warn' : ''}">${m.aftt.toLocaleString()}</span>
        </div>
        <div class="mro-metric">
          <span class="mro-metric-label">Year</span>
          <span class="mro-metric-value">${year}</span>
        </div>
        <div class="mro-metric">
          <span class="mro-metric-label">Base</span>
          <span class="mro-metric-value">${base}</span>
        </div>
        <div class="mro-metric">
          <span class="mro-metric-label">Program</span>
          <span class="mro-metric-value">${m.maintProgram}</span>
        </div>
      </div>
      <div class="mro-card-badges">
        ${urgencyBadge}
        ${forSaleBadge}
        <span class="badge badge-lifecycle">${ac.lifecycle || ac.maketype || '—'}</span>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════
//  PROSPECTING
// ═══════════════════════════════════════════════════

async function loadProspecting() {
  var grid = document.getElementById('prospectGrid');
  grid.innerHTML = '<div class="loading">Loading prospects...</div>';

  var tier = document.getElementById('prospectTier') ? document.getElementById('prospectTier').value : '';
  var status = document.getElementById('prospectStatus') ? document.getElementById('prospectStatus').value : '';

  try {
    var data = { 
       stats: { new: 4, contacted: 12, quoted: 3, won: 1 },
       prospects: [
         { company: 'Acme Aviation', contact: 'John Smith', tier: 'A', status: 'Hot', interest: 'Fleet Expansion' },
         { company: 'SkyHigh Charter', contact: 'Jane Doe', tier: 'B', status: 'Warm', interest: 'Heavy Maintenance' }
       ]
    };

    // Update stats
    document.getElementById('statNewProspects').textContent = (data.stats && data.stats.new) || 0;
    document.getElementById('statContacted').textContent = (data.stats && data.stats.contacted) || 0;
    document.getElementById('statQuoted').textContent = (data.stats && data.stats.quoted) || 0;
    document.getElementById('statWon').textContent = (data.stats && data.stats.won) || 0;

    if (!data.prospects || data.prospects.length === 0) {
      grid.innerHTML = '<div class="empty-state">No prospects found</div>';
      return;
    }

    var html = data.prospects.map(function(p) {
      var tierClass = p.tier === 'A' ? 'badge-forsale' : p.tier === 'B' ? 'badge-jet' : 'badge-heli';
      return '<div class="ac-card">' +
        '<div class="ac-card-header">' +
          '<div>' +
            '<div class="ac-card-make">' + (p.company || 'Unknown') + '</div>' +
            '<div class="ac-card-model">' + (p.contact || '') + '</div>' +
          '</div>' +
          '<span class="badge ' + tierClass + '">Tier ' + (p.tier || 'C') + '</span>' +
        '</div>' +
        '<div class="ac-card-details">' +
          '<div class="ac-card-detail">' +
            '<span class="ac-card-detail-label">Status</span>' +
            '<span class="ac-card-detail-value">' + (p.status || 'New') + '</span>' +
          '</div>' +
          '<div class="ac-card-detail">' +
            '<span class="ac-card-detail-label">Interest</span>' +
            '<span class="ac-card-detail-value">' + (p.interest || '—') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    grid.innerHTML = html;
  } catch (e) {
    grid.innerHTML = '<div class="empty-state">Error loading prospects</div>';
    console.error(e);
  }
}

// ═══════════════════════════════════════════════════
//  BASES
// ═══════════════════════════════════════════════════

async function loadBases() {
  var grid = document.getElementById('basesGrid');
  grid.innerHTML = '<div class="loading">Loading service bases...</div>';

  try {
    var data = {
       bases: [
         { name: 'Advanced AOG Primary', city: 'Atlanta', state: 'GA', country: 'USA', type: 'MRO', capability: 'Heavy Maintenance' },
         { name: 'Teterboro Line Station', city: 'Teterboro', state: 'NJ', country: 'USA', type: 'Line Station', capability: 'AOG Rescue' }
       ]
    };

    if (!data.bases || data.bases.length === 0) {
      grid.innerHTML = '<div class="empty-state">No service bases configured</div>';
      return;
    }

    var html = data.bases.map(function(b) {
      var location = [b.city, b.state, b.country].filter(Boolean).join(', ');
      return '<div class="comp-card">' +
        '<div class="comp-card-name">' + (b.name || 'Service Base') + '</div>' +
        '<div class="comp-card-type">' + (b.type || 'MRO') + '</div>' +
        '<div class="comp-card-info">' +
          '<span>📍 ' + location + '</span>' +
          (b.capability ? '<span>🔧 ' + b.capability + '</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');
    grid.innerHTML = html;
  } catch (e) {
    grid.innerHTML = '<div class="empty-state">Error loading bases</div>';
    console.error(e);
  }
}

// ═══════════════════════════════════════════════════
//  COMPLIANCE
// ═══════════════════════════════════════════════════

async function loadCompliance() {
  var grid = document.getElementById('complianceGrid');
  grid.innerHTML = '<div class="loading">Loading compliance data...</div>';

  var status = document.getElementById('complianceStatus') ? document.getElementById('complianceStatus').value : '';
  var type = document.getElementById('complianceType') ? document.getElementById('complianceType').value : '';

  try {
    var data = {
       stats: { overdue: 1, dueSoon: 2, compliant: 45, activeADs: 12 },
       items: [
         { aircraft: 'N100GS', type: 'FAR 91.411', status: 'due-soon', description: 'Altimeter and Pitot Static System Inspection', dueDate: '2026-04-15' },
         { aircraft: 'N750GL', type: 'AD 2024-11-05', status: 'overdue', description: 'Engine Fan Blade Inspection', dueDate: '2026-03-01' }
       ]
    };

    // Update stats
    document.getElementById('statOverdue').textContent = (data.stats && data.stats.overdue) || 0;
    document.getElementById('statDueSoon').textContent = (data.stats && data.stats.dueSoon) || 0;
    document.getElementById('statCompliant').textContent = (data.stats && data.stats.compliant) || 0;
    document.getElementById('statADs').textContent = (data.stats && data.stats.activeADs) || 0;

    if (!data.items || data.items.length === 0) {
      grid.innerHTML = '<div class="empty-state">No compliance items found</div>';
      return;
    }

    var html = data.items.map(function(item) {
      var statusClass = item.status === 'overdue' ? 'badge-forsale' 
        : item.status === 'due-soon' ? 'badge-turbo' 
        : 'badge-heli';
      return '<div class="ac-card">' +
        '<div class="ac-card-header">' +
          '<div>' +
            '<div class="ac-card-make">' + (item.aircraft || 'N/A') + '</div>' +
            '<div class="ac-card-model">' + (item.type || 'AD') + '</div>' +
          '</div>' +
          '<span class="badge ' + statusClass + '">' + (item.status || 'Unknown') + '</span>' +
        '</div>' +
        '<div class="ac-card-details">' +
          '<div class="ac-card-detail">' +
            '<span class="ac-card-detail-label">Due Date</span>' +
            '<span class="ac-card-detail-value">' + (item.dueDate || '—') + '</span>' +
          '</div>' +
          '<div class="ac-card-detail">' +
            '<span class="ac-card-detail-label">Description</span>' +
            '<span class="ac-card-detail-value">' + (item.description || '—') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    grid.innerHTML = html;
  } catch (e) {
    grid.innerHTML = '<div class="empty-state">Error loading compliance</div>';
    console.error(e);
  }
}

// ═══════════════════════════════════════════════════
//  MARKETPLACE
// ═══════════════════════════════════════════════════

async function loadMarketplace() {
  var grid = document.getElementById('vendorGrid');

  // Static mock vendors — always available, no API needed
  var mockVendors = [
    { name: 'AeroParts Global', capability: 'OEM Parts', city: 'Miami', country: 'USA', rating: 4.9, capabilities: ['CFM56', 'APU', 'Landing Gear'] },
    { name: 'SkyTech MRO', capability: 'Heavy Maintenance', city: 'Singapore', country: 'SG', rating: 4.7, capabilities: ['A320', 'B737', 'Avionics'] },
    { name: 'JetSpares Ltd', capability: 'Rotable Exchange', city: 'London', country: 'UK', rating: 4.8, capabilities: ['Hydraulics', 'Pneumatics', 'Fuel Systems'] },
    { name: 'Atlas Composites', capability: 'Structural Repair', city: 'Hamburg', country: 'DE', rating: 4.6, capabilities: ['Composite Repair', 'NDT', 'Sheet Metal'] },
    { name: 'Pacific Avionics', capability: 'Avionics', city: 'Sydney', country: 'AU', rating: 4.5, capabilities: ['FMS', 'TCAS', 'Weather Radar'] },
    { name: 'TurboPower Solutions', capability: 'Engine Services', city: 'Dallas', country: 'USA', rating: 4.8, capabilities: ['PW4000', 'GE90', 'LEAP-1B'] },
  ];

  var search = document.getElementById('vendorSearch') ? document.getElementById('vendorSearch').value.toLowerCase() : '';
  var capability = document.getElementById('vendorCapability') ? document.getElementById('vendorCapability').value : '';

  var filtered = mockVendors.filter(function(v) {
    if (search && v.name.toLowerCase().indexOf(search) === -1) return false;
    if (capability && v.capability !== capability) return false;
    return true;
  });

  // Update stats
  if (document.getElementById('statTotalVendors')) document.getElementById('statTotalVendors').textContent = filtered.length;
  if (document.getElementById('statReferrals')) document.getElementById('statReferrals').textContent = 12;
  if (document.getElementById('statCommission')) document.getElementById('statCommission').textContent = '$2,450';

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state">No vendors match your search</div>';
    return;
  }

  var html = filtered.map(function(v) {
    var location = [v.city, v.country].filter(Boolean).join(', ');
    var caps = (v.capabilities || []).map(function(c) { 
      return '<span class="badge badge-jet" style="margin:2px">' + c + '</span>'; 
    }).join('');
    return '<div class="comp-card">' +
      '<div class="comp-card-name">' + v.name + '</div>' +
      '<div class="comp-card-type">' + v.capability + '</div>' +
      '<div class="comp-card-info">' +
        '<span>📍 ' + location + '</span>' +
        '<span>★ ' + v.rating + '</span>' +
      '</div>' +
      '<div style="margin-top:8px">' + caps + '</div>' +
    '</div>';
  }).join('');
  grid.innerHTML = html;
}
