import * as THREE from 'three';

export class XRAnimationScrubber {
  constructor({ onAction }) {
    this.onAction = onAction;
    this.action = null;
    this.clip = null;
    this.presentationTarget = 0;
    this.width = 0.72;
    this.localPoint = new THREE.Vector3();

    this.group = new THREE.Group();
    this.group.name = 'MXGeniusAnimationScrubber';
    this.group.position.set(-0.15, 0.82, -1.18);
    this.group.visible = false;
    this.group.scale.setScalar(0.001);

    const railMaterial = new THREE.MeshBasicMaterial({ color: 0x263a4d, side: THREE.DoubleSide });
    this.rail = new THREE.Mesh(new THREE.BoxGeometry(this.width, 0.028, 0.035), railMaterial);
    this.rail.userData.xrScrubber = true;
    this.group.add(this.rail);

    this.fill = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.032, 0.04),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee })
    );
    this.fill.geometry.translate(0.5, 0, 0);
    this.fill.position.x = -this.width / 2;
    this.fill.scale.x = 0.001;
    this.fill.userData.xrScrubber = true;
    this.group.add(this.fill);

    this.knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0xe8f8ff })
    );
    this.knob.position.x = -this.width / 2;
    this.knob.userData.xrScrubber = true;
    this.group.add(this.knob);

    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 1024;
    this.labelCanvas.height = 128;
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTexture.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Mesh(
      new THREE.PlaneGeometry(this.width, 0.09),
      new THREE.MeshBasicMaterial({ map: this.labelTexture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    this.label.position.y = 0.1;
    this.group.add(this.label);
    this.drawLabel('EXPLODED VIEW', 0);
  }

  configure(action, clip) {
    this.action = action || null;
    this.clip = clip || null;
    this.setProgress(0, 'system', false);
  }

  setPresenting(presenting) {
    const shouldShow = Boolean(presenting && this.action && this.clip?.duration > 0);
    this.presentationTarget = shouldShow ? 1 : 0;
    if (shouldShow) this.group.visible = true;
  }

  owns(object) {
    let node = object;
    while (node && node !== this.group) {
      if (node.userData?.xrScrubber) return true;
      node = node.parent;
    }
    return false;
  }

  scrubAtWorldPoint(worldPoint, input = 'unknown') {
    if (!this.action || !this.clip?.duration) return false;
    this.localPoint.copy(worldPoint);
    this.group.worldToLocal(this.localPoint);
    const progress = THREE.MathUtils.clamp((this.localPoint.x + this.width / 2) / this.width, 0, 1);
    this.setProgress(progress, input, true);
    return true;
  }

  fingerScrub(worldPoint, input) {
    if (!this.group.visible) return false;
    this.localPoint.copy(worldPoint);
    this.group.worldToLocal(this.localPoint);
    const inRail = Math.abs(this.localPoint.y) <= 0.075 && Math.abs(this.localPoint.z) <= 0.08 && Math.abs(this.localPoint.x) <= this.width / 2 + 0.06;
    return inRail ? this.scrubAtWorldPoint(worldPoint, input) : false;
  }

  setProgress(progress, input = 'unknown', emit = true) {
    const normalized = THREE.MathUtils.clamp(Number(progress) || 0, 0, 1);
    this.knob.position.x = -this.width / 2 + normalized * this.width;
    this.fill.scale.x = Math.max(0.001, normalized * this.width);
    if (this.action && this.clip?.duration) {
      this.action.enabled = true;
      this.action.play();
      this.action.paused = true;
      this.action.time = normalized * this.clip.duration;
    }
    this.drawLabel(this.clip?.name || 'EXPLODED VIEW', normalized);
    if (emit) {
      this.onAction?.('scrub-animation', input, {
        clip: this.clip?.name || null,
        progress: normalized,
        time: this.clip ? normalized * this.clip.duration : 0,
        duration: this.clip?.duration || 0
      });
    }
  }

  syncFromAction() {
    if (!this.action || !this.clip?.duration || this.action.paused) return;
    const progress = (this.action.time % this.clip.duration) / this.clip.duration;
    this.knob.position.x = -this.width / 2 + progress * this.width;
    this.fill.scale.x = Math.max(0.001, progress * this.width);
    this.drawLabel(this.clip.name || 'EXPLODED VIEW', progress);
  }

  updatePresentation(delta = 1 / 60) {
    const currentScale = this.group.scale.x;
    const blend = 1 - Math.exp(-12 * Math.max(0, delta));
    const nextScale = THREE.MathUtils.lerp(currentScale, this.presentationTarget, blend);
    this.group.scale.setScalar(Math.max(0.001, nextScale));
    if (this.presentationTarget === 0 && nextScale < 0.012) this.group.visible = false;
  }

  drawLabel(title, progress) {
    const context = this.labelCanvas.getContext('2d');
    context.clearRect(0, 0, this.labelCanvas.width, this.labelCanvas.height);
    context.fillStyle = 'rgba(7, 17, 31, 0.92)';
    context.fillRect(0, 0, this.labelCanvas.width, this.labelCanvas.height);
    context.fillStyle = '#e8f4ff';
    context.font = '600 34px system-ui, sans-serif';
    context.fillText(String(title).slice(0, 42), 28, 48);
    context.fillStyle = '#67e8f9';
    context.font = '30px ui-monospace, monospace';
    context.fillText(`${Math.round(progress * 100)}%`, 28, 96);
    this.labelTexture.needsUpdate = true;
  }
}
