/** Schema-driven surface for the mounted MXGenius capability catalog. */
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
  const FALLBACK_TOOLS = FALLBACK_NAMES.map((name) => ({
    name,
    description: 'Typed v1 capability contract',
    inputSchema: { type: 'object', properties: {} },
    mounted: false
  }));
  const state = { tools: [], selected: null, caseContext: null };
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

  function domainOf(name) {
    return name.split('.')[1]?.replaceAll('_', ' ') || 'other';
  }

  function titleOf(name) {
    return name.split('.').at(-1).replaceAll('_', ' ');
  }

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

  function renderCatalog(filter = '') {
    const target = byId('capabilityCatalog');
    const normalized = filter.trim().toLowerCase();
    const tools = state.tools.filter((tool) => `${tool.name} ${tool.description || ''}`.toLowerCase().includes(normalized));
    const groups = tools.reduce((result, tool) => {
      const domain = domainOf(tool.name);
      if (!result.has(domain)) result.set(domain, []);
      result.get(domain).push(tool);
      return result;
    }, new Map());
    target.innerHTML = [...groups].map(([domain, entries]) => `
      <section class="capability-domain">
        <h2>${escapeHtml(domain)} <span>${entries.length}</span></h2>
        <div class="capability-grid">${entries.map((tool) => `
          <button type="button" class="capability-card" data-capability="${escapeHtml(tool.name)}">
            <strong>${escapeHtml(titleOf(tool.name))}</strong>
            <span>${escapeHtml(tool.description || 'Typed MXGenius capability')}</span>
          </button>`).join('')}</div>
      </section>`).join('') || '<p class="capability-empty">No matching capabilities.</p>';
    target.querySelectorAll('[data-capability]').forEach((button) => {
      button.addEventListener('click', () => select(button.dataset.capability));
    });
  }

  function select(name) {
    state.selected = state.tools.find((tool) => tool.name === name);
    if (!state.selected) return;
    byId('capabilityRunner').hidden = false;
    byId('capabilityRunnerTitle').textContent = titleOf(name);
    byId('capabilityRunnerName').textContent = name;
    byId('capabilityArguments').value = JSON.stringify(defaultArguments(state.selected), null, 2);
    byId('capabilitySchema').textContent = JSON.stringify(state.selected.inputSchema || {}, null, 2);
    byId('capabilityResult').hidden = true;
    byId('capabilityRunner').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function execute(event) {
    event.preventDefault();
    const button = byId('capabilityRunButton');
    const result = byId('capabilityResult');
    button.disabled = true;
    button.textContent = 'Running…';
    try {
      const args = JSON.parse(byId('capabilityArguments').value || '{}');
      const envelope = await MXApplicationClient.capabilities.call(state.selected.name, args, session());
      result.dataset.state = envelope?.status || 'completed';
      result.textContent = JSON.stringify(envelope, null, 2);
      result.hidden = false;
    } catch (error) {
      result.dataset.state = 'failed';
      result.textContent = JSON.stringify({ code: error.code || 'CAPABILITY_FAILED', message: error.message, details: error.details || null }, null, 2);
      result.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Run capability';
    }
  }

  async function load() {
    const status = byId('capabilityStatus');
    status.textContent = 'Loading mounted capabilities…';
    try {
      const response = await MXApplicationClient.capabilities.list(session());
      state.tools = response?.tools || [];
      status.textContent = `${state.tools.length} typed capabilities mounted`;
      status.dataset.state = state.tools.length ? 'ready' : 'empty';
      renderCatalog(byId('capabilitySearch').value);
    } catch (error) {
      state.tools = FALLBACK_TOOLS;
      status.textContent = `${state.tools.length} typed capabilities ready · execution service unavailable`;
      status.dataset.state = 'empty';
      renderCatalog(byId('capabilitySearch').value);
    }
  }

  function init() {
    byId('capabilityRefresh')?.addEventListener('click', load);
    byId('capabilitySearch')?.addEventListener('input', (event) => renderCatalog(event.target.value));
    byId('capabilityRunnerForm')?.addEventListener('submit', execute);
    globalThis.addEventListener('mxg:case-selected', (event) => { state.caseContext = event.detail; });
    load();
  }

  return Object.freeze({ init, reload: load });
})();

document.addEventListener('DOMContentLoaded', MXCapabilityWorkbench.init);
