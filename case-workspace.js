/** Maintenance Case workspace mounted on the canonical MCP contract. */
const MXCaseWorkspace = (() => {
  let activeCase = null;
  let activeTwinSelection = null;
  const byId = (id) => document.getElementById(id);
  const text = (value, fallback = 'Not available') => value === null || value === undefined || value === '' ? fallback : String(value);

  function session() {
    const configured = globalThis.MXGENIUS_CONFIG?.getSession?.() || {};
    return {
      accessToken: configured.accessToken,
      organizationId: configured.organizationId,
      correlationId: globalThis.crypto?.randomUUID?.(),
      confirmationGrant: configured.confirmationGrant
    };
  }

  function setStatus(message, state = 'idle') {
    const element = byId('caseWorkspaceStatus');
    if (!element) return;
    element.textContent = message;
    element.dataset.state = state;
  }

  function list(items, render) {
    if (!items?.length) return '<div class="case-workspace__empty">None returned by the capability.</div>';
    return `<ul class="case-workspace__list">${items.map((item) => `<li>${render(item)}</li>`).join('')}</ul>`;
  }

  function escapeHtml(value) {
    const node = document.createElement('span');
    node.textContent = text(value, '');
    return node.innerHTML;
  }

  function render(result) {
    const target = byId('caseWorkspaceResult');
    const caseState = result.case;
    const context = result.context;
    const confidence = result.trace.map((entry) => entry.confidence?.level || entry.confidence?.basis).filter(Boolean).join(', ');
    target.innerHTML = `
      <div class="case-workspace__summary">
        <div class="case-workspace__metric"><span>Case</span>${escapeHtml(result.caseId)}</div>
        <div class="case-workspace__metric"><span>Status / version</span>${escapeHtml(caseState.status)} · v${escapeHtml(caseState.version)}</div>
        <div class="case-workspace__metric"><span>Priority</span>${escapeHtml(caseState.priority)}</div>
        <div class="case-workspace__metric"><span>Approval</span>${escapeHtml(caseState.approval_state)}</div>
      </div>
      <section><strong>Discrepancy</strong><div>${escapeHtml(caseState.raw_discrepancy)}</div></section>
      <section><strong>Timeline</strong>${list(context.timeline, (entry) => `${escapeHtml(entry.occurred_at)} — ${escapeHtml(entry.summary)}`)}</section>
      <section><strong>Technical sources</strong>${list(context.documents, (doc) => `${escapeHtml(doc.title)} · ${escapeHtml(doc.currency_state)}`)}</section>
      <section><strong>Evidence</strong>${list(context.evidence_map, (evidence) => `${escapeHtml(evidence.title)} · ${escapeHtml(evidence.source_type)}`)}</section>
      <section><strong>Warnings / conflicts</strong>${list(context.unresolved_conflicts, (conflict) => `${escapeHtml(conflict.severity)}: ${escapeHtml(conflict.description)}`)}</section>
      <section class="case-workspace__trace"><strong>Capability trace</strong>${list(result.trace, (entry) => `${escapeHtml(entry.tool)} · ${escapeHtml(entry.status)} · ${escapeHtml(entry.traceId)}`)}</section>
      <div class="case-workspace__empty">Confidence: ${escapeHtml(confidence, 'Not supplied')}</div>`;
    target.hidden = false;
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = byId('caseCreateButton');
    submitButton.disabled = true;
    setStatus('Resolving aircraft and building case context…', 'working');
    try {
      const result = await MXApplicationClient.caseWorkspace.runFirstSlice({
        registration: form.elements.registration.value,
        discrepancy: form.elements.discrepancy.value,
        priority: form.elements.priority.value,
        session: session()
      });
      render(result);
      activeCase = result;
      setStatus(`Case ${result.caseId} is live.`, 'ready');
      globalThis.dispatchEvent(new CustomEvent('mxg:case-selected', { detail: result }));
    } catch (error) {
      setStatus(`${error.code || 'CASE_SLICE_FAILED'}: ${error.message}`, 'error');
    } finally {
      submitButton.disabled = false;
    }
  }

  function init() {
    byId('caseIntakeForm')?.addEventListener('submit', submit);
    globalThis.addEventListener('mxgenius:part-selected', async (event) => {
      const selection = event.detail?.selection;
      const target = byId('casePartSelection');
      const controls = byId('caseMarkerControls');
      const markerButton = byId('caseMarkerButton');
      if (!target || !selection) return;
      target.hidden = false;
      controls.hidden = false;
      activeTwinSelection = selection;
      if (!selection.componentId) {
        markerButton.disabled = true;
        target.textContent = `Selected mesh ${selection.meshName}. This asset has no canonical component mapping; no operational marker can be attached.`;
        return;
      }
      target.textContent = `Checking canonical component ${selection.componentId}…`;
      try {
        const inspection = await MXApplicationClient.digitalTwin.inspectSelection({
          aircraftId: activeCase?.case?.aircraft_id || event.detail?.context?.aircraftId,
          caseId: activeCase?.caseId || event.detail?.context?.caseId,
          componentId: selection.componentId,
          session: session()
        });
        const component = inspection.component?.output?.component;
        const warnings = [
          ...(inspection.component?.warnings || []),
          ...(inspection.documents?.warnings || [])
        ];
        const configured = warnings.every((warning) => warning.code !== 'NOT_CONFIGURED');
        markerButton.disabled = !activeCase || !component?.canonical || !configured;
        target.textContent = component?.canonical && configured
          ? `Canonical component ${component.component_id} is ready for an explicitly confirmed case marker.`
          : `Component ${selection.componentId} is not operationally mapped. ${warnings.map((warning) => warning.message).join(' ')}`.trim();
      } catch (error) {
        markerButton.disabled = true;
        target.textContent = `${error.code || 'TWIN_LOOKUP_FAILED'}: ${error.message}`;
      }
    });
    byId('caseMarkerButton')?.addEventListener('click', async () => {
      const button = byId('caseMarkerButton');
      const target = byId('casePartSelection');
      if (!activeCase || !activeTwinSelection?.componentId) return;
      button.disabled = true;
      target.textContent = 'Attaching confirmed marker…';
      try {
        const envelope = await MXApplicationClient.digitalTwin.attachMarker({
          caseId: activeCase.caseId,
          componentId: activeTwinSelection.componentId,
          severity: byId('caseMarkerSeverity').value,
          session: session()
        });
        const output = MXApplicationClient.caseWorkspace.output(envelope);
        if (!output?.marker_id) {
          const warning = envelope.warnings?.[0]?.message || 'Digital-twin marker adapter is unavailable.';
          target.textContent = warning;
          button.disabled = true;
          return;
        }
        target.textContent = `Marker ${output.marker_id} attached to case ${output.case_id}.`;
        button.disabled = false;
      } catch (error) {
        target.textContent = `${error.code || 'MARKER_ATTACH_FAILED'}: ${error.message}`;
        button.disabled = false;
      }
    });
    const config = globalThis.MXGENIUS_CONFIG || {};
    if (!config.getSession && !config.allowInsecureLocal && !config.allowInsecurePilot) {
      byId('caseCreateButton').disabled = true;
      setStatus('Sign in through the application identity provider to create a case.', 'idle');
    } else {
      setStatus('Ready to create an evidence-backed maintenance case.', 'idle');
    }
  }

  return Object.freeze({ init });
})();

document.addEventListener('DOMContentLoaded', MXCaseWorkspace.init);
