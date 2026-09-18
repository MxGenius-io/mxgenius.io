import * as THREE from 'three';

function clean(value, fallback = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

function latLngToVector3(latitude, longitude, radius = 0.38) {
  const phi = (90 - Number(latitude || 0)) * Math.PI / 180;
  const theta = (Number(longitude || 0) + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

export class XROperationsSurface {
  constructor({ storage = globalThis.localStorage, onAction = () => {} } = {}) {
    this.storage = storage;
    this.onAction = onAction;
    this.presenting = false;
    this.visible = false;
    this.placementPending = true;
    this.cameraPosition = new THREE.Vector3();
    this.cameraQuaternion = new THREE.Quaternion();
    this.forward = new THREE.Vector3();
    this.context = {};

    this.group = new THREE.Group();
    this.group.name = 'MXGeniusOperationsSurface';
    this.group.visible = false;

    this.globeRoot = new THREE.Group();
    this.globeRoot.position.set(-0.34, -0.08, 0);
    this.group.add(this.globeRoot);

    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 64, 48),
      new THREE.MeshStandardMaterial({ color: 0x071a2a, emissive: 0x04111d, roughness: 0.82, metalness: 0.08 })
    );
    earth.name = 'MXGeniusOperationsGlobe';
    this.globeRoot.add(earth);
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.372, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.08, side: THREE.BackSide, toneMapped: false })
    );
    this.globeRoot.add(atmosphere);

    this.markerGroup = new THREE.Group();
    this.markerGroup.name = 'MXGeniusFleetMarkers';
    this.globeRoot.add(this.markerGroup);

    this.panelCanvas = document.createElement('canvas');
    this.panelCanvas.width = 900;
    this.panelCanvas.height = 720;
    this.panelTexture = new THREE.CanvasTexture(this.panelCanvas);
    this.panelTexture.colorSpace = THREE.SRGBColorSpace;
    this.panelTexture.minFilter = THREE.LinearFilter;
    this.panelTexture.generateMipmaps = false;
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68, 0.544),
      new THREE.MeshBasicMaterial({ map: this.panelTexture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    this.panel.position.set(0.36, -0.03, 0);
    this.group.add(this.panel);
    this.refresh();
  }

  readFleet() {
    try {
      const payload = JSON.parse(this.storage?.getItem?.('mxg_globe_vr_data') || 'null');
      return payload && Array.isArray(payload.clusters) ? payload : null;
    } catch {
      return null;
    }
  }

  refresh() {
    const payload = this.readFleet();
    while (this.markerGroup.children.length) {
      const child = this.markerGroup.children[0];
      this.markerGroup.remove(child);
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    const clusters = payload?.clusters || [];
    const limited = [...clusters]
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      .slice(0, 180);
    for (const cluster of limited) {
      const urgency = cluster.hasAog ? 0xfb7185 : cluster.hasActiveCase ? 0xfbbf24 : 0x22d3ee;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(cluster.hasAog ? 0.008 : 0.0055, 10, 8),
        new THREE.MeshBasicMaterial({ color: urgency, toneMapped: false })
      );
      marker.position.copy(latLngToVector3(cluster.lat, cluster.lng, 0.368));
      marker.userData.cluster = cluster;
      this.markerGroup.add(marker);
    }
    this.payload = payload;
    this.drawPanel();
  }

  setContext(context = {}) {
    this.context = { ...context };
    this.drawPanel();
  }

  drawPanel() {
    const ctx = this.panelCanvas.getContext('2d');
    ctx.clearRect(0, 0, 900, 720);
    ctx.beginPath(); ctx.roundRect(8, 8, 884, 704, 34);
    ctx.fillStyle = 'rgba(5, 18, 31, .97)'; ctx.fill();
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 6; ctx.stroke();
    ctx.fillStyle = '#7dd3fc'; ctx.font = '700 28px ui-monospace, monospace';
    ctx.fillText('OPERATIONS', 48, 68);
    ctx.fillStyle = '#effaff'; ctx.font = '700 44px system-ui, sans-serif';
    ctx.fillText('Fleet workspace', 48, 128);
    const count = Number(this.payload?.totalAircraft || 0);
    const mapped = Number(this.payload?.mappedAircraft || 0);
    const clusters = this.payload?.clusters?.length || 0;
    const age = this.payload?.createdAt ? Math.max(0, Math.round((Date.now() - Date.parse(this.payload.createdAt)) / 60000)) : null;
    const aircraft = this.context?.aircraft || null;
    const location = this.context?.location || null;
    const rows = [
      ['AIRCRAFT', count ? count.toLocaleString() : 'Fleet cache not loaded'],
      ['MAPPED', mapped ? mapped.toLocaleString() : '—'],
      ['LOCATIONS', clusters ? clusters.toLocaleString() : '—'],
      ['SNAPSHOT', age === null ? 'Open the dashboard globe once' : `${age}m old`],
      ['SELECTED', clean(aircraft?.registration || aircraft?.id || location?.icao, 'None')]
    ];
    rows.forEach(([label, value], index) => {
      const y = 205 + index * 82;
      ctx.fillStyle = '#7894a8'; ctx.font = '700 21px ui-monospace, monospace'; ctx.fillText(label, 50, y);
      ctx.fillStyle = '#e1f4ff'; ctx.font = '600 29px system-ui, sans-serif'; ctx.fillText(value, 260, y);
    });
    ctx.fillStyle = '#85a8ba'; ctx.font = '22px/1.4 system-ui, sans-serif';
    ctx.fillText('Select Maintenance in the tray to inspect the aircraft', 50, 650);
    ctx.fillText('without leaving this XR session.', 50, 684);
    this.panelTexture.needsUpdate = true;
  }

  setPresenting(value, camera = null) {
    this.presenting = Boolean(value);
    this.syncVisibility();
    if (this.presenting) {
      this.placementPending = true;
      this.placeForView(camera);
      this.refresh();
    }
  }

  setVisible(value, camera = null) {
    this.visible = Boolean(value);
    this.syncVisibility();
    if (this.group.visible) {
      this.placementPending = true;
      this.placeForView(camera);
      this.onAction('operations-surface-open', 'system', { clusters: this.payload?.clusters?.length || 0 });
    }
  }

  syncVisibility() {
    this.group.visible = this.presenting && this.visible;
  }

  placeForView(camera = null) {
    if (!this.placementPending || !camera) return;
    camera.getWorldPosition(this.cameraPosition);
    camera.getWorldQuaternion(this.cameraQuaternion);
    this.forward.set(0, 0, -1).applyQuaternion(this.cameraQuaternion);
    this.group.position.copy(this.cameraPosition).addScaledVector(this.forward, 1.35).add(new THREE.Vector3(0, 0.08, 0));
    this.group.quaternion.copy(this.cameraQuaternion);
    this.placementPending = false;
  }

  update(delta, { camera = null } = {}) {
    if (!this.group.visible) return;
    this.placeForView(camera);
    this.globeRoot.rotation.y += Math.max(0, delta) * 0.055;
  }

  dispose() {
    this.group.traverse((child) => {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    });
    this.panelTexture.dispose();
  }
}
