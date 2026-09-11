const $ = (id) => document.getElementById(id);
const formatBytes = (value = 0) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let amount = Number(value) || 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
};

const performanceCanvas = $('performanceCanvas');
const performanceContext = performanceCanvas.getContext('2d');
const holdSplash = new URLSearchParams(location.search).get('splash') === 'hold';
let firstSnapshotReceived = false;
const recentScans = [];
const connectedNodes = new Map();
const LOG_STORAGE_KEY = 'mxg.edge.commissioning-log.v1';
const MAX_LOG_ENTRIES = 400;
let logFilter = 'all';
let logSequence = 0;
let lastSnapshotSignature = '';
let lastPeripheralSignature = '';
let lastThermalMilestone = 0;
let integrationFixtures = [];
let eventLog = [];
let controlToken = '';
let equipmentPackStatus = null;
let performanceHistory = [];
let performanceIntervalSeconds = 5;

try {
  const stored = JSON.parse(localStorage.getItem(LOG_STORAGE_KEY) || '[]');
  if (Array.isArray(stored)) eventLog = stored.slice(-MAX_LOG_ENTRIES);
} catch {
  eventLog = [];
}

function safeDetail(detail) {
  if (!detail || typeof detail !== 'object') return {};
  return Object.fromEntries(Object.entries(detail).slice(0, 8).map(([key, value]) => [key, String(value).slice(0, 180)]));
}

function persistLog() {
  try { localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(eventLog.slice(-MAX_LOG_ENTRIES))); } catch { /* storage is optional */ }
}

function renderLog() {
  const stream = $('logStream');
  if (!stream) return;
  stream.replaceChildren();
  const visible = eventLog.filter((entry) => logFilter === 'all' || entry.level === logFilter);
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'log-empty';
    empty.textContent = logFilter === 'all' ? 'Waiting for commissioning events' : `No ${logFilter} events`;
    stream.append(empty);
  }
  for (const entry of visible) {
    const row = document.createElement('div');
    row.className = 'log-row';
    row.dataset.level = entry.level;
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date(entry.at).toISOString().slice(11, 23);
    const level = document.createElement('span');
    level.className = 'log-level';
    level.textContent = entry.level.toUpperCase();
    const source = document.createElement('span');
    source.className = 'log-source';
    source.textContent = entry.source;
    const message = document.createElement('span');
    message.className = 'log-message';
    message.textContent = entry.message;
    const details = Object.entries(entry.detail || {});
    if (details.length) {
      const detail = document.createElement('small');
      detail.className = 'log-detail';
      detail.textContent = details.map(([key, value]) => `${key}=${value}`).join(' · ');
      message.append(detail);
    }
    row.append(time, level, source, message);
    stream.append(row);
  }
  $('logCount').textContent = eventLog.length;
  $('logTotal').textContent = eventLog.length;
  $('logWarnings').textContent = eventLog.filter((entry) => entry.level === 'warning').length;
  $('logErrors').textContent = eventLog.filter((entry) => entry.level === 'error').length;
  if ($('autoFollow').checked) stream.scrollTop = stream.scrollHeight;
}

function logEvent(level, source, message, detail = {}) {
  eventLog.push({ id: `${Date.now()}-${logSequence += 1}`, at: Date.now(), level, source, message, detail: safeDetail(detail) });
  eventLog.splice(0, Math.max(0, eventLog.length - MAX_LOG_ENTRIES));
  persistLog();
  renderLog();
}

function setView(view) {
  const showLogs = view === 'logs';
  const showConnections = view === 'connections';
  $('overviewView').hidden = showLogs || showConnections;
  $('connectionsView').hidden = !showConnections;
  $('logView').hidden = !showLogs;
  document.querySelectorAll('.view-tab').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  if (showLogs) renderLog();
  if (showConnections) {
    loadEquipmentPackStatus();
    loadUsbGadgetStatus();
  }
  if (!showLogs && !showConnections) requestAnimationFrame(drawPerformanceGraph);
}

function setBootStage(stage, title, detail) {
  const stages = ['bootSurface', 'bootBridge', 'bootDiagnostics', 'bootReady'];
  const activeIndex = stages.indexOf(stage);
  $('bootSplash').style.setProperty('--boot-progress', String((activeIndex + 1) / stages.length));
  stages.forEach((id, index) => {
    const item = $(id);
    item.classList.toggle('complete', index < activeIndex);
    item.classList.toggle('active', index === activeIndex);
  });
  $('bootTitle').textContent = title;
  $('bootDetail').textContent = detail;
}

function finishBoot() {
  setBootStage('bootReady', 'Edge node ready', 'Local diagnostics are live');
  if (!holdSplash) window.setTimeout(() => $('bootSplash').classList.add('complete'), 650);
}

function formatUptime(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function normalizePerformanceSample(sample) {
  const uptimeSeconds = Number(sample?.uptimeSeconds);
  if (!Number.isFinite(uptimeSeconds)) return null;
  const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    uptimeSeconds,
    timestampMs: numberOrNull(sample.timestampMs),
    cpuPercent: numberOrNull(sample.cpuPercent),
    memoryPercent: numberOrNull(sample.memoryPercent),
    temperatureC: numberOrNull(sample.temperatureC),
  };
}

function mergePerformanceHistory(samples) {
  const merged = new Map(performanceHistory.map((sample) => [sample.uptimeSeconds.toFixed(1), sample]));
  for (const raw of samples || []) {
    const sample = normalizePerformanceSample(raw);
    if (sample) merged.set(sample.uptimeSeconds.toFixed(1), sample);
  }
  performanceHistory = [...merged.values()].sort((left, right) => left.uptimeSeconds - right.uptimeSeconds);
  while (performanceHistory.length > 720) {
    performanceHistory = performanceHistory.filter((_, index) => index % 2 === 0 || index === performanceHistory.length - 1);
    performanceIntervalSeconds *= 2;
  }
  drawPerformanceGraph();
}

function recordPerformance(snapshot) {
  mergePerformanceHistory([{
    timestampMs: snapshot.timestampMs,
    uptimeSeconds: snapshot.host?.uptimeSeconds,
    cpuPercent: snapshot.cpu?.usedPercent,
    memoryPercent: snapshot.memory?.usedPercent,
    temperatureC: snapshot.cpu?.temperatureC,
  }]);
}

function drawPerformanceGraph() {
  const bounds = performanceCanvas.getBoundingClientRect();
  if (bounds.width < 20 || bounds.height < 20) return;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  if (performanceCanvas.width !== Math.round(width * ratio) || performanceCanvas.height !== Math.round(height * ratio)) {
    performanceCanvas.width = Math.round(width * ratio);
    performanceCanvas.height = Math.round(height * ratio);
  }
  performanceContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  performanceContext.clearRect(0, 0, width, height);
  const plot = { left: 44, right: width - 46, top: 18, bottom: height - 31 };
  const plotWidth = Math.max(1, plot.right - plot.left);
  const plotHeight = Math.max(1, plot.bottom - plot.top);

  performanceContext.font = '9px ui-monospace, monospace';
  performanceContext.lineWidth = 1;
  performanceContext.textBaseline = 'middle';
  for (let value = 0; value <= 100; value += 25) {
    const y = plot.bottom - (value / 100) * plotHeight;
    performanceContext.strokeStyle = 'rgba(105, 171, 190, .12)';
    performanceContext.beginPath();
    performanceContext.moveTo(plot.left, y);
    performanceContext.lineTo(plot.right, y);
    performanceContext.stroke();
    performanceContext.fillStyle = '#668596';
    performanceContext.textAlign = 'right';
    performanceContext.fillText(`${value}%`, plot.left - 7, y);
    const temperature = Math.round(20 + (value / 100) * 70);
    performanceContext.textAlign = 'left';
    performanceContext.fillText(`${temperature}°`, plot.right + 7, y);
  }

  if (!performanceHistory.length) {
    performanceContext.fillStyle = '#668596';
    performanceContext.textAlign = 'center';
    performanceContext.font = '700 11px ui-monospace, monospace';
    performanceContext.fillText('WAITING FOR PERFORMANCE SAMPLES', width / 2, height / 2);
    return;
  }

  const firstUptime = performanceHistory[0].uptimeSeconds;
  const lastUptime = performanceHistory[performanceHistory.length - 1].uptimeSeconds;
  const uptimeSpan = Math.max(1, lastUptime - firstUptime);
  const xFor = (sample) => plot.left + ((sample.uptimeSeconds - firstUptime) / uptimeSpan) * plotWidth;
  const series = [
    { key: 'cpuPercent', color: '#41d7e7', y: (value) => plot.bottom - Math.max(0, Math.min(100, value)) / 100 * plotHeight },
    { key: 'memoryPercent', color: '#4ade80', y: (value) => plot.bottom - Math.max(0, Math.min(100, value)) / 100 * plotHeight },
    { key: 'temperatureC', color: '#f5b942', y: (value) => plot.bottom - Math.max(0, Math.min(1, (value - 20) / 70)) * plotHeight },
  ];
  for (const line of series) {
    performanceContext.beginPath();
    let started = false;
    for (const sample of performanceHistory) {
      const value = sample[line.key];
      if (value == null) continue;
      const x = xFor(sample);
      const y = line.y(value);
      if (!started) performanceContext.moveTo(x, y);
      else performanceContext.lineTo(x, y);
      started = true;
    }
    performanceContext.strokeStyle = line.color;
    performanceContext.lineWidth = 2;
    performanceContext.lineJoin = 'round';
    performanceContext.lineCap = 'round';
    performanceContext.stroke();
  }

  performanceContext.fillStyle = '#668596';
  performanceContext.font = '9px ui-monospace, monospace';
  performanceContext.textBaseline = 'bottom';
  performanceContext.textAlign = 'left';
  performanceContext.fillText(formatUptime(firstUptime), plot.left, height - 7);
  performanceContext.textAlign = 'right';
  performanceContext.fillText(formatUptime(lastUptime), plot.right, height - 7);
  $('performanceWindow').textContent = `${formatUptime(firstUptime)} → ${formatUptime(lastUptime)} device uptime · ${performanceHistory.length} samples`;
  $('performanceResolution').textContent = `Current history resolution: ${Math.round(performanceIntervalSeconds)}s · older samples compress automatically to preserve the full window.`;
}

function rows(target, items, empty) {
  target.replaceChildren();
  if (!items.length) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span>${empty}</span><small>—</small>`;
    target.append(row);
    return;
  }
  for (const item of items.slice(0, 7)) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.textContent = item.label;
    const value = document.createElement(item.state ? 'b' : 'small');
    value.textContent = item.value;
    if (item.state === 'closed') value.className = 'closed';
    row.append(label, value);
    target.append(row);
  }
}

function setPeripheral(id, state, status, detail) {
  const card = $(`peripheral${id}`);
  card.dataset.state = state;
  $(`${id.toLowerCase()}Status`).textContent = status;
  $(`${id.toLowerCase()}Detail`).textContent = detail;
}

function updatePeripherals(snapshot) {
  const usb = snapshot.usb || [];
  const products = usb.map((item) => `${item.manufacturer || ''} ${item.product || ''}`.toLowerCase());
  const findProduct = (pattern) => usb.find((item, index) => pattern.test(products[index]));
  const honeywell = findProduct(/honeywell|xenon|1950g/);
  const zebra = findProduct(/zebra|ds3608/);
  const bluetooth = snapshot.bridge?.bluetooth || {};
  const thermalNodes = [...connectedNodes.values()].filter((node) => (node.capabilities || []).some((capability) => String(capability).startsWith('thermal-')));
  const simulated = thermalNodes.some((node) => /synthetic|simulator/i.test(`${node.nodeId} ${node.nodeName}`)) || new URLSearchParams(location.search).has('preview');

  if ((snapshot.bridge?.thermalFrames || 0) > 0) {
    setPeripheral('Flir', simulated ? 'simulated' : 'live', simulated ? 'SIMULATED FEED' : 'STREAM ACTIVE', simulated ? 'MXGS/1 relay shape verified; no FLIR hardware claim' : 'Thermal source is delivering MXGS/1 frames');
  } else {
    setPeripheral('Flir', 'standby', 'COMPANION GATE', 'Licensed SDK and headset enumeration pending');
  }
  setPeripheral('Honeywell', honeywell ? 'live' : 'standby', honeywell ? 'DETECTED' : 'WAITING', honeywell ? `${honeywell.manufacturer || 'USB'} ${honeywell.product || 'scanner'}` : 'No matching USB device detected');
  setPeripheral('Zebra', zebra ? 'live' : 'standby', zebra ? 'DETECTED' : 'WAITING', zebra ? `${zebra.manufacturer || 'USB'} ${zebra.product || 'scanner'}` : 'No matching USB device detected');
  if (bluetooth.state === 'connected') {
    setPeripheral('Socket', 'live', 'CONNECTED', bluetooth.peer || 'Bluetooth SPP peer connected');
  } else if (bluetooth.state === 'listening') {
    setPeripheral('Socket', 'ready', 'LISTENING', `RFCOMM channel ${bluetooth.channel || 8} ready`);
  } else {
    setPeripheral('Socket', bluetooth.state === 'error' ? 'blocked' : 'standby', String(bluetooth.state || 'disabled').toUpperCase(), bluetooth.detail || 'Bluetooth bridge is not enabled');
  }

  const signature = JSON.stringify({
    usb: usb.map((item) => [item.vendorId, item.productId, item.product]),
    serial: snapshot.serialPorts || [],
    bluetooth: bluetooth.state,
    thermal: snapshot.bridge?.thermalFrames > 0,
  });
  if (lastPeripheralSignature && lastPeripheralSignature !== signature) {
    logEvent('info', 'peripheral', 'Peripheral topology changed', { usb: usb.length, serial: (snapshot.serialPorts || []).length, bluetooth: bluetooth.state || 'disabled' });
  }
  lastPeripheralSignature = signature;
}

function renderIntegrationFixtures(payload) {
  integrationFixtures = payload.integrations || [];
  const grid = $('integrationGrid');
  grid.replaceChildren();
  for (const fixture of integrationFixtures) {
    const card = document.createElement('article');
    card.className = 'integration-card';
    const state = document.createElement('span');
    state.textContent = `${String(fixture.mode).toUpperCase()} · ${String(fixture.auth).toUpperCase()}`;
    const title = document.createElement('b');
    title.textContent = fixture.label;
    const description = document.createElement('p');
    description.textContent = fixture.description;
    const contract = document.createElement('small');
    contract.textContent = fixture.contract;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Preview shape';
    button.addEventListener('click', () => {
      $('shapeTitle').textContent = fixture.label;
      $('shapeState').textContent = `${String(fixture.mode).toUpperCase()} · NOT LIVE`;
      $('shapePreview').textContent = JSON.stringify(fixture.sample, null, 2);
      logEvent('info', 'fixture', 'Normalized API shape previewed', { provider: fixture.provider, contract: fixture.contract });
    });
    card.append(state, title, description, contract, button);
    grid.append(card);
  }
}

async function loadIntegrationFixtures() {
  try {
    const response = await fetch('/api/v1/integrations/simulated', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderIntegrationFixtures(await response.json());
    logEvent('info', 'fixture', 'Normalized API fixtures loaded', { count: integrationFixtures.length });
  } catch (error) {
    $('integrationGrid').innerHTML = '<article class="integration-card"><b>Fixture registry unavailable</b><p>The local adapter-shape endpoint did not respond.</p></article>';
    logEvent('error', 'fixture', 'Could not load normalized API fixtures', { error: error.message });
  }
}

function setControlNotice(message, state = '') {
  $('controlNotice').textContent = message;
  $('controlNotice').dataset.state = state;
}

async function initializeControls() {
  try {
    const response = await fetch('/api/v1/control/session', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    controlToken = (await response.json()).token;
    setControlNotice('Local appliance controls ready', 'success');
  } catch (error) {
    setControlNotice('Controls are available only on the installed Raspberry Pi', 'error');
    logEvent('warning', 'control', 'Local appliance control session unavailable', { error: error.message });
  }
}

async function controlRequest(path, payload = {}, timeoutMs = 50000) {
  if (!controlToken) await initializeControls();
  if (!controlToken) throw new Error('Local control service is unavailable');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-MXG-Control-Token': controlToken },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('The local control request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function renderEquipmentPack(status) {
  equipmentPackStatus = status;
  const phase = String(status.phase || (status.enabled ? 'checking' : 'disabled'));
  $('packPhase').textContent = phase.toUpperCase();
  $('packPhase').dataset.state = phase;
  $('packDetail').textContent = status.detail || 'No Equipment Pack status is available.';
  $('packNode').textContent = status.displayName || (status.enrolled ? status.deviceId : 'Not enrolled');
  $('packHardwareId').value = status.hardwareId || '';
  $('packHardwareIdState').textContent = status.hardwareId ? 'baked into drive' : 'not found';
  $('packAssigned').textContent = status.pendingGeneration
    ? `Generation ${status.pendingGeneration} · slot ${status.pendingSlot || '—'}`
    : 'No pending pack';
  $('packActive').textContent = status.activeGeneration
    ? `Generation ${status.activeGeneration} · slot ${status.activeSlot || '—'}`
    : 'None';
  $('packRetry').disabled = !status.enabled || !status.enrolled;
  $('packEnrollForm').querySelector('button').disabled = !status.enabled;
}

async function loadEquipmentPackStatus() {
  try {
    const response = await fetch('/api/v1/equipment-pack/status', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderEquipmentPack(await response.json());
  } catch (error) {
    renderEquipmentPack({ enabled: false, enrolled: false, phase: 'failed', detail: 'Local Equipment Pack status is unavailable.' });
    logEvent('warning', 'equipment-pack', 'Equipment Pack status unavailable', { error: error.message });
  }
}

async function loadUsbGadgetStatus() {
  try {
    const status = await controlRequest('/api/v1/control/usb-gadget/status');
    $('packUsb').textContent = status.activationReady ? 'Ready' : status.supported ? 'Needs tools' : 'Not detected';
    $('packUsb').title = (status.udcs || []).join(', ') || 'No USB device controller detected';
  } catch {
    $('packUsb').textContent = 'Unavailable';
  }
}

function renderWifiNetworks(networks) {
  const target = $('wifiNetworks');
  target.replaceChildren();
  if (!networks.length) {
    target.innerHTML = '<p class="device-empty">No broadcast Wi-Fi networks found. You can enter a hidden network below.</p>';
    return;
  }
  for (const network of networks) {
    const row = document.createElement('button');
    row.className = 'device-row network-choice';
    row.type = 'button';
    row.dataset.active = String(Boolean(network.active));
    const identity = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = network.ssid;
    const detail = document.createElement('small');
    detail.textContent = `${network.security || 'Open'} · ${network.signal || 0}% signal${network.active ? ' · CONNECTED' : ''}`;
    identity.append(name, detail);
    const action = document.createElement('span');
    action.className = 'device-action';
    action.textContent = network.active ? 'Active' : 'Select';
    row.append(identity, action);
    row.addEventListener('click', () => {
      $('wifiSsid').value = network.ssid;
      $('wifiPassword').focus();
    });
    target.append(row);
  }
}

function bluetoothButton(device, operation, label, danger = false) {
  const button = document.createElement('button');
  button.className = `device-action${danger ? ' danger' : ''}`;
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', async () => {
    button.disabled = true;
    setControlNotice(`${label} ${device.name}…`);
    try {
      await controlRequest('/api/v1/control/bluetooth/action', { address: device.address, operation });
      setControlNotice(`${device.name}: ${operation} complete`, 'success');
      logEvent('info', 'bluetooth', `Bluetooth ${operation} completed`, { address: device.address, name: device.name });
      await scanBluetooth();
    } catch (error) {
      setControlNotice(error.message, 'error');
      logEvent('error', 'bluetooth', `Bluetooth ${operation} failed`, { address: device.address, error: error.message });
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function renderBluetoothDevices(devices) {
  const target = $('bluetoothDevices');
  target.replaceChildren();
  if (!devices.length) {
    target.innerHTML = '<p class="device-empty">No Bluetooth devices found. Put the peripheral in pairing mode and scan again.</p>';
    return;
  }
  for (const device of devices) {
    const row = document.createElement('div');
    row.className = 'device-row';
    row.dataset.active = String(Boolean(device.connected));
    const identity = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = device.name;
    const detail = document.createElement('small');
    detail.textContent = `${device.address} · ${device.connected ? 'CONNECTED' : device.paired ? 'PAIRED' : 'AVAILABLE'}`;
    identity.append(name, detail);
    const actions = document.createElement('span');
    actions.className = 'device-actions';
    if (device.connected) actions.append(bluetoothButton(device, 'disconnect', 'Disconnect'));
    else if (device.paired) actions.append(bluetoothButton(device, 'connect', 'Connect'));
    else actions.append(bluetoothButton(device, 'pair', 'Pair'));
    if (device.paired) actions.append(bluetoothButton(device, 'forget', 'Forget', true));
    row.append(identity, actions);
    target.append(row);
  }
}

async function scanWifi() {
  const button = $('wifiScan');
  button.disabled = true;
  setControlNotice('Scanning for nearby Wi-Fi networks…');
  try {
    const result = await controlRequest('/api/v1/control/wifi/scan');
    renderWifiNetworks(result.networks || []);
    setControlNotice(`${(result.networks || []).length} Wi-Fi network(s) found`, 'success');
    logEvent('info', 'wifi', 'Wi-Fi scan completed', { networks: (result.networks || []).length });
  } catch (error) {
    setControlNotice(error.message, 'error');
    logEvent('error', 'wifi', 'Wi-Fi scan failed', { error: error.message });
  } finally {
    button.disabled = false;
  }
}

async function scanBluetooth() {
  const button = $('bluetoothScan');
  button.disabled = true;
  setControlNotice('Scanning for Bluetooth devices…');
  try {
    const result = await controlRequest('/api/v1/control/bluetooth/scan');
    renderBluetoothDevices(result.devices || []);
    setControlNotice(`${(result.devices || []).length} Bluetooth device(s) found`, 'success');
    logEvent('info', 'bluetooth', 'Bluetooth scan completed', { devices: (result.devices || []).length });
  } catch (error) {
    setControlNotice(error.message, 'error');
    logEvent('error', 'bluetooth', 'Bluetooth scan failed', { error: error.message });
  } finally {
    button.disabled = false;
  }
}

function update(snapshot) {
  const bridge = snapshot.bridge || {};
  $('systemPosture').textContent = String(snapshot.status || 'unknown').toUpperCase();
  $('systemPosture').style.color = snapshot.status === 'nominal' ? 'var(--green)' : snapshot.status === 'warning' ? 'var(--amber)' : 'var(--red)';
  $('hostLine').textContent = `${snapshot.host?.name || 'Raspberry Pi'} · ${snapshot.host?.machine || 'arm64'} · uptime ${Math.floor((snapshot.host?.uptimeSeconds || 0) / 3600)}h`;
  $('clientCount').textContent = bridge.consumers ?? 0;
  $('sourceCount').textContent = bridge.sources ?? 0;
  $('frameCount').textContent = bridge.thermalFrames ?? 0;
  $('bluetoothState').textContent = String(bridge.bluetooth?.state || 'off').toUpperCase();

  const metrics = [
    ['cpu', snapshot.cpu?.usedPercent || 0, `${snapshot.cpu?.logicalCores || 0} logical cores`],
    ['memory', snapshot.memory?.usedPercent || 0, `${formatBytes(snapshot.memory?.usedBytes)} / ${formatBytes(snapshot.memory?.totalBytes)}`],
    ['storage', snapshot.storage?.usedPercent || 0, `${formatBytes(snapshot.storage?.usedBytes)} / ${formatBytes(snapshot.storage?.totalBytes)}`],
  ];
  for (const [name, value, detail] of metrics) {
    $(`${name}Value`).textContent = `${Number(value).toFixed(1)}%`;
    $(`${name}Meter`).value = value;
    $(`${name}Detail`).textContent = detail;
  }
  const temperature = snapshot.cpu?.temperatureC;
  $('temperatureValue').textContent = temperature == null ? 'N/A' : `${temperature.toFixed(1)}°C`;
  const thermalMetric = $('thermalMetric');
  const temperatureGauge = $('temperatureGauge');
  const temperatureState = temperature == null ? 'unknown' : temperature >= 80 ? 'critical' : temperature >= 70 ? 'warm' : temperature >= 55 ? 'nominal' : 'cool';
  const temperatureLabel = temperature == null ? 'Sensor unavailable' : temperature >= 80 ? 'Critical · throttling risk' : temperature >= 70 ? 'Hot · watch cooling' : temperature >= 55 ? 'Normal operating range' : 'Running cool';
  thermalMetric.dataset.state = temperatureState;
  thermalMetric.style.setProperty('--temperature-level', `${temperature == null ? 0 : Math.max(0, Math.min(100, ((temperature - 20) / 70) * 100))}%`);
  $('temperatureState').textContent = temperatureLabel;
  temperatureGauge.setAttribute('aria-valuenow', temperature == null ? '' : String(temperature));
  temperatureGauge.setAttribute('aria-valuetext', temperature == null ? temperatureLabel : `${temperature.toFixed(1)} degrees Celsius, ${temperatureLabel}`);
  recordPerformance(snapshot);

  const probes = snapshot.portProbes || [];
  $('portSummary').textContent = probes.length ? `${probes.filter((item) => item.status === 'open').length}/${probes.length} OPEN` : 'NO PROBES';
  rows($('ports'), probes.map((item) => ({ label: item.label, value: item.status === 'open' ? `${item.latencyMs} ms` : 'CLOSED', state: item.status })), 'Configure ports in the service environment');
  const usb = snapshot.usb || [];
  $('usbSummary').textContent = `${usb.length} USB · ${(snapshot.serialPorts || []).length} SERIAL`;
  rows($('hardware'), usb.map((item) => ({ label: item.product || `${item.vendorId}:${item.productId}`, value: `${item.vendorId}:${item.productId}` })), 'No external USB hardware detected');
  rows($('network'), (snapshot.network || []).map((item) => ({ label: item.name, value: `${item.state.toUpperCase()} · ↓${formatBytes(item.rxBytes)} ↑${formatBytes(item.txBytes)}` })), 'No active network interfaces');
  updatePeripherals(snapshot);

  const snapshotSignature = JSON.stringify({ status: snapshot.status, host: snapshot.host?.name, probes: (snapshot.portProbes || []).map((item) => [item.label, item.status]) });
  if (!lastSnapshotSignature) {
    logEvent('info', 'diagnostics', 'First diagnostics snapshot received', { posture: snapshot.status || 'unknown', host: snapshot.host?.name || 'Raspberry Pi' });
  } else if (lastSnapshotSignature !== snapshotSignature) {
    logEvent(snapshot.status === 'nominal' ? 'info' : 'warning', 'diagnostics', 'Diagnostics posture or probe state changed', { posture: snapshot.status || 'unknown' });
  }
  lastSnapshotSignature = snapshotSignature;

  const frameMilestone = Math.floor((bridge.thermalFrames || 0) / 250) * 250;
  if (frameMilestone > 0 && frameMilestone > lastThermalMilestone) {
    lastThermalMilestone = frameMilestone;
    logEvent('info', 'thermal', 'Thermal relay cadence confirmed', { frames: frameMilestone, source: new URLSearchParams(location.search).has('preview') ? 'simulated' : 'connected' });
  }

  if (!firstSnapshotReceived) {
    firstSnapshotReceived = true;
    finishBoot();
  }
}

function updateScan(event) {
  recentScans.unshift(event);
  recentScans.splice(7);
  $('scanSummary').textContent = `${recentScans.length} OBSERVED`;
  rows($('scans'), recentScans.map((scan) => ({
    label: scan.normalized?.partNumber || scan.normalized?.serialNumber || scan.normalized?.identifierCandidate || scan.rawValue,
    value: `${String(scan.device?.transport || 'unknown').toUpperCase()} · UNVERIFIED`,
  })), 'No scanner observations');
  logEvent('info', 'scanner', 'Unverified scanner observation received', {
    profile: event.device?.profile || 'generic-line-scanner',
    transport: event.device?.transport || 'unknown',
    sequence: event.sequence || recentScans.length,
  });
}

function connect() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  logEvent('info', 'bridge', 'Opening local realtime channel', { transport: scheme.toUpperCase(), endpoint: '/ws/xr' });
  const socket = new WebSocket(`${scheme}://${location.host}/ws/xr`);
  socket.binaryType = 'arraybuffer';
  socket.addEventListener('open', () => {
    setBootStage('bootDiagnostics', 'Scanning diagnostics', 'Sampling hardware, ports, and network state');
    $('bridgeState').textContent = 'Bridge online';
    $('stateLamp').parentElement.className = 'bridge-state live';
    logEvent('info', 'bridge', 'Realtime channel connected', { protocol: 'MXGS/1' });
    socket.send(JSON.stringify({
      type: 'node.announce',
      nodeId: 'mxg-pi-kiosk',
      nodeType: 'edge-kiosk',
      nodeName: 'MXG Raspberry Pi Diagnostics',
      capabilities: ['local-diagnostics', 'sensor-relay', 'thermal-preview', 'scan-observed-1']
    }));
  });
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      let message;
      try { message = JSON.parse(event.data); } catch (error) {
        logEvent('error', 'bridge', 'Invalid JSON event received', { error: error.message });
        return;
      }
      if (message.type === 'diagnostics.snapshot') update(message);
      if (message.type === 'diagnostics.performance-history') {
        performanceIntervalSeconds = Math.max(1, Number(message.sampleIntervalSeconds) || 5);
        mergePerformanceHistory(message.samples);
      }
      if (message.type === 'scan.observed') updateScan(message);
      if (message.type === 'bridge.hello') logEvent('info', 'bridge', 'Bridge handshake accepted', { version: message.version, role: message.role });
      if (message.type === 'bridge.error') logEvent('error', 'bridge', message.detail || 'Bridge rejected a request', { code: message.code || 'UNKNOWN' });
      if (message.type === 'source.status') logEvent(message.status === 'error' ? 'error' : message.status === 'disconnected' ? 'warning' : 'info', 'source', `Sensor source ${message.status}`, { source: message.sourceId || 'unknown' });
      if (message.type === 'node.status' && message.node) {
        if (message.status === 'connected') connectedNodes.set(message.node.nodeId, message.node);
        else connectedNodes.delete(message.node.nodeId);
        logEvent(message.status === 'disconnected' ? 'warning' : 'info', 'node', `${message.node.nodeName || message.node.nodeId} ${message.status}`, { type: message.node.nodeType || 'unknown' });
      }
      return;
    }
    // Thermal frames remain available to XR clients; the local kiosk no longer renders a decorative preview.
  });
  socket.addEventListener('error', () => logEvent('error', 'bridge', 'Realtime channel reported a transport error'));
  socket.addEventListener('close', () => {
    if (!firstSnapshotReceived) {
      setBootStage('bootBridge', 'Waiting for bridge', 'Reconnecting to the local diagnostics service');
    }
    $('bridgeState').textContent = 'Bridge reconnecting';
    $('stateLamp').parentElement.className = 'bridge-state failed';
    logEvent('warning', 'bridge', 'Realtime channel closed; retry scheduled', { delayMs: 1500 });
    setTimeout(connect, 1500);
  });
}

document.querySelectorAll('.view-tab').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$('wifiScan').addEventListener('click', scanWifi);
$('bluetoothScan').addEventListener('click', scanBluetooth);
$('packRetry').addEventListener('click', async () => {
  $('packRetry').disabled = true;
  try {
    const status = await controlRequest('/api/v1/equipment-pack/reconcile');
    renderEquipmentPack(status);
    logEvent('info', 'equipment-pack', 'Equipment Pack assignment checked', { phase: status.phase });
  } catch (error) {
    setControlNotice(error.message, 'error');
    logEvent('error', 'equipment-pack', 'Equipment Pack check failed', { error: error.message });
  } finally {
    if (equipmentPackStatus?.enabled && equipmentPackStatus?.enrolled) $('packRetry').disabled = false;
  }
});
$('packEnrollForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  setControlNotice('Enrolling this node…');
  try {
    const status = await controlRequest('/api/v1/equipment-pack/enroll', {
      code: $('packEnrollCode').value,
      hardwareId: equipmentPackStatus?.hardwareId || null,
    }, 30000);
    $('packEnrollCode').value = '';
    renderEquipmentPack(status);
    setControlNotice(`${status.displayName || 'Node'} enrolled`, 'success');
    logEvent('info', 'equipment-pack', 'Equipment Pack node enrolled', { deviceId: status.deviceId });
  } catch (error) {
    $('packEnrollCode').value = '';
    setControlNotice(error.message, 'error');
    logEvent('error', 'equipment-pack', 'Equipment Pack enrollment failed', { error: error.message });
  } finally {
    button.disabled = equipmentPackStatus?.enabled === false;
  }
});
$('wifiForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  setControlNotice(`Connecting to ${$('wifiSsid').value}…`);
  try {
    const result = await controlRequest('/api/v1/control/wifi/connect', {
      ssid: $('wifiSsid').value,
      password: $('wifiPassword').value,
      hidden: $('wifiHidden').checked,
    });
    $('wifiPassword').value = '';
    setControlNotice(`${result.ssid} connected`, 'success');
    logEvent('info', 'wifi', 'Wi-Fi connection activated', { ssid: result.ssid });
    window.setTimeout(scanWifi, 1200);
  } catch (error) {
    $('wifiPassword').value = '';
    setControlNotice(error.message, 'error');
    logEvent('error', 'wifi', 'Wi-Fi connection failed', { ssid: $('wifiSsid').value, error: error.message });
  } finally {
    button.disabled = false;
  }
});
$('powerButton').addEventListener('click', () => $('powerDialog').showModal());
$('confirmPoweroff').addEventListener('click', async (event) => {
  event.preventDefault();
  $('confirmPoweroff').disabled = true;
  setControlNotice('Safe shutdown requested…');
  try {
    await controlRequest('/api/v1/control/poweroff');
    $('powerDialog').close();
    setControlNotice('Powering off. Wait for the activity light to stop before disconnecting power.', 'success');
    logEvent('warning', 'power', 'Safe shutdown requested from local kiosk');
  } catch (error) {
    setControlNotice(error.message, 'error');
    logEvent('error', 'power', 'Safe shutdown request failed', { error: error.message });
  } finally {
    $('confirmPoweroff').disabled = false;
  }
});
document.querySelectorAll('.log-filter').forEach((button) => button.addEventListener('click', () => {
  logFilter = button.dataset.level;
  document.querySelectorAll('.log-filter').forEach((candidate) => candidate.classList.toggle('active', candidate === button));
  renderLog();
}));
$('autoFollow').addEventListener('change', renderLog);
$('clearLogs').addEventListener('click', () => {
  eventLog = [];
  persistLog();
  renderLog();
});
$('exportLogs').addEventListener('click', () => {
  logEvent('info', 'ui', 'Commissioning log exported', { entries: eventLog.length });
  const contents = eventLog.map((entry) => JSON.stringify(entry)).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([contents], { type: 'application/x-ndjson' }));
  link.download = `mxgenius-commissioning-${new Date().toISOString().replaceAll(':', '-')}.jsonl`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
window.addEventListener('error', (event) => logEvent('error', 'browser', 'Unhandled browser error', { message: event.message || 'unknown' }));
window.addEventListener('unhandledrejection', (event) => logEvent('error', 'browser', 'Unhandled asynchronous error', { reason: String(event.reason || 'unknown') }));
window.addEventListener('resize', drawPerformanceGraph);

setView('overview');
renderLog();
logEvent('info', 'ui', 'Kiosk surface initialized', { mode: new URLSearchParams(location.search).has('preview') ? 'release-preview' : 'device' });
loadIntegrationFixtures();
loadEquipmentPackStatus();
setBootStage('bootBridge', 'Starting diagnostics bridge', 'Opening the local realtime channel');
setInterval(loadEquipmentPackStatus, 15000);
connect();
