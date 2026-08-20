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
    candidates: [],
    locations: [],
    status: '',
    location: '',
    view: 'inventory'
  };

  function switchView(view) {
    state.view = view;
    document.querySelectorAll('[data-view]').forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    const inventory = byId('partsInventoryGrid');
    const shortages = byId('partsShortageView');
    const searchBar = document.querySelector('.parts-search-bar');
    if (inventory) inventory.hidden = view !== 'inventory';
    if (shortages) shortages.hidden = view !== 'shortages';
    if (searchBar) searchBar.hidden = view !== 'inventory';
    if (view === 'shortages') loadShortages();
  }

  function shortageRow(row) {
    const short = row.shortfall > 0;
    const due = row.requiredBy ? new Date(row.requiredBy).toLocaleDateString() : 'No date set';
    const conditions = Array.isArray(row.acceptableConditions) && row.acceptableConditions.length
      ? row.acceptableConditions.join(', ')
      : 'Any condition';
    return `
      <article class="shortage-row${short ? ' is-short' : ''}">
        <div class="shortage-head">
          <span class="shortage-part">${escapeHtml(row.partNumber)}</span>
          <span class="shortage-priority priority-${escapeHtml(row.casePriority)}">${escapeHtml(row.casePriority)}</span>
        </div>
        <p class="shortage-description">${escapeHtml(row.description)}</p>
        <dl class="shortage-figures">
          <div><dt>Needed</dt><dd>${escapeHtml(row.requiredQuantity)}</dd></div>
          <div><dt>Free stock</dt><dd>${escapeHtml(row.availableQuantity)}</dd></div>
          <div><dt>Short by</dt><dd>${short ? escapeHtml(row.shortfall) : 'Covered'}</dd></div>
        </dl>
        <p class="shortage-meta">Aircraft ${escapeHtml(row.aircraftId)} · case ${escapeHtml(row.caseStatus.replace('_', ' '))} · needed by ${escapeHtml(due)} · accepts ${escapeHtml(conditions)}</p>
      </article>`;
  }

  async function loadShortages() {
    const list = byId('partsShortageList');
    if (!list || !client.listShortages) return;
    list.innerHTML = '<div class="empty-state">Checking demand against stock…</div>';
    try {
      const payload = await client.listShortages({
        includeCovered: byId('shortageIncludeCovered')?.checked || false,
        session: await session()
      });
      const rows = payload.shortages || [];
      const badge = byId('shortageCount');
      if (badge) {
        badge.hidden = !payload.outstanding;
        badge.textContent = payload.outstanding || '';
      }
      list.innerHTML = rows.length
        ? rows.map(shortageRow).join('')
        : '<div class="empty-state">Every open requirement is covered by free stock.</div>';
    } catch (error) {
      list.innerHTML = `<div class="empty-state">${escapeHtml(errorMessage(error))}</div>`;
    }
  }

  function captureFilters() {
    state.query = byId('partsSearchInput')?.value.trim() || '';
    state.status = byId('partsStatusFilter')?.value || '';
    state.location = byId('partsLocationFilter')?.value.trim() || '';
  }

  function emptyResultMessage() {
    const filters = [
      state.query && `matching "${state.query}"`,
      state.status && `in ${state.status.replace('_', ' ')}`,
      state.location && `at ${state.location}`
    ].filter(Boolean);
    return filters.length ? `No units ${filters.join(' ')}.` : 'No units found.';
  }

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
    if (error?.code === 'PARTS_INSPECTION_DENIED' || error?.code === 'PARTS_WRITE_DENIED') {
      return error.message;
    }
    if (error?.status === 403) return 'Your account does not have access to this organization.';
    if (error?.status === 409) return error?.message || 'This record changed. Refresh it before trying again.';
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
              <div class="parts-view-switch" role="tablist" aria-label="Parts view">
                <button class="parts-view-tab active" data-view="inventory" role="tab" aria-selected="true">Inventory</button>
                <button class="parts-view-tab" data-view="shortages" role="tab" aria-selected="false">Shortages<span id="shortageCount" class="shortage-count" hidden></span></button>
              </div>
              <button class="btn-primary" id="btnReceivePart">Receive Part</button>
            </div>
          </header>
          <div class="parts-search-bar">
            <input type="search" id="partsSearchInput" class="search-input" placeholder="Part number, description, or serial number" aria-label="Search parts">
            <select id="partsStatusFilter" aria-label="Filter by status">
              <option value="">Any status</option>
              <option value="quarantine">Quarantine</option>
              <option value="available">Available</option>
              <option value="reserved">Reserved</option>
              <option value="issued">Issued</option>
              <option value="rejected">Rejected</option>
              <option value="in_repair">In repair</option>
              <option value="shipped">Shipped</option>
              <option value="scrapped">Scrapped</option>
            </select>
            <input id="partsLocationFilter" list="partsLocationOptions" placeholder="Any location" aria-label="Filter by location">
            <button id="btnPartsSearch" class="btn-primary">Search</button>
          </div>
          <div class="parts-content">
            <div id="partsStatus" class="parts-inline-status" aria-live="polite"></div>
            <div id="partsInventoryGrid" class="inventory-grid"></div>
            <div id="partsShortageView" hidden>
              <label class="shortage-toggle"><input type="checkbox" id="shortageIncludeCovered"> Show requirements stock already covers</label>
              <div id="partsShortageList"></div>
            </div>
          </div>
          <datalist id="partsLocationOptions"></datalist>
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
    loadLocations();
    loadShortages();
    handleRouting();
  }

  function bindEvents() {
    byId('btnPartsSearch')?.addEventListener('click', () => {
      captureFilters();
      performSearch();
    });
    byId('partsStatusFilter')?.addEventListener('change', () => {
      captureFilters();
      performSearch();
    });
    byId('partsSearchInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        captureFilters();
        performSearch();
      }
    });
    byId('partsLocationFilter')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        captureFilters();
        performSearch();
      }
    });
    document.querySelectorAll('[data-view]').forEach((tab) => {
      tab.addEventListener('click', () => switchView(tab.dataset.view));
    });
    byId('shortageIncludeCovered')?.addEventListener('change', loadShortages);
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
      const units = await client.search({
        query: state.query,
        status: state.status,
        location: state.location,
        session: await session()
      });
      if (!units.length) {
        grid.innerHTML = `<div class="empty-state">${escapeHtml(emptyResultMessage())}</div>`;
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
          <dt>Status</dt><dd><span class="unit-status status-${escapeHtml(unit.status)}">${escapeHtml(unit.status)}</span></dd>
          <dt>Trace</dt><dd>${escapeHtml(unit.traceType)}</dd>
          <dt>Location</dt><dd>${escapeHtml(unit.location)}</dd>
          <dt>Version</dt><dd>${escapeHtml(unit.version)}</dd>
        </dl>
        <div id="unitActionStatus" class="parts-inline-status" aria-live="polite"></div>
        ${renderUnitActions(unit)}`;
      bindUnitActions(unit);
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

  const TERMINAL_STATUSES = new Set(['issued', 'shipped', 'scrapped', 'archived']);

  // Populates the destination datalist so movement fields suggest real bins
  // rather than relying on the operator to type a code from memory.
  async function loadLocations() {
    const list = byId('partsLocationOptions');
    if (!list || !client.listLocations) return;
    try {
      state.locations = await client.listLocations({ session: await session() });
      list.replaceChildren(...state.locations.map((location) => {
        const option = document.createElement('option');
        option.value = location.code;
        option.label = location.name && location.name !== location.code ? location.name : '';
        return option;
      }));
    } catch {
      // A missing location list only costs autocomplete; typing still works.
    }
  }

  const CONDITION_CODES = ['NE', 'NS', 'OH', 'SV', 'RP', 'AR', 'US', 'SC'];
  const TRACE_TYPES = [
    ['none', 'None'],
    ['form_8130', 'FAA 8130-3'],
    ['easa_form1', 'EASA Form 1'],
    ['dual_release', 'Dual release'],
    ['coc', 'CoC'],
    ['teardown', 'Teardown']
  ];

  function optionList(values, selected) {
    return values
      .map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`)
      .join('');
  }

  // What a unit can do next, by the status it currently holds.
  const MOVEMENTS = {
    available: [
      { action: 'issue', label: 'Issue to a job', primary: true, reference: 'Job or case', location: false },
      { action: 'reserve', label: 'Reserve', reference: 'Job or case', location: false },
      { action: 'transfer', label: 'Transfer', location: true },
      { action: 'scrap', label: 'Scrap', location: false },
      { action: 'ship', label: 'Ship out', reference: 'Shipment', location: true }
    ],
    reserved: [
      { action: 'issue', label: 'Issue to a job', primary: true, reference: 'Job or case', location: false },
      { action: 'unreserve', label: 'Release reservation', location: false },
      { action: 'transfer', label: 'Transfer', location: true }
    ],
    rejected: [
      { action: 'scrap', label: 'Scrap', primary: true, location: false },
      { action: 'ship', label: 'Ship out', reference: 'Shipment', location: true },
      { action: 'transfer', label: 'Transfer', location: true }
    ],
    in_repair: [
      { action: 'transfer', label: 'Transfer', location: true }
    ]
  };

  function renderMovementBlock(unit) {
    const movements = MOVEMENTS[unit.status];
    if (!movements) return '';
    const needsReference = movements.some((movement) => movement.reference);
    const needsLocation = movements.some((movement) => movement.location);
    return `
      <section class="unit-action-block">
        <h3>Move this stock</h3>
        <p class="unit-action-hint">Each movement is recorded against this unit as an inventory event.</p>
        ${needsReference ? '<label>Job, case, or order reference <input id="movementReference" placeholder="Required to issue, reserve, or ship"></label>' : ''}
        ${needsLocation ? `<label>Destination location <input id="movementLocation" list="partsLocationOptions" placeholder="Required to transfer, return, or ship"></label>` : ''}
        <label>Notes <input id="movementNotes" placeholder="Optional remarks"></label>
        <div class="unit-action-row">
          ${movements.map((movement) => `<button class="${movement.primary ? 'btn-primary' : 'btn-quiet'}" data-movement="${escapeHtml(movement.action)}">${escapeHtml(movement.label)}</button>`).join('')}
        </div>
      </section>`;
  }

  function renderCountBlock(unit) {
    // Serialized units always hold exactly one; they are counted by presence.
    if (unit.serialNumber) return '';
    return `
      <section class="unit-action-block">
        <h3>Cycle count</h3>
        <p class="unit-action-hint">Record what is physically on the shelf. The difference from the recorded ${escapeHtml(unit.quantity)} is booked as a variance.</p>
        <div class="parts-form-grid">
          <label>Counted quantity<input type="number" min="0.001" step="0.001" id="countedQuantity" value="${escapeHtml(unit.quantity)}"></label>
          <label>Reason<input id="countReason" placeholder="Cycle count, damage, miscount"></label>
        </div>
        <label>Notes <input id="countNotes" placeholder="Optional remarks"></label>
        <button class="btn-quiet" id="btnAdjustQuantity">Book the count</button>
      </section>`;
  }

  async function adjustQuantity(unit) {
    const button = byId('btnAdjustQuantity');
    button.disabled = true;
    unitActionStatus('Booking the counted quantity…');
    try {
      await client.adjustQuantity({
        unitId: unit.id,
        version: unit.version,
        countedQuantity: Number(byId('countedQuantity').value),
        reason: byId('countReason').value.trim(),
        notes: byId('countNotes').value.trim() || null,
        session: await session()
      });
      await openUnit(unit.id, false);
      await performSearch();
    } catch (error) {
      unitActionStatus(errorMessage(error), 'error');
      button.disabled = false;
    }
  }

  function renderSplitBlock(unit) {
    // Only a lot holding more than one can give a quantity away.
    if (unit.serialNumber || !(unit.quantity > 1)) return '';
    return `
      <section class="unit-action-block">
        <h3>Split this lot</h3>
        <p class="unit-action-hint">Breaks a quantity off into its own unit so it can move independently. The remainder stays here.</p>
        <div class="parts-form-grid">
          <label>Quantity to split off<input type="number" min="0.001" step="0.001" id="splitQuantity" placeholder="Less than ${escapeHtml(unit.quantity)}"></label>
          <label>Destination<input id="splitLocation" list="partsLocationOptions" placeholder="Leave blank to keep ${escapeHtml(unit.location)}"></label>
        </div>
        <label>Notes <input id="splitNotes" placeholder="Optional remarks"></label>
        <button class="btn-quiet" id="btnSplitUnit">Split the lot</button>
      </section>`;
  }

  async function splitUnit(unit) {
    const button = byId('btnSplitUnit');
    button.disabled = true;
    unitActionStatus('Splitting the lot…');
    try {
      const created = await client.splitUnit({
        unitId: unit.id,
        version: unit.version,
        quantity: Number(byId('splitQuantity').value),
        locationCode: byId('splitLocation').value.trim() || null,
        notes: byId('splitNotes').value.trim() || null,
        session: await session()
      });
      await performSearch();
      await openUnit(created.id);
    } catch (error) {
      unitActionStatus(errorMessage(error), 'error');
      button.disabled = false;
    }
  }

  function renderUnitActions(unit) {
    if (unit.status === 'issued') {
      return `
        <section class="unit-action-block">
          <h3>Issued</h3>
          <p class="unit-action-hint">This unit was issued to a job. If it came back unused, return it to stock.</p>
          <label>Return to location <input id="movementLocation" list="partsLocationOptions" placeholder="Where it goes back on the shelf"></label>
          <label>Notes <input id="movementNotes" placeholder="Optional remarks"></label>
          <div class="unit-action-row">
            <button class="btn-primary" data-movement="return">Return to stock</button>
          </div>
        </section>`;
    }
    if (TERMINAL_STATUSES.has(unit.status)) {
      return `<p class="parts-inline-status">This unit is ${escapeHtml(unit.status)} and can no longer be changed.</p>`;
    }
    const inspection = unit.status === 'quarantine'
      ? `
        <section class="unit-action-block">
          <h3>Receiving inspection</h3>
          <p class="unit-action-hint">This unit is held in quarantine. Passing inspection releases it to serviceable stock; rejecting it holds it for disposition.</p>
          <label>Move to location <input id="dispositionLocation" list="partsLocationOptions" placeholder="Leave blank to keep ${escapeHtml(unit.location)}"></label>
          <label>Notes <input id="dispositionNotes" placeholder="Inspection remarks"></label>
          <div class="unit-action-row">
            <button class="btn-primary" id="btnInspectPass">Pass inspection</button>
            <button class="btn-quiet" id="btnInspectReject">Reject</button>
          </div>
        </section>`
      : '';
    return `
      ${inspection}
      ${renderMovementBlock(unit)}
      ${renderCountBlock(unit)}
      ${renderSplitBlock(unit)}
      <section class="unit-action-block">
        <h3>Correct details</h3>
        <p class="unit-action-hint">Corrections are recorded against this unit with the previous values. Quantity, status, and location change through their own actions.</p>
        <div class="parts-form-grid">
          <label>Serial number<input id="correctSerialNumber" value="${escapeHtml(unit.serialNumber || '')}"></label>
          <label>Lot number<input id="correctLotNumber" value="${escapeHtml(unit.lotNumber || '')}"></label>
          <label>Condition
            <select id="correctConditionCode">${optionList(CONDITION_CODES.map((code) => [code, code]), unit.conditionCode)}</select>
          </label>
          <label>Trace
            <select id="correctTraceType">${optionList(TRACE_TYPES, unit.traceType)}</select>
          </label>
          <label>Certificate number<input id="correctCertificateNumber" value="${escapeHtml(unit.certificateNumber || '')}"></label>
          <label>Reason<input id="correctNotes" placeholder="Why this record is being corrected"></label>
        </div>
        <button class="btn-quiet" id="btnCorrectUnit">Save correction</button>
      </section>`;
  }

  function unitActionStatus(message, kind = '') {
    const element = byId('unitActionStatus');
    if (!element) return;
    element.className = `parts-inline-status ${kind}`.trim();
    element.textContent = message;
  }

  function bindUnitActions(unit) {
    byId('btnInspectPass')?.addEventListener('click', () => disposition(unit, 'inspect_pass'));
    byId('btnInspectReject')?.addEventListener('click', () => disposition(unit, 'inspect_reject'));
    byId('btnCorrectUnit')?.addEventListener('click', () => correctUnit(unit));
    byId('btnAdjustQuantity')?.addEventListener('click', () => adjustQuantity(unit));
    byId('btnSplitUnit')?.addEventListener('click', () => splitUnit(unit));
    byId('drawerContent')?.querySelectorAll('[data-movement]').forEach((button) => {
      button.addEventListener('click', () => moveStock(unit, button.dataset.movement));
    });
  }

  async function moveStock(unit, action) {
    const buttons = [...byId('drawerContent').querySelectorAll('[data-movement]')];
    buttons.forEach((button) => { button.disabled = true; });
    unitActionStatus('Recording the movement…');
    try {
      await client.dispositionUnit({
        unitId: unit.id,
        version: unit.version,
        action,
        locationCode: byId('movementLocation')?.value.trim() || null,
        referenceId: byId('movementReference')?.value.trim() || null,
        notes: byId('movementNotes')?.value.trim() || null,
        session: await session()
      });
      await openUnit(unit.id, false);
      await performSearch();
    } catch (error) {
      unitActionStatus(errorMessage(error), 'error');
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  async function disposition(unit, action) {
    const buttons = [byId('btnInspectPass'), byId('btnInspectReject')].filter(Boolean);
    buttons.forEach((button) => { button.disabled = true; });
    unitActionStatus(action === 'inspect_pass' ? 'Releasing to stock…' : 'Recording rejection…');
    try {
      await client.dispositionUnit({
        unitId: unit.id,
        version: unit.version,
        action,
        locationCode: byId('dispositionLocation')?.value.trim() || null,
        notes: byId('dispositionNotes')?.value.trim() || null,
        session: await session()
      });
      await openUnit(unit.id, false);
      await performSearch();
    } catch (error) {
      unitActionStatus(errorMessage(error), 'error');
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  async function correctUnit(unit) {
    const button = byId('btnCorrectUnit');
    button.disabled = true;
    unitActionStatus('Recording the correction…');
    try {
      await client.correctUnit({
        unitId: unit.id,
        version: unit.version,
        values: {
          serialNumber: byId('correctSerialNumber').value.trim(),
          lotNumber: byId('correctLotNumber').value.trim(),
          conditionCode: byId('correctConditionCode').value,
          traceType: byId('correctTraceType').value,
          certificateNumber: byId('correctCertificateNumber').value.trim(),
          notes: byId('correctNotes').value.trim() || null
        },
        session: await session()
      });
      await openUnit(unit.id, false);
      await performSearch();
    } catch (error) {
      unitActionStatus(errorMessage(error), 'error');
      button.disabled = false;
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
