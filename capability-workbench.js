/** Operator-facing surface for the mounted MXGenius capability catalog. */
const MXCapabilityWorkbench = (() => {
  const FALLBACK_NAMES = [
    'mxg.aircraft.lookup','mxg.aircraft.profile','mxg.aircraft.location_context','mxg.aircraft.utilization_summary','mxg.aircraft.related_entities','mxg.aircraft.history_window',
    'mxg.maintenance_case.create','mxg.maintenance_case.get','mxg.maintenance_case.build_context','mxg.maintenance_case.similar_cases','mxg.maintenance_case.update_status','mxg.maintenance_case.attach_observation',
    'mxg.parts.resolve','mxg.parts.alternates','mxg.parts.inventory','mxg.parts.rank_options','mxg.parts.attach_certificate',
    'mxg.mro.search','mxg.mro.capability_match','mxg.mro.rank','mxg.mro.contact_pack','mxg.mro.route_eta',
    'mxg.weather.airport_now','mxg.weather.maintenance_window','mxg.weather.ramp_risk','mxg.weather.ferry_assessment','mxg.weather.hazard_overlay',
    'mxg.compliance.applicable_ads','mxg.compliance.saib_search','mxg.compliance.manual_currency','mxg.compliance.record_audit','mxg.compliance.return_to_service_pack',
    'mxg.digital_twin.list_models','mxg.digital_twin.component_state','mxg.digital_twin.highlight_zone','mxg.digital_twin.link_documents','mxg.digital_twin.attach_case_marker',
    'mxg.scheduling.window_options','mxg.scheduling.resource_match','mxg.scheduling.conflict_scan','mxg.scheduling.parts_readiness','mxg.scheduling.publish_plan',
    'mxg.evidence.collect','mxg.evidence.trace_case','mxg.evidence.citation_pack','mxg.evidence.conflict_check',
    'mxg.analytics.fleet_health','mxg.analytics.repeat_defects','mxg.analytics.parts_risk','mxg.analytics.exec_kpis'
  ];

  const JOBS = [
    { id: 'aircraft', title: 'Assess an aircraft', description: 'Identity, profile, location, utilization, relationships, and history.', domains: ['aircraft'] },
    { id: 'case', title: 'Plan and execute maintenance', description: 'Build the case record, plan the work, schedule resources, and connect 3D findings.', domains: ['maintenance_case', 'scheduling', 'digital_twin'] },
    { id: 'support', title: 'Source parts and support', description: 'Resolve parts, check supply, and find qualified MRO facilities.', domains: ['parts', 'mro'] },
    { id: 'weather', title: 'Check operating conditions', description: 'Assess airport weather, ramp risk, maintenance windows, and ferry conditions.', domains: ['weather'] },
    { id: 'assurance', title: 'Verify compliance and evidence', description: 'Review regulatory applicability, source currency, evidence, and release records.', domains: ['compliance', 'evidence'] },
    { id: 'analytics', title: 'Review fleet performance', description: 'Fleet health, repeat defects, parts risk, and operational KPIs.', domains: ['analytics'] }
  ];

  const ACTION_TITLES = {
    lookup: 'Find aircraft', profile: 'View aircraft profile', location_context: 'Check aircraft location', utilization_summary: 'Review utilization', related_entities: 'View owner and operator', history_window: 'Review aircraft history',
    create: 'Create maintenance case', get: 'Open maintenance case', build_context: 'Build case brief', similar_cases: 'Find similar cases', update_status: 'Move case forward', attach_observation: 'Add observation',
    resolve: 'Identify a part', alternates: 'Check alternates', inventory: 'Check inventory', rank_options: 'Compare sourcing options', attach_certificate: 'Attach certificate',
    search: 'Find an MRO facility', capability_match: 'Check facility capability', rank: 'Compare MRO facilities', contact_pack: 'Get facility contacts', route_eta: 'Estimate route time',
    airport_now: 'Current airport weather', maintenance_window: 'Find maintenance window', ramp_risk: 'Assess ramp risk', ferry_assessment: 'Assess ferry window', hazard_overlay: 'Show weather hazards',
    applicable_ads: 'Check applicable ADs', saib_search: 'Search SAIBs', manual_currency: 'Check manual currency', record_audit: 'Audit maintenance records', return_to_service_pack: 'Prepare release evidence',
    list_models: 'Choose aircraft model', component_state: 'View component state', highlight_zone: 'Highlight component zone', link_documents: 'Link documents to model', attach_case_marker: 'Add 3D case marker',
    window_options: 'Find schedule options', resource_match: 'Match resources', conflict_scan: 'Check schedule conflicts', parts_readiness: 'Check parts readiness', publish_plan: 'Publish maintenance plan',
    collect: 'Collect evidence', trace_case: 'Trace case evidence', citation_pack: 'Create citation pack', conflict_check: 'Check evidence conflicts',
    fleet_health: 'Review fleet health', repeat_defects: 'Find repeat defects', parts_risk: 'Review parts risk', exec_kpis: 'Review operational KPIs'
  };

  const FIELD_LABELS = {
    aircraft_id: 'Aircraft', registration: 'Aircraft registration', serial_number: 'Serial number', source_id: 'Source record ID', case_id: 'Maintenance case', case_ids: 'Maintenance cases', raw_discrepancy: 'Observed discrepancy',
    airport_icao: 'Airport (ICAO)', airport_iata: 'Airport (IATA)', icao: 'ICAO code', iata: 'IATA code', mro: 'MRO', facility_id: 'Facility', site_facility_id: 'Site facility', destination_facility: 'Destination facility',
    part_id: 'Part', part_number: 'Part number', part_requirement_id: 'Part requirement', description_query: 'Part description', component_id: 'Component', initial_component_id: 'Initial component',
    start_date: 'Start date', end_date: 'End date', horizon_start: 'Planning window start', horizon_end: 'Planning window end', target_window_start: 'Target start', target_window_end: 'Target end', required_by: 'Required by',
    expected_version: 'Current record version', media_refs: 'Photos or file references', evidence_ids: 'Evidence records', document_reference: 'Document reference', operating_time_need: 'Required operating time'
  };

  const FALLBACK_TOOLS = FALLBACK_NAMES.map((name) => ({
    name,
    description: 'This operation will be available when the capability service reconnects.',
    inputSchema: { type: 'object', properties: {} },
    mounted: false
  }));

  const state = { tools: [], selected: null, caseContext: null, rawDirty: false };
  const byId = (id) => document.getElementById(id);

  function session() {
    const value = globalThis.MXGENIUS_CONFIG?.getSession?.() || {};
    return {
      accessToken: value.accessToken,
      organizationId: value.organizationId,
      correlationId: globalThis.crypto?.randomUUID?.()
    };
  }

  function escapeHtml(value) {
    const node = document.createElement('span');
    node.textContent = String(value ?? '');
    return node.innerHTML;
  }

  function domainOf(name) { return name.split('.')[1] || 'other'; }
  function suffixOf(name) { return name.split('.').at(-1); }
  function titleOf(name) { return ACTION_TITLES[suffixOf(name)] || humanize(suffixOf(name)); }
  function humanize(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  function labelOf(name) { return FIELD_LABELS[name] || humanize(name); }

  function defaultArguments(tool) {
    const properties = tool.inputSchema?.properties || {};
    const values = {};
    for (const [name, spec] of Object.entries(properties)) {
      if (name === 'case_id' && state.caseContext?.caseId) values[name] = state.caseContext.caseId;
      else if (name === 'aircraft_id' && state.caseContext?.case?.aircraft_id) values[name] = state.caseContext.case.aircraft_id;
      else if (spec.default !== undefined) values[name] = spec.default;
    }
    return values;
  }

  function jobFor(tool) {
    const domain = domainOf(tool.name);
    return JOBS.find((job) => job.domains.includes(domain)) || { id: 'other', title: 'Other operations', description: '', domains: [] };
  }

  function renderCatalog(filter = '') {
    const target = byId('capabilityCatalog');
    const normalized = filter.trim().toLowerCase();
    const tools = state.tools.filter((tool) => `${titleOf(tool.name)} ${tool.name} ${tool.description || ''} ${jobFor(tool).title}`.toLowerCase().includes(normalized));
    const groups = JOBS.map((job) => ({ job, entries: tools.filter((tool) => job.domains.includes(domainOf(tool.name))) })).filter(({ entries }) => entries.length);
    target.innerHTML = groups.map(({ job, entries }) => `
      <section class="capability-domain" aria-labelledby="capability-job-${job.id}">
        <header class="capability-domain__header">
          <div><h2 id="capability-job-${job.id}">${escapeHtml(job.title)} <span>${entries.length}</span></h2><p>${escapeHtml(job.description)}</p></div>
        </header>
        <div class="capability-grid">${entries.map((tool) => `
          <button type="button" class="capability-card${tool.name === state.selected?.name ? ' is-selected' : ''}" data-capability="${escapeHtml(tool.name)}">
            <strong>${escapeHtml(titleOf(tool.name))}</strong>
            <span>${escapeHtml(tool.description || 'Open this operation')}</span>
          </button>`).join('')}</div>
      </section>`).join('') || '<p class="capability-empty">No matching operations.</p>';
    target.querySelectorAll('[data-capability]').forEach((button) => button.addEventListener('click', () => select(button.dataset.capability)));
  }

  function resolveSchema(spec, root) {
    const original = spec || {};
    let resolved = original;
    for (let pass = 0; pass < 4; pass += 1) {
      if (resolved.$ref?.startsWith('#/')) {
        resolved = resolved.$ref.slice(2).split('/').reduce((value, key) => value?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], root) || resolved;
        continue;
      }
      const variants = resolved.oneOf || resolved.anyOf;
      if (variants) {
        resolved = variants.find((item) => item.type !== 'null') || resolved;
        continue;
      }
      break;
    }
    return { ...original, ...resolved };
  }

  function fieldMarkup(name, originalSpec, path, required, root) {
    const spec = resolveSchema(originalSpec, root);
    const fieldPath = [...path, name].join('.');
    const fieldId = `capability-field-${fieldPath.replaceAll('.', '-')}`;
    const label = labelOf(name);
    const requiredText = required ? '<span aria-hidden="true">Required</span>' : '<span>Optional</span>';
    const description = spec.description ? `<small>${escapeHtml(spec.description)}</small>` : '';

    if (spec.type === 'object' || spec.properties) {
      const objectRequired = new Set(spec.required || []);
      return `<fieldset class="capability-fieldset"><legend>${escapeHtml(label)} ${requiredText}</legend>${description}<div class="capability-fields capability-fields--nested">${Object.entries(spec.properties || {}).map(([childName, childSpec]) => fieldMarkup(childName, childSpec, [...path, name], objectRequired.has(childName), root)).join('')}</div></fieldset>`;
    }

    const enumValues = spec.enum || [];
    let control;
    if (enumValues.length) {
      control = `<select id="${fieldId}" data-path="${escapeHtml(fieldPath)}" data-kind="enum" ${required ? 'required' : ''}><option value="">${required ? 'Select an option' : 'Not specified'}</option>${enumValues.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(humanize(value))}</option>`).join('')}</select>`;
    } else if (spec.type === 'boolean') {
      control = `<label class="capability-toggle"><input id="${fieldId}" data-path="${escapeHtml(fieldPath)}" data-kind="boolean" data-required="${required}" type="checkbox"><span>Yes</span></label>`;
    } else if (spec.type === 'array') {
      control = `<textarea id="${fieldId}" data-path="${escapeHtml(fieldPath)}" data-kind="array" rows="3" placeholder="Enter one item per line" ${required ? 'required' : ''}></textarea>`;
    } else if (spec.type === 'number' || spec.type === 'integer') {
      control = `<input id="${fieldId}" data-path="${escapeHtml(fieldPath)}" data-kind="${spec.type}" type="number" ${spec.type === 'integer' ? 'step="1"' : 'step="any"'} ${spec.minimum !== undefined ? `min="${spec.minimum}"` : ''} ${spec.maximum !== undefined ? `max="${spec.maximum}"` : ''} ${required ? 'required' : ''}>`;
    } else if (spec.type && spec.type !== 'string') {
      control = `<textarea id="${fieldId}" data-path="${escapeHtml(fieldPath)}" data-kind="json" rows="4" placeholder="Enter structured details" ${required ? 'required' : ''}></textarea>`;
    } else {
      const isLong = /discrepancy|description|query|note|reason|constraints|assumptions/i.test(name);
      const format = spec.format === 'date-time' ? 'datetime-local' : spec.format === 'date' ? 'date' : 'text';
      control = isLong
        ? `<textarea id="${fieldId}" data-path="${escapeHtml(fieldPath)}" data-kind="string" rows="4" ${required ? 'required' : ''}></textarea>`
        : `<input id="${fieldId}" data-path="${escapeHtml(fieldPath)}" data-kind="string" type="${format}" ${spec.minLength ? `minlength="${spec.minLength}"` : ''} ${spec.maxLength ? `maxlength="${spec.maxLength}"` : ''} ${required ? 'required' : ''}>`;
    }
    return `<div class="capability-field"><label for="${fieldId}">${escapeHtml(label)} ${requiredText}</label>${control}${description}</div>`;
  }

  function renderFields(tool, values) {
    const schema = tool.inputSchema || {};
    const required = new Set(schema.required || []);
    const fields = Object.entries(schema.properties || {}).map(([name, spec]) => fieldMarkup(name, spec, [], required.has(name), schema)).join('');
    byId('capabilityFields').innerHTML = fields || '<p class="capability-empty-state">No additional information is required for this operation.</p>';
    populateFields(values);
    byId('capabilityFields').querySelectorAll('[data-path]').forEach((control) => {
      control.addEventListener('input', () => { state.rawDirty = false; syncRawRequest(); });
      control.addEventListener('change', () => { state.rawDirty = false; syncRawRequest(); });
    });
  }

  function valueAt(source, path) { return path.split('.').reduce((value, key) => value?.[key], source); }

  function populateFields(values) {
    byId('capabilityFields').querySelectorAll('[data-path]').forEach((control) => {
      const value = valueAt(values, control.dataset.path);
      if (value === undefined || value === null) return;
      if (control.dataset.kind === 'boolean') control.checked = Boolean(value);
      else if (control.dataset.kind === 'array') control.value = Array.isArray(value) ? value.join('\n') : value;
      else if (control.dataset.kind === 'json') control.value = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      else if (control.type === 'datetime-local') control.value = String(value).replace('Z', '').slice(0, 16);
      else control.value = value;
    });
  }

  function setAt(target, path, value) {
    const keys = path.split('.');
    let cursor = target;
    keys.slice(0, -1).forEach((key) => { cursor[key] ||= {}; cursor = cursor[key]; });
    cursor[keys.at(-1)] = value;
  }

  function collectFields() {
    const values = {};
    byId('capabilityFields').querySelectorAll('[data-path]').forEach((control) => {
      const kind = control.dataset.kind;
      let value = control.value?.trim?.() ?? control.value;
      if (kind === 'boolean') {
        if (!control.checked && control.dataset.required !== 'true') return;
        value = control.checked;
      } else if (value === '') return;
      else if (kind === 'integer') value = Number.parseInt(value, 10);
      else if (kind === 'number') value = Number.parseFloat(value);
      else if (kind === 'array') value = value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
      else if (kind === 'json') value = JSON.parse(value);
      else if (control.type === 'datetime-local') value = new Date(value).toISOString();
      setAt(values, control.dataset.path, value);
    });
    return values;
  }

  function syncRawRequest() {
    try { byId('capabilityArguments').value = JSON.stringify(collectFields(), null, 2); } catch { /* An incomplete advanced field is allowed while editing. */ }
  }

  function select(name) {
    state.selected = state.tools.find((tool) => tool.name === name);
    if (!state.selected) return;
    const defaults = defaultArguments(state.selected);
    state.rawDirty = false;
    byId('capabilityRunner').hidden = false;
    byId('capabilityRunnerTitle').textContent = titleOf(name);
    byId('capabilityRunnerName').textContent = jobFor(state.selected).title;
    byId('capabilityRunnerDescription').textContent = state.selected.description || 'Complete the details below to run this operation.';
    byId('capabilityArguments').value = JSON.stringify(defaults, null, 2);
    byId('capabilitySchema').textContent = JSON.stringify(state.selected.inputSchema || {}, null, 2);
    renderFields(state.selected, defaults);
    byId('capabilityResultSummary').hidden = true;
    byId('capabilityResultAdvanced').hidden = true;
    renderCatalog(byId('capabilitySearch').value);
    byId('capabilityRunner').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderPrimitive(value) {
    if (value === null || value === undefined || value === '') return '<span class="capability-result__muted">Not available</span>';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return escapeHtml(value);
  }

  function renderOutput(value, depth = 0) {
    if (value === null || value === undefined) return '<p class="capability-empty-state">No records returned.</p>';
    if (typeof value !== 'object') return `<p>${renderPrimitive(value)}</p>`;
    if (Array.isArray(value)) {
      if (!value.length) return '<p class="capability-empty-state">No records returned.</p>';
      if (value.every((item) => typeof item !== 'object' || item === null)) return `<ul class="capability-result-list">${value.map((item) => `<li>${renderPrimitive(item)}</li>`).join('')}</ul>`;
      return `<div class="capability-result-records">${value.map((item, index) => `<article class="capability-result-record"><span class="capability-result-record__number">${index + 1}</span>${renderOutput(item, depth + 1)}</article>`).join('')}</div>`;
    }
    const entries = Object.entries(value);
    if (!entries.length) return '<p class="capability-empty-state">No records returned.</p>';
    const simple = entries.filter(([, item]) => typeof item !== 'object' || item === null);
    const complex = entries.filter(([, item]) => typeof item === 'object' && item !== null);
    return `${simple.length ? `<dl class="capability-result-facts">${simple.map(([key, item]) => `<div><dt>${escapeHtml(labelOf(key))}</dt><dd>${renderPrimitive(item)}</dd></div>`).join('')}</dl>` : ''}${complex.map(([key, item]) => `<section class="capability-result-group"><h4>${escapeHtml(labelOf(key))}</h4>${depth >= 3 ? `<pre>${escapeHtml(JSON.stringify(item, null, 2))}</pre>` : renderOutput(item, depth + 1)}</section>`).join('')}`;
  }

  function renderEnvelope(envelope, failed = false) {
    const summary = byId('capabilityResultSummary');
    const status = failed ? 'failed' : (envelope?.status || 'completed');
    const statusLabel = status === 'completed' ? 'Complete' : status === 'partial' ? 'Partial result' : status === 'not_configured' ? 'Source unavailable' : humanize(status);
    const message = failed
      ? (envelope?.message || 'The operation could not be completed.')
      : status === 'partial' || status === 'not_configured'
        ? 'Available information is shown below. One or more sources may not be connected.'
        : 'Operation completed.';
    summary.dataset.state = status;
    summary.innerHTML = `<header><span class="capability-result-status">${escapeHtml(statusLabel)}</span><p>${escapeHtml(message)}</p></header><div class="capability-result-body">${renderOutput(failed ? envelope?.details : envelope?.output)}</div>`;
    summary.hidden = false;
    byId('capabilityResult').textContent = JSON.stringify(envelope, null, 2);
    byId('capabilityResultAdvanced').hidden = false;
  }

  async function execute(event) {
    event.preventDefault();
    const button = byId('capabilityRunButton');
    button.disabled = true;
    button.textContent = 'Working…';
    try {
      const args = state.rawDirty ? JSON.parse(byId('capabilityArguments').value || '{}') : collectFields();
      byId('capabilityArguments').value = JSON.stringify(args, null, 2);
      const envelope = await MXApplicationClient.capabilities.call(state.selected.name, args, session());
      renderEnvelope(envelope);
    } catch (error) {
      renderEnvelope({ code: error.code || 'OPERATION_FAILED', message: error.message, details: error.details || null }, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Run operation';
    }
  }

  async function load() {
    const status = byId('capabilityStatus');
    status.textContent = 'Connecting operational services…';
    try {
      const response = await MXApplicationClient.capabilities.list(session());
      state.tools = response?.tools || [];
      status.textContent = `${state.tools.length} operations ready`;
      status.dataset.state = state.tools.length ? 'ready' : 'empty';
    } catch (error) {
      state.tools = FALLBACK_TOOLS;
      status.textContent = `${state.tools.length} operations listed · service reconnecting`;
      status.dataset.state = 'empty';
    }
    renderCatalog(byId('capabilitySearch').value);
  }

  function closeRunner() {
    state.selected = null;
    byId('capabilityRunner').hidden = true;
    renderCatalog(byId('capabilitySearch').value);
  }

  function init() {
    byId('capabilityRefresh')?.addEventListener('click', load);
    byId('capabilitySearch')?.addEventListener('input', (event) => renderCatalog(event.target.value));
    byId('capabilityRunnerClose')?.addEventListener('click', closeRunner);
    byId('capabilityArguments')?.addEventListener('input', () => { state.rawDirty = true; });
    byId('capabilityRunnerForm')?.addEventListener('submit', execute);
    globalThis.addEventListener('mxg:case-selected', (event) => {
      state.caseContext = event.detail;
      if (state.selected && !state.rawDirty) {
        const values = { ...collectFields(), ...defaultArguments(state.selected) };
        populateFields(values);
        syncRawRequest();
      }
    });
    load();
  }

  return Object.freeze({ init, reload: load });
})();

document.addEventListener('DOMContentLoaded', MXCapabilityWorkbench.init);
