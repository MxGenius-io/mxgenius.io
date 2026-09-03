import * as THREE from 'three';

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const WORLD_WIDTH = 1.6;
const WORLD_HEIGHT = 0.9;
const VALID_STATES = new Set(['candidate', 'locked']);

function clean(value, fallback = '', limit = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, limit);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function ease(value) {
  const t = clamp01(value);
  return 1 - Math.pow(1 - t, 3);
}

function phase(progress, start, end) {
  return ease((progress - start) / (end - start));
}

function makeHitTarget(name, action, x, width) {
  const target = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 0.082),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
  );
  target.name = name;
  target.position.set(x, -0.392, 0.015);
  target.userData.xrSpatialAction = action;
  target.userData.xrHitSize = { width, height: 0.082 };
  target.visible = false;
  return target;
}

/** Head-locked, renderer-independent view over the shared target registry. */
export class XRSpatialTargetHUD {
  constructor({ registry, onAction = () => {}, distance = 1.55 } = {}) {
    if (!registry?.snapshot || !registry?.subscribe || !registry?.lock) {
      throw new Error('XRSpatialTargetHUD requires an MXTargetRegistry instance');
    }
    this.registry = registry;
    this.onAction = onAction;
    this.distance = Math.min(2.4, Math.max(0.8, Number(distance) || 1.55));
    this.presenting = false;
    this.disposed = false;
    this.targets = [];
    this.selectedTargetId = null;
    this.revealProgress = 0;
    this.visibility = 0;
    this.lastExpiryCheck = 0;
    this.lastDrawKey = '';
    this.highlightRequest = 0;
    this.cameraPosition = new THREE.Vector3();
    this.cameraQuaternion = new THREE.Quaternion();
    this.forwardOffset = new THREE.Vector3();
    this.localPoint = new THREE.Vector3();

    this.group = new THREE.Group();
    this.group.name = 'MXGeniusSpatialTargetHUD';
    this.group.visible = false;

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.surface = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_WIDTH, WORLD_HEIGHT),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide
      })
    );
    this.surface.name = 'MXGeniusSpatialTargetSurface';
    this.surface.renderOrder = 1000;
    this.surface.frustumCulled = false;
    this.group.add(this.surface);

    this.nextTarget = makeHitTarget('MXGeniusSpatialNext', 'next-target', -0.245, 0.29);
    this.lockTarget = makeHitTarget('MXGeniusSpatialLock', 'lock-target', 0.08, 0.26);
    this.clearTarget = makeHitTarget('MXGeniusSpatialClear', 'clear-target', 0.375, 0.23);
    this.group.add(this.nextTarget, this.lockTarget, this.clearTarget);

    this.unsubscribe = this.registry.subscribe((detail) => this.refresh(detail.snapshot, detail.reason), { emitCurrent: true });
    this.draw();
  }

  setPresenting(value) {
    this.presenting = Boolean(value);
    this.syncVisibility();
  }

  refresh(snapshot = this.registry.snapshot(), reason = 'registry-refresh') {
    const previous = this.selectedTargetId;
    this.targets = (snapshot?.targets || [])
      .filter((target) => VALID_STATES.has(target.state) && target.anchor?.coordinateFrame === 'screen-normalized' && target.anchor?.bounds)
      .sort((left, right) => {
        if (left.targetId === snapshot.activeTargetId) return -1;
        if (right.targetId === snapshot.activeTargetId) return 1;
        return right.confidence - left.confidence || left.targetId.localeCompare(right.targetId);
      })
      .slice(0, 3);
    if (!this.targets.some((target) => target.targetId === this.selectedTargetId)) {
      this.selectedTargetId = snapshot.activeTargetId && this.targets.some((target) => target.targetId === snapshot.activeTargetId)
        ? snapshot.activeTargetId
        : this.targets[0]?.targetId || null;
    }
    if (this.selectedTargetId && this.selectedTargetId !== previous) {
      this.revealProgress = 0;
      this.onAction('spatial-target-arrive', 'registry', { targetId: this.selectedTargetId, reason });
    }
    this.lastDrawKey = '';
    this.syncVisibility();
  }

  selectedTarget() {
    return this.targets.find((target) => target.targetId === this.selectedTargetId) || null;
  }

  nextCandidate(input = 'xr') {
    if (this.targets.length < 2) return this.selectedTarget();
    this.highlightRequest += 1;
    const current = Math.max(0, this.targets.findIndex((target) => target.targetId === this.selectedTargetId));
    const selected = this.targets[(current + 1) % this.targets.length];
    this.selectedTargetId = selected.targetId;
    this.revealProgress = 0;
    this.lastDrawKey = '';
    this.onAction('spatial-candidate-next', input, { targetId: selected.targetId, index: (current + 1) % this.targets.length, count: this.targets.length });
    return selected;
  }

  lockSelected(input = 'xr') {
    const target = this.selectedTarget();
    return target ? this.lockTargetById(target.targetId, input) : null;
  }

  lockTargetById(targetId, input = 'xr') {
    const target = this.registry.get(targetId);
    if (!target || !this.targets.some((candidate) => candidate.targetId === target.targetId)) return null;
    this.highlightRequest += 1;
    this.selectedTargetId = target.targetId;
    this.revealProgress = 0;
    this.lastDrawKey = '';
    const locked = this.registry.lock(target.targetId, { reason: 'spatial-target-locked' });
    if (locked) this.onAction('spatial-target-locked', input, { targetId: locked.targetId, confidence: locked.confidence });
    return locked;
  }

  async highlightTarget(targetId, input = 'model', { dwellMs = 180, isCurrent = null } = {}) {
    const request = ++this.highlightRequest;
    const proposed = this.registry.get(targetId);
    if (!proposed || !this.targets.some((target) => target.targetId === proposed.targetId)) {
      return { status: 'stale', reason: 'Spatial target is no longer visible' };
    }
    const sameTarget = proposed.targetId === this.selectedTargetId;
    if (!sameTarget && dwellMs > 0) await new Promise((resolve) => setTimeout(resolve, dwellMs));
    if (this.disposed || request !== this.highlightRequest) {
      return { status: 'stale', reason: 'A newer highlight request replaced this one' };
    }
    const guard = typeof isCurrent === 'function' ? isCurrent() : { current: true };
    const current = this.registry.get(proposed.targetId);
    if (!guard.current || !current || !this.targets.some((target) => target.targetId === proposed.targetId)) {
      return { status: 'stale', reason: guard.reason || 'Spatial target changed during highlight dwell' };
    }
    this.selectedTargetId = current.targetId;
    if (!sameTarget) this.revealProgress = 0;
    this.lastDrawKey = '';
    this.onAction('spatial-target-highlighted', input, { targetId: current.targetId, confidence: current.confidence });
    return { status: 'applied' };
  }

  clear(input = 'xr') {
    this.highlightRequest += 1;
    const current = this.registry.snapshot();
    const removedIds = current.targets
      .filter((target) => target.anchor?.coordinateFrame === 'screen-normalized')
      .map((target) => target.targetId);
    if (!removedIds.length) return false;
    const retained = current.targets.filter((target) => !removedIds.includes(target.targetId));
    const activeTargetId = retained.some((target) => target.targetId === current.activeTargetId) ? current.activeTargetId : null;
    const result = this.registry.replaceSnapshot({
      ...current,
      registryRevision: current.registryRevision + 1,
      observedAtMs: Date.now(),
      activeTargetId,
      targets: retained
    }, { reason: 'spatial-targets-cleared' });
    if (result.status === 'applied') this.onAction('spatial-targets-cleared', input, { removedIds });
    return result.status === 'applied';
  }

  interactiveObjects() {
    return [this.nextTarget, this.lockTarget, this.clearTarget].filter((target) => target.visible);
  }

  handleObject(object, input = 'xr') {
    const action = object?.userData?.xrSpatialAction;
    if (action === 'next-target') this.nextCandidate(input);
    else if (action === 'lock-target') this.lockSelected(input);
    else if (action === 'clear-target') this.clear(input);
    else return false;
    return true;
  }

  fingerTargetAt(point) {
    if (!this.group.visible) return null;
    for (const target of this.interactiveObjects()) {
      target.updateMatrixWorld(true);
      target.worldToLocal(this.localPoint.copy(point));
      const size = target.userData.xrHitSize;
      if (Math.abs(this.localPoint.z) < 0.04 && Math.abs(this.localPoint.x) <= size.width / 2 && Math.abs(this.localPoint.y) <= size.height / 2) return target;
    }
    return null;
  }

  syncVisibility() {
    const active = Boolean(this.presenting && (this.targets.length || this.visibility > 0.01));
    this.group.visible = active;
    const controlsVisible = Boolean(this.presenting && this.targets.length && this.visibility > 0.7);
    this.nextTarget.visible = controlsVisible && this.targets.length > 1;
    this.lockTarget.visible = controlsVisible;
    this.clearTarget.visible = controlsVisible;
  }

  drawButton(ctx, x, width, label, accent, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(5, 18, 31, 0.9)';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, 651, width, 52, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e9f8ff';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + width / 2, 684);
  }

  draw() {
    const target = this.selectedTarget();
    const ctx = this.context;
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (!target || this.visibility <= 0.001) {
      this.texture.needsUpdate = true;
      return;
    }
    const bounds = target.anchor.bounds;
    const x = bounds.x * CANVAS_WIDTH;
    const y = bounds.y * CANVAS_HEIGHT;
    const width = bounds.width * CANVAS_WIDTH;
    const height = bounds.height * CANVAS_HEIGHT;
    const progress = this.revealProgress;
    const alpha = this.visibility;
    const accent = target.state === 'locked' ? '#34d399' : '#22d3ee';
    const cornerProgress = phase(progress, 0, 0.24);
    const outlineProgress = phase(progress, 0.16, 0.44);
    const leaderProgress = phase(progress, 0.38, 0.66);
    const cardProgress = phase(progress, 0.58, 0.88);
    const corner = Math.min(34, width * 0.22, height * 0.22) * cornerProgress;

    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, y + corner); ctx.lineTo(x, y); ctx.lineTo(x + corner, y);
    ctx.moveTo(x + width - corner, y); ctx.lineTo(x + width, y); ctx.lineTo(x + width, y + corner);
    ctx.moveTo(x + width, y + height - corner); ctx.lineTo(x + width, y + height); ctx.lineTo(x + width - corner, y + height);
    ctx.moveTo(x + corner, y + height); ctx.lineTo(x, y + height); ctx.lineTo(x, y + height - corner);
    ctx.stroke();

    ctx.globalAlpha = alpha * outlineProgress * 0.72;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = target.state === 'locked' ? 'rgba(52, 211, 153, 0.06)' : 'rgba(34, 211, 238, 0.045)';
    ctx.fillRect(x, y, width, height);

    const cardWidth = 350;
    const cardHeight = 132;
    const placeRight = x + width / 2 < CANVAS_WIDTH / 2;
    const cardX = placeRight
      ? Math.min(CANVAS_WIDTH - cardWidth - 28, x + width + 110)
      : Math.max(28, x - cardWidth - 110);
    const cardY = Math.min(CANVAS_HEIGHT - cardHeight - 92, Math.max(34, y + height / 2 - cardHeight / 2));
    const startX = placeRight ? x + width : x;
    const startY = y + height * 0.5;
    const elbowX = placeRight ? startX + 46 : startX - 46;
    const endX = placeRight ? cardX : cardX + cardWidth;
    const endY = cardY + 34;
    const middle = Math.min(1, leaderProgress * 2);
    const end = Math.max(0, leaderProgress * 2 - 1);
    ctx.globalAlpha = alpha * 0.92;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX + (elbowX - startX) * middle, startY + (endY - startY) * middle);
    if (end > 0) {
      ctx.moveTo(elbowX, endY);
      ctx.lineTo(elbowX + (endX - elbowX) * end, endY);
    }
    ctx.stroke();

    ctx.globalAlpha = alpha * cardProgress;
    ctx.fillStyle = 'rgba(5, 15, 27, 0.94)';
    ctx.strokeStyle = target.state === 'locked' ? 'rgba(52, 211, 153, 0.75)' : 'rgba(34, 211, 238, 0.68)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY + (1 - cardProgress) * 14, cardWidth, cardHeight, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.font = '700 15px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(target.state === 'locked' ? 'TARGET LOCKED' : 'HIGH-CONFIDENCE CANDIDATE', cardX + 20, cardY + 30);
    ctx.fillStyle = '#edf8ff';
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.fillText(clean(target.label, 'Observed object', 28), cardX + 20, cardY + 65);
    ctx.fillStyle = '#92a9bc';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(`${Math.round(target.confidence * 100)}% detector confidence`, cardX + 20, cardY + 94);
    ctx.fillStyle = '#6f879b';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('Location only · verify before action', cardX + 20, cardY + 118);

    const selectedIndex = Math.max(0, this.targets.findIndex((item) => item.targetId === target.targetId));
    const controlAlpha = alpha * phase(progress, 0.72, 1);
    if (this.targets.length > 1) this.drawButton(ctx, 300, 232, `NEXT  ${selectedIndex + 1}/${this.targets.length}`, '#38bdf8', controlAlpha);
    this.drawButton(ctx, 548, 208, target.state === 'locked' ? 'LOCKED' : 'LOCK', target.state === 'locked' ? '#34d399' : '#a78bfa', controlAlpha);
    this.drawButton(ctx, 772, 184, 'CLEAR', '#64748b', controlAlpha);
    ctx.globalAlpha = 1;
    this.texture.needsUpdate = true;
  }

  update(delta, time, { camera = null } = {}) {
    if (this.disposed) return;
    if (time - this.lastExpiryCheck >= 250) {
      this.lastExpiryCheck = time;
      this.registry.expire({ reason: 'spatial-targets-expired' });
    }
    const hasTarget = Boolean(this.selectedTarget());
    const targetVisibility = this.presenting && hasTarget ? 1 : 0;
    this.visibility = THREE.MathUtils.lerp(this.visibility, targetVisibility, 1 - Math.exp(-Math.max(0, delta) * 10));
    if (hasTarget) this.revealProgress = Math.min(1, this.revealProgress + Math.max(0, delta) / 1.05);
    if (camera && this.presenting) {
      camera.getWorldPosition(this.cameraPosition);
      camera.getWorldQuaternion(this.cameraQuaternion);
      this.forwardOffset.set(0, 0, -this.distance).applyQuaternion(this.cameraQuaternion);
      this.group.position.copy(this.cameraPosition).add(this.forwardOffset);
      this.group.quaternion.copy(this.cameraQuaternion);
    }
    this.syncVisibility();
    const drawKey = `${this.selectedTargetId}|${this.selectedTarget()?.state}|${this.targets.length}|${this.revealProgress.toFixed(3)}|${this.visibility.toFixed(3)}`;
    if (drawKey !== this.lastDrawKey) {
      this.lastDrawKey = drawKey;
      this.draw();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.highlightRequest += 1;
    this.unsubscribe?.();
    this.group.visible = false;
    this.group.traverse((object) => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => material.dispose?.());
    });
    this.texture.dispose();
  }
}
