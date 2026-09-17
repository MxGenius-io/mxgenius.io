(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const client = window.MXApplicationClient;
  const state = {
    customers: [],
    devices: [],
    selectedCustomerId: '',
    overview: null
  };

  const elements = {
    refresh: byId('customerRefresh'),
    status: byId('customerStatus'),
    list: byId('customerDirectoryList'),
    count: byId('customerDirectoryCount'),
    unassignedList: byId('customerUnassignedList'),
    unassignedCount: byId('customerUnassignedCount'),
    detail: byId('customerDetail'),
    empty: byId('customerEmpty'),
    createForm: byId('customerCreateForm'),
    editForm: byId('customerEditForm'),
    paymentForm: byId('customerPaymentForm'),
    paymentList: byId('customerPaymentList'),
    telemetryList: byId('customerTelemetryList'),
    deviceForm: byId('settingsDeviceForm'),
    deviceName: byId('settingsDeviceName'),
    deviceCode: byId('settingsDeviceClaimCode'),
    deviceRegister: byId('settingsDeviceRegister'),
    deviceRefresh: byId('settingsDeviceRefresh'),
    deviceStatus: byId('settingsDeviceStatus'),
    deviceScope: byId('settingsDeviceCustomerScope'),
    driveScope: byId('settingsPackCustomerScope'),
    deviceList: byId('settingsDeviceList'),
    revokedList: byId('settingsDeviceRevokedList'),
    revokedCount: byId('settingsDeviceRevokedCount')
  };

  function setStatus(message, tone = '') {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.dataset.state = tone;
  }

  function setDeviceStatus(message, tone = '') {
    if (!elements.deviceStatus) return;
    elements.deviceStatus.textContent = message;
    elements.deviceStatus.dataset.state = tone;
  }

  async function authenticatedSession({ forceRefresh = false } = {}) {
    await Promise.resolve(window.MXGENIUS_CONFIG?.ready);
    const renewed = window.MXGENIUS_AUTH?.getToken
      ? await window.MXGENIUS_AUTH.getToken({ forceRefresh })
      : '';
    const current = window.MXGENIUS_CONFIG?.getSession?.() || {};
    const accessToken = renewed || current.accessToken;
    if (!accessToken && !window.MXGENIUS_CONFIG?.allowInsecurePilot) {
      const error = new Error('Sign in is required to manage customer operations.');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    return { ...current, accessToken, correlationId: window.crypto?.randomUUID?.() };
  }

  async function withSession(operation) {
    let session = await authenticatedSession();
    try {
      return await operation(session);
    } catch (error) {
      if (!['AUTH_REQUIRED', 'ACCESS_DENIED'].includes(String(error?.code || '')) && error?.status !== 401) throw error;
      session = await authenticatedSession({ forceRefresh: true });
      return operation(session);
    }
  }

  function formatDate(value, fallback = 'Never') {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
  }

  function money(cents, currency = 'USD') {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(cents || 0) / 100);
  }

  function statusLabel(value) {
    return String(value || 'active').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function selectedCustomer() {
    return state.customers.find((customer) => customer.id === state.selectedCustomerId) || null;
  }

  function syncCustomerScope() {
    const customer = selectedCustomer();
    const selectedLabel = customer ? `Managing ${customer.name}` : 'Select or create a customer first';
    if (elements.deviceScope) elements.deviceScope.textContent = customer
      ? `${selectedLabel} · new devices are assigned to this account automatically.`
      : 'Select or create a customer to approve a device.';
    if (elements.driveScope) elements.driveScope.textContent = customer
      ? `${selectedLabel} · only this account's devices are available for assignment.`
      : 'Select or create a customer to assign an Equipment Drive.';
    elements.deviceForm?.querySelectorAll('input, button').forEach((control) => {
      control.disabled = !customer;
    });
    if (!customer) setDeviceStatus('Choose a customer, then enter the seven-digit code shown on the Pi.');
  }

  function text(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  }

  function renderMetrics() {
    const activeDevices = state.devices.filter((device) => device.status === 'active').length;
    const attention = state.devices.filter((device) => ['pending', 'offline'].includes(device.status)).length;
    byId('customerMetricAccounts').textContent = String(state.customers.length);
    byId('customerMetricDevices').textContent = String(state.devices.filter((device) => device.status !== 'revoked').length);
    byId('customerMetricOnline').textContent = String(activeDevices);
    byId('customerMetricAttention').textContent = String(attention);
  }

  function renderDirectory() {
    elements.list.replaceChildren();
    elements.count.textContent = String(state.customers.length);
    if (!state.customers.length) {
      elements.list.appendChild(text('p', 'customer-status', 'No customers yet. Add the first account below.'));
      return;
    }
    state.customers.forEach((customer) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'customer-directory__item';
      button.classList.toggle('is-selected', customer.id === state.selectedCustomerId);
      button.setAttribute('aria-pressed', String(customer.id === state.selectedCustomerId));
      button.append(
        text('strong', '', customer.name),
        text('span', '', `${statusLabel(customer.status)} · ${customer.deviceCount} device${customer.deviceCount === 1 ? '' : 's'}`)
      );
      button.addEventListener('click', () => void selectCustomer(customer.id));
      elements.list.appendChild(button);
    });
  }

  function renderUnassigned() {
    const devices = state.devices.filter((device) => !device.customerAccountId && device.status !== 'revoked');
    elements.unassignedList.replaceChildren();
    elements.unassignedCount.textContent = String(devices.length);
    if (!devices.length) {
      elements.unassignedList.appendChild(text('p', 'customer-status', 'Every active device is assigned.'));
      return;
    }
    devices.forEach((device) => {
      const row = document.createElement('div');
      row.className = 'customer-unassigned__item';
      const assignment = customerOptions('');
      assignment.firstElementChild.textContent = state.customers.length ? 'Assign to customer…' : 'Create a customer first';
      assignment.disabled = !state.customers.length;
      assignment.addEventListener('change', async () => {
        if (!assignment.value) return;
        assignment.disabled = true;
        setStatus(`Assigning ${device.displayName}…`);
        try {
          await withSession((session) => client.customerAccounts.assignDevice(device.id, assignment.value, session));
          state.selectedCustomerId = assignment.value;
          await loadDashboard({ preserveSelection: true });
          window.dispatchEvent(new Event('mxg:edge-devices-changed'));
          setStatus(`${device.displayName} assigned.`, 'success');
        } catch (error) {
          assignment.disabled = false;
          assignment.value = '';
          setStatus(error.message || 'Unable to assign the device.', 'error');
        }
      });
      row.append(text('strong', '', device.displayName || 'Unnamed device'), assignment);
      elements.unassignedList.appendChild(row);
    });
  }

  function fillEditForm(customer) {
    if (!elements.editForm) return;
    for (const [name, value] of Object.entries({
      name: customer.name,
      status: customer.status,
      primaryContactName: customer.primaryContactName || '',
      primaryContactEmail: customer.primaryContactEmail || '',
      billingEmail: customer.billingEmail || '',
      notes: customer.notes || ''
    })) {
      const field = elements.editForm.elements.namedItem(name);
      if (field) field.value = value;
    }
  }

  function customerOptions(selectedId) {
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Customer assignment');
    select.appendChild(new Option('Unassigned', ''));
    state.customers.forEach((customer) => select.appendChild(new Option(customer.name, customer.id)));
    select.value = selectedId || '';
    return select;
  }

  function renderDevices(devices) {
    elements.deviceList.replaceChildren();
    elements.revokedList.replaceChildren();
    const active = devices.filter((device) => device.status !== 'revoked');
    const revoked = devices.filter((device) => device.status === 'revoked');
    elements.revokedCount.textContent = String(revoked.length);
    if (!active.length) elements.deviceList.appendChild(text('p', 'customer-status', 'No active devices on this customer account.'));

    devices.forEach((device) => {
      const row = document.createElement('article');
      row.className = 'customer-device';
      const identity = document.createElement('div');
      identity.className = 'customer-device__identity';
      const statePill = text('span', 'device-state', statusLabel(device.status));
      statePill.dataset.state = device.status;
      const fingerprint = String(device.hardwareId || '');
      identity.append(
        text('strong', '', device.displayName || 'Unnamed device'),
        statePill,
        text('code', '', fingerprint ? `Device …${fingerprint.slice(-8)}` : 'Device identity unavailable'),
        text('span', '', `Last connected: ${formatDate(device.lastSeenAt)}`)
      );
      row.appendChild(identity);

      if (device.status !== 'revoked') {
        const actions = document.createElement('div');
        actions.className = 'customer-device__actions';
        const assignment = customerOptions(device.customerAccountId);
        assignment.addEventListener('change', async () => {
          assignment.disabled = true;
          setDeviceStatus(`Moving ${device.displayName}…`);
          try {
            await withSession((session) => client.customerAccounts.assignDevice(device.id, assignment.value || null, session));
            await loadDashboard({ preserveSelection: true });
            setDeviceStatus(`${device.displayName} account assignment updated.`, 'success');
          } catch (error) {
            assignment.disabled = false;
            assignment.value = device.customerAccountId || '';
            setDeviceStatus(error.message || 'Unable to update the device account.', 'error');
          }
        });
        const revoke = text('button', 'button customer-danger', 'Revoke');
        revoke.type = 'button';
        revoke.addEventListener('click', async () => {
          if (!window.confirm(`Revoke ${device.displayName}? Its saved credential will stop working immediately.`)) return;
          revoke.disabled = true;
          try {
            await withSession((session) => client.edgeDevices.revoke(device.id, session));
            await loadDashboard({ preserveSelection: true });
            setDeviceStatus(`${device.displayName} revoked.`, 'success');
          } catch (error) {
            revoke.disabled = false;
            setDeviceStatus(error.message || 'Unable to revoke the device.', 'error');
          }
        });
        actions.append(assignment, revoke);
        row.appendChild(actions);
      }
      (device.status === 'revoked' ? elements.revokedList : elements.deviceList).appendChild(row);
    });
    if (!revoked.length) elements.revokedList.appendChild(text('p', 'customer-status', 'No revoked devices.'));
  }

  function renderPayments(payments) {
    elements.paymentList.replaceChildren();
    if (!payments.length) {
      elements.paymentList.appendChild(text('p', 'customer-status', 'No payment history recorded.'));
      return;
    }
    payments.forEach((payment) => {
      const row = document.createElement('article');
      row.className = 'customer-payment';
      const detail = document.createElement('div');
      detail.append(
        text('strong', '', money(payment.amountCents, payment.currency)),
        text('small', '', `${formatDate(payment.occurredAt, 'Date unavailable')}${payment.reference ? ` · ${payment.reference}` : ''}`)
      );
      const pill = text('span', 'payment-state', statusLabel(payment.status));
      pill.dataset.state = payment.status;
      row.append(detail, pill);
      elements.paymentList.appendChild(row);
    });
  }

  function renderTelemetry(devices) {
    elements.telemetryList.replaceChildren();
    if (!devices.length) {
      elements.telemetryList.appendChild(text('p', 'customer-status', 'Device signals will appear after a Pi is approved.'));
      return;
    }
    devices.filter((device) => device.status !== 'revoked').forEach((device) => {
      const row = document.createElement('article');
      row.className = 'customer-telemetry';
      row.dataset.state = device.latestDeploymentState || device.status;
      const detail = document.createElement('div');
      detail.append(
        text('strong', '', device.displayName),
        text('small', '', `${device.assignedPackName || 'No Equipment Drive assigned'}${device.assignedVersionNumber ? ` · Version ${device.assignedVersionNumber}` : ''}`),
        text('small', '', device.latestErrorCode
          ? `${device.latestErrorCode}${device.latestDetail ? ` · ${device.latestDetail}` : ''}`
          : `Latest signal: ${statusLabel(device.latestDeploymentState || device.status)} · ${formatDate(device.latestReportedAt || device.lastSeenAt)}`)
      );
      const pill = text('span', 'device-state', statusLabel(device.latestDeploymentState || device.status));
      pill.dataset.state = device.latestDeploymentState || device.status;
      row.append(detail, pill);
      elements.telemetryList.appendChild(row);
    });
  }

  function renderOverview() {
    const overview = state.overview;
    elements.detail.hidden = false;
    elements.empty.hidden = true;
    elements.detail.querySelectorAll('[data-customer-required]').forEach((section) => {
      section.hidden = !overview;
    });
    syncCustomerScope();
    if (!overview) {
      renderDevices([]);
      renderPayments([]);
      renderTelemetry([]);
      return;
    }
    const customer = overview.customer;
    byId('customerName').textContent = customer.name;
    byId('customerState').textContent = statusLabel(customer.status);
    byId('customerState').dataset.state = customer.status;
    byId('customerContact').textContent = [customer.primaryContactName, customer.primaryContactEmail].filter(Boolean).join(' · ') || 'No primary contact recorded';
    byId('customerDeviceCount').textContent = String(customer.deviceCount);
    byId('customerActiveDeviceCount').textContent = String(customer.activeDeviceCount);
    byId('customerAttentionCount').textContent = String(customer.attentionDeviceCount);
    byId('customerPaidTotal').textContent = money(customer.totalPaidCents);
    fillEditForm(customer);
    renderDevices(overview.devices || []);
    renderPayments(overview.payments || []);
    renderTelemetry(overview.devices || []);
  }

  async function selectCustomer(customerId) {
    state.selectedCustomerId = customerId || '';
    state.overview = null;
    renderDirectory();
    renderOverview();
    window.dispatchEvent(new Event('mxg:customer-selection-changed'));
    if (!state.selectedCustomerId) return;
    setStatus('Loading customer account…');
    try {
      state.overview = await withSession((session) => client.customerAccounts.get(state.selectedCustomerId, session));
      renderOverview();
      setStatus(`${state.overview.customer.name} loaded.`, 'success');
    } catch (error) {
      setStatus(error.message || 'Unable to load this customer account.', 'error');
    }
  }

  async function loadDashboard({ preserveSelection = true } = {}) {
    elements.refresh.disabled = true;
    setStatus('Loading customer operations…');
    try {
      const [accountPayload, devicePayload] = await Promise.all([
        withSession((session) => client.customerAccounts.list(session)),
        withSession((session) => client.edgeDevices.list(session))
      ]);
      state.customers = accountPayload.customers || [];
      state.devices = devicePayload.devices || [];
      const retained = preserveSelection && state.customers.some((customer) => customer.id === state.selectedCustomerId)
        ? state.selectedCustomerId
        : state.customers[0]?.id || '';
      state.selectedCustomerId = retained;
      renderMetrics();
      renderDirectory();
      renderUnassigned();
      if (retained) await selectCustomer(retained);
      else {
        state.overview = null;
        renderOverview();
        setStatus('Add the first customer account to begin.');
      }
    } catch (error) {
      state.customers = [];
      state.devices = [];
      state.overview = null;
      renderMetrics();
      renderDirectory();
      renderUnassigned();
      renderOverview();
      setStatus(error.message || 'Unable to load customer operations.', 'error');
    } finally {
      elements.refresh.disabled = false;
    }
  }

  function formCustomer(form) {
    const data = new FormData(form);
    return {
      name: String(data.get('name') || '').trim(),
      status: String(data.get('status') || 'active'),
      primaryContactName: String(data.get('primaryContactName') || '').trim() || null,
      primaryContactEmail: String(data.get('primaryContactEmail') || '').trim() || null,
      billingEmail: String(data.get('billingEmail') || '').trim() || null,
      notes: String(data.get('notes') || '').trim() || null
    };
  }

  elements.createForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    setStatus('Creating customer account…');
    try {
      const created = await withSession((session) => client.customerAccounts.create(formCustomer(event.currentTarget), session));
      state.selectedCustomerId = created.customer.id;
      event.currentTarget.reset();
      await loadDashboard({ preserveSelection: true });
      setStatus(`${created.customer.name} created.`, 'success');
    } catch (error) {
      setStatus(error.message || 'Unable to create the customer account.', 'error');
    } finally {
      submit.disabled = false;
    }
  });

  elements.editForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.selectedCustomerId) return;
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    setStatus('Saving customer account…');
    try {
      const updated = await withSession((session) => client.customerAccounts.update(state.selectedCustomerId, formCustomer(event.currentTarget), session));
      state.overview = updated;
      await loadDashboard({ preserveSelection: true });
      event.currentTarget.closest('details')?.removeAttribute('open');
      setStatus(`${updated.customer.name} saved.`, 'success');
    } catch (error) {
      setStatus(error.message || 'Unable to save the customer account.', 'error');
    } finally {
      submit.disabled = false;
    }
  });

  elements.deviceForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.selectedCustomerId) return setDeviceStatus('Choose a customer first.', 'error');
    const displayName = elements.deviceName.value.trim();
    const code = elements.deviceCode.value.replace(/\D/g, '');
    if (!displayName || code.length !== 7) return setDeviceStatus('Enter a device name and the seven-digit code shown on the Pi.', 'error');
    elements.deviceRegister.disabled = true;
    setDeviceStatus(`Approving ${displayName}…`);
    try {
      await withSession((session) => client.edgeDevices.approveClaim({ code, displayName, customerId: state.selectedCustomerId, session }));
      elements.deviceForm.reset();
      await loadDashboard({ preserveSelection: true });
      window.dispatchEvent(new Event('mxg:edge-devices-changed'));
      setDeviceStatus(`${displayName} approved for this customer.`, 'success');
    } catch (error) {
      setDeviceStatus(error.message || 'Unable to approve the device.', 'error');
    } finally {
      elements.deviceRegister.disabled = false;
    }
  });

  elements.paymentForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.selectedCustomerId) return;
    const data = new FormData(event.currentTarget);
    const amount = Number(data.get('amount'));
    const occurredAt = String(data.get('occurredAt') || '');
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    setStatus('Recording payment history…');
    try {
      await withSession((session) => client.customerAccounts.recordPayment(state.selectedCustomerId, {
        amountCents: Math.round(amount * 100),
        currency: String(data.get('currency') || 'USD').trim().toUpperCase(),
        status: String(data.get('status') || 'paid'),
        occurredAt: new Date(`${occurredAt}T12:00:00`).toISOString(),
        reference: String(data.get('reference') || '').trim() || null,
        note: null
      }, session));
      event.currentTarget.reset();
      event.currentTarget.elements.currency.value = 'USD';
      event.currentTarget.elements.occurredAt.valueAsDate = new Date();
      await loadDashboard({ preserveSelection: true });
      setStatus('Payment history recorded.', 'success');
    } catch (error) {
      setStatus(error.message || 'Unable to record the payment.', 'error');
    } finally {
      submit.disabled = false;
    }
  });

  elements.refresh?.addEventListener('click', () => void loadDashboard({ preserveSelection: true }));
  elements.deviceRefresh?.addEventListener('click', () => void loadDashboard({ preserveSelection: true }));
  if (elements.paymentForm?.elements?.occurredAt) elements.paymentForm.elements.occurredAt.valueAsDate = new Date();

  window.MXCustomerOperations = Object.freeze({
    load: loadDashboard,
    selectedCustomerId: () => state.selectedCustomerId,
    withSession
  });

  window.MXEquipmentPacks?.init?.({
    withSession,
    getDeviceFilter: () => state.selectedCustomerId || '__no_customer_selected__'
  });
})();
