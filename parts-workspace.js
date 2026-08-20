/**
 * Production parts workspace. All state crosses MXApplicationClient.parts;
 * the browser never owns an authoritative inventory record.
 */
const MXPartsWorkspace = (() => {
  const byId = (id) => document.getElementById(id);
  const client = globalThis.MXApplicationClient?.parts;
  const state = {
    query: '',
    currentUnit: null,
    draft: null,
    asset: null,
    extractionRun: null,
    candidates: []
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function session() {
    await globalThis.MXGENIUS_CONFIG?.ready;
    const accessToken = await globalThis.MXGENIUS_AUTH?.getToken();
    const current = globalThis.MXGENIUS_CONFIG?.getSession?.() || {};
    if (!accessToken) throw new Error('Your secure session has expired. Sign in again.');
    return { ...current, accessToken };
  }

  function errorMessage(error) {
    if (error?.status === 403) return 'Your account does not have access to this organization.';
    if (error?.status === 409) return 'This record changed. Refresh it before trying again.';
    if (error?.status >= 500) return 'The parts service is temporarily unavailable.';
    return error?.message || 'The operation could not be completed.';
  }

  function init() {
    const root = byId('partsWorkspaceRoot');
    if (!root || !client) return;
    root.innerHTML = `
      <div class="parts-workspace">
        <main class="parts-main">
          <header class="parts-header">
            <div>
              <h1>Parts Management</h1>
              <p class="parts-subtitle">Traceable receiving, documents, and inventory history</p>
            </div>
            <div class="parts-toolbar">
              <button class="btn-primary" id="btnReceivePart">Receive Part</button>
            </div>
          </header>
          <div class="parts-search-bar">
            <input type="search" id="partsSearchInput" class="search-input" placeholder="Part number, description, or serial number" aria-label="Search parts">
            <button id="btnPartsSearch" class="btn-primary">Search</button>
          </div>
          <div class="parts-content">
            <div id="partsStatus" class="parts-inline-status" aria-live="polite"></div>
            <div id="partsInventoryGrid" class="inventory-grid"></div>
          </div>
        </main>
        <aside id="partsDrawer" class="parts-drawer" aria-label="Part unit details" aria-hidden="true">
          <div class="drawer-header">
            <h2 id="drawerTitle">Unit Details</h2>
            <button class="modal-close" id="btnCloseDrawer" aria-label="Close drawer">&times;</button>
          </div>
          <div class="drawer-tabs">
            <button class="drawer-tab active" data-part-tab="overview">Overview</button>
            <button class="drawer-tab" data-part-tab="documents">Documents</button>
            <button class="drawer-tab" data-part-tab="history">History</button>
            <button class="drawer-tab" data-part-tab="faa">FAA ADs</button>
            <button class="drawer-tab" data-part-tab="label">Label</button>
          </div>
          <div class="drawer-content" id="drawerContent"></div>
        </aside>
        <div id="receivingWizard" class="receiving-wizard" hidden>
          <div class="wizard-header">
            <h2>Receive Part</h2>
            <div class="wizard-steps" aria-label="Receiving progress">
              <span class="wizard-step-indicator active" data-step="1">1. Capture</span>
              <span class="wizard-step-indicator" data-step="2">2. Review</span>
              <span class="wizard-step-indicator" data-step="3">3. Details</span>
              <span class="wizard-step-indicator" data-step="4">4. Confirm</span>
            </div>
            <button class="modal-close" id="btnCancelWizard" aria-label="Cancel receiving">&times;</button>
          </div>
          <div class="wizard-body">
            <div id="wizardMessage" class="parts-inline-status" aria-live="polite"></div>
            <section class="wizard-step-content active" id="wizardStep1">
              <h3>Capture evidence</h3>
              <p>Upload a PDF, packing slip, 8130-3, placard, or part photo. OCR suggestions will require review.</p>
              <input type="file" id="wizardFileInput" accept="application/pdf,image/jpeg,image/png,image/webp">
              <div class="wizard-capture-actions">
                <button class="btn-primary" id="btnWizardProcessCapture">Upload and extract</button>
                <button class="btn-quiet" id="btnWizardSkipCapture">Enter details manually</button>
              </div>
            </section>
            <section class="wizard-step-content" id="wizardStep2">
              <h3>Review extracted values</h3>
              <p>Accept, edit, or reject each suggestion. This does not yet create inventory.</p>
              <div id="wizardExtractedData"></div>
              <button class="btn-primary" id="btnWizardApproveData">Save review</button>
            </section>
            <section class="wizard-step-content" id="wizardStep3">
              <h3>Inventory details</h3>
              <div class="parts-form-grid">
                <label>Part number<input id="wizardInputPartNumber" required></label>
                <label>Description<input id="wizardInputDescription" required></label>
                <label>Manufacturer<input id="wizardInputManufacturer"></label>
                <label>Serial number<input id="wizardInputSerialNumber"></label>
                <label>Quantity<input type="number" min="0.001" step="0.001" id="wizardQty" value="1" required></label>
                <label>Location<input id="wizardLocation" placeholder="RECEIVING" required></label>
                <label>Condition
                  <select id="wizardCondition"><option>NE</option><option>NS</option><option>OH</option><option selected>SV</option><option>RP</option><option>AR</option><option>US</option><option>SC</option></select>
                </label>
                <label>Trace
                  <select id="wizardTrace"><option value="none">None</option><option value="form_8130">FAA 8130-3</option><option value="easa_form1">EASA Form 1</option><option value="dual_release">Dual release</option><option value="coc">CoC</option><option value="teardown">Teardown</option></select>
                </label>
                <label>Certificate number<input id="wizardCertificateNumber"></label>
              </div>
              <button class="btn-primary" id="btnWizardReviewConfirm">Review confirmation</button>
            </section>
            <section class="wizard-step-content" id="wizardStep4">
              <h3>Confirm receiving</h3>
              <div id="wizardConfirmationSummary"></div>
              <p class="parts-warning">This confirmed action creates the stock unit and immutable receiving event.</p>
              <button class="btn-primary" id="btnWizardSubmit">Confirm and create unit</button>
            </section>
          </div>
        </div>
      </div>`;
    bindEvents();
    performSearch();
    handleRouting();
  }

  function bindEvents() {
    byId('btnPartsSearch')?.addEventListener('click', () => {
      state.query = byId('partsSearchInput')?.value.trim() || '';
      performSearch();
    });
    byId('partsSearchInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        state.query = event.currentTarget.value.trim();
        performSearch();
      }
    });
    byId('btnReceivePart')?.addEventListener('click', openWizard);
    byId('btnCancelWizard')?.addEventListener('click', closeWizard);
    byId('btnCloseDrawer')?.addEventListener('click', closeDrawer);
    byId('btnWizardProcessCapture')?.addEventListener('click', processCapture);
    byId('btnWizardSkipCapture')?.addEventListener('click', skipCapture);
    byId('btnWizardApproveData')?.addEventListener('click', approveExtraction);
    byId('btnWizardReviewConfirm')?.addEventListener('click', showConfirmation);
    byId('btnWizardSubmit')?.addEventListener('click', submitReceiving);
    document.querySelectorAll('[data-part-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('[data-part-tab]').forEach((item) => item.classList.remove('active'));
        tab.classList.add('active');
        renderDrawerContent(tab.dataset.partTab);
      });
    });
    window.addEventListener('hashchange', handleRouting);
  }

  function setStatus(message, kind = '') {
    const element = byId('partsStatus');
    if (!element) return;
    element.className = `parts-inline-status ${kind}`.trim();
    element.textContent = message;
  }

  async function performSearch() {
    const grid = byId('partsInventoryGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="empty-state">Loading inventory…</div>';
    setStatus('');
    try {
      const units = await client.search({ query: state.query, session: await session() });
      if (!units.length) {
        grid.innerHTML = '<div class="empty-state">No units found.</div>';
        return;
      }
      grid.replaceChildren(...units.map(unitCard));
    } catch (error) {
      grid.innerHTML = '';
      setStatus(errorMessage(error), 'error');
    }
  }

  function unitCard(unit) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'inventory-card';
    card.innerHTML = `
      <div class="inventory-card-header">
        <span class="inventory-part-number">${escapeHtml(unit.partNumber)}</span>
        <span class="inventory-status-badge status-${escapeHtml(unit.status)}">${escapeHtml(unit.status)}</span>
      </div>
      <div class="inventory-description">${escapeHtml(unit.description)}</div>
      <div><strong>SN:</strong> ${escapeHtml(unit.serialNumber || 'N/A')}</div>
      <div><strong>Condition:</strong> ${escapeHtml(unit.conditionCode)}</div>
      <div><strong>Location:</strong> ${escapeHtml(unit.location)}</div>`;
    card.addEventListener('click', () => openUnit(unit.id));
    return card;
  }

  function handleRouting() {
    const match = location.hash.match(/^#parts\/unit\/([0-9a-f-]{36})$/i);
    if (!match) return;
    globalThis.switchTab?.('parts');
    openUnit(match[1], false);
  }

  async function openUnit(unitId, updateRoute = true) {
    const drawer = byId('partsDrawer');
    if (!drawer) return;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    byId('drawerContent').innerHTML = '<div class="empty-state">Loading unit…</div>';
    if (updateRoute) history.replaceState(null, '', `#parts/unit/${unitId}`);
    try {
      state.currentUnit = await client.getUnit({ unitId, session: await session() });
      byId('drawerTitle').textContent = state.currentUnit.unit.partNumber;
      renderDrawerContent('overview');
    } catch (error) {
      byId('drawerContent').innerHTML = `<div class="empty-state">${escapeHtml(errorMessage(error))}</div>`;
    }
  }

  function closeDrawer() {
    const drawer = byId('partsDrawer');
    drawer?.classList.remove('open');
    drawer?.setAttribute('aria-hidden', 'true');
    state.currentUnit = null;
    history.replaceState(null, '', '#parts');
  }

  async function renderDrawerContent(tab) {
    const content = byId('drawerContent');
    const detail = state.currentUnit;
    if (!content || !detail) return;
    const unit = detail.unit;
    if (tab === 'overview') {
      content.innerHTML = `
        <dl class="parts-detail-list">
          <dt>Part number</dt><dd>${escapeHtml(unit.partNumber)}</dd>
          <dt>Description</dt><dd>${escapeHtml(unit.description)}</dd>
          <dt>Manufacturer</dt><dd>${escapeHtml(unit.manufacturer || 'Not recorded')}</dd>
          <dt>Serial</dt><dd>${escapeHtml(unit.serialNumber || 'Not serialized')}</dd>
          <dt>Quantity</dt><dd>${escapeHtml(unit.quantity)}</dd>
          <dt>Condition</dt><dd>${escapeHtml(unit.conditionCode)}</dd>
          <dt>Status</dt><dd>${escapeHtml(unit.status)}</dd>
          <dt>Trace</dt><dd>${escapeHtml(unit.traceType)}</dd>
          <dt>Location</dt><dd>${escapeHtml(unit.location)}</dd>
          <dt>Version</dt><dd>${escapeHtml(unit.version)}</dd>
        </dl>`;
      return;
    }
    if (tab === 'documents') {
      const assets = detail.assets || [];
      content.innerHTML = assets.length
        ? assets.map((asset) => `<button class="parts-document" data-download-asset="${escapeHtml(asset.id)}">${escapeHtml(asset.originalFilename)} <small>${escapeHtml(asset.kind)}</small></button>`).join('')
        : '<div class="empty-state">No documents attached.</div>';
      content.querySelectorAll('[data-download-asset]').forEach((button) => {
        button.addEventListener('click', () => downloadAsset(button.dataset.downloadAsset));
      });
      return;
    }
    if (tab === 'history') {
      const events = detail.events || [];
      content.innerHTML = events.length
        ? `<ol class="parts-timeline">${events.map((event) => `<li><strong>${escapeHtml(event.eventType)}</strong><span>${escapeHtml(new Date(event.createdAt).toLocaleString())}</span><p>${escapeHtml(event.notes || '')}</p></li>`).join('')}</ol>`
        : '<div class="empty-state">No inventory events recorded.</div>';
      return;
    }
    if (tab === 'faa') {
      content.innerHTML = '<div class="empty-state">Checking FAA source…</div>';
      try {
        const result = await client.getFaaCandidates({ unitId: unit.id, session: await session() });
        content.innerHTML = `
          <h3>${escapeHtml(result.state.replaceAll('_', ' '))}</h3>
          <p>${escapeHtml(result.advisory || '')}</p>
          <p><small>Source: <a href="${escapeHtml(result.source?.url || 'https://drs.faa.gov/')}" target="_blank" rel="noopener">FAA Dynamic Regulatory System</a></small></p>
          ${(result.candidates || []).map((candidate) => `<article><a href="${escapeHtml(candidate.url)}" target="_blank" rel="noopener">${escapeHtml(candidate.title)}</a></article>`).join('')}`;
      } catch (error) {
        content.innerHTML = `<div class="empty-state">${escapeHtml(errorMessage(error))}</div>`;
      }
      return;
    }
    if (tab === 'label') {
      content.innerHTML = '<div class="empty-state">Preparing label…</div>';
      try {
        const label = await client.getLabel({ unitId: unit.id, session: await session() });
        content.innerHTML = `
          <div class="parts-label">
            <img src="${escapeHtml(label.qrDataUrl)}" alt="QR code for this unit">
            <strong>${escapeHtml(label.partNumber)}</strong>
            <span>SN ${escapeHtml(label.serialNumber || 'N/A')}</span>
            <small>${escapeHtml(label.humanReadableId)}</small>
          </div>
          <button class="btn-primary" id="btnPrintPartsLabel">Print label</button>`;
        byId('btnPrintPartsLabel')?.addEventListener('click', () => window.print());
      } catch (error) {
        content.innerHTML = `<div class="empty-state">${escapeHtml(errorMessage(error))}</div>`;
      }
    }
  }

  async function downloadAsset(assetId) {
    try {
      const blob = await client.downloadAsset({ assetId, session: await session() });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = '';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setStatus(errorMessage(error), 'error');
    }
  }

  function resetWizard() {
    state.draft = null;
    state.asset = null;
    state.extractionRun = null;
    state.candidates = [];
    const file = byId('wizardFileInput');
    if (file) file.value = '';
    ['wizardInputPartNumber', 'wizardInputDescription', 'wizardInputManufacturer',
      'wizardInputSerialNumber', 'wizardCertificateNumber', 'wizardLocation']
      .forEach((id) => { if (byId(id)) byId(id).value = ''; });
    if (byId('wizardQty')) byId('wizardQty').value = '1';
    if (byId('wizardMessage')) byId('wizardMessage').textContent = '';
  }

  function openWizard() {
    resetWizard();
    byId('receivingWizard').hidden = false;
    setWizardStep(1);
  }

  function closeWizard() {
    byId('receivingWizard').hidden = true;
  }

  function setWizardStep(step) {
    document.querySelectorAll('.wizard-step-indicator').forEach((element) => {
      element.classList.toggle('active', Number(element.dataset.step) === step);
    });
    document.querySelectorAll('.wizard-step-content').forEach((element, index) => {
      element.classList.toggle('active', index + 1 === step);
    });
  }

  function wizardMessage(message, kind = '') {
    const element = byId('wizardMessage');
    element.className = `parts-inline-status ${kind}`.trim();
    element.textContent = message;
  }

  async function sha256(file) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function assetKind(file) {
    if (/8130/i.test(file.name)) return 'form_8130';
    if (file.type.startsWith('image/')) return 'part_photo';
    if (/packing/i.test(file.name)) return 'packing_slip';
    return 'other';
  }

  async function processCapture() {
    const button = byId('btnWizardProcessCapture');
    const file = byId('wizardFileInput')?.files?.[0];
    if (!file) {
      wizardMessage('Choose a supported photo or PDF first.', 'error');
      return;
    }
    button.disabled = true;
    wizardMessage('Creating a secure receiving draft…');
    try {
      const currentSession = await session();
      state.draft = await client.createReceivingDraft({ session: currentSession });
      const registration = await client.registerAssetUpload({
        draftId: state.draft.id,
        kind: assetKind(file),
        file,
        sha256: await sha256(file),
        session: currentSession
      });
      state.asset = registration.asset;
      wizardMessage('Uploading evidence to private storage…');
      await client.uploadAsset({ assetId: state.asset.id, file, session: currentSession });
      wizardMessage('Extracting proposed metadata…');
      const extraction = await client.requestExtraction({ assetId: state.asset.id, session: currentSession });
      state.extractionRun = extraction.run;
      state.candidates = extraction.candidates || [];
      renderCandidates();
      setWizardStep(2);
      wizardMessage(state.candidates.length ? 'Review every suggestion.' : 'No fields were recognized. Enter details manually.');
    } catch (error) {
      wizardMessage(errorMessage(error), 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function skipCapture() {
    const button = byId('btnWizardSkipCapture');
    button.disabled = true;
    wizardMessage('Creating a secure receiving draft…');
    try {
      state.draft = await client.createReceivingDraft({ session: await session() });
      state.candidates = [];
      setWizardStep(3);
      wizardMessage('Enter the inventory details. Evidence can be attached to the unit later.');
    } catch (error) {
      wizardMessage(errorMessage(error), 'error');
    } finally {
      button.disabled = false;
    }
  }

  function renderCandidates() {
    const area = byId('wizardExtractedData');
    if (!state.candidates.length) {
      area.innerHTML = '<div class="empty-state">No OCR suggestions were returned.</div>';
      return;
    }
    area.innerHTML = state.candidates.map((candidate) => `
      <div class="ocr-field-row" data-candidate-id="${escapeHtml(candidate.id)}" data-field-name="${escapeHtml(candidate.fieldName)}">
        <label>${escapeHtml(candidate.fieldName)}
          <input data-candidate-value value="${escapeHtml(candidate.proposedValue || '')}">
        </label>
        <label>Decision
          <select data-candidate-decision>
            <option value="accepted">Accept</option>
            <option value="edited">Edit</option>
            <option value="rejected">Reject</option>
          </select>
        </label>
        <span>${candidate.confidence == null ? '—' : `${Math.round(candidate.confidence * 100)}%`}</span>
      </div>`).join('');
  }

  async function approveExtraction() {
    if (state.candidates.length) {
      const rows = [...document.querySelectorAll('[data-candidate-id]')];
      const decisions = rows.map((row) => {
        const reviewState = row.querySelector('[data-candidate-decision]').value;
        const value = row.querySelector('[data-candidate-value]').value.trim();
        return {
          candidateId: row.dataset.candidateId,
          reviewState,
          finalValue: reviewState === 'edited' ? value : null
        };
      });
      try {
        const reviewed = await client.reviewExtraction({
          runId: state.extractionRun.id,
          decisions,
          session: await session()
        });
        applyReviewedFields(reviewed.candidates || []);
      } catch (error) {
        wizardMessage(errorMessage(error), 'error');
        return;
      }
    }
    setWizardStep(3);
  }

  function applyReviewedFields(candidates) {
    const targets = {
      partNumber: 'wizardInputPartNumber',
      description: 'wizardInputDescription',
      manufacturer: 'wizardInputManufacturer',
      serialNumber: 'wizardInputSerialNumber',
      certificateNumber: 'wizardCertificateNumber'
    };
    candidates.forEach((candidate) => {
      if (candidate.reviewState === 'rejected') return;
      const target = byId(targets[candidate.fieldName]);
      if (target) target.value = candidate.finalValue || candidate.proposedValue || '';
    });
  }

  function receivingValues() {
    return {
      partId: state.draft?.partId || null,
      partNumber: byId('wizardInputPartNumber').value.trim(),
      description: byId('wizardInputDescription').value.trim(),
      manufacturer: byId('wizardInputManufacturer').value.trim() || null,
      serialNumber: byId('wizardInputSerialNumber').value.trim() || null,
      lotNumber: null,
      quantity: Number(byId('wizardQty').value),
      conditionCode: byId('wizardCondition').value,
      traceType: byId('wizardTrace').value,
      certificateNumber: byId('wizardCertificateNumber').value.trim() || null,
      locationCode: byId('wizardLocation').value.trim(),
      ownerType: 'owned',
      metadata: {}
    };
  }

  function showConfirmation() {
    const values = receivingValues();
    if (!values.partNumber || !values.description || !values.locationCode || !(values.quantity > 0)) {
      wizardMessage('Part number, description, positive quantity, and location are required.', 'error');
      return;
    }
    byId('wizardConfirmationSummary').innerHTML = `
      <dl class="parts-detail-list">
        <dt>Part</dt><dd>${escapeHtml(values.partNumber)}</dd>
        <dt>Description</dt><dd>${escapeHtml(values.description)}</dd>
        <dt>Serial</dt><dd>${escapeHtml(values.serialNumber || 'Not recorded')}</dd>
        <dt>Quantity</dt><dd>${escapeHtml(values.quantity)}</dd>
        <dt>Condition</dt><dd>${escapeHtml(values.conditionCode)}</dd>
        <dt>Trace</dt><dd>${escapeHtml(values.traceType)}</dd>
        <dt>Location</dt><dd>${escapeHtml(values.locationCode)}</dd>
      </dl>`;
    setWizardStep(4);
  }

  async function submitReceiving() {
    const button = byId('btnWizardSubmit');
    button.disabled = true;
    wizardMessage('Recording the confirmed receiving event…');
    try {
      const unit = await client.confirmReceiving({
        draftId: state.draft.id,
        version: state.draft.version,
        values: receivingValues(),
        idempotencyKey: crypto.randomUUID(),
        session: await session()
      });
      closeWizard();
      await performSearch();
      await openUnit(unit.id);
    } catch (error) {
      wizardMessage(errorMessage(error), 'error');
    } finally {
      button.disabled = false;
    }
  }

  globalThis.addEventListener?.('mxg:demo-data-loaded', () => void performSearch());

  return Object.freeze({ init, refresh: performSearch });
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', MXPartsWorkspace.init);
} else {
  MXPartsWorkspace.init();
}
