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
    extractionWarnings: [],
    sourcePreviewUrl: null,
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
    const locations = byId('partsLocationsView');
    const requests = byId('partsRequestsView');
    const rotables = byId('partsRotablesView');
    const robs = byId('partsRobsView');
    const imports = byId('partsImportView');
    const searchBar = document.querySelector('.parts-search-bar');
    if (inventory) inventory.hidden = view !== 'inventory';
    if (shortages) shortages.hidden = view !== 'shortages';
    if (locations) locations.hidden = view !== 'locations';
    if (requests) requests.hidden = view !== 'requests';
    if (rotables) rotables.hidden = view !== 'rotables';
    if (robs) robs.hidden = view !== 'cannibalizations';
    if (imports) imports.hidden = view !== 'imports';
    if (searchBar) searchBar.hidden = view !== 'inventory';
    if (view === 'shortages') loadShortages();
    if (view === 'locations') renderLocations();
    if (view === 'requests') loadRequests();
    if (view === 'rotables') loadRotables();
    if (view === 'cannibalizations') loadRobs();
    if (view === 'imports') loadImportBatches();
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

  function locationStatus(message, kind = '') {
    const element = byId('locationStatus');
    if (!element) return;
    element.className = `parts-inline-status ${kind}`.trim();
    element.textContent = message;
  }

  async function renderLocations() {
    const list = byId('partsLocationList');
    if (!list) return;
    list.innerHTML = '<div class="empty-state">Loading locations…</div>';
    try {
      const locations = await client.listLocations({
        includeInactive: byId('locationsIncludeInactive')?.checked || false,
        session: await session()
      });
      if (!locations.length) {
        list.innerHTML = '<div class="empty-state">No locations defined yet.</div>';
        return;
      }
      list.innerHTML = locations.map((location) => `
        <article class="location-row${location.active ? '' : ' is-retired'}" data-location-id="${escapeHtml(location.id)}">
          <div class="location-identity">
            <span class="location-code">${escapeHtml(location.code)}</span>
            <span class="location-type">${escapeHtml(location.locationType)}</span>
            ${location.active ? '' : '<span class="location-type">retired</span>'}
          </div>
          <p class="location-name">${escapeHtml(location.name || '')}</p>
          <div class="unit-action-row">
            <button class="btn-quiet" data-toggle-location="${escapeHtml(location.id)}" data-active="${location.active}">${location.active ? 'Retire' : 'Reinstate'}</button>
          </div>
        </article>`).join('');
      list.querySelectorAll('[data-toggle-location]').forEach((button) => {
        button.addEventListener('click', () => toggleLocation(button.dataset.toggleLocation, button.dataset.active !== 'true'));
      });
    } catch (error) {
      list.innerHTML = `<div class="empty-state">${escapeHtml(errorMessage(error))}</div>`;
    }
  }

  async function createLocation() {
    const button = byId('btnCreateLocation');
    const code = byId('newLocationCode').value.trim();
    if (!code) {
      locationStatus('Enter a code for the new location.', 'error');
      return;
    }
    button.disabled = true;
    locationStatus('Adding the location…');
    try {
      await client.createLocation({
        code,
        name: byId('newLocationName').value.trim() || code,
        locationType: byId('newLocationType').value,
        barcode: byId('newLocationBarcode').value.trim() || null,
        session: await session()
      });
      ['newLocationCode', 'newLocationName', 'newLocationBarcode'].forEach((id) => { byId(id).value = ''; });
      locationStatus('');
      await renderLocations();
      await loadLocations();
    } catch (error) {
      locationStatus(errorMessage(error), 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function toggleLocation(locationId, active) {
    locationStatus(active ? 'Reinstating the location…' : 'Retiring the location…');
    try {
      await client.updateLocation({ locationId, active, session: await session() });
      locationStatus('');
      await renderLocations();
      await loadLocations();
    } catch (error) {
      locationStatus(errorMessage(error), 'error');
    }
  }

  const ORDER_ACTIONS = {
    draft: [
      { status: 'placed', label: 'Place order', primary: true },
      { status: 'cancelled', label: 'Cancel' }
    ],
    placed: [
      { status: 'confirmed', label: 'Confirm', primary: true },
      { status: 'cancelled', label: 'Cancel' }
    ],
    confirmed: [{ status: 'cancelled', label: 'Cancel' }],
    cancelled: []
  };

  function requestStatusMessage(message, kind = '') {
    const element = byId('requestStatus');
    if (!element) return;
    element.className = `parts-inline-status ${kind}`.trim();
    element.textContent = message;
  }

  // The overdue verdict is rendered from the fields the server stamped, never
  // recomputed here: a second copy of the rule is how it drifted before.
  function requestCard(row) {
    const due = row.requiredBy
      ? new Date(row.requiredBy).toLocaleDateString()
      : 'No need-by set';
    const flag = row.isOverdue
      ? `<span class="request-flag is-overdue">${escapeHtml(row.daysOverdue)}d overdue</span>`
      : row.missingNeedBy
        ? '<span class="request-flag is-unmeasured">No need-by</span>'
        : '';
    return `
      <article class="request-row${row.isOverdue ? ' is-overdue' : ''}" data-request-id="${escapeHtml(row.id)}">
        <div class="request-head">
          <span class="request-part">${escapeHtml(row.partNumber)}</span>
          <span class="shortage-priority priority-${escapeHtml(row.priority)}">${escapeHtml(row.priority.replace('_', ' '))}</span>
          <span class="request-state">${escapeHtml(row.status)}</span>
          ${flag}
        </div>
        <p class="shortage-description">${escapeHtml(row.description)}</p>
        <p class="shortage-meta">Aircraft ${escapeHtml(row.aircraftId)} · needed ${escapeHtml(due)} · ${escapeHtml(row.quantityFulfilled)} of ${escapeHtml(row.quantity)} fulfilled · ${escapeHtml(row.openOrderCount)} open order(s)</p>
        <div class="unit-action-row">
          <button class="btn-quiet" data-open-orders="${escapeHtml(row.id)}">Orders</button>
          <button class="btn-quiet" data-open-trace="${escapeHtml(row.id)}">Trace</button>
          <button class="btn-quiet" data-open-history="${escapeHtml(row.id)}">History</button>
        </div>
        <div class="request-detail" data-detail-for="${escapeHtml(row.id)}" hidden></div>
      </article>`;
  }

  async function loadRequests() {
    const list = byId('partsRequestList');
    if (!list || !client.listRequests) return;
    list.innerHTML = '<div class="empty-state">Loading the request queue…</div>';
    try {
      const payload = await client.listRequests({
        status: byId('requestStatusFilter')?.value || undefined,
        priority: byId('requestPriorityFilter')?.value || undefined,
        overdueOnly: byId('requestOverdueOnly')?.checked || false,
        missingNeedByOnly: byId('requestMissingNeedBy')?.checked || false,
        session: await session()
      });
      const rows = payload.requests || [];
      const badge = byId('overdueCount');
      if (badge) {
        badge.hidden = !payload.overdue;
        badge.textContent = payload.overdue || '';
      }
      requestStatusMessage(
        payload.missingNeedBy
          ? `${payload.missingNeedBy} request(s) cannot be measured because nobody set a need-by date.`
          : ''
      );
      list.innerHTML = rows.length
        ? rows.map(requestCard).join('')
        : '<div class="empty-state">No requests match these filters.</div>';
      list.querySelectorAll('[data-open-orders]').forEach((button) => {
        button.addEventListener('click', () => showOrders(button.dataset.openOrders));
      });
      list.querySelectorAll('[data-open-history]').forEach((button) => {
        button.addEventListener('click', () => showRequestHistory(button.dataset.openHistory));
      });
      list.querySelectorAll('[data-open-trace]').forEach((button) => {
        button.addEventListener('click', () => showTrace(button.dataset.openTrace));
      });
    } catch (error) {
      list.innerHTML = `<div class="empty-state">${escapeHtml(errorMessage(error))}</div>`;
    }
  }

  function detailPanel(requirementId) {
    return byId('partsRequestList')?.querySelector(`[data-detail-for="${requirementId}"]`);
  }

  async function showOrders(requirementId) {
    const panel = detailPanel(requirementId);
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = '<div class="empty-state">Loading orders…</div>';
    try {
      const orders = await client.listOrders({ requirementId, session: await session() });
      panel.innerHTML = `
        ${orders.length ? orders.map(orderRow).join('') : '<div class="empty-state">No orders on this request yet.</div>'}
        <section class="unit-action-block">
          <h3>New order</h3>
          <div class="parts-form-grid">
            <label>Kind
              <select data-new-order-kind><option value="po">Purchase order</option><option value="so">Service order</option></select>
            </label>
            <label>Type of buy
              <select data-new-order-buy>
                <option value="outright">Outright</option>
                <option value="exchange">Exchange</option>
                <option value="repair">Repair</option>
                <option value="loan">Loan</option>
              </select>
            </label>
            <label>Order number<input data-new-order-number placeholder="PO-1042"></label>
            <label>Supplier<input data-new-order-supplier placeholder="Vendor name"></label>
          </div>
          <button class="btn-primary" data-create-order="${escapeHtml(requirementId)}">Add order</button>
        </section>`;
      panel.querySelector('[data-create-order]')?.addEventListener('click', () => createOrder(requirementId, panel));
      panel.querySelectorAll('[data-order-action]').forEach((button) => {
        button.addEventListener('click', () => setOrderStatus(
          requirementId, button.dataset.orderId, Number(button.dataset.orderVersion), button.dataset.orderAction));
      });
    } catch (error) {
      panel.innerHTML = `<div class="empty-state">${escapeHtml(errorMessage(error))}</div>`;
    }
  }

  function orderRow(order) {
    const actions = ORDER_ACTIONS[order.status] || [];
    const cost = order.purchaseCostUsd == null ? '' : ` · $${escapeHtml(order.purchaseCostUsd)}`;
    return `
      <article class="order-row">
        <div class="request-head">
          <span class="request-part">${escapeHtml(order.orderNumber || 'Unnumbered')}</span>
          <span class="request-state">${escapeHtml(order.status)}</span>
        </div>
        <p class="shortage-meta">${escapeHtml(order.orderKind.toUpperCase())} · ${escapeHtml(order.typeOfBuy)}${cost} · ${escapeHtml(order.supplierName || 'No supplier recorded')}</p>
        <div class="unit-action-row">
          ${actions.map((action) => `<button class="${action.primary ? 'btn-primary' : 'btn-quiet'}" data-order-action="${escapeHtml(action.status)}" data-order-id="${escapeHtml(order.id)}" data-order-version="${escapeHtml(order.version)}">${escapeHtml(action.label)}</button>`).join('')}
        </div>
      </article>`;
  }

  async function createOrder(requirementId, panel) {
    requestStatusMessage('Adding the order…');
    try {
      await client.createOrder({
        requirementId,
        values: {
          orderKind: panel.querySelector('[data-new-order-kind]').value,
          typeOfBuy: panel.querySelector('[data-new-order-buy]').value,
          orderNumber: panel.querySelector('[data-new-order-number]').value.trim() || null,
          supplierName: panel.querySelector('[data-new-order-supplier]').value.trim() || null
        },
        session: await session()
      });
      requestStatusMessage('');
      // The list re-render replaces every row, so refresh it before
      // re-opening the panel or the panel is discarded immediately after.
      await loadRequests();
      await showOrders(requirementId);
    } catch (error) {
      requestStatusMessage(errorMessage(error), 'error');
    }
  }

  async function setOrderStatus(requirementId, orderId, version, status) {
    requestStatusMessage('Updating the order…');
    try {
      await client.setOrderStatus({ orderId, version, status, session: await session() });
      requestStatusMessage('');
      // The list re-render replaces every row, so refresh it before
      // re-opening the panel or the panel is discarded immediately after.
      await loadRequests();
      await showOrders(requirementId);
    } catch (error) {
      requestStatusMessage(errorMessage(error), 'error');
    }
  }

  async function showRequestHistory(requirementId) {
    const panel = detailPanel(requirementId);
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = '<div class="empty-state">Loading history…</div>';
    try {
      const changes = await client.listRequestHistory({ requirementId, session: await session() });
      panel.innerHTML = changes.length
        ? `<ol class="parts-timeline">${changes.map((change) => `<li><strong>${escapeHtml(change.fieldName)}</strong><span>${escapeHtml(new Date(change.createdAt).toLocaleString())}</span><p>${escapeHtml(change.oldValue || 'unset')} → ${escapeHtml(change.newValue || 'unset')}</p></li>`).join('')}</ol>`
        : '<div class="empty-state">No recorded changes on this request.</div>';
    } catch (error) {
      panel.innerHTML = `<div class="empty-state">${escapeHtml(errorMessage(error))}</div>`;
    }
  }

  const SHIPMENT_ACTIONS = {
    pending: [
      { status: 'in_transit', label: 'Mark shipped', primary: true },
      { status: 'delivered', label: 'Mark delivered' },
      { status: 'exception', label: 'Flag exception' }
    ],
    in_transit: [
      { status: 'delivered', label: 'Mark delivered', primary: true },
      { status: 'exception', label: 'Flag exception' }
    ],
    exception: [
      { status: 'in_transit', label: 'Back in transit', primary: true },
      { status: 'delivered', label: 'Mark delivered' }
    ],
    delivered: []
  };

  function shipmentRow(leg) {
    const actions = SHIPMENT_ACTIONS[leg.status] || [];
    const route = [leg.origin || 'origin unrecorded', leg.destination || 'destination unrecorded'].join(' → ');
    const paperwork = leg.certificateType
      ? `${TRACE_LABELS[leg.certificateType] || leg.certificateType}${leg.certificateNumber ? ` ${leg.certificateNumber}` : ''}`
      : 'No paperwork recorded';
    const landed = leg.receivedAt ? ` · landed ${new Date(leg.receivedAt).toLocaleDateString()}` : '';
    return `
      <article class="order-row">
        <div class="request-head">
          <span class="request-part">Leg ${escapeHtml(leg.legSequence)} · ${escapeHtml(leg.purpose.replace(/_/g, ' '))}</span>
          <span class="request-state">${escapeHtml(leg.status.replace('_', ' '))}</span>
        </div>
        <p class="shortage-meta">${escapeHtml(route)} · ${escapeHtml(leg.carrier || 'no carrier')}${leg.trackingNumber ? ` ${escapeHtml(leg.trackingNumber)}` : ''}${escapeHtml(landed)}</p>
        <p class="shortage-meta">${escapeHtml(paperwork)}</p>
        <div class="unit-action-row">
          ${actions.map((a) => `<button class="${a.primary ? 'btn-primary' : 'btn-quiet'}" data-leg-action="${escapeHtml(a.status)}" data-leg-id="${escapeHtml(leg.id)}" data-leg-version="${escapeHtml(leg.version)}">${escapeHtml(a.label)}</button>`).join('')}
        </div>
      </article>`;
  }

  function eventRow(event) {
    const when = new Date(event.eventAt).toLocaleString();
    const reason = event.removalReason ? ` · ${escapeHtml(event.removalReason)}` : '';
    return `
      <article class="order-row event-row is-${escapeHtml(event.eventKind)}">
        <div class="request-head">
          <span class="request-part">${escapeHtml(event.eventKind)}</span>
          <span class="request-state">${escapeHtml(event.partNumber)}${event.partSerial ? ` / ${escapeHtml(event.partSerial)}` : ''}</span>
        </div>
        <p class="shortage-meta">${escapeHtml(event.aircraftId || 'no aircraft recorded')}${reason} · ${escapeHtml(when)}${event.performedBy ? ` · ${escapeHtml(event.performedBy)}` : ''}</p>
      </article>`;
  }

  async function showTrace(requirementId) {
    const panel = detailPanel(requirementId);
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = '<div class="empty-state">Loading traceability…</div>';
    try {
      const currentSession = await session();
      const [legs, events] = await Promise.all([
        client.listShipments({ requirementId, session: currentSession }),
        client.listPartEvents({ session: currentSession })
      ]);
      panel.innerHTML = `
        <h3 class="trace-heading">Shipment legs</h3>
        ${legs.length ? legs.map(shipmentRow).join('') : '<div class="empty-state">No legs recorded.</div>'}
        <section class="unit-action-block">
          <h3>Add a leg</h3>
          <div class="parts-form-grid">
            <label>Purpose
              <select data-leg-purpose>
                <option value="procurement">Procurement inbound</option>
                <option value="repair_out">Out for repair</option>
                <option value="repair_return">Back from repair</option>
                <option value="transfer">Transfer</option>
                <option value="return">Return</option>
              </select>
            </label>
            <label>Carrier<input data-leg-carrier placeholder="Carrier"></label>
            <label>Origin<input data-leg-origin placeholder="From"></label>
            <label>Destination<input data-leg-destination placeholder="To"></label>
            <label>Paperwork
              <select data-leg-cert>${optionList(TRACE_TYPES, 'none')}</select>
            </label>
            <label>Certificate number<input data-leg-cert-number placeholder="Optional"></label>
          </div>
          <button class="btn-primary" data-create-leg="${escapeHtml(requirementId)}">Add leg</button>
        </section>
        <h3 class="trace-heading">Install and removal history</h3>
        ${events.length ? events.map(eventRow).join('') : '<div class="empty-state">No install or removal events recorded.</div>'}`;
      panel.querySelector('[data-create-leg]')?.addEventListener('click', () => createShipment(requirementId, panel));
      panel.querySelectorAll('[data-leg-action]').forEach((button) => {
        button.addEventListener('click', () => setShipmentStatus(
          requirementId, button.dataset.legId, Number(button.dataset.legVersion), button.dataset.legAction));
      });
    } catch (error) {
      panel.innerHTML = `<div class="empty-state">${escapeHtml(errorMessage(error))}</div>`;
    }
  }

  async function createShipment(requirementId, panel) {
    requestStatusMessage('Recording the leg…');
    try {
      await client.createShipment({
        requirementId,
        values: {
          purpose: panel.querySelector('[data-leg-purpose]').value,
          carrier: panel.querySelector('[data-leg-carrier]').value.trim() || null,
          origin: panel.querySelector('[data-leg-origin]').value.trim() || null,
          destination: panel.querySelector('[data-leg-destination]').value.trim() || null,
          certificateType: panel.querySelector('[data-leg-cert]').value,
          certificateNumber: panel.querySelector('[data-leg-cert-number]').value.trim() || null
        },
        session: await session()
      });
      requestStatusMessage('');
      await loadRequests();
      await showTrace(requirementId);
    } catch (error) {
      requestStatusMessage(errorMessage(error), 'error');
    }
  }

  async function setShipmentStatus(requirementId, shipmentId, version, status) {
    requestStatusMessage('Updating the leg…');
    try {
      await client.setShipmentStatus({ shipmentId, version, status, session: await session() });
      requestStatusMessage('');
      await loadRequests();
      await showTrace(requirementId);
    } catch (error) {
      requestStatusMessage(errorMessage(error), 'error');
    }
  }

  const ROTABLE_STATUSES = [
    ['in_stock', 'In stock'],
    ['installed', 'Installed'],
    ['in_repair', 'In repair'],
    ['in_transit', 'In transit'],
    ['on_loan', 'On loan'],
    ['scrapped', 'Scrapped']
  ];

  function rotableStatusMessage(message, kind = '') {
    const element = byId('rotableStatus');
    if (!element) return;
    element.className = `parts-inline-status ${kind}`.trim();
    element.textContent = message;
  }

  function rotableRow(unit) {
    const retired = !!unit.retiredAt;
    const where = unit.currentAircraftId
      ? `on ${escapeHtml(unit.currentAircraftId)}`
      : 'not on an aircraft';
    return `
      <article class="rotable-row status-${escapeHtml(unit.currentStatus)}${retired ? ' is-retired' : ''}" data-rotable-id="${escapeHtml(unit.id)}">
        <div class="request-head">
          <span class="request-part">${escapeHtml(unit.partNumber)} / ${escapeHtml(unit.serialNumber)}</span>
          <span class="request-state">${escapeHtml(unit.currentStatus.replace('_', ' '))}</span>
        </div>
        <p class="shortage-meta">${escapeHtml(unit.nomenclature || 'No nomenclature recorded')} · ${where} · repaired ${escapeHtml(unit.timesRepaired)} time(s)</p>
        <div class="unit-action-row">
          <label>Status
            <select data-rotable-status="${escapeHtml(unit.id)}">${optionList(ROTABLE_STATUSES, unit.currentStatus)}</select>
          </label>
          <label>Aircraft
            <input data-rotable-aircraft="${escapeHtml(unit.id)}" value="${escapeHtml(unit.currentAircraftId || '')}" placeholder="none">
          </label>
          <button class="btn-quiet" data-save-rotable="${escapeHtml(unit.id)}" data-version="${escapeHtml(unit.version)}">Save</button>
          ${retired ? '' : `<button class="btn-quiet" data-open-retire="${escapeHtml(unit.id)}">Retire</button>`}
        </div>
        <div class="retire-panel" data-retire-panel="${escapeHtml(unit.id)}" hidden>
          <label>Why is this unit being retired?
            <input data-retire-reason="${escapeHtml(unit.id)}" maxlength="500" placeholder="Beyond economic repair after second shop visit">
          </label>
          <div class="unit-action-row">
            <button class="btn-primary" data-confirm-retire="${escapeHtml(unit.id)}" data-version="${escapeHtml(unit.version)}">Retire this unit</button>
            <button class="btn-quiet" data-cancel-retire="${escapeHtml(unit.id)}">Cancel</button>
          </div>
        </div>
      </article>`;
  }

  async function loadRotables() {
    const list = byId('partsRotableList');
    if (!list || !client.listRotables) return;
    list.innerHTML = '<div class="empty-state">Loading the rotable register…</div>';
    try {
      const units = await client.listRotables({
        status: byId('rotableStatusFilter')?.value || undefined,
        aircraftId: byId('rotableAircraftFilter')?.value.trim() || undefined,
        includeRetired: byId('rotableIncludeRetired')?.checked || false,
        session: await session()
      });
      list.innerHTML = units.length
        ? units.map(rotableRow).join('')
        : '<div class="empty-state">No rotables match these filters.</div>';
      list.querySelectorAll('[data-save-rotable]').forEach((button) => {
        button.addEventListener('click', () => saveRotable(button.dataset.saveRotable, Number(button.dataset.version)));
      });
      list.querySelectorAll('[data-open-retire]').forEach((button) => {
        button.addEventListener('click', () => {
          const panel = list.querySelector(`[data-retire-panel="${button.dataset.openRetire}"]`);
          panel.hidden = false;
          panel.querySelector('[data-retire-reason]').focus();
        });
      });
      list.querySelectorAll('[data-cancel-retire]').forEach((button) => {
        button.addEventListener('click', () => {
          const panel = list.querySelector(`[data-retire-panel="${button.dataset.cancelRetire}"]`);
          panel.hidden = true;
          panel.querySelector('[data-retire-reason]').value = '';
        });
      });
      list.querySelectorAll('[data-confirm-retire]').forEach((button) => {
        button.addEventListener('click', () => retireRotable(button.dataset.confirmRetire, Number(button.dataset.version)));
      });
    } catch (error) {
      list.innerHTML = `<div class="empty-state">${escapeHtml(errorMessage(error))}</div>`;
    }
  }

  async function createRotable() {
    const button = byId('btnCreateRotable');
    button.disabled = true;
    rotableStatusMessage('Registering…');
    try {
      await client.createRotable({
        values: {
          partNumber: byId('newRotablePart').value.trim(),
          serialNumber: byId('newRotableSerial').value.trim(),
          nomenclature: byId('newRotableNomen').value.trim() || null,
          currentStatus: byId('newRotableStatus').value,
          currentAircraftId: byId('newRotableAircraft').value.trim() || null
        },
        session: await session()
      });
      ['newRotablePart', 'newRotableSerial', 'newRotableNomen', 'newRotableAircraft']
        .forEach((id) => { byId(id).value = ''; });
      rotableStatusMessage('');
      await loadRotables();
    } catch (error) {
      rotableStatusMessage(errorMessage(error), 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function saveRotable(rotableId, version) {
    rotableStatusMessage('Saving…');
    try {
      const list = byId('partsRotableList');
      await client.updateRotable({
        rotableId,
        version,
        values: {
          currentStatus: list.querySelector(`[data-rotable-status="${rotableId}"]`).value,
          currentAircraftId: list.querySelector(`[data-rotable-aircraft="${rotableId}"]`).value.trim()
        },
        session: await session()
      });
      rotableStatusMessage('');
      await loadRotables();
    } catch (error) {
      rotableStatusMessage(errorMessage(error), 'error');
    }
  }

  async function retireRotable(rotableId, version) {
    const field = byId('partsRotableList')?.querySelector(`[data-retire-reason="${rotableId}"]`);
    const reason = field?.value.trim() || '';
    if (!reason) {
      rotableStatusMessage('Retiring a unit is a disposition. Record why before confirming.', 'error');
      field?.focus();
      return;
    }
    rotableStatusMessage('Retiring…');
    try {
      await client.retireRotable({ rotableId, version, reason: reason.trim(), session: await session() });
      rotableStatusMessage('');
      await loadRotables();
    } catch (error) {
      rotableStatusMessage(errorMessage(error), 'error');
    }
  }

  // What a rob can become next. Approval cannot be skipped, and completed,
  // rejected, and cancelled are the end of the line.
  const ROB_DECISIONS = {
    proposed: [
      { status: 'approved', label: 'Approve', primary: true },
      { status: 'rejected', label: 'Reject' },
      { status: 'cancelled', label: 'Withdraw' }
    ],
    approved: [
      { status: 'completed', label: 'Mark complete', primary: true },
      { status: 'cancelled', label: 'Withdraw' }
    ],
    rejected: [],
    completed: [],
    cancelled: []
  };

  function robStatusMessage(message, kind = '') {
    const element = byId('robStatusMessage');
    if (!element) return;
    element.className = `parts-inline-status ${kind}`.trim();
    element.textContent = message;
  }

  function robRow(rob) {
    const decisions = ROB_DECISIONS[rob.status] || [];
    const life = rob.isLifeLimited
      ? `<span class="rob-life">Life limited${rob.transferredHours != null ? ` · ${escapeHtml(rob.transferredHours)} hrs` : ''}${rob.transferredCycles != null ? ` · ${escapeHtml(rob.transferredCycles)} cycles` : ''}</span>`
      : '';
    const lineage = rob.donorRemovalEventId && rob.receiverInstallEventId
      ? 'both events on record'
      : rob.donorRemovalEventId
        ? 'donor removal on record; awaiting the install'
        : 'no events linked yet';
    return `
      <article class="rob-row status-${escapeHtml(rob.status)}" data-rob-id="${escapeHtml(rob.id)}">
        <div class="request-head">
          <span class="request-part">${escapeHtml(rob.partNumber || 'Part not named')}${rob.serialNumber ? ` / ${escapeHtml(rob.serialNumber)}` : ''}</span>
          <span class="request-state">${escapeHtml(rob.status)}</span>
          ${life}
        </div>
        <p class="shortage-meta">${escapeHtml(rob.donorAircraftId || 'donor not named')} → ${escapeHtml(rob.receiverAircraftId || 'receiver not named')} · ${escapeHtml(lineage)}</p>
        ${rob.rtsImpactRationale ? `<p class="shortage-description">${escapeHtml(rob.rtsImpactRationale)}</p>` : ''}
        ${decisions.length ? `
        <div class="rob-decide">
          ${rob.isLifeLimited && rob.status === 'proposed' ? `
          <div class="parts-form-grid">
            <label>Hours transferred<input type="number" step="0.1" data-rob-hours="${escapeHtml(rob.id)}" value="${escapeHtml(rob.transferredHours ?? '')}"></label>
            <label>Cycles transferred<input type="number" data-rob-cycles="${escapeHtml(rob.id)}" value="${escapeHtml(rob.transferredCycles ?? '')}"></label>
          </div>` : ''}
          <div class="unit-action-row">
            ${decisions.map((d) => `<button class="${d.primary ? 'btn-primary' : 'btn-quiet'}" data-rob-decision="${escapeHtml(d.status)}" data-rob-target="${escapeHtml(rob.id)}" data-rob-version="${escapeHtml(rob.version)}">${escapeHtml(d.label)}</button>`).join('')}
          </div>
        </div>` : ''}
      </article>`;
  }

  async function loadRobs() {
    const list = byId('partsRobList');
    if (!list || !client.listCannibalizations) return;
    list.innerHTML = '<div class="empty-state">Loading cannibalizations…</div>';
    try {
      const rows = await client.listCannibalizations({ session: await session() });
      const open = rows.filter((rob) => rob.status === 'proposed' || rob.status === 'approved').length;
      const badge = byId('robCount');
      if (badge) {
        badge.hidden = !open;
        badge.textContent = open || '';
      }
      list.innerHTML = rows.length
        ? rows.map(robRow).join('')
        : '<div class="empty-state">No cannibalizations recorded.</div>';
      list.querySelectorAll('[data-rob-decision]').forEach((button) => {
        button.addEventListener('click', () => decideRob(
          button.dataset.robTarget, Number(button.dataset.robVersion), button.dataset.robDecision));
      });
    } catch (error) {
      list.innerHTML = `<div class="empty-state">${escapeHtml(errorMessage(error))}</div>`;
    }
  }

  async function proposeRob() {
    const button = byId('btnProposeRob');
    button.disabled = true;
    robStatusMessage('Recording the proposal…');
    try {
      await client.proposeCannibalization({
        values: {
          partNumber: byId('newRobPart').value.trim() || null,
          serialNumber: byId('newRobSerial').value.trim() || null,
          donorAircraftId: byId('newRobDonor').value.trim() || null,
          receiverAircraftId: byId('newRobReceiver').value.trim() || null,
          isLifeLimited: byId('newRobLifeLimited').value === 'true',
          rtsImpactRationale: byId('newRobRationale').value.trim() || null
        },
        session: await session()
      });
      ['newRobPart', 'newRobSerial', 'newRobDonor', 'newRobReceiver', 'newRobRationale']
        .forEach((id) => { byId(id).value = ''; });
      robStatusMessage('');
      await loadRobs();
    } catch (error) {
      robStatusMessage(errorMessage(error), 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function decideRob(robId, version, status) {
    robStatusMessage('Recording the decision…');
    try {
      const list = byId('partsRobList');
      const hours = list.querySelector(`[data-rob-hours="${robId}"]`)?.value;
      const cycles = list.querySelector(`[data-rob-cycles="${robId}"]`)?.value;
      await client.decideCannibalization({
        cannId: robId,
        version,
        status,
        values: {
          transferredHours: hours ? Number(hours) : null,
          transferredCycles: cycles ? Number(cycles) : null
        },
        session: await session()
      });
      robStatusMessage('');
      await loadRobs();
    } catch (error) {
      robStatusMessage(errorMessage(error), 'error');
    }
  }

  // The preview a file earned, keyed to that exact file. Choosing a different
  // file, or changing the mode, invalidates it — the plan on screen would no
  // longer describe what Apply would do.
  let importPreview = null;

  function importStatus(message, kind = '') {
    const element = byId('importStatusMessage');
    if (!element) return;
    element.className = `parts-inline-status ${kind}`.trim();
    element.textContent = message;
  }

  function invalidateImportPreview(reason) {
    importPreview = null;
    const apply = byId('btnApplyImport');
    if (apply) apply.disabled = true;
    const panel = byId('importPreviewPanel');
    if (panel) panel.innerHTML = '';
    const hint = byId('importApplyHint');
    if (hint) hint.textContent = reason || 'Apply stays disabled until this exact file has been previewed.';
  }

  function planLabel(row) {
    if (row.problems && row.problems.length) {
      return { css: 'is-error', text: row.problems.join('; ') };
    }
    const plan = row.plan || {};
    switch (plan.outcome) {
      case 'create':
        return {
          css: 'is-create',
          text: plan.creates_part ? 'New part' + (plan.creates_unit ? ' and stock' : '') : 'New stock'
        };
      case 'update':
        return { css: 'is-update', text: `Would change ${(plan.changed_fields || []).join(', ')}` };
      case 'skip':
        return { css: 'is-skip', text: plan.reason || 'No change' };
      case 'conflict':
        return { css: 'is-conflict', text: plan.reason || 'Not permitted in this mode' };
      default:
        return { css: '', text: '' };
    }
  }

  function renderImportPreview(preview) {
    const panel = byId('importPreviewPanel');
    if (!panel) return;
    const blocked = preview.errorRows > 0 || preview.conflicts > 0;
    panel.innerHTML = `
      <div class="import-summary${blocked ? ' is-blocked' : ''}">
        <div><dt>Rows</dt><dd>${escapeHtml(preview.totalRows)}</dd></div>
        <div><dt>Create</dt><dd>${escapeHtml(preview.creates)}</dd></div>
        <div><dt>Update</dt><dd class="${preview.updates ? 'count-update' : ''}">${escapeHtml(preview.updates)}</dd></div>
        <div><dt>Skip</dt><dd>${escapeHtml(preview.skips)}</dd></div>
        <div><dt>Conflict</dt><dd class="${preview.conflicts ? 'count-conflict' : ''}">${escapeHtml(preview.conflicts)}</dd></div>
        <div><dt>Errors</dt><dd class="${preview.errorRows ? 'count-conflict' : ''}">${escapeHtml(preview.errorRows)}</dd></div>
      </div>
      ${preview.updates && !blocked ? `<p class="import-warning">This file will overwrite ${escapeHtml(preview.updates)} existing part(s). Check the rows marked as changes below before applying.</p>` : ''}
      ${blocked ? `<p class="import-warning is-blocked">Nothing can be imported from this file yet. ${preview.conflicts ? `${escapeHtml(preview.conflicts)} row(s) would change parts that already exist, which add-only mode refuses.` : ''} ${preview.errorRows ? `${escapeHtml(preview.errorRows)} row(s) could not be read.` : ''}</p>` : ''}
      <div class="import-rows">
        ${preview.rows.map((row) => {
          const label = planLabel(row);
          return `<div class="import-row ${label.css}">
            <span class="import-row-number">Row ${escapeHtml(row.rowNumber)}</span>
            <span class="import-row-part">${escapeHtml(row.partNumber || '(no part number)')}</span>
            <span class="import-row-plan">${escapeHtml(label.text)}</span>
          </div>`;
        }).join('')}
      </div>`;
  }

  async function previewImport() {
    const file = byId('importFile')?.files?.[0];
    if (!file) {
      importStatus('Choose a CSV or Excel file first.', 'error');
      return;
    }
    const button = byId('btnPreviewImport');
    button.disabled = true;
    invalidateImportPreview('Previewing…');
    importStatus('Reading the file…');
    try {
      const mode = byId('importMode').value;
      const preview = await client.previewImport({ file, mode, session: await session() });
      renderImportPreview(preview);
      if (preview.applicable) {
        importPreview = { sha256: preview.sourceSha256, name: file.name, size: file.size, mode };
        byId('btnApplyImport').disabled = false;
        byId('importApplyHint').textContent =
          `Reviewed. Applying will create ${preview.creates}, update ${preview.updates}, and skip ${preview.skips} row(s).`;
      } else {
        byId('importApplyHint').textContent = 'Fix the file, or change the mode, then preview again.';
      }
      importStatus('');
    } catch (error) {
      importStatus(errorMessage(error), 'error');
      invalidateImportPreview();
    } finally {
      button.disabled = false;
    }
  }

  async function applyImport() {
    const file = byId('importFile')?.files?.[0];
    if (!file || !importPreview) {
      importStatus('Preview the file before applying it.', 'error');
      return;
    }
    // Belt and braces against the picker changing under an approved preview.
    if (file.name !== importPreview.name || file.size !== importPreview.size) {
      invalidateImportPreview('The chosen file changed. Preview it again.');
      importStatus('The chosen file changed since it was previewed.', 'error');
      return;
    }
    const button = byId('btnApplyImport');
    button.disabled = true;
    importStatus('Importing…');
    try {
      const batch = await client.applyImport({
        file,
        mode: importPreview.mode,
        previewSha256: importPreview.sha256,
        session: await session()
      });
      importStatus(`Imported ${batch.partsCreated} part(s), ${batch.unitsCreated} unit(s); ${batch.rowsSkipped} row(s) skipped.`);
      invalidateImportPreview('Import applied. Choose another file to import again.');
      byId('importFile').value = '';
      await loadImportBatches();
      await performSearch();
    } catch (error) {
      importStatus(errorMessage(error), 'error');
      button.disabled = false;
    }
  }

  function importBatchRow(batch) {
    const rolledBack = batch.status === 'rolled_back';
    const when = new Date(batch.createdAt).toLocaleString();
    return `
      <article class="order-row import-batch${rolledBack ? ' is-rolled-back' : ''}">
        <div class="request-head">
          <span class="request-part">${escapeHtml(batch.fileName)}</span>
          <span class="request-state">${escapeHtml(batch.status.replace('_', ' '))}</span>
        </div>
        <p class="shortage-meta">${escapeHtml(when)} · ${escapeHtml(batch.mode.replace(/_/g, ' '))} · ${escapeHtml(batch.partsCreated)} part(s) created, ${escapeHtml(batch.partsUpdated)} updated, ${escapeHtml(batch.unitsCreated)} unit(s), ${escapeHtml(batch.rowsSkipped)} skipped</p>
        ${rolledBack ? '' : `<div class="unit-action-row">
          <button class="btn-quiet" data-rollback-import="${escapeHtml(batch.id)}">Roll back</button>
        </div>`}
      </article>`;
  }

  async function loadImportBatches() {
    const list = byId('importBatchList');
    if (!list || !client.listImportBatches) return;
    list.innerHTML = '<div class="empty-state">Loading import history…</div>';
    try {
      const batches = await client.listImportBatches({ session: await session() });
      list.innerHTML = batches.length
        ? batches.map(importBatchRow).join('')
        : '<div class="empty-state">Nothing has been imported yet.</div>';
      list.querySelectorAll('[data-rollback-import]').forEach((button) => {
        button.addEventListener('click', () => rollbackImport(button.dataset.rollbackImport));
      });
    } catch (error) {
      list.innerHTML = `<div class="empty-state">${escapeHtml(errorMessage(error))}</div>`;
    }
  }

  async function rollbackImport(batchId) {
    importStatus('Rolling back…');
    try {
      await client.rollbackImport({ batchId, session: await session() });
      importStatus('');
      await loadImportBatches();
      await performSearch();
    } catch (error) {
      importStatus(errorMessage(error), 'error');
    }
  }

  async function downloadImportTemplate() {
    try {
      const blob = await client.downloadImportTemplate({ session: await session() });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'mxgenius-parts.csv';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      importStatus(errorMessage(error), 'error');
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

  // Codes where the server's own wording is less useful than a plain
  // explanation. Everything else is passed through, because an allowlist of
  // denial codes silently mistranslates every new one that is added.
  const OPAQUE_DENIALS = new Set(['TENANT_ACCESS_DENIED', 'FORBIDDEN']);

  function errorMessage(error) {
    if (error?.status === 403) {
      if (error.message && !OPAQUE_DENIALS.has(error.code)) return error.message;
      return 'Your account does not have access to this organization.';
    }
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
              <button type="button" class="guided-help-trigger" data-guide-id="parts-management" aria-label="Explain the controlled parts workflow" aria-expanded="false">?</button>
              <div class="parts-view-switch" role="tablist" aria-label="Parts view">
                <button class="parts-view-tab active" data-view="inventory" role="tab" aria-selected="true">Inventory</button>
                <button class="parts-view-tab" data-view="requests" role="tab" aria-selected="false">Requests<span id="overdueCount" class="shortage-count" hidden></span></button>
                <button class="parts-view-tab" data-view="shortages" role="tab" aria-selected="false">Shortages<span id="shortageCount" class="shortage-count" hidden></span></button>
                <button class="parts-view-tab" data-view="rotables" role="tab" aria-selected="false">Rotables</button>
                <button class="parts-view-tab" data-view="cannibalizations" role="tab" aria-selected="false">Robs<span id="robCount" class="shortage-count" hidden></span></button>
                <button class="parts-view-tab" data-view="locations" role="tab" aria-selected="false">Locations</button>
                <button class="parts-view-tab" data-view="imports" role="tab" aria-selected="false">Import</button>
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
            <div id="partsRequestsView" hidden>
              <div class="request-filters">
                <select id="requestStatusFilter" aria-label="Filter requests by status">
                  <option value="">Any status</option>
                  <option value="requested">Requested</option>
                  <option value="sourced">Sourced</option>
                  <option value="ordered">Ordered</option>
                  <option value="received">Received</option>
                  <option value="installed">Installed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <select id="requestPriorityFilter" aria-label="Filter requests by priority">
                  <option value="">Any priority</option>
                  <option value="aog">AOG</option>
                  <option value="scheduled_mx">Scheduled MX</option>
                  <option value="stock">Stock</option>
                </select>
                <label class="shortage-toggle"><input type="checkbox" id="requestOverdueOnly"> Overdue only</label>
                <label class="shortage-toggle"><input type="checkbox" id="requestMissingNeedBy"> No need-by date</label>
              </div>
              <div id="requestStatus" class="parts-inline-status" aria-live="polite"></div>
              <div id="partsRequestList"></div>
            </div>
            <div id="partsRotablesView" hidden>
              <div class="request-filters">
                <select id="rotableStatusFilter" aria-label="Filter rotables by status">
                  <option value="">Any status</option>
                  <option value="in_stock">In stock</option>
                  <option value="installed">Installed</option>
                  <option value="in_repair">In repair</option>
                  <option value="in_transit">In transit</option>
                  <option value="on_loan">On loan</option>
                  <option value="scrapped">Scrapped</option>
                </select>
                <input id="rotableAircraftFilter" placeholder="Aircraft" aria-label="Filter rotables by aircraft">
                <label class="shortage-toggle"><input type="checkbox" id="rotableIncludeRetired"> Show retired</label>
              </div>
              <div id="rotableStatus" class="parts-inline-status" aria-live="polite"></div>
              <section class="unit-action-block location-create">
                <h3>Register a rotable</h3>
                <p class="unit-action-hint">A serialized unit tracked across tails, repairs, and loans. The part number and serial together identify it.</p>
                <div class="parts-form-grid">
                  <label>Part number<input id="newRotablePart" placeholder="MXG-DEMO-32-1101"></label>
                  <label>Serial number<input id="newRotableSerial" placeholder="SN-0001"></label>
                  <label>Nomenclature<input id="newRotableNomen" placeholder="Optional"></label>
                  <label>Status
                    <select id="newRotableStatus">
                      <option value="in_stock">In stock</option>
                      <option value="installed">Installed</option>
                      <option value="in_repair">In repair</option>
                      <option value="in_transit">In transit</option>
                      <option value="on_loan">On loan</option>
                    </select>
                  </label>
                  <label>Aircraft<input id="newRotableAircraft" placeholder="Required when installed"></label>
                </div>
                <button class="btn-primary" id="btnCreateRotable">Register</button>
              </section>
              <div id="partsRotableList"></div>
            </div>
            <div id="partsRobsView" hidden>
              <p class="unit-action-hint rob-preamble">Robbing a serviceable part off one aircraft to return another to service is an airworthiness claim. A rob is proposed by one person and decided by another, and it can only be completed once both the donor removal and the receiver install are on record.</p>
              <div id="robStatusMessage" class="parts-inline-status" aria-live="polite"></div>
              <section class="unit-action-block location-create">
                <h3>Propose a rob</h3>
                <div class="parts-form-grid">
                  <label>Part number<input id="newRobPart" placeholder="MXG-DEMO-32-1101"></label>
                  <label>Serial number<input id="newRobSerial" placeholder="Identifies the part taken"></label>
                  <label>Donor aircraft<input id="newRobDonor" placeholder="Taken from"></label>
                  <label>Receiver aircraft<input id="newRobReceiver" placeholder="Fitted to"></label>
                  <label>Life limited?
                    <select id="newRobLifeLimited"><option value="false">No</option><option value="true">Yes</option></select>
                  </label>
                  <label>Why this rob<input id="newRobRationale" placeholder="Return-to-service impact"></label>
                </div>
                <button class="btn-primary" id="btnProposeRob">Propose</button>
              </section>
              <div id="partsRobList"></div>
            </div>
            <div id="partsImportView" hidden>
              <section class="unit-action-block location-create">
                <h3>Import parts and stock</h3>
                <p class="unit-action-hint">Upload a CSV or Excel file. Nothing is written until you have seen what it would do and confirmed it. Start from the template so the columns line up.</p>
                <div class="import-controls">
                  <input type="file" id="importFile" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
                  <label>Mode
                    <select id="importMode">
                      <option value="add_only">Add only — refuse rows that change existing parts</option>
                      <option value="add_and_update">Add and update — let rows overwrite existing parts</option>
                    </select>
                  </label>
                </div>
                <div class="unit-action-row">
                  <button class="btn-primary" id="btnPreviewImport">Preview</button>
                  <button class="btn-primary" id="btnApplyImport" disabled>Apply</button>
                  <button class="btn-quiet" id="btnImportTemplate">Download template</button>
                </div>
                <p class="unit-action-hint" id="importApplyHint">Apply stays disabled until this exact file has been previewed.</p>
              </section>
              <div id="importStatusMessage" class="parts-inline-status" aria-live="polite"></div>
              <div id="importPreviewPanel"></div>
              <h3 class="trace-heading">Import history</h3>
              <div id="importBatchList"></div>
            </div>
            <div id="partsLocationsView" hidden>
              <div id="locationStatus" class="parts-inline-status" aria-live="polite"></div>
              <section class="unit-action-block location-create">
                <h3>Add a location</h3>
                <p class="unit-action-hint">Codes are stored uppercase and must be unique within your organization.</p>
                <div class="parts-form-grid">
                  <label>Code<input id="newLocationCode" placeholder="STOCK-A12"></label>
                  <label>Name<input id="newLocationName" placeholder="Bonded shelf A12"></label>
                  <label>Type
                    <select id="newLocationType">
                      <option value="stock">Stock</option>
                      <option value="receiving">Receiving</option>
                      <option value="quarantine">Quarantine</option>
                      <option value="bonded">Bonded</option>
                      <option value="shipping">Shipping</option>
                      <option value="scrap">Scrap</option>
                    </select>
                  </label>
                  <label>Barcode<input id="newLocationBarcode" placeholder="Optional"></label>
                </div>
                <button class="btn-primary" id="btnCreateLocation">Add location</button>
              </section>
              <label class="shortage-toggle"><input type="checkbox" id="locationsIncludeInactive"> Show retired locations</label>
              <div id="partsLocationList"></div>
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
              <div class="wizard-source-actions">
                <button class="btn-quiet" id="btnWizardViewSource" type="button">View source</button>
                <span id="wizardSourceName"></span>
              </div>
              <div id="wizardSourcePreview" class="wizard-source-preview" hidden></div>
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
                  <select id="wizardTrace"></select>
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
    const traceSelect = byId('wizardTrace');
    if (traceSelect) traceSelect.innerHTML = optionList(TRACE_TYPES, 'none');
    bindEvents();
    performSearch();
    loadLocations();
    loadShortages();
    loadRequests();
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
    ['requestStatusFilter', 'requestPriorityFilter', 'requestOverdueOnly', 'requestMissingNeedBy']
      .forEach((id) => byId(id)?.addEventListener('change', loadRequests));
    byId('locationsIncludeInactive')?.addEventListener('change', renderLocations);
    byId('btnCreateLocation')?.addEventListener('click', createLocation);
    byId('btnCreateRotable')?.addEventListener('click', createRotable);
    byId('btnProposeRob')?.addEventListener('click', proposeRob);
    byId('btnPreviewImport')?.addEventListener('click', previewImport);
    byId('btnApplyImport')?.addEventListener('click', applyImport);
    byId('btnImportTemplate')?.addEventListener('click', downloadImportTemplate);
    // Any change to what would be imported retires the approved preview.
    byId('importFile')?.addEventListener('change', () => invalidateImportPreview('New file chosen. Preview it before applying.'));
    byId('importMode')?.addEventListener('change', () => invalidateImportPreview('Mode changed. Preview again to see what it would do.'));
    ['rotableStatusFilter', 'rotableIncludeRetired']
      .forEach((id) => byId(id)?.addEventListener('change', loadRotables));
    byId('rotableAircraftFilter')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') loadRotables();
    });
    byId('btnReceivePart')?.addEventListener('click', openWizard);
    byId('btnCancelWizard')?.addEventListener('click', closeWizard);
    byId('btnCloseDrawer')?.addEventListener('click', closeDrawer);
    byId('btnWizardProcessCapture')?.addEventListener('click', processCapture);
    byId('btnWizardSkipCapture')?.addEventListener('click', skipCapture);
    byId('btnWizardViewSource')?.addEventListener('click', toggleWizardSource);
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
  // Assignable paperwork. The bare legacy 'coc' is readable on historical
  // records but never offered, because a new record should be able to say
  // whose certificate of conformance it is.
  const TRACE_TYPES = [
    ['none', 'None'],
    ['form_8130', 'FAA 8130-3'],
    ['easa_form1', 'EASA Form 1'],
    ['dual_release', 'Dual release'],
    ['tso', 'TSO authorization'],
    ['coc_mfr', 'CoC — manufacturer'],
    ['coc_vendor', 'CoC — vendor'],
    ['ata106', 'ATA 106 used-parts trace'],
    ['teardown', 'Teardown report']
  ];

  const TRACE_LABELS = Object.fromEntries(TRACE_TYPES.concat([['coc', 'CoC (source not recorded)']]));

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
    clearWizardSourcePreview();
    state.draft = null;
    state.asset = null;
    state.extractionRun = null;
    state.candidates = [];
    state.extractionWarnings = [];
    const file = byId('wizardFileInput');
    if (file) file.value = '';
    ['wizardInputPartNumber', 'wizardInputDescription', 'wizardInputManufacturer',
      'wizardInputSerialNumber', 'wizardCertificateNumber', 'wizardLocation']
      .forEach((id) => { if (byId(id)) byId(id).value = ''; });
    if (byId('wizardQty')) byId('wizardQty').value = '1';
    if (byId('wizardMessage')) byId('wizardMessage').textContent = '';
    if (byId('wizardSourceName')) byId('wizardSourceName').textContent = '';
  }

  function openWizard() {
    resetWizard();
    byId('receivingWizard').hidden = false;
    setWizardStep(1);
  }

  function closeWizard() {
    clearWizardSourcePreview();
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

  function clearWizardSourcePreview() {
    if (state.sourcePreviewUrl) URL.revokeObjectURL(state.sourcePreviewUrl);
    state.sourcePreviewUrl = null;
    const preview = byId('wizardSourcePreview');
    if (preview) {
      preview.replaceChildren();
      preview.hidden = true;
    }
    const button = byId('btnWizardViewSource');
    if (button) button.textContent = 'View source';
  }

  async function toggleWizardSource() {
    const preview = byId('wizardSourcePreview');
    const button = byId('btnWizardViewSource');
    if (!preview || !button || !state.asset?.id) return;
    if (state.sourcePreviewUrl) {
      preview.hidden = !preview.hidden;
      button.textContent = preview.hidden ? 'View source' : 'Hide source';
      return;
    }
    button.disabled = true;
    wizardMessage('Opening the private source…');
    try {
      const blob = await client.downloadAsset({ assetId: state.asset.id, session: await session() });
      const url = URL.createObjectURL(blob);
      state.sourcePreviewUrl = url;
      const viewer = document.createElement(blob.type.startsWith('image/') ? 'img' : 'iframe');
      viewer.src = url;
      if (viewer.tagName === 'IMG') {
        viewer.alt = `Uploaded source: ${state.asset.originalFilename || 'parts evidence'}`;
      } else {
        viewer.title = `Uploaded source: ${state.asset.originalFilename || 'parts evidence'}`;
        viewer.setAttribute('sandbox', '');
      }
      preview.replaceChildren(viewer);
      preview.hidden = false;
      button.textContent = 'Hide source';
      wizardMessage('Compare each suggestion with the uploaded source.');
    } catch (error) {
      wizardMessage(errorMessage(error), 'error');
    } finally {
      button.disabled = false;
    }
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
      state.extractionWarnings = Array.isArray(extraction.warnings) ? extraction.warnings : [];
      const sourceName = byId('wizardSourceName');
      if (sourceName) sourceName.textContent = state.asset.originalFilename || file.name;

      // Hands-free path: the server marks which fields a human must actually
      // look at. When none of them do, accept the confident ones and go
      // straight to the details, so a mechanic in a headset never has to
      // proofread a form they cannot comfortably read.
      const needsReview = state.candidates.filter((candidate) => candidate.requiresReview);
      if (state.candidates.length && !needsReview.length) {
        await acceptConfidentCandidates();
        return;
      }

      renderCandidates();
      setWizardStep(2);
      wizardMessage(state.candidates.length
        ? `${needsReview.length} field(s) need a look; the rest were read confidently.`
        : 'No fields were recognized. Enter details manually.');
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

  /// Accepts every extracted field as proposed and moves to the details, used
  /// when the server flagged nothing for review.
  async function acceptConfidentCandidates() {
    try {
      const reviewed = await client.reviewExtraction({
        runId: state.extractionRun.id,
        decisions: state.candidates.map((candidate) => ({
          candidateId: candidate.id,
          reviewState: 'accepted',
          finalValue: null
        })),
        session: await session()
      });
      applyReviewedFields(reviewed.candidates || []);
      setWizardStep(3);
      wizardMessage(`Read ${state.candidates.length} field(s) confidently. Check the details and confirm.`);
    } catch (error) {
      // Fall back to the reviewed path rather than losing the extraction.
      renderCandidates();
      setWizardStep(2);
      wizardMessage(errorMessage(error), 'error');
    }
  }

  function renderCandidates() {
    const area = byId('wizardExtractedData');
    const warnings = state.extractionWarnings
      .filter((warning) => typeof warning === 'string' && warning.trim())
      .map((warning) => `<li>${escapeHtml(warning.trim())}</li>`)
      .join('');
    const warningPanel = warnings
      ? `<aside class="extraction-warning-panel" role="status"><strong>Source needs attention</strong><ul>${warnings}</ul></aside>`
      : '';
    if (!state.candidates.length) {
      area.innerHTML = `${warningPanel}<div class="empty-state">No document suggestions were returned.</div>`;
      return;
    }
    const confident = state.candidates.filter((candidate) => !candidate.requiresReview);
    const review = state.candidates.filter((candidate) => candidate.requiresReview);
    area.innerHTML = `${warningPanel}
      ${confident.length ? `<div class="ocr-accepted"><h4>Read confidently — accepted</h4>${confident.map((candidate) => `
        <div class="ocr-accepted-row" data-candidate-id="${escapeHtml(candidate.id)}" data-field-name="${escapeHtml(candidate.fieldName)}">
          <span>${escapeHtml(candidate.fieldName)}</span>
          <strong>${escapeHtml(candidate.proposedValue || '')}</strong>
          <span>${candidate.confidence == null ? '—' : `${Math.round(candidate.confidence * 100)}%`}</span>
          ${candidateSourceEvidence(candidate)}
        </div>`).join('')}</div>` : ''}
      ${review.map((candidate) => `
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
        ${candidateSourceEvidence(candidate)}
      </div>`).join('')}`;
  }

  function candidateSourceEvidence(candidate) {
    const sourceExcerpt = typeof candidate.sourceRegion?.sourceExcerpt === 'string'
      ? candidate.sourceRegion.sourceExcerpt.trim()
      : '';
    if (!sourceExcerpt) return '';
    const pageNumber = Number.isInteger(candidate.sourceRegion?.pageNumber)
      ? ` · page ${candidate.sourceRegion.pageNumber}`
      : '';
    return `<p class="candidate-source-evidence"><span>Source${escapeHtml(pageNumber)}</span>${escapeHtml(sourceExcerpt)}</p>`;
  }

  async function approveExtraction() {
    if (state.candidates.length) {
      const rows = [...document.querySelectorAll('[data-candidate-id]')];
      const decisions = rows.map((row) => {
        const decision = row.querySelector('[data-candidate-decision]');
        // A row with no decision control was read confidently and is accepted
        // as proposed; only flagged fields carry a choice.
        if (!decision) {
          return { candidateId: row.dataset.candidateId, reviewState: 'accepted', finalValue: null };
        }
        const reviewState = decision.value;
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
