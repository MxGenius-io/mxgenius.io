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
    return unit?.metadata?.demo === true
      || /^MXG-DEMO-/i.test(String(value(unit, 'part_number', 'partNumber')));
  }

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
    forCase,
    forPart
  });
})();
