// MXGenius - Frontend Application
// Auto-login, tab routing, API calls, dynamic rendering

const API = MXApplicationClient.API_BASE;
let TOKEN = '';
let BEARER = '';
let cachedFleetSignals = [];

function escapeMarkup(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeRecordId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
}

function safeImageUrl(value) {
  try {
    const url = new URL(String(value || ''), window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

// Stable application boundary for the embedded 3D viewer. Canonical case and
// component identifiers can be mounted here without coupling them to Three.js.
const MX3DViewer = {
  context: {},
  pendingSelector: null,
  tutorial: null,

  frame() {
    return document.getElementById('viewer-iframe');
  },

  ensureLoaded() {
    const frame = this.frame();
    if (frame?.dataset.src && (!frame.getAttribute('src') || frame.getAttribute('src') === 'about:blank')) {
      frame.src = frame.dataset.src;
    }
    return frame;
  },

  post(message) {
    const frame = this.ensureLoaded();
    frame?.contentWindow?.postMessage(message, window.location.origin);
  },

  setContext(context = {}) {
    this.context = { ...context };
    this.post({ type: 'mxgenius.viewer.set-context', context: this.context });
  },

  highlightPart(selector, context) {
    if (context) this.setContext(context);
    this.pendingSelector = selector ? { ...selector } : null;
    if (this.pendingSelector) {
      this.post({ type: 'mxgenius.viewer.highlight-part', selector: this.pendingSelector });
    }
  },

  setTutorial(tutorial, context) {
    if (context) this.setContext(context);
    this.tutorial = tutorial && typeof tutorial === 'object' ? { ...tutorial } : null;
    this.post({ type: 'mxgenius.viewer.set-tutorial', tutorial: this.tutorial });
  },

  clearSelection() {
    this.pendingSelector = null;
    this.post({ type: 'mxgenius.viewer.clear-selection' });
  }
};

window.MX3DViewer = MX3DViewer;

const MXCaseState = {
  active: null,
  normalizeRegistration(value) {
    return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  },
  matchesAircraft(aircraft) {
    if (!this.active || !aircraft) return false;
    const aircraftId = String(aircraft.aircraftid || aircraft.aircraft_id || '');
    if (aircraftId && aircraftId === String(this.active.case?.aircraft_id || '')) return true;
    return this.normalizeRegistration(aircraft.regnbr || aircraft.registration) === this.active.registration;
  },
  set(detail) {
    const matches = detail?.aircraft?.matches || [];
    const canonical = matches.find((match) => match.aircraft_id === detail?.case?.aircraft_id) || matches[0] || {};
    this.active = { ...detail, registration: this.normalizeRegistration(canonical.registration) };
    const card = document.getElementById('activeCaseCard');
    const value = document.getElementById('activeCaseValue');
    const label = document.getElementById('activeCaseLabel');
    if (card) card.dataset.state = 'active';
    if (value) value.textContent = canonical.registration || 'Case';
    if (label) label.textContent = `${detail.case?.status || 'open'} · v${detail.case?.version ?? '—'}`;
    const nav = document.getElementById('caseNav');
    if (nav) {
      nav.dataset.activeCaseId = detail.caseId || '';
      nav.title = `Active maintenance case ${detail.caseId || ''}`;
    }
    document.querySelectorAll('.ac-card[data-aircraft-reg]').forEach((element) => {
      const matched = element.dataset.aircraftReg === encodeURIComponent(this.registration);
      element.dataset.hasActiveCase = String(matched);
      const existing = element.querySelector('.case-card-badge');
      if (matched && !existing) {
        const badge = document.createElement('span');
        badge.className = 'badge badge-jet case-card-badge';
        badge.textContent = 'ACTIVE CASE';
        element.querySelector('.ac-card-badges')?.appendChild(badge);
      } else if (!matched) {
        existing?.remove();
      }
    });
    if (allClusters.length) {
      allClusters.forEach((cluster) => {
        cluster.hasActiveCase = cluster.aircraft.some((aircraft) => this.matchesAircraft(aircraft));
      });
      if (globeInstance) {
        globeInstance
          .pointsData(allClusters)
          .ringsData(attentionClusters(allClusters))
          .pointColor(clusterColor)
          .pointRadius(clusterRadius)
          .pointAltitude(clusterAltitude);
        const cluster = allClusters.find((item) => item.hasActiveCase);
        if (cluster) globeInstance.pointOfView({ lat: cluster.lat, lng: cluster.lng, altitude: 1.1 }, 700);
      }
      const activeCount = document.getElementById('pillActiveCase');
      if (activeCount) activeCount.textContent = allClusters.some((cluster) => cluster.hasActiveCase) ? '1' : '0';
    }
  }
};

window.MXCaseState = MXCaseState;

window.addEventListener('message', (event) => {
  const frame = MX3DViewer.frame();
  if (!frame || event.source !== frame.contentWindow || event.origin !== window.location.origin) return;
  const message = event.data || {};
  if (message.type === 'mxgenius.viewer.ready') {
    MX3DViewer.post({ type: 'mxgenius.viewer.set-context', context: MX3DViewer.context });
    if (MX3DViewer.tutorial) {
      MX3DViewer.post({ type: 'mxgenius.viewer.set-tutorial', tutorial: MX3DViewer.tutorial });
    }
    if (MX3DViewer.pendingSelector) {
      MX3DViewer.post({ type: 'mxgenius.viewer.highlight-part', selector: MX3DViewer.pendingSelector });
    }
  }
  if (message.type === 'mxgenius.viewer.part-selected') {
    window.dispatchEvent(new CustomEvent('mxgenius:part-selected', { detail: message.detail }));
  }
  if (message.type === 'mxgenius.viewer.xr-action') {
    window.dispatchEvent(new CustomEvent('mxgenius:xr-action', { detail: message.detail }));
  }
});

window.addEventListener('mxg:case-selected', (event) => {
  const selected = event.detail || {};
  MXCaseState.set(selected);
  const caseState = selected.case || {};
  document.documentElement.dataset.activeCaseId = selected.caseId || '';
  MX3DViewer.setContext({
    caseId: selected.caseId || null,
    aircraftId: caseState.aircraft_id || null,
    caseVersion: caseState.version ?? null
  });
});

// Source-backed fleet attributes used for triage. AFTT bands are descriptive
// screening metadata, not maintenance-due findings or regulatory determinations.
function buildMROSignals(aircraft) {
  const aftt = Number(aircraft.aftt || aircraft.estaftt || 0) || 0;
  const isHighTime = aftt > 8000;
  const isVeryHighTime = aftt > 12000;
  const isForSale = aircraft.forsale === true || aircraft.forsale === 'true';
  const lifecycle = aircraft.lifecycle || '';
  const isAOG = lifecycle.toUpperCase().includes('AOG');

  return {
    aftt,
    isHighTime,
    isVeryHighTime,
    isForSale,
    isAOG,
    lifecycle,
    maintProgram: aircraft.maintenance?.airframemaintenanceprogram || aircraft.maintenanceprogram || '—'
  };
}

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
    const [catalogResult, imageMapResult] = await Promise.allSettled([
        MXApplicationClient.staticJson('display_index/catalog.json'),
        MXApplicationClient.staticJson('rag_image_map.json'),
    ]);
    if (catalogResult.status === 'fulfilled') this.catalog = catalogResult.value;
    else console.warn('[RAG] Catalog not available:', catalogResult.reason?.message || catalogResult.reason);
    if (imageMapResult.status === 'fulfilled') this.imageMap = imageMapResult.value;
    else console.warn('[RAG] Image map not available:', imageMapResult.reason?.message || imageMapResult.reason);
    this.loaded = true;
    console.log(`[RAG] Sources loaded: ${this.catalog?.length || 0} aircraft, ${Object.keys(this.imageMap || {}).length} image mappings`);
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
      const data = await MXApplicationClient.staticJson('display_index/' + entry.file);
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

// Preserve the compatibility API's legacy method and bearer conventions.
const _originalFetch = window.fetch;
window.fetch = async function (url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const urlStr = typeof url === 'string' ? url : (url.url || url.toString());

  const isApi = urlStr.includes('/api/');

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

  return _originalFetch(url, options);
};

// ═══════════════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // Phase 1: UI + local engines (instant, no network)
  setupNavigation();     // Nav + chat panel + LLM init (all independent of API)
  RAG.load();            // RAG index (non-blocking)

  // Phase 2: Network-dependent (fire and forget — app works without it)
  login().then(() => { loadDashboard(); loadGlobe(); MXOnboarding.checkFirstRun(); }).catch(() => { loadDashboard(); loadGlobe(); MXOnboarding.checkFirstRun(); });
});

async function login() {
  // The Azure proxy owns JetNet authentication and replaces this marker
  // server-side. No JetNet credential or token is exposed to the browser.
  TOKEN = 'LIVE_TOKEN';
  BEARER = '';
  const status = document.getElementById('apiStatus');
  status.classList.add('connected');
  status.querySelector('span:last-child').textContent = 'Fleet proxy ready';
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
  document.getElementById('activeCaseCard')?.addEventListener('click', () => switchTab('case'));

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

  // Aircraft fleet-triage filters
  document.getElementById('acDirectSearchBtn')?.addEventListener('click', loadAircraft);
  ['acScanUrgency', 'acScanRegion'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { tabLoaded['aircraft'] = true; loadAircraft(); });
  });

  document.getElementById('compSearchBtn')?.addEventListener('click', loadCompanies);
  compFields.forEach(id => document.getElementById(id)?.addEventListener('input', debouncedCompanies));

  document.getElementById('contSearchBtn')?.addEventListener('click', loadContacts);
  contFields.forEach(id => document.getElementById(id)?.addEventListener('input', debouncedContacts));

  // Lazy-load directory data when its section opens.
  document.getElementById('outreachCollapsible')?.addEventListener('toggle', (e) => {
    if (e.target.open && !isCompaniesInitialized) loadCompanies();
  });

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
  const toggleBtn = document.getElementById('chatToggleNav') || document.getElementById('chatToggleFab');
  const closeBtn = document.getElementById('closeChatBtn');
  const input = document.getElementById('chatInput');
  const sendBtn = document.querySelector('.chat-send-btn');
  const history = document.getElementById('chatHistory');
  let activeCaseContext = null;

  if (!panel || !toggleBtn) return;

  window.addEventListener('mxg:case-selected', (event) => {
    activeCaseContext = event.detail || null;
    const notice = document.createElement('div');
    notice.className = 'chat-msg ai-msg';
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = `Case ${activeCaseContext?.caseId || ''} is now the active copilot context.`;
    notice.appendChild(bubble);
    history.appendChild(notice);
    history.scrollTop = history.scrollHeight;
  });

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

  // Header is now minimal — just the X close button

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
5. If no authoritative manual is provided, state that evidence is unavailable and do not supply a maintenance procedure.
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

  // ── Fleet Data Serializer (source attributes → compatibility context) ──
  function serializeFleetContext() {
    if (!cachedFleetSignals || cachedFleetSignals.length === 0) return '';

    // Sort by reported AFTT for deterministic screening, never as due status.
    const sorted = [...cachedFleetSignals].sort((a, b) => {
      const afttA = (a.mro || buildMROSignals(a)).aftt;
      const afttB = (b.mro || buildMROSignals(b)).aftt;
      return afttB - afttA;
    });

    const lines = sorted.slice(0, 8).map((ac, i) => {
      const m = ac.mro || buildMROSignals(ac);

      const flags = [];
      if (m.isForSale) flags.push('FOR SALE');
      if (m.isAOG) flags.push('AOG');

      return `${i + 1}. ${ac.regnbr || '?'} | ${ac.make} ${ac.model} | ${ac.yearmfg || '?'} | reported AFTT ${m.aftt.toLocaleString()} hrs | ${ac.baseicao || ac.basecity || '?'}${flags.length ? ' | ' + flags.join(', ') : ''}`;
    });

    return '\n\n--- COMPATIBILITY FLEET CONTEXT (sorted by reported AFTT, ' + cachedFleetSignals.length + ' aircraft) ---\n' +
      'AFTT alone does not establish inspection status, maintenance due status, or airworthiness. Do not infer any of those from this list.\n' +
      lines.join('\n') +
      '\n--- END COMPATIBILITY FLEET CONTEXT ---\n';
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
    '🔧 GL7500 fuel system leak check',
    '✈️ Falcon 8X APU overhaul steps'
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
    pill.onclick = (e) => {
      e.stopPropagation();
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

  // Click outside to close
  document.addEventListener('click', (e) => {
    if (panel.classList.contains('open') && !panel.contains(e.target) && !toggleBtn.contains(e.target)) {
      togglePanel();
    }
  });

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    
    const userMsg = document.createElement('div');
    userMsg.className = 'chat-msg user-msg';
    const userBubble = document.createElement('div');
    userBubble.className = 'msg-bubble';
    userBubble.textContent = text;
    userMsg.appendChild(userBubble);
    history.appendChild(userMsg);
    input.value = '';
    history.scrollTop = history.scrollHeight;

    const aiMsg = document.createElement('div');
    aiMsg.className = 'chat-msg ai-msg';
    aiMsg.innerHTML = `<div class="msg-bubble"><span class="stream-target">
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 0;">
        <div style="position:relative;width:80px;height:80px;border-radius:16px;overflow:hidden;background:linear-gradient(180deg,#E8F4F8 0%,#C8E0EC 55%,#A8CCE0 100%);box-shadow:0 6px 16px rgba(10,37,64,0.12);">
          <svg style="position:absolute;width:36px;top:30%;animation:mxFloat 10s linear infinite;" viewBox="0 0 60 24"><ellipse cx="30" cy="16" rx="28" ry="6" fill="white"/><circle cx="20" cy="12" r="8" fill="white"/><circle cx="35" cy="10" r="10" fill="white"/><circle cx="45" cy="13" r="7" fill="white"/></svg>
          <svg style="position:absolute;width:26px;top:58%;opacity:0.85;animation:mxFloat 14s linear infinite;animation-delay:-5s;" viewBox="0 0 50 20"><ellipse cx="25" cy="14" rx="22" ry="5" fill="white"/><circle cx="15" cy="10" r="6" fill="white"/><circle cx="28" cy="8" r="8" fill="white"/><circle cx="38" cy="11" r="6" fill="white"/></svg>
          <svg style="position:absolute;width:30px;top:42%;opacity:0.9;animation:mxFloat 12s linear infinite;animation-delay:-8s;" viewBox="0 0 55 22"><ellipse cx="27" cy="15" rx="25" ry="5" fill="white"/><circle cx="17" cy="11" r="7" fill="white"/><circle cx="32" cy="9" r="9" fill="white"/><circle cx="42" cy="12" r="6" fill="white"/></svg>
          <div style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:5px;height:5px;border-radius:50%;background:#F5A623;box-shadow:0 0 6px rgba(245,166,35,0.5);animation:mxDot 1.6s ease-in-out infinite;z-index:4;"></div>
        </div>
        <div style="position:relative;height:14px;overflow:hidden;">
          <span style="position:absolute;font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#8b949e;opacity:0;animation:mxWord 8s ease-in-out infinite;">Servicing</span>
          <span style="position:absolute;font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#8b949e;opacity:0;animation:mxWord 8s ease-in-out infinite;animation-delay:2s;">Thinking</span>
          <span style="position:absolute;font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#8b949e;opacity:0;animation:mxWord 8s ease-in-out infinite;animation-delay:4s;">Analyzing</span>
          <span style="position:absolute;font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#8b949e;opacity:0;animation:mxWord 8s ease-in-out infinite;animation-delay:6s;">Inspecting</span>
        </div>
      </div>
    </span></div>`;
    history.appendChild(aiMsg);
    history.scrollTop = history.scrollHeight;
    const streamTarget = aiMsg.querySelector('.stream-target');

    // ── Cloud Inference (Azure Rust Backend) ──
    try {
      const applicationSession = window.MXGENIUS_CONFIG?.getSession?.() || {};
      const response = await MXApplicationClient.chat({
        message: text,
        fleetSignals: typeof cachedFleetSignals !== 'undefined' ? cachedFleetSignals : [],
        caseContext: activeCaseContext && {
          case_id: activeCaseContext.caseId,
          version: activeCaseContext.case?.version,
          capability_trace: activeCaseContext.trace
        },
        accessToken: applicationSession.accessToken,
        organizationId: applicationSession.organizationId,
        correlationId: window.crypto?.randomUUID?.()
      });
      
      const rawText = await response.text();
      let data, answerText = '';
      try {
        const rawData = JSON.parse(rawText);
        data = rawData.response || rawData;
        // Try multiple response fields from the structured backend response
        if (data && data.advisory) answerText = data.advisory;
        else if (data && data.answer) answerText = data.answer;
        else if (data && data.synthesis) {
          // Structured MXGenius response — build formatted answer
          let parts = [];
          if (data.synthesis) parts.push(data.synthesis);
          if (data.mxgenius_recommends) parts.push('**MXGenius Recommends:** ' + data.mxgenius_recommends);
          if (data.verify_first) parts.push('**Verify First:** ' + data.verify_first);
          if (data.most_likely_cause) parts.push('**Most Likely Cause:** ' + data.most_likely_cause);
          if (data.labor_by_action && data.labor_by_action.length) parts.push('**Labor Steps:**\n' + data.labor_by_action.map((s,i) => (i+1) + '. ' + s).join('\n'));
          if (data.parts_and_references && data.parts_and_references.length) parts.push('**Parts & References:**\n' + data.parts_and_references.map(p => '• ' + p).join('\n'));
          if (data.what_worked && data.what_worked.length) parts.push('**What Worked:**\n' + data.what_worked.map(w => '• ' + w).join('\n'));
          answerText = parts.join('\n\n');
        }
      } catch (_) {
        // Backend returned non-JSON — treat raw text as the answer
        answerText = rawText;
      }
      
      if (answerText) {
        streamTarget.innerHTML = formatMxResponse(answerText);
      } else {
        streamTarget.innerHTML = '<span style="color:#8b949e;font-style:italic;">No response generated</span>';
      }
      
    } catch (e) {
      console.error('[MXGenius] Cloud inference:', e.message);
      if (llamaContext && modelReady) {
        try {
          const { text: ragText, hits: ragHits } = await RAG.buildContextAsync(text);
          const fleetText = /fleet|aircraft|tail|registration|aftt|aog|for.sale/i.test(text)
            ? serializeFleetContext()
            : '';
          const prompt = '<|im_start|>system\n' + AOG_SYSTEM_PROMPT + fleetText + (ragText || '') +
            '\n<|im_end|>\n<|im_start|>user\n' + text +
            '\n<|im_end|>\n<|im_start|>assistant\n<think>\n</think>\nAnswer:\n';
          const result = await llamaContext.completion({
            id: 1,
            params: {
              prompt,
              n_predict: 300,
              stop: ['<|im_end|>', '</s>', '<|im_start|>', '<|end_of_sentence|>', '<|endoftext|>'],
              temperature: 0.2,
              repeat_penalty: 1.6,
              top_p: 0.7
            }
          });
          const answer = cleanModelOutput(result?.text || result?.content || '');
          if (!answer) throw new Error('On-device model returned no usable response');
          streamTarget.innerHTML = formatMxResponse(answer);
          if (ragHits?.length) {
            const references = document.createElement('div');
            references.innerHTML = formatProcedureBlock(ragHits);
            aiMsg.querySelector('.msg-bubble')?.appendChild(references);
          }
          updateCostCounter(Math.ceil(prompt.length / 4), result?.tokens_predicted || Math.ceil(answer.length / 4));
        } catch (fallbackError) {
          console.error('[MXGenius] On-device fallback:', fallbackError.message);
          streamTarget.textContent = 'Cloud and on-device assistance are unavailable. Case and fleet tools remain usable.';
        }
      } else {
        streamTarget.textContent = 'Assistance is temporarily unavailable. Case and fleet tools remain usable.';
      }
    }
    history.scrollTop = history.scrollHeight;
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // --- Authenticated OpenAI Realtime voice ---
  const micBtn = document.querySelector('.chat-mic-btn');
  const realtimeState = document.getElementById('realtimeState');
  const realtimeStateLabel = document.getElementById('realtimeStateLabel');
  const realtimeTranscript = document.getElementById('realtimeTranscript');
  const realtimeUserTranscript = document.getElementById('realtimeUserTranscript');
  const realtimeAssistantTranscript = document.getElementById('realtimeAssistantTranscript');
  const realtimeInterruptBtn = document.getElementById('realtimeInterruptBtn');
  const realtimeConfirmation = document.getElementById('realtimeConfirmation');
  const realtimeConfirmationSummary = document.getElementById('realtimeConfirmationSummary');
  const realtimeConfirmationArguments = document.getElementById('realtimeConfirmationArguments');
  const realtimeConfirmationCancel = document.getElementById('realtimeConfirmationCancel');
  const realtimeConfirmationApprove = document.getElementById('realtimeConfirmationApprove');
  let realtimeSession = null;
  let realtimeApplicationSession = null;
  let pendingRealtimeMutation = null;
  const handledRealtimeCalls = new Set();

  function setupVoiceInput() {
    if (!micBtn) return;
    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia || !window.MXRealtime) {
      micBtn.style.opacity = '0.3';
      micBtn.disabled = true;
      micBtn.title = 'Realtime voice is unavailable in this browser; text chat remains available';
      setRealtimeUiState('degraded', 'Voice unavailable · use text');
      return;
    }

    realtimeSession = new MXRealtime.RealtimeSession({
      exchangeSdp: ({ sdp, session }) => MXApplicationClient.realtime.exchangeSdp({ sdp, session }),
      onEvent: handleRealtimeEvent
    });

    micBtn.addEventListener('click', async () => {
      if (realtimeSession.state !== 'disconnected' && realtimeSession.state !== 'failed') {
        realtimeSession.disconnect();
        return;
      }
      const session = window.MXGENIUS_CONFIG?.getSession?.() || {};
      if (!session.accessToken && !window.MXGENIUS_CONFIG?.allowInsecurePilot) {
        setRealtimeUiState('failed', 'Sign in to use Realtime voice');
        return;
      }
      try {
        realtimeApplicationSession = {
          accessToken: session.accessToken,
          organizationId: session.organizationId,
          correlationId: window.crypto?.randomUUID?.()
        };
        await realtimeSession.connect({
          session: realtimeApplicationSession
        });
      } catch (error) {
        console.warn('[Realtime] Connection failed:', error.code || error.message);
      }
    });
    realtimeInterruptBtn?.addEventListener('click', () => realtimeSession.interrupt());
    realtimeConfirmationCancel?.addEventListener('click', declineRealtimeMutation);
    realtimeConfirmationApprove?.addEventListener('click', confirmRealtimeMutation);
  }

  function setRealtimeUiState(state, label) {
    const labels = {
      disconnected: 'Voice disconnected',
      connecting: 'Connecting voice…',
      listening: 'Listening',
      thinking: 'Thinking / tool use',
      speaking: 'MXGenius speaking',
      degraded: 'Voice connection degraded',
      failed: 'Voice connection failed'
    };
    realtimeState.dataset.state = state;
    realtimeStateLabel.textContent = label || labels[state] || state;
    const active = !['disconnected', 'failed'].includes(state);
    micBtn.setAttribute('aria-pressed', String(active));
    micBtn.title = active ? 'Disconnect Realtime voice' : 'Start Realtime voice';
    micBtn.classList.toggle('pulse-mic', state === 'listening');
    realtimeInterruptBtn.hidden = state !== 'speaking' && state !== 'thinking';
    input.placeholder = state === 'failed' ? 'Voice unavailable · use text chat' : 'Ask MXGenius…';
  }

  async function handleRealtimeEvent(event) {
    if (event.type === 'state') {
      setRealtimeUiState(event.state, event.reason);
      return;
    }
    if (event.type === 'transcript') {
      realtimeTranscript.hidden = false;
      const target = event.role === 'user' ? realtimeUserTranscript : realtimeAssistantTranscript;
      target.textContent = event.text || '';
      return;
    }
    if (event.type === 'channel-open') {
      try {
        const listed = await MXApplicationClient.capabilities.list(realtimeApplicationSession);
        const caseDescription = activeCaseContext
          ? `The active application case is ${activeCaseContext.caseId} at version ${activeCaseContext.case?.version}. Never select a different tenant or claim an action completed before its function result is returned.`
          : 'No maintenance case is currently active. Ask the user to select or create a case before requesting a case-bound action.';
        realtimeSession.configureTools(listed.tools, {
          instructions: `You are the MXGenius maintenance copilot. Use only the supplied typed capabilities for operational facts and actions. ${caseDescription} Read evidence and confidence from capability envelopes. Operational mutations always require a dashboard confirmation and may be declined.`
        });
      } catch (error) {
        setRealtimeUiState('degraded', `Capability catalog unavailable: ${error.code || 'request failed'}`);
      }
      return;
    }
    if (event.type === 'tool-request') {
      setRealtimeUiState('thinking', `Tool requested: ${event.name}`);
      await routeRealtimeTool(event);
    }
  }

  async function routeRealtimeTool(event) {
    if (!event.callId || handledRealtimeCalls.has(event.callId) || pendingRealtimeMutation?.callId === event.callId) return;
    let capabilityArguments;
    try {
      capabilityArguments = typeof event.arguments === 'string'
        ? JSON.parse(event.arguments)
        : event.arguments;
    } catch {
      realtimeSession.sendToolOutput(event.callId, { status: 'failed', error: { code: 'INVALID_TOOL_ARGUMENTS', message: 'Tool arguments were not valid JSON.' } });
      handledRealtimeCalls.add(event.callId);
      return;
    }
    if (!event.spec?.name || !/^mxg\.[a-z_]+\.[a-z_]+$/.test(event.spec.name)) {
      realtimeSession.sendToolOutput(event.callId, { status: 'failed', error: { code: 'UNKNOWN_CAPABILITY', message: 'Requested capability is not in the authenticated registry.' } });
      handledRealtimeCalls.add(event.callId);
      return;
    }
    if (event.spec.meta?.requires_human_approval) {
      pendingRealtimeMutation = { ...event, arguments: capabilityArguments };
      showRealtimeConfirmation(pendingRealtimeMutation);
      return;
    }
    await executeRealtimeCapability(event.callId, event.spec.name, capabilityArguments);
  }

  async function executeRealtimeCapability(callId, name, capabilityArguments, confirmationGrant) {
    try {
      const envelope = await MXApplicationClient.capabilities.call(name, capabilityArguments, {
        ...realtimeApplicationSession,
        correlationId: window.crypto?.randomUUID?.(),
        confirmationGrant
      });
      realtimeSession.sendToolOutput(callId, envelope);
    } catch (error) {
      realtimeSession.sendToolOutput(callId, {
        status: 'failed',
        error: { code: error.code || 'CAPABILITY_FAILED', message: error.message }
      });
    } finally {
      handledRealtimeCalls.add(callId);
      setRealtimeUiState('listening');
    }
  }

  function showRealtimeConfirmation(request) {
    const target = request.arguments.case_id || request.arguments.aircraft_id || request.arguments.part_id || 'unbound target';
    const version = request.arguments.expected_version ?? activeCaseContext?.case?.version ?? 'not supplied';
    realtimeConfirmationSummary.textContent = `${request.name} proposes changing ${target} at version ${version}. Confirm only after reviewing the exact typed arguments below.`;
    realtimeConfirmationArguments.textContent = JSON.stringify(request.arguments, null, 2);
    realtimeConfirmation.hidden = false;
    realtimeConfirmationApprove.disabled = false;
    realtimeConfirmationCancel.disabled = false;
  }

  async function confirmRealtimeMutation() {
    const request = pendingRealtimeMutation;
    if (!request || handledRealtimeCalls.has(request.callId)) return;
    realtimeConfirmationApprove.disabled = true;
    realtimeConfirmationCancel.disabled = true;
    realtimeConfirmationSummary.textContent = `Issuing a single-use confirmation for ${request.name}…`;
    try {
      const qualifiedApproval = request.name === 'mxg.maintenance_case.update_status'
        && request.arguments.target_status === 'closed';
      const grant = await MXApplicationClient.confirmations.issue({
        toolName: request.name,
        arguments: request.arguments,
        qualifiedApproval,
        session: { ...realtimeApplicationSession, correlationId: window.crypto?.randomUUID?.() }
      });
      realtimeConfirmation.hidden = true;
      pendingRealtimeMutation = null;
      await executeRealtimeCapability(request.callId, request.name, request.arguments, grant.token);
    } catch (error) {
      realtimeConfirmationSummary.textContent = `Confirmation failed: ${error.message}`;
      realtimeConfirmationApprove.disabled = false;
      realtimeConfirmationCancel.disabled = false;
    }
  }

  function declineRealtimeMutation() {
    const request = pendingRealtimeMutation;
    if (!request) return;
    realtimeSession.sendToolOutput(request.callId, {
      status: 'declined',
      error: { code: 'HUMAN_DECLINED', message: 'The user declined the proposed operational action.' }
    });
    handledRealtimeCalls.add(request.callId);
    pendingRealtimeMutation = null;
    realtimeConfirmation.hidden = true;
    setRealtimeUiState('listening');
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
    loadGlobe();
    loadAircraft();
    loadCompanies();
    loadContacts();
  } else if (activeTab) {
    tabLoaded[activeTab] = true;
    switch (activeTab) {
      case '3d-viewer': MX3DViewer.ensureLoaded(); break;
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
  const tabBtn = document.querySelector(`.nav-tab[data-tab="${tabId}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  const tabEl = document.getElementById(`tab-${tabId}`);
  if (tabEl) tabEl.classList.add('active');

  // Load the viewer once. Its context and selected component must survive tab changes.
  if (tabId === '3d-viewer') {
    MX3DViewer.ensureLoaded();
  }

  // Lazy-load tab data
  if (!tabLoaded[tabId]) {
    tabLoaded[tabId] = true;
    switch (tabId) {
      case 'dashboard': loadGlobe(); loadAircraft(); loadCompanies(); loadContacts(); break;
      case '3d-viewer': break;
      case 'settings': initSettings(); break;
    }
  }
}

// ═══════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════

function initSettings() {
  // Accent color picker
  const colorPicker = document.getElementById('settingsAccentColor');
  if (colorPicker) {
    const savedColor = localStorage.getItem('mx_accentColor');
    if (savedColor) {
      colorPicker.value = savedColor;
      document.documentElement.style.setProperty('--accent-cyan', savedColor);
    }
    colorPicker.addEventListener('input', function() {
      document.documentElement.style.setProperty('--accent-cyan', this.value);
      localStorage.setItem('mx_accentColor', this.value);
    });
  }

  // Compact mode toggle
  const compactToggle = document.getElementById('settingsCompactMode');
  if (compactToggle) {
    compactToggle.checked = localStorage.getItem('mx_compactMode') === 'true';
    if (compactToggle.checked) document.body.classList.add('compact-mode');
    compactToggle.addEventListener('change', function() {
      localStorage.setItem('mx_compactMode', this.checked);
      document.body.classList.toggle('compact-mode', this.checked);
    });
  }

  // Background, text, card color pickers
  const colorBindings = [
    { id: 'settingsBgColor',   prop: '--bg-primary',    key: 'mx_bgColor' },
    { id: 'settingsTextColor', prop: '--text-primary',  key: 'mx_textColor' },
    { id: 'settingsCardColor', prop: '--bg-card',       key: 'mx_cardColor' },
  ];
  colorBindings.forEach(({ id, prop, key }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const saved = localStorage.getItem(key);
    if (saved) {
      el.value = saved;
      document.documentElement.style.setProperty(prop, saved);
    }
    el.addEventListener('input', function() {
      document.documentElement.style.setProperty(prop, this.value);
      localStorage.setItem(key, this.value);
      document.getElementById('settingsTheme').value = ''; // switch to Custom
    });
  });

  // Theme presets
  const themes = {
    midnight: { bg: '#0a0e1a', text: '#e8ecf4', card: '#1a1f35', accent: '#00d4ff' },
    slate:    { bg: '#1e293b', text: '#f1f5f9', card: '#334155', accent: '#38bdf8' },
    ember:    { bg: '#1c1210', text: '#fde8e0', card: '#2d1f1b', accent: '#f97316' },
    ocean:    { bg: '#0c1929', text: '#e0f2fe', card: '#132f4c', accent: '#06b6d4' },
  };
  const themeSelect = document.getElementById('settingsTheme');
  if (themeSelect) {
    const savedTheme = localStorage.getItem('mx_theme');
    if (savedTheme && themes[savedTheme]) {
      themeSelect.value = savedTheme;
      applyTheme(themes[savedTheme]);
    }
    themeSelect.addEventListener('change', function() {
      const t = themes[this.value];
      if (!t) return;
      applyTheme(t);
      localStorage.setItem('mx_theme', this.value);
    });
  }

  function applyTheme(t) {
    const root = document.documentElement.style;
    root.setProperty('--bg-primary', t.bg);
    root.setProperty('--text-primary', t.text);
    root.setProperty('--bg-card', t.card);
    root.setProperty('--accent-cyan', t.accent);
    // Sync pickers
    const bgEl = document.getElementById('settingsBgColor');
    const txtEl = document.getElementById('settingsTextColor');
    const cardEl = document.getElementById('settingsCardColor');
    const accEl = document.getElementById('settingsAccentColor');
    if (bgEl) bgEl.value = t.bg;
    if (txtEl) txtEl.value = t.text;
    if (cardEl) cardEl.value = t.card;
    if (accEl) accEl.value = t.accent;
    localStorage.setItem('mx_bgColor', t.bg);
    localStorage.setItem('mx_textColor', t.text);
    localStorage.setItem('mx_cardColor', t.card);
    localStorage.setItem('mx_accentColor', t.accent);
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
    btnCompanies.classList.remove('outreach-tab-active');
    btnContacts.classList.add('outreach-tab-active');
    // Lazy-load contacts on first switch
    if (!isContactsInitialized) loadContacts();
  } else {
    companies.style.display = '';
    contacts.style.display = 'none';
    btnCompanies.classList.add('outreach-tab-active');
    btnContacts.classList.remove('outreach-tab-active');
    // Lazy-load companies on first switch
    if (!isCompaniesInitialized) loadCompanies();
  }
}

// ═══════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════

async function loadDashboard() {
  try {
    // Show loading throbbers in chart containers
    const spinner = '<div class="loading-spinner"></div>';
    ['chartMakes','chartTypes','chartADSB','chartAge','chartEngines','chartMaint','recentListings'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:120px;">${spinner}<span style="margin-left:10px;color:var(--text-muted);font-size:0.8rem;">Loading data...</span></div>`;
    });

    let acList = [];
    let bulkCount = 0;

    if (TOKEN) {
      // One-time cache bust to clear stale Gulfstream-only data
      const cacheVersion = '2';
      if (localStorage.getItem('mx_cacheVer') !== cacheVersion) {
        await MXCache.clearAll();
        localStorage.setItem('mx_cacheVer', cacheVersion);
        console.log('[Dashboard] Cache cleared for version upgrade');
      }

      try {
        const bulkData = await MXApplicationClient.bulkAircraft({
          token: TOKEN,
          bearer: BEARER,
          cacheTtl: MXCache.TTL.BULK
        });
        acList = bulkData.aircraft || [];
        bulkCount = bulkData.count || acList.length;
      } catch (e) { console.warn('[Dashboard] Bulk export failed:', e.message); }
    }

    // Store globally for filtering
    window._dashboardData = { acList, bulkCount: bulkCount || acList.length };

    // Populate filter dropdowns from live data
    populateDashboardFilters(acList);

    // Render with current filters (initially none)
    renderDashboard(acList, bulkCount || acList.length);

  } catch (e) {
    console.error('Dashboard load failed:', e);
  }
}

function populateDashboardFilters(acList) {
  const makeSelect = document.getElementById('filterMake');
  const typeSelect = document.getElementById('filterType');
  if (!makeSelect || !typeSelect) return;

  // Makes — sorted alphabetically
  const makes = [...new Set(acList.map(a => a.make).filter(Boolean))].sort();
  makes.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    makeSelect.appendChild(opt);
  });

  // Types
  const types = [...new Set(acList.map(a => a.maketype).filter(Boolean))].sort();
  types.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    typeSelect.appendChild(opt);
  });
}

function applyDashboardFilters() {
  const d = window._dashboardData;
  if (!d) return;

  const make = document.getElementById('filterMake')?.value || '';
  const type = document.getElementById('filterType')?.value || '';
  const status = document.getElementById('filterStatus')?.value || '';

  let filtered = d.acList;
  if (make) filtered = filtered.filter(a => a.make === make);
  if (type) filtered = filtered.filter(a => a.maketype === type);
  if (status === 'forsale') filtered = filtered.filter(a => a.forsale === true || a.forsale === 'true' || a.forsale === 'Y');
  if (status === 'maintained') filtered = filtered.filter(a => a.maintained === 'Y' || a.maintained === true);
  if (status === 'adsb') filtered = filtered.filter(a => a.hasadsb === 'Y' || a.hasadsb === true);

  renderDashboard(filtered, filtered.length);
}

function clearDashboardFilters() {
  const makeEl = document.getElementById('filterMake');
  const typeEl = document.getElementById('filterType');
  const statusEl = document.getElementById('filterStatus');
  if (makeEl) makeEl.value = '';
  if (typeEl) typeEl.value = '';
  if (statusEl) statusEl.value = '';
  const d = window._dashboardData;
  if (d) renderDashboard(d.acList, d.bulkCount);
}

function renderDashboard(acList, bulkCount) {

    const totalAircraft = bulkCount || acList.length || 0;
    const adsbReady = acList.filter(a => a.hasadsb === 'Y' || a.hasadsb === true).length;

    // ═══ Fleet by Make/Type (existing) ═══
    const byMake = {};
    const byType = {};
    acList.forEach(a => {
      const make = a.make || 'Unknown';
      byMake[make] = (byMake[make] || 0) + 1;
      const type = a.maketype || 'Unknown';
      byType[type] = (byType[type] || 0) + 1;
    });
    const topMakes = Object.fromEntries(
      Object.entries(byMake).sort((a, b) => b[1] - a[1]).slice(0, 6)
    );

    renderBarChart('chartMakes', topMakes, ['#00d4ff', '#0099ff', '#8b5cf6', '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#ec4899']);
    renderBarChart('chartTypes', byType, ['#00d4ff', '#8b5cf6', '#10b981', '#f59e0b']);

    // ═══ ADS-B Compliance Donut ═══
    renderDonutChart('chartADSB', adsbReady, totalAircraft - adsbReady, 'ADS-B');

    // ═══ Fleet Age Distribution Histogram ═══
    renderAgeHistogram('chartAge', acList);

    // ═══ Engine Health Overview ═══
    renderEngineHealth('chartEngines', acList);

    // ═══ Maintenance Program Breakdown ═══
    renderMaintPrograms('chartMaint', acList);

    // ═══ Recently Listed For Sale ═══
    renderRecentListings(acList);

    // ── Update cache stats in settings ──
    MXCache.stats().then(s => {
      const el = document.getElementById('cacheStats');
      if (el) el.textContent = `${s.entries} cached entries`;
    });
}

function animateNumber(id, target, commas = false) {
  const el = document.getElementById(id);
  if (!el) return;
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
  if (!container) return;
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) { container.innerHTML = ''; MXOnboarding.injectEmptyCta(containerId); return; }
  const max = Math.max(...entries.map(e => e[1]));

  container.innerHTML = entries.map(([label, value], i) => {
    const pct = Math.round((value / max) * 100);
    const color = colors[i % colors.length];
    return `
      <div class="chart-row">
        <span class="chart-label">${escapeMarkup(label)}</span>
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

// ═══════════════════════════════════════════════════
//  DASHBOARD CHART RENDERERS
// ═══════════════════════════════════════════════════

function renderDonutChart(containerId, yesCount, noCount, label) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const total = yesCount + noCount;
  if (total === 0) { container.innerHTML = ''; MXOnboarding.injectEmptyCta(containerId); return; }
  const pct = Math.round((yesCount / total) * 100);
  const deg = Math.round((yesCount / total) * 360);

  container.innerHTML = `
    <div class="donut-chart" style="--pct:${deg}deg; --color-yes:#22d3ee; --color-no:rgba(255,255,255,0.08);">
      <div class="donut-center">
        <div class="donut-value">${pct}%</div>
        <div class="donut-label">${label}</div>
      </div>
    </div>
    <div class="donut-legend">
      <div><span class="donut-dot" style="background:#22d3ee;"></span> Equipped: ${yesCount.toLocaleString()}</div>
      <div><span class="donut-dot" style="background:rgba(255,255,255,0.15);"></span> Not Equipped: ${noCount.toLocaleString()}</div>
    </div>`;
}

function renderAgeHistogram(containerId, acList) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const currentYear = new Date().getFullYear();
  const decades = {};
  acList.forEach(a => {
    if (!a.yearmfr || a.yearmfr < 1950) return;
    const decade = Math.floor(a.yearmfr / 10) * 10;
    const label = `${decade}s`;
    decades[label] = (decades[label] || 0) + 1;
  });
  const sorted = Object.fromEntries(Object.entries(decades).sort((a, b) => a[0].localeCompare(b[0])));
  renderBarChart(containerId, sorted, ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#7c3aed', '#5b21b6']);
}

function renderEngineHealth(containerId, acList) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Aggregate engines that have TBO and time data
  let totalEngines = 0;
  let green = 0, yellow = 0, red = 0;
  const programs = {};

  acList.forEach(a => {
    // Check engines 1-4 (left/right/1/2 naming convention)
    const suffixes = ['l', 'r', '1', '2'];
    suffixes.forEach(s => {
      const tt = a[`engtt${s}_new`];
      const tbo = a[`tbo${s}_new`];
      if (tt && tbo && tbo > 0) {
        totalEngines++;
        const ratio = tt / tbo;
        if (ratio < 0.6) green++;
        else if (ratio < 0.85) yellow++;
        else red++;
      }
    });

    // Engine program tracking
    const prog = a.engineproviderprogram || a.emp || '';
    if (prog && prog.trim()) {
      const key = prog.trim();
      programs[key] = (programs[key] || 0) + 1;
    }
  });

  if (totalEngines === 0) {
    container.innerHTML = ''; MXOnboarding.injectEmptyCta(containerId);
    return;
  }

  container.innerHTML = `
    <div class="engine-health-bars">
      <div class="engine-bar-row">
        <span class="engine-bar-label" style="color:#10b981;">Under 60% reported TT/TBO</span>
        <div class="chart-bar-bg"><div class="chart-bar" style="width:${Math.round(green/totalEngines*100)}%;background:#10b981;">${green}</div></div>
      </div>
      <div class="engine-bar-row">
        <span class="engine-bar-label" style="color:#f59e0b;">60–85% reported TT/TBO</span>
        <div class="chart-bar-bg"><div class="chart-bar" style="width:${Math.round(yellow/totalEngines*100)}%;background:#f59e0b;">${yellow}</div></div>
      </div>
      <div class="engine-bar-row">
        <span class="engine-bar-label" style="color:#ef4444;">Over 85% reported TT/TBO</span>
        <div class="chart-bar-bg"><div class="chart-bar" style="width:${Math.round(red/totalEngines*100)}%;background:#ef4444;">${red}</div></div>
      </div>
    </div>
    <div class="engine-summary">${totalEngines} engines tracked</div>`;

  // Animate
  setTimeout(() => {
    container.querySelectorAll('.chart-bar').forEach(bar => {
      const w = bar.style.width; bar.style.width = '0%';
      requestAnimationFrame(() => { bar.style.width = w; });
    });
  }, 50);
}

function renderMaintPrograms(containerId, acList) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const programs = {};
  acList.forEach(a => {
    const prog = a.mxprog || a.amp || '';
    if (prog && prog.trim()) {
      const key = prog.trim();
      programs[key] = (programs[key] || 0) + 1;
    }
  });

  if (Object.keys(programs).length === 0) {
    container.innerHTML = ''; MXOnboarding.injectEmptyCta(containerId);
    return;
  }

  const topProgs = Object.fromEntries(
    Object.entries(programs).sort((a, b) => b[1] - a[1]).slice(0, 8)
  );
  renderBarChart(containerId, topProgs, ['#f472b6', '#ec4899', '#db2777', '#be185d', '#9d174d', '#831843', '#fb7185', '#fda4af']);
}

function renderRecentListings(acList) {
  const container = document.getElementById('recentListings');
  if (!container) return;

  // Show currently for-sale aircraft (sorted by hours, highest first)
  const listings = acList
    .filter(a => (a.forsale === true || a.forsale === 'true' || a.forsale === 'Y'))
    .sort((a, b) => (b.airfrmtt || 0) - (a.airfrmtt || 0))
    .slice(0, 20);

  if (listings.length === 0) {
    container.innerHTML = '<div class="empty-state">No aircraft currently for sale</div>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Listed</th><th>Make</th><th>Model</th><th>Reg</th><th>Year</th><th>AFTT</th><th>Asking</th><th>Base</th>
        </tr>
      </thead>
      <tbody>
        ${listings.map(a => {
          const asking = a.asking ? '$' + Number(a.asking).toLocaleString() : '—';
          return `
          <tr data-aircraft-id="${safeRecordId(a.aircraftid) ?? ''}" style="cursor:pointer;">
            <td class="td-dim">${escapeMarkup(a.datelisted || '—')}</td>
            <td class="td-accent">${escapeMarkup(a.make || '—')}</td>
            <td>${escapeMarkup(a.model || '—')}</td>
            <td class="td-mono">${escapeMarkup(a.regnbr || '—')}</td>
            <td>${escapeMarkup(a.yearmfr || '—')}</td>
            <td>${a.airfrmtt ? a.airfrmtt.toLocaleString() : a.estaftt ? a.estaftt.toLocaleString() : '—'}</td>
            <td class="td-accent">${asking}</td>
            <td class="td-dim">${escapeMarkup(a.acbasecity || a.acbaseicao || '—')}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  container.querySelectorAll('tr[data-aircraft-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const id = safeRecordId(row.dataset.aircraftId);
      if (id !== null) showAircraftDetail(id);
    });
  });
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
  let urgencyFilter = '';

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
    // Fleet triage mode — use source-attribute filters
    const regionFilter = document.getElementById('acScanRegion')?.value || '';
    urgencyFilter = document.getElementById('acScanUrgency')?.value || '';
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
    const data = await MXApplicationClient.aircraftList({ token: TOKEN, bearer: BEARER, filters: body });

    if (data.responsestatus && data.responsestatus !== 'Success' && data.responsestatus !== 'SUCCESS') {
      grid.innerHTML = `<div class="empty-state">Fleet source error: ${escapeMarkup(data.responsestatus)}</div>`;
      return;
    }

    if (!data.aircraft || data.aircraft.length === 0) {
      grid.innerHTML = '<div class="empty-state">No aircraft found matching your criteria</div>';
      return;
    }

    // Cache as explicitly non-authoritative compatibility context.
    cachedFleetSignals = data.aircraft.map(ac => ({ ...ac, mro: buildMROSignals(ac) }));

    // Apply descriptive AFTT bands client-side; these are not due-status filters.
    if (acSearchMode === 'scan' && urgencyFilter && urgencyFilter !== 'for-sale') {
      cachedFleetSignals = cachedFleetSignals.filter(ac => {
        if (urgencyFilter === 'high-time') return ac.mro.aftt > 8000;
        if (urgencyFilter === 'very-high') return ac.mro.aftt > 12000;
        return true;
      });
    }

    if (cachedFleetSignals.length === 0) {
      grid.innerHTML = '<div class="empty-state">No aircraft found matching your high-time criteria</div>';
      return;
    }

    // Store full dataset for infinite scroll
    aircraftScrollState = {
      allAircraft: cachedFleetSignals,
      rendered: 0,
      forSale: forSale,
      CHUNK: 100,
    };

    // Populate fleet screening stats in Aircraft tab.
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
    : mro.isVeryHighTime ? '<span class="badge badge-overdue">12K+ AFTT</span>'
    : mro.isHighTime ? '<span class="badge badge-due-soon">8K+ AFTT</span>' : '';
  const hasActiveCase = MXCaseState.matchesAircraft(ac);
  return `
    <div class="ac-card" data-aircraft-id="${safeRecordId(ac.aircraftid) ?? ''}" data-aircraft-reg="${encodeURIComponent(reg)}" data-has-active-case="${hasActiveCase}">
      <div class="ac-card-header">
        <div>
          <div class="ac-card-make">${escapeMarkup(ac.make)}</div>
          <div class="ac-card-model">${escapeMarkup(ac.model)}</div>
        </div>
        <div class="ac-card-reg">${escapeMarkup(reg)}</div>
      </div>
      <div class="ac-card-details">
        <div class="ac-card-detail">
          <span class="ac-card-detail-label">Year</span>
          <span class="ac-card-detail-value">${escapeMarkup(year)}</span>
        </div>
        <div class="ac-card-detail">
          <span class="ac-card-detail-label">Serial</span>
          <span class="ac-card-detail-value">${escapeMarkup(ac.sernbr || '—')}</span>
        </div>
        <div class="ac-card-detail">
          <span class="ac-card-detail-label">AFTT</span>
          <span class="ac-card-detail-value ${mro.isHighTime ? 'mro-metric-warn' : ''}">${ac.aftt?.toLocaleString() || ac.estaftt?.toLocaleString() || '—'}</span>
        </div>
        <div class="ac-card-detail">
          <span class="ac-card-detail-label">Base</span>
          <span class="ac-card-detail-value">${escapeMarkup(base)}</span>
        </div>
      </div>
      <div class="ac-card-badges">
        <span class="badge ${typeClass}">${escapeMarkup(type)}</span>
        ${forSale ? '<span class="badge badge-forsale">FOR SALE</span>' : ''}
        ${mroBadge}
        ${hasActiveCase ? '<span class="badge badge-jet case-card-badge">ACTIVE CASE</span>' : ''}
        <span class="badge badge-lifecycle">${escapeMarkup(ac.lifecycle || '—')}</span>
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
  grid.querySelectorAll('.ac-card[data-aircraft-id]').forEach((card) => {
    if (card.dataset.detailBound === 'true') return;
    card.dataset.detailBound = 'true';
    card.addEventListener('click', () => {
      const id = safeRecordId(card.dataset.aircraftId);
      if (id !== null) showAircraftDetail(id);
    });
  });
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
    const bundle = await MXApplicationClient.aircraftBundle({ id, token: TOKEN });
    const data = bundle.aircraft || {};
    const picData = bundle.pictures || {};
    const engData = bundle.engines || {};
    
    const ac = data.aircraft;
    if (!ac) { body.innerHTML = '<div class="empty-state">Aircraft not found (404/401)</div>'; return; }

    const ident = ac.identification || {};
    const af = ac.airframe || {};
    const maint = ac.maintenance || {};
    const apu = ac.apu || {};
    
    const metarHtml = '';

    const pictures = picData.pictures || [];
    const detailedEngines = engData.engines || [];
    const activeCase = MXCaseState.matchesAircraft({ aircraftid: ident.aircraftid, regnbr: ident.regnbr }) ? MXCaseState.active : null;
    const activeCaseHtml = activeCase ? `<div class="case-context-banner">Active maintenance case · ${escapeMarkup(activeCase.case.status)} · version ${escapeMarkup(activeCase.case.version)}</div>` : '';
    const faaRegistrationSuffix = String(ident.regnbr || '').replace(/^N/i, '').replace(/[^a-z0-9]/gi, '');

    const galleryHtml = pictures.length > 0 ? `
      <div class="photo-gallery" style="display:flex; gap:10px; overflow-x:auto; padding-bottom:15px; margin-bottom:15px; border-bottom:1px solid var(--border);">
        ${pictures.map(p => safeImageUrl(p.pictureurl)).filter(Boolean).map(url => `<img src="${escapeMarkup(url)}" alt="Aircraft" class="aircraft-gallery-image" style="height:200px; border-radius:6px; object-fit:cover; border:1px solid var(--border); cursor:pointer;">`).join('')}
      </div>
    ` : '';

    body.innerHTML = `
      ${activeCaseHtml}
      ${galleryHtml}
      <div class="detail-header">
        <div class="detail-title-group">
          <div class="detail-make">${escapeMarkup(ident.make)}</div>
          <div class="detail-model">${escapeMarkup(ident.model)}</div>
          <div style="margin-top:4px">
            <span class="badge badge-jet">${escapeMarkup(ident.maketype || ident.categorysize)}</span>
          </div>
        </div>
        <div class="detail-reg" style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          <div>${escapeMarkup(ident.regnbr)}</div>
          ${ident.regnbr && ident.regnbr.toUpperCase().startsWith('N') ? `
            <a href="https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${encodeURIComponent(faaRegistrationSuffix)}"
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
              <div style="font-size:0.72rem;color:var(--accent-cyan);font-weight:600;">Engine ${escapeMarkup(e.position)}</div>
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
            ${(ac.avionics || []).map(a => `<span class="badge badge-jet">${escapeMarkup(a.name)}</span>`).join('')}
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
                  <td class="td-accent">${escapeMarkup(r.name)}</td>
                  <td>${escapeMarkup(r.relationtype)}</td>
                  <td class="td-dim">${escapeMarkup(r.businesstype)}</td>
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
                  <td>${escapeMarkup(f.flightyear)}</td><td>${escapeMarkup(f.flightmonth)}</td>
                  <td class="td-accent">${escapeMarkup(f.flights)}</td><td>${escapeMarkup(f.flighthours)}</td>
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
            <button class="badge badge-heli aircraft-chat-prompt" type="button" style="cursor:pointer;border:none;font-size:0.75rem;" data-prompt-suffix="maintenance schedule">Maintenance schedule</button>
            <button class="badge badge-heli aircraft-chat-prompt" type="button" style="cursor:pointer;border:none;font-size:0.75rem;" data-prompt-suffix="common AOG issues">Common AOG issues</button>
            <button class="badge badge-heli aircraft-chat-prompt" type="button" style="cursor:pointer;border:none;font-size:0.75rem;" data-prompt-suffix="inspection intervals">Inspection intervals</button>
            <button class="badge badge-heli aircraft-chat-prompt" type="button" style="cursor:pointer;border:none;font-size:0.75rem;" data-prompt-suffix="engine overhaul cycle">Engine overhaul</button>
          </div>
        </div>

        <div class="detail-section full-width" id="acDetailADs">
          <div class="detail-section-title">FAA Airworthiness Directives</div>
          <div id="acDetailADList" style="font-size:0.82rem;color:var(--text-secondary);">Retrieving candidate ADs through the compliance capability…</div>
        </div>
      </div>
    `;

    body.querySelectorAll('.aircraft-gallery-image').forEach((image) => {
      image.addEventListener('click', () => openImageLightbox(image.src));
      image.addEventListener('error', () => { image.hidden = true; });
    });
    const aircraftPromptPrefix = [ident.make, ident.model].filter(Boolean).join(' ');
    body.querySelectorAll('.aircraft-chat-prompt').forEach((button) => {
      button.addEventListener('click', () => {
        window.openChatWith(`${aircraftPromptPrefix} ${button.dataset.promptSuffix || ''}`.trim());
      });
    });

    // Populate the compliance section through the authenticated MCP boundary.
    (async () => {
      const adContainer = document.getElementById('acDetailADList');
      if (!adContainer) return;
      const session = window.MXGENIUS_CONFIG?.getSession?.() || {};
      if (!session.accessToken && !window.MXGENIUS_CONFIG?.allowInsecureLocal && !window.MXGENIUS_CONFIG?.allowInsecurePilot) {
        adContainer.textContent = 'Sign in to retrieve regulatory evidence.';
        return;
      }
      try {
        const envelope = await MXApplicationClient.compliance.applicableAds({
          aircraftId: ident.aircraftid || id,
          caseId: MXCaseState.active?.caseId || null,
          session
        });
        const output = MXApplicationClient.caseWorkspace.output(envelope);
        const ads = output?.ads || [];
        if (!ads.length) {
          adContainer.textContent = envelope.warnings?.[0]?.message || 'No candidate ADs were returned by the configured source.';
          return;
        }
        adContainer.replaceChildren(...ads.slice(0, 15).map((ad) => {
          const row = document.createElement('div');
          row.className = 'compliance-result';
          const heading = document.createElement('strong');
          heading.textContent = ad.ad_number || 'AD';
          const title = document.createElement('span');
          title.textContent = ad.title || 'Untitled directive';
          const state = document.createElement('small');
          state.textContent = `Applicability: ${String(ad.applicability || 'unknown').replaceAll('_', ' ')}`;
          row.append(heading, title, state);
          return row;
        }));
      } catch (error) {
        adContainer.textContent = `${error.code || 'COMPLIANCE_UNAVAILABLE'}: ${error.message}`;
      }
    })();
  } catch (e) {
    body.innerHTML = '<div class="empty-state">Error loading details</div>';
    console.error(e);
  }
}
function detailRow(label, value) {
  return `<div class="detail-row"><span class="detail-row-label">${escapeMarkup(label)}</span><span class="detail-row-value">${escapeMarkup(value ?? '—')}</span></div>`;
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
  const safeSrc = safeImageUrl(src);
  if (!safeSrc) return;
  const image = document.createElement('img');
  image.src = safeSrc;
  image.alt = 'Aircraft detail';
  image.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:8px;object-fit:contain;';
  lb.replaceChildren(image);
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
    const data = await MXApplicationClient.companyList({ token: TOKEN, bearer: BEARER, filters: body });

    if (!data.companies || data.companies.length === 0) {
      grid.innerHTML = '<div class="empty-state">No companies found</div>';
      return;
    }

    grid.innerHTML = data.companies.map(c => `
      <div class="comp-card" data-company-id="${safeRecordId(c.companyid) ?? ''}">
        <div class="comp-card-name">${escapeMarkup(c.name)}</div>
        <div class="comp-card-type">${escapeMarkup(c.entitytype || 'Company')}</div>
        <div class="comp-card-info">
          <span>${escapeMarkup([c.city, c.state, c.country].filter(Boolean).join(', '))}</span>
          ${c.email ? `<span>${escapeMarkup(c.email)}</span>` : ''}
          ${c.website ? `<span>${escapeMarkup(c.website)}</span>` : ''}
        </div>
      </div>
    `).join('');
    grid.querySelectorAll('.comp-card[data-company-id]').forEach((card) => {
      card.addEventListener('click', () => {
        const id = safeRecordId(card.dataset.companyId);
        if (id !== null) showCompanyDetail(id);
      });
    });
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
    const data = await MXApplicationClient.companyDetail({ id, token: TOKEN });
    const comp = data.company;
    if (!comp) { body.innerHTML = '<div class="empty-state">Company not found</div>'; return; }

    const ident = comp.identification || {};
    body.innerHTML = `
      <div class="detail-header">
        <div class="detail-title-group">
          <div class="detail-make">${escapeMarkup(ident.agencytype || 'Company')}</div>
          <div class="detail-model">${escapeMarkup(ident.name)}</div>
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
              ${(comp.businesstypes || []).map(b => `<span class="badge badge-heli">${escapeMarkup(b)}</span>`).join('') || '<span class="td-dim">—</span>'}
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
                  <td class="td-accent">${escapeMarkup([c.firstname, c.lastname].filter(Boolean).join(' '))}</td>
                  <td>${escapeMarkup(c.title || '—')}</td>
                  <td class="td-dim">${escapeMarkup(c.email || '—')}</td>
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
                  <td class="td-mono td-accent related-aircraft" style="cursor:pointer" data-aircraft-id="${safeRecordId(a.aircraftid) ?? ''}">${escapeMarkup(a.aircraftid)}</td>
                  <td>${escapeMarkup(a.relationtype)}</td>
                  <td>${a.isoperator === 'Y' ? '✓ Yes' : 'No'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>` : ''}
      </div>
    `;
    body.querySelectorAll('.related-aircraft[data-aircraft-id]').forEach((cell) => {
      cell.addEventListener('click', () => {
        const aircraftId = safeRecordId(cell.dataset.aircraftId);
        if (aircraftId === null) return;
        closeModal('compDetailModal');
        showAircraftDetail(aircraftId);
      });
    });
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
    const data = await MXApplicationClient.contactList({ token: TOKEN, bearer: BEARER, filters: body });

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
              <td class="td-accent">${escapeMarkup([c.sirname, c.firstname, c.lastname, c.suffix].filter(Boolean).join(' '))}</td>
              <td>${escapeMarkup(c.title || '—')}</td>
              <td>${escapeMarkup(c.companyname || '—')}</td>
              <td class="td-dim">${escapeMarkup(c.email || '—')}</td>
              <td class="td-mono">${escapeMarkup(c.phonenumber || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="padding:12px;color:var(--text-muted);font-size:0.78rem;">
        ${escapeMarkup(data.count)} contacts
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
  const counts = { aog: 0, aftt12000: 0, aftt8000: 0, other: 0 };
  aircraft.forEach(ac => {
    const icao = (ac.baseicao || ac.baseicaocode || '').toUpperCase().trim();
    const coords = ICAO_COORDS[icao];
    if (!coords) return;
    if (!clusters[icao]) clusters[icao] = { icao, lat: coords[0], lng: coords[1], aircraft: [], hasAog: false, hasVeryHighTime: false, hasHighTime: false, city: '', country: '' };
    const c = clusters[icao];
    c.aircraft.push(ac);
    if (!c.city) c.city = ac.basecity || '';
    if (!c.country) c.country = ac.basecountry || ac.country || '';
    const mro = buildMROSignals(ac);
    if (mro.isAOG) { c.hasAog = true; counts.aog++; }
    else if (mro.isVeryHighTime) { c.hasVeryHighTime = true; counts.aftt12000++; }
    else if (mro.isHighTime) { c.hasHighTime = true; counts.aftt8000++; }
    else { counts.other++; }
  });
  return { clusters: Object.values(clusters), counts };
}

function clusterColor(d) {
  if (d.hasActiveCase) return '#00d4ff';
  if (d.hasAog) return '#ff4444';
  if (d.hasVeryHighTime) return '#ef4444';
  if (d.hasHighTime) return '#f59e0b';
  return '#10b981';
}
function clusterRadius(d) {
  const count = Math.max(1, d.aircraft?.length || Number(d.count) || 1);
  const emphasis = d.hasActiveCase || d.hasAog ? 0.025 : 0;
  return Math.min(0.22, 0.055 + Math.log2(count + 1) * 0.022 + emphasis);
}
function clusterAltitude() { return 0.0015; }
function attentionClusters(clusters) { return clusters.filter((cluster) => cluster.hasActiveCase || cluster.hasAog); }
function clusterRingRadius(d) { return Math.min(0.55, Math.max(0.22, clusterRadius(d) * 2.4)); }
function clusterRingColor(d) { const color = clusterColor(d); return [`${color}cc`, `${color}00`]; }

function applyGlobeFilters() {
  if (!globeInstance || !allClusters.length) return;
  const q = (document.getElementById('globeSearch')?.value || '').toLowerCase().trim();
  const typeFilter = document.getElementById('globeTypeFilter')?.value || '';
  let filtered = allClusters;
  if (activeUrgencyFilter) {
    filtered = filtered.filter(c => {
      if (activeUrgencyFilter === 'active-case') return c.hasActiveCase;
      if (activeUrgencyFilter === 'aog') return c.hasAog;
      if (activeUrgencyFilter === 'aftt-12000') return c.hasVeryHighTime;
      if (activeUrgencyFilter === 'aftt-8000') return c.hasHighTime;
      if (activeUrgencyFilter === 'other') return !c.hasAog && !c.hasVeryHighTime && !c.hasHighTime;
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
  globeInstance.pointsData(filtered).ringsData(attentionClusters(filtered));
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
  // Close button
  const closeBtn = document.getElementById('globeSheetClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      currentState = 0;
      sheet.className = 'globe-sheet';
    });
  }
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

  // Click outside sheet to close it
  const gc = document.getElementById('globeContainer');
  if (gc) {
    gc.addEventListener('click', (e) => {
      if (!sheet.contains(e.target)) {
        currentState = 0;
        sheet.className = 'globe-sheet';
      }
    });
  }
}

function handleGlobeClick(point) {
  if (!point || !point.aircraft) return;
  const sheet = document.getElementById('globeSheet');
  const results = document.getElementById('globeSheetResults');
  sheet.className = 'globe-sheet full';
  results.innerHTML = `<div class="drill-header"><span class="drill-icao">${escapeMarkup(point.icao)}</span>${point.city ? '<span>' + escapeMarkup(point.city) + '</span>' : ''}<span class="drill-count">${point.aircraft.length} aircraft</span></div>` +
    point.aircraft.map(ac => {
      const mro = buildMROSignals(ac);
      const ul = mro.isAOG ? 'AOG' : mro.isVeryHighTime ? '12K+ AFTT' : mro.isHighTime ? '8K+ AFTT' : 'Other';
      const uc = mro.isAOG ? 'critical' : mro.isVeryHighTime ? 'overdue' : mro.isHighTime ? 'high-time' : 'current';
      return `<div class="drill-card" data-aircraft-id="${safeRecordId(ac.aircraftid) ?? ''}"><span class="drill-reg">${escapeMarkup(ac.regnbr || '—')}</span><span class="drill-model">${escapeMarkup([ac.make, ac.model].filter(Boolean).join(' '))}</span><span class="drill-owner">${escapeMarkup(ac.owner || ac.operator || '')}</span><span class="drill-urgency badge-${uc}">${ul}</span></div>`;
    }).join('');
  results.querySelectorAll('.drill-card[data-aircraft-id]').forEach((card) => {
    card.addEventListener('click', () => {
      const id = safeRecordId(card.dataset.aircraftId);
      if (id !== null) showAircraftDetail(id);
    });
  });
  globeInstance.pointOfView({ lat: point.lat, lng: point.lng, altitude: 0.8 }, 800);
}

function handleGlobeHover(point) {
  window._lastGlobePoint = point;
  const tooltip = document.getElementById('globeTooltip');
  const container = document.getElementById('globeContainer');
  if (point) {
    globeInstance.controls().autoRotate = false;
    const ul = point.hasAog ? 'AOG reported' : point.hasVeryHighTime ? '12K+ reported AFTT' : point.hasHighTime ? '8K+ reported AFTT' : 'No selected triage flag';
    tooltip.innerHTML = `<div class="tt-icao">${escapeMarkup(point.icao)}</div><div class="tt-count">${point.aircraft.length} aircraft</div><div class="tt-urgency">${ul}${point.city ? ' · ' + escapeMarkup(point.city) : ''}</div>`;
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

function openGlobeInVR() {
  if (!allClusters.length) return;
  const payload = {
    version: 2,
    createdAt: new Date().toISOString(),
    totalAircraft: globeData?.totalAircraft || 0,
    mappedAircraft: globeData?.mappedAircraft || 0,
    clusters: allClusters.map((cluster) => ({
      icao: cluster.icao,
      lat: cluster.lat,
      lng: cluster.lng,
      city: cluster.city || '',
      country: cluster.country || '',
      count: cluster.aircraft.length,
      aircraft: cluster.aircraft.map((aircraft) => {
        const signals = buildMROSignals(aircraft);
        return {
          aircraftid: safeRecordId(aircraft.aircraftid),
          regnbr: aircraft.regnbr || '',
          make: aircraft.make || '',
          model: aircraft.model || '',
          owner: aircraft.owner || aircraft.operator || '',
          urgency: signals.isAOG ? 'AOG' : signals.isVeryHighTime ? '12K+ AFTT' : signals.isHighTime ? '8K+ AFTT' : 'Other'
        };
      }).filter((aircraft) => aircraft.aircraftid !== null),
      hasActiveCase: Boolean(cluster.hasActiveCase),
      hasAog: Boolean(cluster.hasAog),
      hasVeryHighTime: Boolean(cluster.hasVeryHighTime),
      hasHighTime: Boolean(cluster.hasHighTime)
    }))
  };
  try {
    localStorage.setItem('mxg_globe_vr_data', JSON.stringify(payload));
  } catch (error) {
    console.warn('Unable to cache fleet globe data for VR', error);
  }
  window.location.assign('globe-vr.html?v=5');
}

async function loadGlobe() {
  const container = document.getElementById('globeViz');
  if (!globeInstance) container.innerHTML = '<div class="loading" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:5;">Loading globe...</div>';

  const body = {};
  try {
    const data = await MXApplicationClient.aircraftList({ token: TOKEN, bearer: BEARER, filters: body });
    if (data.responsestatus && data.responsestatus !== 'Success' && data.responsestatus !== 'SUCCESS') { container.innerHTML = `<div class="empty-state">Fleet source error: ${escapeMarkup(data.responsestatus)}</div>`; return; }
    const aircraft = data.aircraft || [];
    const { clusters, counts } = clusterByAirport(aircraft);
    clusters.forEach((cluster) => {
      cluster.hasActiveCase = cluster.aircraft.some((item) => MXCaseState.matchesAircraft(item));
    });
    allClusters = clusters;
    globeData = { totalAircraft: aircraft.length, mappedAircraft: clusters.reduce((s, c) => s + c.aircraft.length, 0), byCountry: {}, counts };
    clusters.forEach(c => { if (c.country) globeData.byCountry[c.country] = true; });
  } catch (e) { console.error('Globe data fetch failed:', e); container.innerHTML = '<div class="empty-state" style="color:var(--text-danger);">Could not load aircraft registry data.</div>'; return; }

  document.getElementById('globeTotal').textContent = globeData.totalAircraft.toLocaleString();
  document.getElementById('globeMapped').textContent = globeData.mappedAircraft.toLocaleString();
  document.getElementById('globeCountries').textContent = Object.keys(globeData.byCountry).length;
  const cn = globeData.counts;
  const pe = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  pe('pillAog', cn.aog); pe('pillAftt12000', cn.aftt12000); pe('pillAftt8000', cn.aftt8000); pe('pillOther', cn.other);
  pe('pillActiveCase', allClusters.some((cluster) => cluster.hasActiveCase) ? 1 : 0);
  const vrButton = document.getElementById('globeVrButton');
  if (vrButton) {
    vrButton.disabled = !allClusters.length;
    if (!vrButton.dataset.bound) {
      vrButton.dataset.bound = 'true';
      vrButton.addEventListener('click', openGlobeInVR);
    }
  }

  if (!globeInstance) {
    container.innerHTML = '';
    globeInstance = Globe()
      .globeImageUrl('earth-night.jpg')
      .bumpImageUrl('earth-topology.png')
      .backgroundImageUrl('night-sky.png')
      .pointsData(allClusters).pointLat('lat').pointLng('lng')
      .pointAltitude(clusterAltitude).pointRadius(clusterRadius).pointColor(clusterColor)
      .pointResolution(12).pointsMerge(false).pointsTransitionDuration(250)
      .onPointHover(handleGlobeHover).onPointClick(handleGlobeClick)
      .ringsData(attentionClusters(allClusters)).ringLat('lat').ringLng('lng')
      .ringAltitude(0.0025).ringColor(clusterRingColor).ringMaxRadius(clusterRingRadius)
      .ringPropagationSpeed(0.22).ringRepeatPeriod(1800)
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
    globeInstance
      .pointsData(allClusters)
      .ringsData(attentionClusters(allClusters))
      .pointColor(clusterColor)
      .pointRadius(clusterRadius)
      .pointAltitude(clusterAltitude);
  }
}
