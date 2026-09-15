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
    }),
    partWheelAssembly: Object.freeze({
      src: 'media/demo/part-wheel-assembly.jpg',
      alt: 'Fictional demo visual of a business jet wheel assembly',
      classification: 'demonstration'
    }),
    partBrakeStack: Object.freeze({
      src: 'media/demo/part-brake-stack.jpg',
      alt: 'Fictional demo visual of an aircraft brake stack and housing',
      classification: 'demonstration'
    }),
    partTires: Object.freeze({
      src: 'media/demo/part-tires.jpg',
      alt: 'Fictional demo visual of main and nose aircraft tires',
      classification: 'demonstration'
    }),
    partWheelHardware: Object.freeze({
      src: 'media/demo/part-wheel-hardware.jpg',
      alt: 'Fictional demo visual of organized aircraft wheel service hardware',
      classification: 'demonstration'
    }),
    partFilters: Object.freeze({
      src: 'media/demo/part-filters.jpg',
      alt: 'Fictional demo visual of aircraft cabin, hydraulic, and oil filter elements',
      classification: 'demonstration'
    }),
    partElectrical: Object.freeze({
      src: 'media/demo/part-electrical.jpg',
      alt: 'Fictional demo visual of aircraft electrical and anti-skid components',
      classification: 'demonstration'
    }),
    partPitotProbe: Object.freeze({
      src: 'media/demo/part-pitot-probe.jpg',
      alt: 'Fictional demo visual of a heated business jet pitot probe',
      classification: 'demonstration'
    }),
    partLandingLight: Object.freeze({
      src: 'media/demo/part-landing-light.jpg',
      alt: 'Fictional demo visual of an aircraft landing light assembly',
      classification: 'demonstration'
    }),
    partFlightControl: Object.freeze({
      src: 'media/demo/part-flight-control.jpg',
      alt: 'Fictional demo visual of flight-control and landing-gear hardware',
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
    if (/landing light|light assembly|condensation/.test(searchable)) return ASSETS.maintenanceLandingLight;
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

  function scopeReportRows(records, reportName) {
    if (mode() === 'operational') return scope(records, hasDemoMarker);
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
    if (/cabin air filter|hydraulic filter|oil filter|21-2200|29-1002|79-7001/.test(searchable)) return ASSETS.partFilters;
    if (/pitot|34-6001/.test(searchable)) return ASSETS.partPitotProbe;
    if (/landing light|33-5001/.test(searchable)) return ASSETS.partLandingLight;
    if (/generator control|wheel speed transducer|anti-skid|24-3001|32-190/.test(searchable)) return ASSETS.partElectrical;
    if (/turnbuckle|shimmy damper|gear door seal|27-4001|32-180/.test(searchable)) return ASSETS.partFlightControl;
    if (/main tire|nose tire|32-130/.test(searchable)) return ASSETS.partTires;
    if (/brake|torque plate|32-120|32-1702/.test(searchable)) return ASSETS.partBrakeStack;
    if (/wheel assembly|wheel hub cap|32-110|32-1701/.test(searchable)) return ASSETS.partWheelAssembly;
    if (/bearing|wheel tie|axle nut|cotter pin|thermal fuse|tire valve|32-140|32-150|32-160/.test(searchable)) return ASSETS.partWheelHardware;
    if (/wheel|32-/.test(searchable)) return ASSETS.partWheelBrake;
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
      hide: () => setMode('operational'),
      showAll: () => setMode('operational'),
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
