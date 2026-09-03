/** Maintenance Case workspace mounted on the canonical MCP contract. */
const MXCaseWorkspace = (() => {
  let activeCase = null;
  let activeTwinSelection = null;
  const byId = (id) => document.getElementById(id);
  const text = (value, fallback = 'Not available') => value === null || value === undefined || value === '' ? fallback : String(value);

  async function session({ forceRefresh = false } = {}) {
    await globalThis.MXGENIUS_CONFIG?.ready;
    const refreshedAccessToken = globalThis.MXGENIUS_AUTH?.getToken
      ? await globalThis.MXGENIUS_AUTH.getToken({ forceRefresh })
      : '';
    const configured = globalThis.MXGENIUS_CONFIG?.getSession?.() || {};
    const accessToken = refreshedAccessToken || configured.accessToken;
    if (!accessToken && !globalThis.MXGENIUS_CONFIG?.allowInsecurePilot) {
      const error = new Error('Your sign-in needs to be renewed.');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    return {
      accessToken,
      organizationId: configured.organizationId,
      correlationId: globalThis.crypto?.randomUUID?.(),
      confirmationGrant: configured.confirmationGrant
    };
  }

  function authenticationError(error) {
    return ['AUTH_REQUIRED', 'ACCESS_DENIED'].includes(String(error?.code || ''))
      || error?.status === 401;
  }

  async function authenticatedRequest(operation) {
    let requestSession = await session();
    try {
      return { value: await operation(requestSession), session: requestSession };
    } catch (error) {
      if (!authenticationError(error) || globalThis.MXGENIUS_CONFIG?.allowInsecurePilot) throw error;
      MXApplicationClient.capabilities.disconnect(requestSession);
      requestSession = await session({ forceRefresh: true });
      return { value: await operation(requestSession), session: requestSession };
    }
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

  function displayToken(value, fallback = 'Not available') {
    const raw = text(value, fallback).replace(/[_-]+/g, ' ').trim();
    if (/^aog$/i.test(raw)) return 'AOG';
    return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function displayDate(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Not available';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    }).format(parsed);
  }

  function render(result) {
    const target = byId('caseWorkspaceResult');
    const caseState = result.case;
    const context = result.context;
    const matches = result.aircraft?.matches || [];
    const canonical = matches.find((match) => match.aircraft_id === caseState.aircraft_id) || matches[0] || {};
    const aircraftLabel = canonical.registration || [canonical.make, canonical.model].filter(Boolean).join(' ') || 'Aircraft';
    const confidence = result.trace.map((entry) => entry.confidence?.level || entry.confidence?.basis).filter(Boolean).join(', ');
    target.innerHTML = `
      <div class="case-workspace__case-hero">
        <div class="case-workspace__gallery" aria-label="Maintenance case image gallery">
          <figure class="case-workspace__case-media">
            <img id="caseWorkspaceImage" src="media/deck-mechanic.jpg" alt="Maintenance case preview">
            <figcaption>${escapeHtml(aircraftLabel)} · ${escapeHtml(displayToken(caseState.priority, 'Routine'))}</figcaption>
            <span class="case-workspace__gallery-count" id="caseWorkspaceImageCount">1 / 1</span>
          </figure>
          <div class="case-workspace__gallery-rail" id="caseWorkspaceGallery" aria-label="Choose case image">
            <button type="button" class="case-workspace__gallery-thumb is-active" aria-label="Show image 1" aria-pressed="true">
              <img src="media/deck-mechanic.jpg" alt="">
            </button>
          </div>
        </div>
        <div class="case-workspace__summary">
          <div class="case-workspace__metric"><span>Aircraft</span>${escapeHtml(aircraftLabel)}</div>
          <div class="case-workspace__metric"><span>Status</span>${escapeHtml(displayToken(caseState.status, 'Open'))}</div>
          <div class="case-workspace__metric"><span>Priority</span>${escapeHtml(displayToken(caseState.priority, 'Routine'))}</div>
          <div class="case-workspace__metric"><span>Last updated</span>${escapeHtml(displayDate(caseState.updated_at || caseState.opened_at))}</div>
        </div>
      </div>
      <section><strong>Discrepancy</strong><div>${escapeHtml(caseState.raw_discrepancy)}</div></section>
      <section><strong>Timeline</strong>${list(context.timeline, (entry) => `${escapeHtml(entry.occurred_at)} — ${escapeHtml(entry.summary)}`)}</section>
      <section><strong>Technical sources</strong>${list(context.documents, (doc) => `${escapeHtml(doc.title)} · ${escapeHtml(doc.currency_state)}`)}</section>
      <section><strong>Evidence</strong>${list(context.evidence_map, (evidence) => `${escapeHtml(evidence.title)} · ${escapeHtml(evidence.source_type)}`)}</section>
      <section><strong>Warnings / conflicts</strong>${list(context.unresolved_conflicts, (conflict) => `${escapeHtml(conflict.severity)}: ${escapeHtml(conflict.description)}`)}</section>
      <details class="case-workspace__trace"><summary>Technical details</summary>
        <div class="case-workspace__empty">Case reference: ${escapeHtml(result.caseId)} · Confidence: ${escapeHtml(confidence, 'Not supplied')}</div>
        ${list(result.trace, (entry) => `${escapeHtml(entry.tool)} · ${escapeHtml(entry.status)} · ${escapeHtml(entry.traceId)}`)}
      </details>`;
    target.hidden = false;
  }

  function traceEntry(tool, envelope) {
    return {
      tool,
      traceId: envelope?.trace_id || null,
      requestId: envelope?.request_id || null,
      status: envelope?.status || 'unknown',
      warnings: envelope?.warnings || [],
      confidence: envelope?.confidence || null
    };
  }

  async function loadExistingCases({ selectLatest = false } = {}) {
    const select = byId('caseExistingSelect');
    const openButton = byId('caseOpenButton');
    if (!select || !openButton) return;
    select.disabled = true;
    openButton.disabled = true;
    select.replaceChildren(new Option('Loading cases…', ''));
    try {
      const { value: result } = await authenticatedRequest((requestSession) => (
        MXApplicationClient.cases.list(requestSession)
      ));
      const cases = [...(result.cases || [])].sort((left, right) => {
        const rightTime = Date.parse(right.updated_at || right.opened_at || '') || 0;
        const leftTime = Date.parse(left.updated_at || left.opened_at || '') || 0;
        return rightTime - leftTime || String(right.case_id || '').localeCompare(String(left.case_id || ''));
      });
      select.replaceChildren(new Option(cases.length ? 'Select an existing case' : 'No cases available', ''));
      cases.forEach((caseState) => {
        const summary = text(caseState.raw_discrepancy, '').replace(/\s+/g, ' ').slice(0, 72);
        const label = [
          caseState.priority?.toUpperCase(),
          caseState.status,
          caseState.aircraft_id,
          summary
        ].filter(Boolean).join(' · ');
        select.add(new Option(label, caseState.case_id));
      });
      select.disabled = cases.length === 0;
      const latestCaseId = cases[0]?.case_id;
      if (selectLatest && latestCaseId) {
        select.value = latestCaseId;
        await openExistingCase(latestCaseId);
      }
    } catch (error) {
      select.replaceChildren(new Option('Cases unavailable', ''));
      setStatus(`${error.code || 'CASE_LIST_FAILED'}: ${error.message}`, 'error');
    }
  }

  async function openExistingCase(caseId = byId('caseExistingSelect')?.value) {
    if (!caseId) return;
    const openButton = byId('caseOpenButton');
    openButton.disabled = true;
    setStatus(`Opening case ${caseId}…`, 'working');
    try {
      const { value: current, session: requestSession } = await authenticatedRequest((activeSession) => (
        MXApplicationClient.cases.get(caseId, activeSession)
      ));
      const caseState = current.case;
      const loadSupportingDetails = (activeSession) => Promise.allSettled([
        MXApplicationClient.capabilities.call('mxg.maintenance_case.build_context', {
          case_id: caseId,
          include: {
            documents: true,
            compliance: true,
            weather: true,
            parts: true,
            facilities: true,
            timeline: true
          }
        }, activeSession),
        MXApplicationClient.capabilities.call('mxg.aircraft.profile', {
          aircraft_id: caseState.aircraft_id
        }, activeSession)
      ]);
      let supporting = await loadSupportingDetails(requestSession);
      if (supporting.some((entry) => entry.status === 'rejected' && authenticationError(entry.reason))) {
        MXApplicationClient.capabilities.disconnect(requestSession);
        const renewedSession = await session({ forceRefresh: true });
        supporting = await loadSupportingDetails(renewedSession);
      }
      const [contextResult, profileResult] = supporting;
      const contextEnvelope = contextResult.status === 'fulfilled' ? contextResult.value : null;
      const profileEnvelope = profileResult.status === 'fulfilled' ? profileResult.value : null;
      const supportingErrors = supporting
        .filter((entry) => entry.status === 'rejected')
        .map((entry) => entry.reason);
      let context = {
        timeline: [],
        documents: [],
        evidence_map: [],
        unresolved_conflicts: []
      };
      let profile = {};
      if (contextEnvelope) {
        try { context = MXApplicationClient.caseWorkspace.output(contextEnvelope); }
        catch (error) { supportingErrors.push(error); }
      }
      if (profileEnvelope) {
        try { profile = MXApplicationClient.caseWorkspace.output(profileEnvelope); }
        catch (error) { supportingErrors.push(error); }
      }
      const result = {
        caseId,
        case: caseState,
        context,
        aircraft: {
          aircraft_id: caseState.aircraft_id,
          images: Array.isArray(profile.images) ? profile.images : [],
          make: profile.make,
          model: profile.model,
          year: profile.year,
          matches: [{
            aircraft_id: caseState.aircraft_id,
            registration: profile.registration,
            serial_number: profile.serial_number,
            make: profile.make,
            model: profile.model
          }]
        },
        trace: [
          contextEnvelope && traceEntry('mxg.maintenance_case.build_context', contextEnvelope),
          profileEnvelope && traceEntry('mxg.aircraft.profile', profileEnvelope)
        ].filter(Boolean)
      };
      render(result);
      activeCase = result;
      localStorage.setItem('mxg_active_case_id', caseId);
      setStatus(supportingErrors.length
        ? `Case ${caseId} is active. Some supporting details are temporarily unavailable.`
        : `Case ${caseId} is active.`, supportingErrors.length ? 'working' : 'ready');
      globalThis.dispatchEvent(new CustomEvent('mxg:case-selected', { detail: result }));
    } catch (error) {
      setStatus(`${error.code || 'CASE_OPEN_FAILED'}: ${error.message}`, 'error');
    } finally {
      openButton.disabled = !byId('caseExistingSelect')?.value;
    }
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = byId('caseCreateButton');
    submitButton.disabled = true;
    const registration = form.elements.registration.value.trim();
    const discrepancy = form.elements.discrepancy.value.trim();
    const priority = form.elements.priority.value;
    setStatus('Resolving aircraft…', 'working');
    try {
      const requestSession = await session();
      const lookupEnvelope = await MXApplicationClient.aircraft.lookup({
        registration,
        session: requestSession
      });
      const lookup = MXApplicationClient.caseWorkspace.output(lookupEnvelope);
      const exactMatches = Array.isArray(lookup?.matches) ? lookup.matches : [];
      const aircraftId = lookup?.aircraft_id
        || (exactMatches.length === 1 ? exactMatches[0]?.aircraft_id : null);
      if (!aircraftId) {
        const error = new Error(exactMatches.length === 0
          ? `No aircraft matched tail number ${registration}.`
          : `Tail number ${registration} did not resolve to one aircraft.`);
        error.code = exactMatches.length === 0 ? 'AIRCRAFT_NOT_FOUND' : 'AIRCRAFT_AMBIGUOUS';
        throw error;
      }
      const createArguments = {
        aircraft_id: aircraftId,
        raw_discrepancy: discrepancy,
        priority
      };
      setStatus('Confirming maintenance case creation…', 'working');
      const confirmation = await MXApplicationClient.confirmations.issue({
        toolName: 'mxg.maintenance_case.create',
        arguments: createArguments,
        session: requestSession
      });
      setStatus('Creating maintenance case and building context…', 'working');
      const result = await MXApplicationClient.caseWorkspace.runFirstSlice({
        registration,
        discrepancy,
        priority,
        session: { ...requestSession, confirmationGrant: confirmation.token }
      });
      render(result);
      activeCase = result;
      localStorage.setItem('mxg_active_case_id', result.caseId);
      setStatus(`Case ${result.caseId} is live.`, 'ready');
      globalThis.dispatchEvent(new CustomEvent('mxg:case-selected', { detail: result }));
      await loadExistingCases();
      byId('caseExistingSelect').value = result.caseId;
    } catch (error) {
      setStatus(`${error.code || 'CASE_SLICE_FAILED'}: ${error.message}`, 'error');
    } finally {
      submitButton.disabled = false;
    }
  }

  function init() {
    byId('caseIntakeForm')?.addEventListener('submit', submit);
    byId('caseExistingSelect')?.addEventListener('change', (event) => {
      byId('caseOpenButton').disabled = !event.currentTarget.value;
    });
    byId('caseOpenButton')?.addEventListener('click', () => void openExistingCase());
    byId('caseRefreshButton')?.addEventListener('click', () => void loadExistingCases());
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
          session: await session()
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
          session: await session()
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
      void loadExistingCases({ selectLatest: true });
    }
  }

  return Object.freeze({ init });
})();

document.addEventListener('DOMContentLoaded', MXCaseWorkspace.init);
