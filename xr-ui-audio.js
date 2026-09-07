import * as THREE from 'three';

const AUDIO_ROOT = new URL('./assets/xr-ui-fx/audio/', import.meta.url);

function soundStorage() {
  if (globalThis.MXGeniusSoundStorage) return globalThis.MXGeniusSoundStorage;
  try { return globalThis.parent?.MXGeniusSoundStorage || null; }
  catch { return null; }
}

export const XR_AUDIO_CUES = Object.freeze({
  ui_focus_soft: { id: 'SND-001', file: 'ui/ui_focus_soft.wav', gain: 0.32 },
  ui_press_primary: { id: 'SND-002', file: 'ui/ui_press_primary.wav', gain: 0.58 },
  ui_press_secondary: { id: 'SND-003', file: 'ui/ui_press_secondary.wav', gain: 0.46 },
  ui_cancel_retract: { id: 'SND-004', file: 'ui/ui_cancel_retract.wav', gain: 0.58 },
  ui_back_close: { id: 'SND-005', file: 'ui/ui_back_close.wav', gain: 0.44 },
  workflow_step_advance: { id: 'SND-006', file: 'ui/workflow_step_advance.wav', gain: 0.58 },
  workflow_complete: { id: 'SND-007', file: 'ui/workflow_complete.wav', gain: 0.48 },
  voice_listen_start: { id: 'SND-008', file: 'ui/voice_listen_start.wav', gain: 0.56 },
  voice_listen_stop: { id: 'SND-009', file: 'ui/voice_listen_stop.wav', gain: 0.5 },
  voice_processing_loop: { id: 'SND-010', file: 'ui/voice_processing_loop.wav', gain: 0.22, loop: true },
  spatial_acquire: { id: 'SND-011', file: 'spatial/spatial_acquire.wav', gain: 0.62, spatial: true },
  spatial_candidate: { id: 'SND-012', file: 'spatial/spatial_candidate.wav', gain: 0.54, spatial: true },
  spatial_confirm: { id: 'SND-013', file: 'spatial/spatial_confirm.wav', gain: 0.58, spatial: true },
  spatial_rejected: { id: 'SND-014', file: 'spatial/spatial_rejected.wav', gain: 0.56, spatial: true },
  spatial_guide_begin: { id: 'SND-015', file: 'spatial/spatial_guide_begin.wav', gain: 0.48, spatial: true },
  spatial_target_arrive: { id: 'SND-016', file: 'spatial/spatial_target_arrive.wav', gain: 0.46, spatial: true },
  evidence_capture: { id: 'SND-017', file: 'ui/evidence_capture.wav', gain: 0.58 },
  evidence_attached: { id: 'SND-018', file: 'ui/evidence_attached.wav', gain: 0.48 },
  provenance_open: { id: 'SND-019', file: 'ui/provenance_open.wav', gain: 0.34 },
  system_relocalizing_loop: { id: 'SND-020', file: 'system/system_relocalizing_loop.wav', gain: 0.28, loop: true },
  system_relocalized: { id: 'SND-021', file: 'system/system_relocalized.wav', gain: 0.56 },
  system_degraded: { id: 'SND-022', file: 'system/system_degraded.wav', gain: 0.54 },
  system_reconnected: { id: 'SND-023', file: 'system/system_reconnected.wav', gain: 0.46 },
  system_permission_needed: { id: 'SND-024', file: 'system/system_permission_needed.wav', gain: 0.46 },
  safety_attention: { id: 'SND-025', file: 'system/safety_attention.wav', gain: 0.78 },
  safety_acknowledged: { id: 'SND-026', file: 'system/safety_acknowledged.wav', gain: 0.72 }
});

export function cueForXRAction(action, target = {}) {
  switch (action) {
    case 'realtime-toggle':
      return ['disconnected', 'failed'].includes(target.state) ? 'voice_listen_start' : 'voice_listen_stop';
    case 'realtime-snapshot-request':
      return 'evidence_capture';
    case 'realtime-snapshot-sent':
      return 'evidence_attached';
    case 'realtime-snapshot-failed':
    case 'tutorial-playback-blocked':
      return 'system_degraded';
    case 'tutorial-play':
      return 'ui_press_primary';
    case 'tutorial-pause':
      return 'ui_press_secondary';
    case 'tutorial-ended':
      return 'workflow_complete';
    case 'open-fleet-location':
      return 'spatial_acquire';
    case 'spatial-scan-requested':
      return 'spatial_acquire';
    case 'spatial-scan-completed':
      return target.status === 'ready' ? 'spatial_candidate' : target.status === 'empty' ? 'spatial_rejected' : null;
    case 'spatial-target-arrive':
      return 'spatial_target_arrive';
    case 'spatial-candidate-next':
      return 'spatial_candidate';
    case 'spatial-target-locked':
      return 'spatial_confirm';
    case 'spatial-targets-cleared':
      return 'ui_cancel_retract';
    case 'toggle-globe-rotation':
    case 'globe-filter':
    case 'globe-texture':
    case 'globe-page':
    case 'thermal-screen-scale':
    case 'browser-link-unavailable':
      return 'ui_press_secondary';
    case 'globe-recenter':
      return 'spatial_confirm';
    case 'back-to-dashboard':
      return 'ui_back_close';
    case 'sensor-companion-launch':
      return 'ui_press_primary';
    case 'toggle-thermal-screen':
    case 'toggle-sensor-orb':
      return target.active ? 'ui_press_primary' : 'ui_cancel_retract';
    case 'browser-panel-toggle':
      return target.open ? 'ui_press_primary' : 'ui_cancel_retract';
    case 'thermal-screen-anchor':
      return target.pinned ? 'spatial_confirm' : 'ui_cancel_retract';
    case 'sensor-status':
      if (['connected', 'streaming'].includes(target.current) && !['connected', 'streaming'].includes(target.previous)) {
        return 'system_reconnected';
      }
      if (['failed', 'offline'].includes(target.current)) return 'system_degraded';
      if (['connecting', 'waiting'].includes(target.current)) return 'system_relocalizing_loop';
      return null;
    default:
      return null;
  }
}

export class XRUIAudio {
  constructor({ camera, volume = 0.72, onStateChange } = {}) {
    this.camera = camera;
    this.onStateChange = onStateChange;
    this.listener = new THREE.AudioListener();
    this.loader = new THREE.AudioLoader();
    this.buffers = new Map();
    this.pending = new Map();
    this.active = new Set();
    this.muted = false;
    this.state = 'locked';
    this.volume = THREE.MathUtils.clamp(volume, 0, 1);
    this.listener.setMasterVolume(this.volume);
    this.camera?.add(this.listener);
    this.notify();
  }

  notify(extra = {}) {
    this.onStateChange?.({ state: this.state, muted: this.muted, volume: this.volume, ...extra });
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted) this.stopAll({ fadeMs: 70 });
    this.listener.setMasterVolume(this.muted ? 0 : this.volume);
    this.notify();
  }

  setVolume(volume) {
    this.volume = THREE.MathUtils.clamp(Number(volume) || 0, 0, 1);
    this.listener.setMasterVolume(this.muted ? 0 : this.volume);
    this.notify();
  }

  async unlock() {
    if (this.muted) return false;
    const context = this.listener.context;
    try {
      if (context.state === 'suspended') await context.resume();
      this.state = context.state === 'running' ? 'ready' : 'locked';
      this.notify();
      if (this.state === 'ready' && this.buffers.size === 0) void this.preload();
      return this.state === 'ready';
    } catch (error) {
      this.state = 'unavailable';
      this.notify({ error: error?.message || 'Audio could not start' });
      return false;
    }
  }

  async loadCue(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    if (this.pending.has(name)) return this.pending.get(name);
    const cue = XR_AUDIO_CUES[name];
    if (!cue) return null;
    const bundledUrl = new URL(cue.file, AUDIO_ROOT).href;
    const request = Promise.resolve(soundStorage()?.getCueUrl?.(cue.id))
      .catch(() => null)
      .then(async (customUrl) => {
        if (!customUrl) return this.loader.loadAsync(bundledUrl);
        try {
          return await this.loader.loadAsync(customUrl);
        } catch {
          return this.loader.loadAsync(bundledUrl);
        }
      })
      .then((buffer) => {
        this.buffers.set(name, buffer);
        this.pending.delete(name);
        return buffer;
      })
      .catch((error) => {
        this.pending.delete(name);
        console.warn(`XR audio cue unavailable: ${name}`, error);
        return null;
      });
    this.pending.set(name, request);
    return request;
  }

  async preload(names = Object.keys(XR_AUDIO_CUES)) {
    const results = await Promise.all(names.map((name) => this.loadCue(name)));
    const failed = results.filter((buffer) => !buffer).length;
    if (failed && failed === results.length) this.state = 'unavailable';
    else if (this.listener.context.state === 'running') this.state = failed ? 'degraded' : 'ready';
    this.notify({ loaded: results.length - failed, failed });
    return { loaded: results.length - failed, failed };
  }

  async play(name, { object = null, gain = 1, loop } = {}) {
    const cue = XR_AUDIO_CUES[name];
    if (!cue || this.muted) return false;
    if (!(await this.unlock())) return false;
    const buffer = await this.loadCue(name);
    if (!buffer || this.muted) return false;

    if (cue.loop) this.stopCue(name, { fadeMs: 55 });
    const sound = cue.spatial && object
      ? new THREE.PositionalAudio(this.listener)
      : new THREE.Audio(this.listener);
    sound.name = `MXGeniusAudio:${name}`;
    sound.userData.xrAudioCue = name;
    sound.setBuffer(buffer);
    sound.setLoop(loop ?? Boolean(cue.loop));
    sound.setVolume(THREE.MathUtils.clamp(cue.gain * gain, 0, 1));
    if (sound.isPositionalAudio) {
      sound.setRefDistance(0.35);
      sound.setRolloffFactor(1.25);
      sound.setDistanceModel('inverse');
      sound.setMaxDistance(8);
    }
    (cue.spatial && object ? object : this.listener).add(sound);
    this.active.add(sound);
    sound.onEnded = () => this.release(sound);
    try {
      sound.play();
      return true;
    } catch (error) {
      this.release(sound);
      console.warn(`XR audio cue could not play: ${name}`, error);
      return false;
    }
  }

  async playAction(action, target = {}, { object = null, gain = 1 } = {}) {
    if (action === 'sensor-status' && !['connecting', 'waiting'].includes(target.current)) {
      this.stopCue('system_relocalizing_loop', { fadeMs: 70 });
    }
    const cue = cueForXRAction(action, target);
    return cue ? this.play(cue, { object, gain }) : false;
  }

  release(sound) {
    if (!sound) return;
    sound.isPlaying = false;
    sound.removeFromParent();
    sound.disconnect?.();
    this.active.delete(sound);
  }

  stopCue(name, options) {
    [...this.active]
      .filter((sound) => sound.userData.xrAudioCue === name)
      .forEach((sound) => this.stopSound(sound, options));
  }

  stopSound(sound, { fadeMs = 60 } = {}) {
    if (!sound || !this.active.has(sound)) return;
    const now = sound.context.currentTime;
    const releaseSeconds = Math.max(0, fadeMs) / 1000;
    sound.gain.gain.cancelScheduledValues(now);
    sound.gain.gain.setValueAtTime(sound.gain.gain.value, now);
    sound.gain.gain.linearRampToValueAtTime(0, now + releaseSeconds);
    window.setTimeout(() => {
      try {
        if (sound.isPlaying) sound.stop();
      } catch {
        // The source may have ended during its release window.
      }
      this.release(sound);
    }, fadeMs + 12);
  }

  stopAll(options) {
    [...this.active].forEach((sound) => this.stopSound(sound, options));
  }

  dispose() {
    this.stopAll({ fadeMs: 0 });
    this.listener.removeFromParent();
    this.buffers.clear();
    this.pending.clear();
  }
}
