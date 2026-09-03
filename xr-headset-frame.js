const FRAME_PURPOSES = new Set(['scan', 'evidence']);

export const FRAME_TIMEOUT_POLICY = Object.freeze({
  defaultMs: 10_000,
  minimumMs: 2_000,
  maximumMs: 20_000
});

export const MAX_HEADSET_JPEG_DATA_URL_CHARS = 1_398_200;

export class HeadsetFrameError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HeadsetFrameError';
    this.code = code;
  }
}

function clean(value, fallback = '', limit = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, limit);
}

function boundedTimeout(value, policy) {
  const proposed = Number(value);
  const timeout = Number.isFinite(proposed) && proposed > 0 ? proposed : policy.defaultMs;
  return Math.round(Math.min(policy.maximumMs, Math.max(policy.minimumMs, timeout)));
}

function randomId(prefix) {
  const token = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  return `${prefix}-${token}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80);
}

function validJpegDataUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_HEADSET_JPEG_DATA_URL_CHARS) return false;
  const match = value.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match || match[1].length % 4 !== 0) return false;
  try {
    const firstBytes = globalThis.atob(match[1].slice(0, 8));
    return firstBytes.charCodeAt(0) === 0xff && firstBytes.charCodeAt(1) === 0xd8;
  } catch {
    return false;
  }
}

function normalizedCamera(message, eye) {
  const camera = message.camera && typeof message.camera === 'object' ? message.camera : {};
  return {
    source: clean(camera.source, 'quest-passthrough', 60),
    eye: clean(camera.eye, eye, 40),
    poseAvailable: camera.poseAvailable === true,
    intrinsicsAvailable: camera.intrinsicsAvailable === true
  };
}

/**
 * Owns exactly one in-flight passthrough frame request. It does not store,
 * analyze, upload, or attach the returned JPEG.
 */
export class HeadsetFrameAcquirer {
  constructor({
    send,
    isConnected = () => true,
    timeoutPolicy = FRAME_TIMEOUT_POLICY,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    idFactory = randomId,
    onStatus = () => {}
  } = {}) {
    this.send = send;
    this.isConnected = isConnected;
    this.timeoutPolicy = { ...FRAME_TIMEOUT_POLICY, ...(timeoutPolicy || {}) };
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.idFactory = idFactory;
    this.onStatus = onStatus;
    this.pending = null;
    this.disposed = false;
  }

  acquireHeadsetFrame({ purpose = 'evidence', timeoutMs } = {}) {
    if (this.disposed) return Promise.reject(new HeadsetFrameError('frame-closed', 'Sensor scene is closed'));
    if (!FRAME_PURPOSES.has(purpose)) return Promise.reject(new HeadsetFrameError('frame-purpose', 'Frame purpose must be scan or evidence'));
    if (this.pending) return Promise.reject(new HeadsetFrameError('frame-busy', 'Another headset frame is already in progress'));
    if (typeof this.send !== 'function' || !this.isConnected()) {
      return Promise.reject(new HeadsetFrameError('frame-unavailable', 'Quest snapshot bridge is not connected'));
    }

    const requestId = this.idFactory('frame');
    const scanId = purpose === 'scan' ? this.idFactory('scan') : null;
    const timeout = boundedTimeout(timeoutMs, this.timeoutPolicy);
    this.onStatus({ state: 'requesting', purpose, requestId, scanId, timeoutMs: timeout });

    return new Promise((resolve, reject) => {
      const timer = this.setTimer(() => {
        if (this.pending?.requestId !== requestId) return;
        this.pending = null;
        const error = new HeadsetFrameError('frame-timeout', `Headset ${purpose} frame timed out after ${timeout} ms`);
        this.onStatus({ state: 'failed', purpose, requestId, scanId, code: error.code, detail: error.message });
        reject(error);
      }, timeout);
      this.pending = { requestId, scanId, purpose, timer, resolve, reject };
      try {
        this.send({
          type: 'headset.snapshot.request',
          requestId,
          purpose,
          ...(scanId ? { scanId } : {})
        });
      } catch (cause) {
        this.clearTimer(timer);
        this.pending = null;
        const error = new HeadsetFrameError('frame-send', clean(cause?.message, 'Headset frame request could not be sent', 240));
        this.onStatus({ state: 'failed', purpose, requestId, scanId, code: error.code, detail: error.message });
        reject(error);
      }
    });
  }

  handleMessage(message) {
    if (!message || message.type !== 'headset.snapshot.result' || !this.pending || message.requestId !== this.pending.requestId) return false;
    const pending = this.pending;
    this.pending = null;
    this.clearTimer(pending.timer);

    if (message.status !== 'ok') {
      const error = new HeadsetFrameError(clean(message.code, 'frame-failed', 160), clean(message.detail, 'Headset frame capture failed', 240));
      this.onStatus({ state: 'failed', purpose: pending.purpose, requestId: pending.requestId, scanId: pending.scanId, code: error.code, detail: error.message });
      pending.reject(error);
      return true;
    }
    if ((message.purpose && message.purpose !== pending.purpose) ||
        (message.scanId && message.scanId !== pending.scanId)) {
      const error = new HeadsetFrameError('frame-correlation', 'Headset frame response did not match its request');
      this.onStatus({ state: 'failed', purpose: pending.purpose, requestId: pending.requestId, scanId: pending.scanId, code: error.code, detail: error.message });
      pending.reject(error);
      return true;
    }
    const width = Number(message.width);
    const height = Number(message.height);
    const capturedAtMs = Number(message.capturedAtMs);
    if (!validJpegDataUrl(message.dataUrl) || !Number.isInteger(width) || width < 1 || width > 16_000 ||
        !Number.isInteger(height) || height < 1 || height > 16_000 || !Number.isInteger(capturedAtMs) || capturedAtMs < 0) {
      const error = new HeadsetFrameError('frame-invalid', 'Headset snapshot payload was invalid or oversized');
      this.onStatus({ state: 'failed', purpose: pending.purpose, requestId: pending.requestId, scanId: pending.scanId, code: error.code, detail: error.message });
      pending.reject(error);
      return true;
    }

    const eye = clean(message.eye, 'unknown', 40);
    const frame = {
      requestId: pending.requestId,
      purpose: pending.purpose,
      ...(pending.scanId ? { scanId: pending.scanId } : {}),
      dataUrl: message.dataUrl,
      mimeType: 'image/jpeg',
      width,
      height,
      eye,
      capturedAtMs,
      camera: normalizedCamera(message, eye)
    };
    this.onStatus({ state: 'received', purpose: pending.purpose, requestId: pending.requestId, scanId: pending.scanId, frame });
    pending.resolve(frame);
    return true;
  }

  failPending(detail = 'Quest snapshot bridge disconnected', code = 'frame-disconnected') {
    if (!this.pending) return false;
    const pending = this.pending;
    this.pending = null;
    this.clearTimer(pending.timer);
    const error = new HeadsetFrameError(code, clean(detail, 'Quest snapshot bridge disconnected', 240));
    this.onStatus({ state: 'failed', purpose: pending.purpose, requestId: pending.requestId, scanId: pending.scanId, code, detail: error.message });
    pending.reject(error);
    return true;
  }

  dispose() {
    this.disposed = true;
    this.failPending('Sensor scene closed before headset frame completed', 'frame-closed');
  }
}
