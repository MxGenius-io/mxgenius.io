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
    partHydraulic: Object.freeze({
      src: 'media/demo/part-hydraulic-pump.jpg',
      alt: 'Fictional demo visual of an aviation hydraulic pump assembly',
      classification: 'demonstration'
    }),
    partWheelBrake: Object.freeze({
      src: 'media/demo/part-wheel-brake.jpg',
      alt: 'Fictional demo visual of an aviation wheel and brake assembly',
      classification: 'demonstration'
    }),
    partConsumables: Object.freeze({
      src: 'media/demo/part-consumables.jpg',
      alt: 'Fictional demo visual of organized aviation consumable parts',
      classification: 'demonstration'
    })
  });

  const PRESENTATION_STORAGE_KEY = 'mxg_demo_presentation_mode';
  const DEMO_DATASET = 'mxgenius_complete_demo';

  function value(record, snake, camel = snake) {
    return record?.[snake] ?? record?.[camel] ?? '';
  }

  function isDemoCase(caseState = {}) {
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
      value(record, 'part_number', 'partNumber'),
      value(record, 'aircraft_id', 'aircraftId'),
      value(record, 'serial_number', 'serialNumber'),
      value(record, 'location_code', 'locationCode'),
      record.code,
      record.name,
      record.description,
      record.summary,
      value(record, 'raw_discrepancy', 'rawDiscrepancy'),
      record.supplier,
      value(record, 'from_location', 'fromLocation'),
      value(record, 'to_location', 'toLocation'),
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
    if (/cabin|filter|environmental/.test(searchable)) return ASSETS.maintenanceFilter;
    if (/wheel|brake|landing gear/.test(searchable)) return ASSETS.maintenanceWheel;
    return ASSETS.maintenanceHydraulic;
  }

  function isDemoPart(unit = {}) {
    return hasDemoMarker(unit)
      || /^MXG-DEMO-/i.test(String(value(unit, 'part_number', 'partNumber')));
  }

  function isDemoLocation(location = {}) {
    return hasDemoMarker(location)
      || /^DEMO-/i.test(String(location?.code || ''));
  }

  function aircraftLabelFor(record = {}) {
    return (isDemoCase(record) || hasDemoMarker(record)) ? 'N350MX' : '';
  }

  function mode() {
    try {
      return localStorage.getItem(PRESENTATION_STORAGE_KEY) || 'auto';
    } catch {
      return 'auto';
    }
  }

  function updateDocumentState(active) {
    if (!globalThis.document?.documentElement) return;
    globalThis.document.documentElement.toggleAttribute('data-demo-presentation', active);
  }

  function setMode(nextMode, { announce = true } = {}) {
    const normalized = nextMode === 'all' ? 'all' : 'demo';
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
    if (mode() === 'all') return source;
    const demoRecords = source.filter(predicate);
    if (mode() === 'auto' && demoRecords.length) setMode('demo', { announce: false });
    return isPresentationEnabled() ? demoRecords : source;
  }

  function scopeReportRows(records, reportName) {
    if (mode() === 'all') return Array.isArray(records) ? records : [];
    // A movement summary is already aggregated before it reaches the browser,
    // so it cannot be separated without inventing precision. Keep it clear in
    // presentation mode rather than leaking totals from old test activity.
    if (reportName === 'summary') return [];
    return scope(records, hasDemoMarker);
  }

  updateDocumentState(isPresentationEnabled());

  function forPart(unit = {}) {
    if (!isDemoPart(unit)) return null;
    const searchable = [
      value(unit, 'part_number', 'partNumber'),
      unit?.description,
      unit?.metadata?.ata
    ].filter(Boolean).join(' ').toLowerCase();
    if (/hydraulic pump|29-1001/.test(searchable)) return ASSETS.partHydraulic;
    if (/wheel|brake|32-/.test(searchable)) return ASSETS.partWheelBrake;
    return ASSETS.partConsumables;
  }

  globalThis.MXDemoVisualRegistry = Object.freeze({
    assets: ASSETS,
    isDemoCase,
    isDemoPart,
    aircraftLabelFor,
    forCase,
    forPart,
    presentation: Object.freeze({
      enable: (options) => setMode('demo', options),
      showAll: () => setMode('all'),
      mode,
      isEnabled: isPresentationEnabled,
      scopeCases: (records) => scope(records, isDemoCase),
      scopeParts: (records) => scope(records, isDemoPart),
      scopeLocations: (records) => scope(records, isDemoLocation),
      scopeRecords: (records) => scope(records, hasDemoMarker),
      scopeReportRows
    })
  });
})();
