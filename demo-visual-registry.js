(() => {
  'use strict';

  const ASSETS = Object.freeze({
    maintenanceHydraulic: Object.freeze({
      src: 'media/demo/maintenance-hydraulic-bay.jpg',
      alt: 'Fictional demo visual of a business jet hydraulic equipment bay',
      classification: 'demonstration'
    }),
    maintenanceFilter: Object.freeze({
      src: 'media/demo/maintenance-cabin-filter.jpg',
      alt: 'Fictional demo visual of a business jet cabin air filter inspection',
      classification: 'demonstration'
    }),
    maintenanceWheel: Object.freeze({
      src: 'media/demo/maintenance-wheel-brake.jpg',
      alt: 'Fictional demo visual of a business jet wheel and brake inspection',
      classification: 'demonstration'
    }),
    maintenanceLandingLight: Object.freeze({
      src: 'media/demo/maintenance-landing-light.jpg',
      alt: 'Fictional demo inspection image of condensation in an installed aircraft landing light',
      classification: 'demonstration'
    }),
    maintenanceStrobe: Object.freeze({
      src: 'media/demo/maintenance-strobe-light.png',
      alt: 'Fictional demo inspection image of a cracked wingtip strobe-light lens',
      classification: 'demonstration'
    }),
    maintenanceWindshield: Object.freeze({
      src: 'media/demo/maintenance-windshield-damage.png',
      alt: 'Fictional demo inspection image of localized outer-ply windshield damage',
      classification: 'demonstration'
    })
  });

  const PRESENTATION_STORAGE_KEY = 'mxg_demo_presentation_mode';
  const DEMO_DATASET = 'mxgenius_complete_demo';
  const FRIDAY_DEMO_SUITE = 'friday_funding_demo';

  function value(record, snake, camel = snake) {
    return record?.[snake] ?? record?.[camel] ?? '';
  }

  function isDemoCase(caseState = {}) {
    if (metadata(caseState)?.presentation_hidden === true) return false;
    const discrepancy = String(value(caseState, 'raw_discrepancy', 'rawDiscrepancy'));
    const aircraftId = String(value(caseState, 'aircraft_id', 'aircraftId'));
    const caseId = String(value(caseState, 'case_id', 'caseId'));
    return /^\[DEMO\]/i.test(discrepancy)
      || /^MXG-DEMO-/i.test(aircraftId)
      || /^d0000000-0000-4000-8000-/i.test(caseId);
  }

  function metadata(record = {}) {
    return record?.metadata
      || record?.normalized_discrepancy
      || record?.normalizedDiscrepancy
      || {};
  }

  function hasDemoMarker(record = {}) {
    if (!record || typeof record !== 'object') return false;
    const recordMetadata = metadata(record);
    if (recordMetadata?.demo === true || recordMetadata?.dataset === DEMO_DATASET) return true;
    const candidates = [
      value(record, 'aircraft_id', 'aircraftId'),
      value(record, 'serial_number', 'serialNumber'),
      value(record, 'location_code', 'locationCode'),
      record.code,
      record.name,
      record.description,
      record.summary,
      value(record, 'raw_discrepancy', 'rawDiscrepancy'),
      record.fileName
    ].filter((candidate) => candidate !== null && candidate !== undefined);
    return candidates.some((candidate) => /^(?:\[DEMO\]|MXG(?:-|\s)DEMO(?:-|\s)|DEMO-)/i.test(String(candidate)));
  }

  function forCase(caseState = {}) {
    if (!isDemoCase(caseState)) return null;
    const searchable = [
      value(caseState, 'raw_discrepancy', 'rawDiscrepancy'),
      caseState?.normalized_discrepancy?.summary,
      caseState?.normalizedDiscrepancy?.summary
    ].filter(Boolean).join(' ').toLowerCase();
    if (/windshield|outer ply|impact mark|transparency/.test(searchable)) return ASSETS.maintenanceWindshield;
    if (/strobe|anti-collision|wingtip light/.test(searchable)) return ASSETS.maintenanceStrobe;
    if (/landing light|light assembly|condensation/.test(searchable)) return ASSETS.maintenanceLandingLight;
    if (/cabin|filter|environmental/.test(searchable)) return ASSETS.maintenanceFilter;
    if (/wheel|brake|landing gear/.test(searchable)) return ASSETS.maintenanceWheel;
    return ASSETS.maintenanceHydraulic;
  }

  function isFridayDemoCase(caseState = {}) {
    return metadata(caseState)?.demo_suite === FRIDAY_DEMO_SUITE;
  }

  function aircraftLabelFor(record = {}) {
    return (isDemoCase(record) || hasDemoMarker(record)) ? 'N350MX' : '';
  }

  function mode() {
    try {
      const stored = localStorage.getItem(PRESENTATION_STORAGE_KEY) || 'auto';
      return stored === 'all' ? 'operational' : stored;
    } catch {
      return 'auto';
    }
  }

  function updateDocumentState(active) {
    if (!globalThis.document?.documentElement) return;
    globalThis.document.documentElement.toggleAttribute('data-demo-presentation', active);
  }

  function setMode(nextMode, { announce = true } = {}) {
    const normalized = nextMode === 'operational' || nextMode === 'all' ? 'operational' : 'demo';
    try {
      localStorage.setItem(PRESENTATION_STORAGE_KEY, normalized);
    } catch {
      // Storage can be unavailable in hardened browser contexts. The current
      // render still scopes from the returned records in automatic mode.
    }
    updateDocumentState(normalized === 'demo');
    if (announce) {
      globalThis.dispatchEvent?.(new CustomEvent('mxg:demo-presentation-changed', {
        detail: { mode: normalized }
      }));
    }
    return normalized;
  }

  function isPresentationEnabled() {
    return mode() === 'demo';
  }

  function scope(records, predicate = hasDemoMarker) {
    const source = Array.isArray(records) ? records : [];
    if (mode() === 'operational') return source.filter((record) => !predicate(record));
    const demoRecords = source.filter(predicate);
    if (mode() === 'auto' && demoRecords.length) setMode('demo', { announce: false });
    return isPresentationEnabled() ? demoRecords : source;
  }

  function scopeFocused(records, predicate, focusPredicate) {
    const scoped = scope(records, predicate);
    if (!isPresentationEnabled()) return scoped;
    const focused = scoped.filter(focusPredicate);
    return focused.length ? focused : scoped;
  }

  updateDocumentState(isPresentationEnabled());

  globalThis.MXDemoVisualRegistry = Object.freeze({
    assets: ASSETS,
    isDemoCase,
    aircraftLabelFor,
    forCase,
    presentation: Object.freeze({
      enable: (options) => setMode('demo', options),
      hide: () => setMode('operational'),
      showAll: () => setMode('operational'),
      mode,
      isEnabled: isPresentationEnabled,
      scopeCases: (records) => scopeFocused(records, isDemoCase, isFridayDemoCase),
      scopeRecords: (records) => scope(records, hasDemoMarker)
    })
  });
})();
