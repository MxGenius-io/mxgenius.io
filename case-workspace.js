/** Maintenance Case workspace mounted on the canonical MCP contract. */
const MXCaseWorkspace = (() => {
  let activeCase = null;
  let activeTwinSelection = null;
  let intakePreviewUrl = null;
  const CASE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const MAX_CASE_IMAGE_BYTES = 50 * 1024 * 1024;
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

  function validateCaseImage(file) {
    if (!(file instanceof Blob) || !CASE_IMAGE_TYPES.has(file.type)) {
      const error = new Error('Choose a JPG, PNG, or WebP image.');
      error.code = 'CASE_IMAGE_TYPE_INVALID';
      throw error;
    }
    if (!file.size || file.size > MAX_CASE_IMAGE_BYTES) {
      const error = new Error('Choose an image no larger than 50 MB.');
      error.code = 'CASE_IMAGE_SIZE_INVALID';
      throw error;
    }
    return file;
  }

  function resetIntakeImage() {
    if (intakePreviewUrl) URL.revokeObjectURL(intakePreviewUrl);
    intakePreviewUrl = null;
    const input = byId('caseImage');
    const preview = byId('caseImagePreview');
    const remove = byId('caseImageRemove');
    const status = byId('caseImageStatus');
    if (input) input.value = '';
    if (preview) {
      preview.removeAttribute('src');
      preview.hidden = true;
    }
    if (remove) remove.hidden = true;
    if (status) status.textContent = 'No image selected';
  }

  function updateIntakeImageSelection() {
    const input = byId('caseImage');
    const preview = byId('caseImagePreview');
    const remove = byId('caseImageRemove');
    const status = byId('caseImageStatus');
    const file = input?.files?.[0];
    if (!file) {
      resetIntakeImage();
      return;
    }
    try {
      validateCaseImage(file);
      if (intakePreviewUrl) URL.revokeObjectURL(intakePreviewUrl);
      intakePreviewUrl = URL.createObjectURL(file);
      if (preview) {
        preview.src = intakePreviewUrl;
        preview.hidden = false;
      }
      if (remove) remove.hidden = false;
      if (status) status.textContent = `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    } catch (error) {
      resetIntakeImage();
      setStatus(`${error.code}: ${error.message}`, 'error');
    }
  }

  function attachCaseImage({ caseId, file, note }) {
    validateCaseImage(file);
    return authenticatedRequest((requestSession) => MXApplicationClient.cases.attachMedia({
      caseId,
      media: file,
      note,
      session: requestSession
    }));
  }

  function bindActiveCaseImageUpload(result) {
    const input = byId('caseActiveImage');
    const label = byId('caseActiveImageButton');
    const status = byId('caseActiveImageStatus');
    input?.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        validateCaseImage(file);
        input.disabled = true;
        label?.setAttribute('aria-disabled', 'true');
        if (status) status.textContent = `Adding ${file.name}…`;
        setStatus(`Adding image to case ${result.caseId}…`, 'working');
        await attachCaseImage({
          caseId: result.caseId,
          file,
          note: 'Image added from the maintenance case workspace'
        });
        await openExistingCase(result.caseId);
      } catch (error) {
        if (status) status.textContent = error.message;
        setStatus(`${error.code || 'CASE_IMAGE_FAILED'}: ${error.message}`, 'error');
      } finally {
        if (document.contains(input)) {
          input.disabled = false;
          input.value = '';
          label?.removeAttribute('aria-disabled');
        }
      }
    });
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
            <video id="caseWorkspaceVideo" controls playsinline preload="metadata" hidden aria-label="Maintenance case video evidence"></video>
            <figcaption>${escapeHtml(aircraftLabel)} · ${escapeHtml(displayToken(caseState.priority, 'Routine'))}</figcaption>
            <span class="case-workspace__gallery-count" id="caseWorkspaceImageCount">1 / 1</span>
          </figure>
          <div class="case-workspace__gallery-rail" id="caseWorkspaceGallery" aria-label="Choose case image">
            <button type="button" class="case-workspace__gallery-thumb is-active" aria-label="Show image 1" aria-pressed="true">
              <img src="media/deck-mechanic.jpg" alt="">
            </button>
          </div>
          <div class="case-workspace__media-toolbar">
            <label id="caseActiveImageButton" for="caseActiveImage">Add image</label>
            <input id="caseActiveImage" type="file" accept="image/jpeg,image/png,image/webp">
            <span id="caseActiveImageStatus" role="status" aria-live="polite">JPG, PNG, or WebP</span>
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
    bindActiveCaseImageUpload(result);
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

  function clearActiveCase({ announce = true, dispatch = true } = {}) {
    activeCase = null;
    activeTwinSelection = null;
    localStorage.removeItem('mxg_active_case_id');

    const select = byId('caseExistingSelect');
    const markerButton = byId('caseMarkerButton');
    const markerSection = byId('caseMarkerSection');
    const partSelection = byId('casePartSelection');
    const markerControls = byId('caseMarkerControls');
    const result = byId('caseWorkspaceResult');

    if (select) select.value = '';
    if (markerButton) markerButton.disabled = true;
    if (markerSection) markerSection.hidden = true;
    if (partSelection) {
      partSelection.textContent = '';
      partSelection.hidden = true;
    }
    if (markerControls) markerControls.hidden = true;
    if (result) {
      result.replaceChildren();
      result.hidden = true;
    }
    if (announce) setStatus('Default view. Select a case or open New maintenance case.', 'idle');
    if (dispatch) globalThis.dispatchEvent(new CustomEvent('mxg:case-selected', { detail: null }));
  }

  function openCaseIntakePanel() {
    const panel = byId('caseIntakePanel');
    if (!panel || panel.open) return;
    panel.classList.remove('is-closing');
    panel.showModal();
    byId('woReg')?.focus();
  }

  function closeCaseIntakePanel({ focusId = 'caseIntakeOpenButton' } = {}) {
    const panel = byId('caseIntakePanel');
    if (!panel?.open || panel.classList.contains('is-closing')) return;
    panel.classList.add('is-closing');
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      panel.classList.remove('is-closing');
      panel.close();
      if (focusId) byId(focusId)?.focus();
    };
    panel.addEventListener('animationend', finish, { once: true });
    globalThis.setTimeout(finish, 240);
  }

  async function loadExistingCases() {
    const select = byId('caseExistingSelect');
    if (!select) return;
    const activeCaseId = activeCase?.caseId || '';
    select.disabled = true;
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
      select.replaceChildren(new Option('Default — no active case', ''));
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
      select.disabled = false;
      if (activeCaseId && cases.some((caseState) => caseState.case_id === activeCaseId)) {
        select.value = activeCaseId;
      } else if (activeCaseId) {
        clearActiveCase();
      }
    } catch (error) {
      select.replaceChildren(new Option('Cases unavailable', ''));
      setStatus(`${error.code || 'CASE_LIST_FAILED'}: ${error.message}`, 'error');
    }
  }

  async function openExistingCase(caseId = byId('caseExistingSelect')?.value) {
    if (!caseId) return;
    const select = byId('caseExistingSelect');
    const clearButton = byId('caseClearButton');
    const previousCaseId = activeCase?.caseId || '';
    if (select) {
      select.disabled = true;
      select.setAttribute('aria-busy', 'true');
    }
    if (clearButton) clearButton.disabled = true;
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
        }, activeSession),
        MXApplicationClient.cases.listMedia(caseId, activeSession)
      ]);
      let supporting = await loadSupportingDetails(requestSession);
      if (supporting.some((entry) => entry.status === 'rejected' && authenticationError(entry.reason))) {
        MXApplicationClient.capabilities.disconnect(requestSession);
        const renewedSession = await session({ forceRefresh: true });
        supporting = await loadSupportingDetails(renewedSession);
      }
      const [contextResult, profileResult, mediaResult] = supporting;
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
        caseMedia: mediaResult?.status === 'fulfilled' ? (mediaResult.value.media || []) : [],
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
      if (select) select.value = previousCaseId;
      setStatus(`${error.code || 'CASE_OPEN_FAILED'}: ${error.message}`, 'error');
    } finally {
      if (select) {
        select.disabled = false;
        select.removeAttribute('aria-busy');
      }
      if (clearButton) clearButton.disabled = false;
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
    const caseImage = form.elements.caseImage.files?.[0] || null;
    setStatus('Resolving aircraft…', 'working');
    try {
      if (caseImage) validateCaseImage(caseImage);
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
      let imageWarning = null;
      if (caseImage) {
        setStatus(`Case ${result.caseId} created. Adding image…`, 'working');
        try {
          await attachCaseImage({
            caseId: result.caseId,
            file: caseImage,
            note: 'Image attached during maintenance case intake'
          });
          const { value: media } = await authenticatedRequest((activeSession) => (
            MXApplicationClient.cases.listMedia(result.caseId, activeSession)
          ));
          result.caseMedia = media.media || [];
        } catch (error) {
          imageWarning = error;
        }
      }
      render(result);
      activeCase = result;
      localStorage.setItem('mxg_active_case_id', result.caseId);
      setStatus(imageWarning
        ? `Case ${result.caseId} is live, but the image could not be added. Use Add image to try again.`
        : `Case ${result.caseId} is live${caseImage ? ' with its image attached' : ''}.`, imageWarning ? 'error' : 'ready');
      globalThis.dispatchEvent(new CustomEvent('mxg:case-selected', { detail: result }));
      await loadExistingCases();
      form.reset();
      resetIntakeImage();
      closeCaseIntakePanel({ focusId: 'caseExistingSelect' });
    } catch (error) {
      setStatus(`${error.code || 'CASE_SLICE_FAILED'}: ${error.message}`, 'error');
    } finally {
      submitButton.disabled = false;
    }
  }

  function init() {
    byId('caseIntakeForm')?.addEventListener('submit', submit);
    byId('caseImage')?.addEventListener('change', updateIntakeImageSelection);
    byId('caseImageRemove')?.addEventListener('click', resetIntakeImage);
    byId('caseIntakeOpenButton')?.addEventListener('click', openCaseIntakePanel);
    byId('caseIntakeCloseButton')?.addEventListener('click', () => closeCaseIntakePanel());
    byId('caseIntakePanel')?.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeCaseIntakePanel();
    });
    byId('caseIntakePanel')?.addEventListener('click', (event) => {
      const panel = event.currentTarget;
      const bounds = panel.getBoundingClientRect();
      const outsidePanel = event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom;
      if (outsidePanel) closeCaseIntakePanel();
    });
    byId('caseExistingSelect')?.addEventListener('change', (event) => {
      if (!event.currentTarget.value) {
        clearActiveCase();
        return;
      }
      void openExistingCase(event.currentTarget.value);
    });
    byId('caseClearButton')?.addEventListener('click', () => clearActiveCase());
    globalThis.addEventListener('mxgenius:part-selected', async (event) => {
      const selection = event.detail?.selection;
      const target = byId('casePartSelection');
      const controls = byId('caseMarkerControls');
      const markerButton = byId('caseMarkerButton');
      const markerSection = byId('caseMarkerSection');
      if (!target || !selection) return;
      if (markerSection) markerSection.hidden = false;
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
      clearActiveCase({ announce: false });
      setStatus('Default view. Select a case or open New maintenance case.', 'idle');
      void loadExistingCases();
    }
  }

  return Object.freeze({ init });
})();

document.addEventListener('DOMContentLoaded', MXCaseWorkspace.init);
