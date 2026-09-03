import * as THREE from 'three';

const DEFAULT_QUICK_LINKS = Object.freeze([
  { id: 'parts', label: 'PARTS & SOURCING', detail: 'PartsBase and approved supplier portals', href: '' },
  { id: 'aircraft', label: 'AIRCRAFT RECORDS', detail: 'Registry, operator, and aircraft lookup', href: '' },
  { id: 'technical', label: 'TECHNICAL REFERENCES', detail: 'Manuals, service data, and approved sources', href: '' }
]);

function clean(value, fallback = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

function safeQuickLinks(links) {
  const source = Array.isArray(links) && links.length ? links : DEFAULT_QUICK_LINKS;
  return source.slice(0, 3).map((link, index) => ({
    id: clean(link?.id, `link-${index + 1}`),
    label: clean(link?.label, `QUICK LINK ${index + 1}`).slice(0, 28),
    detail: clean(link?.detail, 'Destination is not configured').slice(0, 62),
    href: /^https:\/\//i.test(clean(link?.href)) ? clean(link.href) : ''
  }));
}

function drawRoundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

export class XRBrowserPanel {
  constructor({ links = null, onNavigate = null, onAction = () => {} } = {}) {
    this.links = safeQuickLinks(links);
    this.onNavigate = typeof onNavigate === 'function' ? onNavigate : null;
    this.onAction = onAction;
    this.presenting = false;
    this.open = false;
    this.panelTarget = 0;
    this.status = 'Select a configured destination to open it.';
    this.disposed = false;
    this.cameraPosition = new THREE.Vector3();
    this.cameraQuaternion = new THREE.Quaternion();
    this.targetPosition = new THREE.Vector3();
    this.localPoint = new THREE.Vector3();
    this.headOffset = new THREE.Vector3(0.43, 0.27, -0.84);

    this.group = new THREE.Group();
    this.group.name = 'MXGeniusXRBrowser';
    this.group.visible = false;

    this.buttonCanvas = document.createElement('canvas');
    this.buttonCanvas.width = 256;
    this.buttonCanvas.height = 256;
    this.buttonContext = this.buttonCanvas.getContext('2d');
    this.buttonTexture = new THREE.CanvasTexture(this.buttonCanvas);
    this.buttonTexture.colorSpace = THREE.SRGBColorSpace;
    this.button = new THREE.Mesh(
      new THREE.PlaneGeometry(0.105, 0.105),
      new THREE.MeshBasicMaterial({ map: this.buttonTexture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    this.button.name = 'MXGeniusXRBrowserButton';
    this.button.userData.xrBrowserAction = 'toggle-browser-panel';
    this.button.userData.xrHitSize = { width: 0.105, height: 0.105 };
    this.group.add(this.button);

    this.panelRoot = new THREE.Group();
    this.panelRoot.name = 'MXGeniusXRBrowserPanel';
    this.panelRoot.position.set(-0.4, -0.29, -0.018);
    this.panelRoot.scale.setScalar(0.001);
    this.panelRoot.visible = false;
    this.group.add(this.panelRoot);

    this.panelCanvas = document.createElement('canvas');
    this.panelCanvas.width = 1024;
    this.panelCanvas.height = 720;
    this.panelContext = this.panelCanvas.getContext('2d');
    this.panelTexture = new THREE.CanvasTexture(this.panelCanvas);
    this.panelTexture.colorSpace = THREE.SRGBColorSpace;
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.78, 0.55),
      new THREE.MeshBasicMaterial({ map: this.panelTexture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    this.panel.name = 'MXGeniusXRBrowserSurface';
    this.panelRoot.add(this.panel);

    this.closeButton = new THREE.Mesh(
      new THREE.PlaneGeometry(0.075, 0.075),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, side: THREE.DoubleSide })
    );
    this.closeButton.name = 'MXGeniusXRBrowserClose';
    this.closeButton.position.set(0.337, 0.227, 0.012);
    this.closeButton.userData.xrBrowserAction = 'close-browser-panel';
    this.closeButton.userData.xrHitSize = { width: 0.075, height: 0.075 };
    this.panelRoot.add(this.closeButton);

    this.linkTargets = this.links.map((link, index) => {
      const target = new THREE.Mesh(
        new THREE.PlaneGeometry(0.68, 0.105),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, side: THREE.DoubleSide })
      );
      target.name = `MXGeniusXRBrowserLink-${link.id}`;
      target.position.set(0, 0.105 - index * 0.125, 0.012);
      target.userData.xrBrowserAction = 'open-browser-link';
      target.userData.xrBrowserLink = link;
      target.userData.xrHitSize = { width: 0.68, height: 0.105 };
      this.panelRoot.add(target);
      return target;
    });

    this.drawButton();
    this.drawPanel();
  }

  interactiveObjects() {
    if (!this.presenting || !this.group.visible) return [];
    return this.open ? [this.button, this.closeButton, ...this.linkTargets] : [this.button];
  }

  owns(object) {
    let node = object;
    while (node) {
      if (node.userData?.xrBrowserAction) return true;
      node = node.parent;
    }
    return false;
  }

  handleObject(object, input = 'xr') {
    if (!this.owns(object)) return false;
    let target = object;
    while (target && !target.userData?.xrBrowserAction) target = target.parent;
    const action = target?.userData?.xrBrowserAction;
    if (action === 'toggle-browser-panel') {
      this.setOpen(!this.open, input);
      return true;
    }
    if (action === 'close-browser-panel') {
      this.setOpen(false, input);
      return true;
    }
    if (action === 'open-browser-link') {
      this.openLink(target.userData.xrBrowserLink, input);
      return true;
    }
    return false;
  }

  fingerTargetAt(point) {
    for (const target of this.interactiveObjects()) {
      target.updateMatrixWorld(true);
      target.worldToLocal(this.localPoint.copy(point));
      const { width, height } = target.userData.xrHitSize;
      if (Math.abs(this.localPoint.z) < 0.04
        && Math.abs(this.localPoint.x) <= width / 2
        && Math.abs(this.localPoint.y) <= height / 2) {
        return target;
      }
    }
    return null;
  }

  setOpen(open, input = 'xr') {
    const next = Boolean(open);
    if (this.open === next) return;
    this.open = next;
    this.panelTarget = next ? 1 : 0;
    if (next) this.panelRoot.visible = true;
    this.onAction('browser-panel-toggle', input, { open: next });
    this.drawButton();
  }

  openLink(link, input = 'xr') {
    if (!link?.href || !this.onNavigate) {
      this.status = `${clean(link?.label, 'Destination')} is ready for an approved URL.`;
      this.onAction('browser-link-unavailable', input, { id: link?.id || '', configured: false });
      this.drawPanel();
      return;
    }
    const opened = this.onNavigate(link) !== false;
    this.status = opened ? `Opening ${link.label}…` : `${link.label} could not be opened.`;
    this.onAction('browser-link-open', input, { id: link.id, configured: true, opened });
    this.drawPanel();
  }

  setPresenting(presenting) {
    this.presenting = Boolean(presenting);
    this.group.visible = this.presenting;
    if (!this.presenting) {
      this.open = false;
      this.panelTarget = 0;
      this.panelRoot.visible = false;
      this.panelRoot.scale.setScalar(0.001);
      this.drawButton();
    }
  }

  drawButton() {
    const ctx = this.buttonContext;
    ctx.clearRect(0, 0, 256, 256);
    drawRoundedRect(ctx, 12, 12, 232, 232, 42);
    ctx.fillStyle = 'rgba(5, 18, 31, 0.96)';
    ctx.fill();
    ctx.strokeStyle = this.open ? '#67e8f9' : '#3c647b';
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.strokeStyle = this.open ? '#a5f3fc' : '#c4e9f5';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(128, 112, 53, 0, Math.PI * 2);
    ctx.moveTo(75, 112);
    ctx.lineTo(181, 112);
    ctx.moveTo(128, 59);
    ctx.bezierCurveTo(96, 80, 96, 144, 128, 165);
    ctx.moveTo(128, 59);
    ctx.bezierCurveTo(160, 80, 160, 144, 128, 165);
    ctx.stroke();
    ctx.fillStyle = '#dff7ff';
    ctx.font = '700 25px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('WEB', 128, 214);
    this.buttonTexture.needsUpdate = true;
  }

  drawPanel() {
    const ctx = this.panelContext;
    ctx.clearRect(0, 0, 1024, 720);
    drawRoundedRect(ctx, 5, 5, 1014, 710, 30);
    ctx.fillStyle = 'rgba(5, 14, 27, 0.975)';
    ctx.fill();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.fillStyle = '#67e8f9';
    ctx.font = '700 30px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('BROWSER', 48, 62);
    ctx.fillStyle = '#e7f8ff';
    ctx.font = '700 39px system-ui, sans-serif';
    ctx.fillText('Quick access', 48, 112);
    ctx.fillStyle = '#9ab3c7';
    ctx.font = '25px system-ui, sans-serif';
    ctx.fillText('Aircraft resources stay one gesture away.', 48, 151);
    ctx.strokeStyle = '#8dc9db';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(934, 43);
    ctx.lineTo(974, 83);
    ctx.moveTo(974, 43);
    ctx.lineTo(934, 83);
    ctx.stroke();

    this.links.forEach((link, index) => {
      const y = 202 + index * 164;
      drawRoundedRect(ctx, 54, y, 916, 136, 20);
      ctx.fillStyle = link.href ? 'rgba(9, 47, 62, 0.94)' : 'rgba(20, 35, 50, 0.82)';
      ctx.fill();
      ctx.strokeStyle = link.href ? '#2dd4bf' : '#365064';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = link.href ? '#99f6e4' : '#bdd0dc';
      ctx.font = '700 25px ui-monospace, monospace';
      ctx.fillText(link.label, 86, y + 48);
      ctx.fillStyle = '#91aabd';
      ctx.font = '24px system-ui, sans-serif';
      ctx.fillText(link.detail, 86, y + 87);
      ctx.fillStyle = link.href ? '#2dd4bf' : '#647b8d';
      ctx.font = '700 21px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(link.href ? 'OPEN  →' : 'URL PENDING', 934, y + 76);
      ctx.textAlign = 'left';
    });

    ctx.fillStyle = '#7892a6';
    ctx.font = '21px system-ui, sans-serif';
    ctx.fillText(clean(this.status).slice(0, 88), 56, 685);
    this.panelTexture.needsUpdate = true;
  }

  update(delta, { camera = null } = {}) {
    if (this.disposed || !this.presenting || !camera) return;
    camera.getWorldPosition(this.cameraPosition);
    camera.getWorldQuaternion(this.cameraQuaternion);
    this.targetPosition.copy(this.headOffset).applyQuaternion(this.cameraQuaternion).add(this.cameraPosition);
    const followBlend = 1 - Math.exp(-Math.max(0, delta) * 14);
    this.group.position.lerp(this.targetPosition, followBlend);
    this.group.quaternion.slerp(this.cameraQuaternion, followBlend);
    const revealBlend = 1 - Math.exp(-Math.max(0, delta) * 12);
    const scale = THREE.MathUtils.lerp(this.panelRoot.scale.x, this.panelTarget, revealBlend);
    this.panelRoot.scale.setScalar(Math.max(0.001, scale));
    if (!this.open && scale < 0.012) this.panelRoot.visible = false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.visible = false;
    for (const mesh of [this.button, this.panel, this.closeButton, ...this.linkTargets]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.buttonTexture.dispose();
    this.panelTexture.dispose();
  }
}
