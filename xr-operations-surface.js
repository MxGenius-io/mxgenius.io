import * as THREE from 'three';
import { XRGlobeHUD } from './xr-globe-hud.js';

const EMPTY_FLEET = Object.freeze({ totalAircraft: 0, mappedAircraft: 0, clusters: [] });
const GLOBE_TEXTURES = Object.freeze({
  night: new URL('./earth-night.jpg', import.meta.url).href,
  blue: new URL('./earth-blue-marble.jpg', import.meta.url).href,
  dark: new URL('./earth-dark-hd.png', import.meta.url).href,
  water: new URL('./earth-water-hd.png', import.meta.url).href,
  map: new URL('./earth-topology.png', import.meta.url).href
});

function clean(value, fallback = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

function pointOnGlobe(latitude, longitude, radius = 0.429) {
  const phi = THREE.MathUtils.degToRad(90 - Number(latitude || 0));
  const theta = THREE.MathUtils.degToRad(Number(longitude || 0) + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function markerColor(cluster) {
  if (cluster?.hasActiveCase) return 0x22d3ee;
  if (cluster?.hasAog) return 0xfb7185;
  if (cluster?.hasVeryHighTime) return 0xf59e0b;
  if (cluster?.hasHighTime) return 0xfbbf24;
  return 0x34d399;
}

function destinationPoint(latitude, longitude, bearingDegrees, distanceKm) {
  const angularDistance = distanceKm / 6371;
  const bearing = THREE.MathUtils.degToRad(bearingDegrees);
  const lat1 = THREE.MathUtils.degToRad(latitude);
  const lng1 = THREE.MathUtils.degToRad(longitude);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance)
    + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing));
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );
  return {
    lat: THREE.MathUtils.radToDeg(lat2),
    lng: ((THREE.MathUtils.radToDeg(lng2) + 540) % 360) - 180
  };
}

function normalizeFleet(payload) {
  if (!payload || !Array.isArray(payload.clusters)) return { ...EMPTY_FLEET };
  return {
    ...payload,
    totalAircraft: Number(payload.totalAircraft) || 0,
    mappedAircraft: Number(payload.mappedAircraft) || 0,
    liveFlight: Number.isFinite(Number(payload.liveFlight?.lat)) && Number.isFinite(Number(payload.liveFlight?.lng))
      ? { ...payload.liveFlight, lat: Number(payload.liveFlight.lat), lng: Number(payload.liveFlight.lng) }
      : null,
    clusters: payload.clusters
      .filter((cluster) => Number.isFinite(Number(cluster?.lat)) && Number.isFinite(Number(cluster?.lng)))
      .map((cluster) => ({
        ...cluster,
        count: Number(cluster.count) || (Array.isArray(cluster.aircraft) ? cluster.aircraft.length : 0)
      }))
  };
}

export class XROperationsSurface {
  constructor({ storage = globalThis.localStorage, onAction = () => {} } = {}) {
    this.storage = storage;
    this.onAction = onAction;
    this.presenting = false;
    this.visible = false;
    this.placementPending = true;
    this.rotationActive = true;
    this.selectedIndex = -1;
    this.cameraPosition = new THREE.Vector3();
    this.cameraQuaternion = new THREE.Quaternion();
    this.forward = new THREE.Vector3();
    this.markerWorldPosition = new THREE.Vector3();
    this.context = {};
    this.markerMeshes = [];
    this.attentionRings = [];
    this.textureLoader = new THREE.TextureLoader();
    this.textureGeneration = 0;
    this.globeTexture = null;

    this.group = new THREE.Group();
    this.group.name = 'MXGeniusOperationsSurface';
    this.group.visible = false;

    this.globeRoot = new THREE.Group();
    this.globeRoot.name = 'MXGeniusOperationsGlobeRig';
    this.globeRoot.position.set(-0.58, -0.05, 0);
    this.globeRoot.rotation.y = -0.32;
    this.group.add(this.globeRoot);

    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 72, 48),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x020b13,
        emissiveIntensity: 0.34,
        roughness: 0.84,
        metalness: 0.02
      })
    );
    this.earth.name = 'MXGeniusOperationsGlobe';
    this.globeRoot.add(this.earth);

    this.graticule = new THREE.Mesh(
      new THREE.SphereGeometry(0.423, 24, 16),
      new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        wireframe: true,
        transparent: true,
        opacity: 0.055,
        depthWrite: false,
        toneMapped: false
      })
    );
    this.graticule.name = 'MXGeniusOperationsGraticule';
    this.globeRoot.add(this.graticule);

    this.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.442, 56, 36),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.11,
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false
      })
    );
    this.atmosphere.name = 'MXGeniusOperationsAtmosphere';
    this.globeRoot.add(this.atmosphere);

    this.markerGroup = new THREE.Group();
    this.markerGroup.name = 'MXGeniusFleetMarkers';
    this.globeRoot.add(this.markerGroup);

    this.liveTrafficGroup = new THREE.Group();
    this.liveTrafficGroup.name = 'MXGeniusSelectedLiveFlight';
    this.globeRoot.add(this.liveTrafficGroup);
    this.liveAircraft = null;

    this.payload = this.readFleet();
    this.hud = new XRGlobeHUD({
      fleet: this.payload,
      onAction: (action, input) => this.handleHudAction(action, input)
    });
    this.hud.group.name = 'MXGeniusOperationsFleetHUD';
    this.hudMount = new THREE.Group();
    this.hudMount.name = 'MXGeniusOperationsFleetHUDMount';
    this.hudMount.position.set(0.47, -0.015, 0.018);
    this.hudMount.scale.setScalar(0.78);
    this.hudMount.add(this.hud.group);
    this.group.add(this.hudMount);

    this.applyGlobeTexture('blue', 'system');
    this.refresh();
  }

  readFleet() {
    try {
      return normalizeFleet(JSON.parse(this.storage?.getItem?.('mxg_globe_vr_data') || 'null'));
    } catch {
      return { ...EMPTY_FLEET };
    }
  }

  clearMarkers() {
    while (this.markerGroup.children.length) {
      const child = this.markerGroup.children[0];
      this.markerGroup.remove(child);
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    this.markerMeshes = [];
    this.attentionRings = [];
    while (this.liveTrafficGroup.children.length) {
      const child = this.liveTrafficGroup.children[0];
      this.liveTrafficGroup.remove(child);
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    this.liveAircraft = null;
  }

  createSelectedLiveFlight(flight) {
    if (!flight) return;
    const track = Number(flight.trackDegrees) || 0;
    const speedKph = Number.isFinite(Number(flight.velocityMps)) ? Number(flight.velocityMps) * 3.6 : 350;
    const legKm = flight.onGround ? 8 : Math.max(35, Math.min(180, speedKph * 0.15));
    const start = destinationPoint(flight.lat, flight.lng, track + 180, legKm);
    const end = destinationPoint(flight.lat, flight.lng, track, legKm);
    const startPoint = pointOnGlobe(start.lat, start.lng, 0.441);
    const endPoint = pointOnGlobe(end.lat, end.lng, 0.441);
    const midpoint = startPoint.clone().add(endPoint).multiplyScalar(0.5).normalize().multiplyScalar(0.463);
    const ribbonCurve = new THREE.QuadraticBezierCurve3(startPoint, midpoint, endPoint);
    const ribbon = new THREE.Mesh(
      new THREE.TubeGeometry(ribbonCurve, 28, 0.0026, 7, false),
      new THREE.MeshBasicMaterial({
        color: 0xa78bfa,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        toneMapped: false
      })
    );
    ribbon.name = 'MXGeniusLiveFlightRibbon';
    this.liveTrafficGroup.add(ribbon);

    const shape = new THREE.Shape();
    shape.moveTo(0, 0.022);
    shape.lineTo(0.006, 0.004);
    shape.lineTo(0.023, -0.006);
    shape.lineTo(0.021, -0.011);
    shape.lineTo(0.004, -0.006);
    shape.lineTo(0.004, -0.019);
    shape.lineTo(0.011, -0.024);
    shape.lineTo(0.009, -0.028);
    shape.lineTo(0, -0.024);
    shape.lineTo(-0.009, -0.028);
    shape.lineTo(-0.011, -0.024);
    shape.lineTo(-0.004, -0.019);
    shape.lineTo(-0.004, -0.006);
    shape.lineTo(-0.021, -0.011);
    shape.lineTo(-0.023, -0.006);
    shape.lineTo(-0.006, 0.004);
    shape.closePath();
    const aircraft = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false
      })
    );
    const position = pointOnGlobe(flight.lat, flight.lng, 0.448);
    aircraft.position.copy(position);
    aircraft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), position.clone().normalize());
    aircraft.rotateZ(THREE.MathUtils.degToRad(-track));
    aircraft.name = `MXGeniusLiveAircraft-${clean(flight.callsign || flight.icao24, 'LIVE')}`;
    aircraft.userData.xrOperationsLiveFlight = true;
    this.liveTrafficGroup.add(aircraft);
    this.liveAircraft = aircraft;
  }

  createMarker(cluster, index) {
    const position = pointOnGlobe(cluster.lat, cluster.lng);
    const size = Math.min(1.8, 0.78 + Math.log2(Math.max(1, cluster.count) + 1) * 0.12
      + (cluster.hasActiveCase || cluster.hasAog ? 0.16 : 0));
    const marker = new THREE.Mesh(
      new THREE.CircleGeometry(0.0105, 20),
      new THREE.MeshBasicMaterial({
        color: markerColor(cluster),
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        toneMapped: false
      })
    );
    marker.name = `MXGeniusFleetLocation-${clean(cluster.icao, index)}`;
    marker.position.copy(position);
    marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), position.clone().normalize());
    marker.scale.setScalar(size);
    marker.userData.xrOperationsClusterIndex = index;
    marker.userData.baseColor = markerColor(cluster);
    marker.userData.baseScale = size;
    this.markerGroup.add(marker);
    this.markerMeshes.push(marker);

    if (cluster.hasActiveCase || cluster.hasAog || cluster.hasVeryHighTime) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.014, 0.018, 28),
        new THREE.MeshBasicMaterial({
          color: markerColor(cluster),
          transparent: true,
          opacity: 0.62,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false
        })
      );
      ring.position.copy(position).multiplyScalar(1.0025);
      ring.quaternion.copy(marker.quaternion);
      ring.userData.clusterIndex = index;
      this.markerGroup.add(ring);
      this.attentionRings.push(ring);
    }
  }

  refresh() {
    this.payload = this.readFleet();
    this.selectedIndex = -1;
    this.clearMarkers();
    this.payload.clusters.forEach((cluster, index) => this.createMarker(cluster, index));
    this.createSelectedLiveFlight(this.payload.liveFlight);
    this.hud.fleet = this.payload;
    this.hud.setSelected(-1);
    this.hud.setLocations();
    this.syncMarkerVisibility();
  }

  setContext(context = {}) {
    this.context = { ...context };
    const location = clean(this.context?.location?.icao).toUpperCase();
    if (!location) return;
    const index = this.payload.clusters.findIndex((cluster) => clean(cluster.icao).toUpperCase() === location);
    if (index >= 0) this.selectCluster(index, 'context', { emit: false });
  }

  applyGlobeTexture(textureId, input = 'unknown') {
    const url = GLOBE_TEXTURES[textureId];
    if (!url) return;
    const generation = ++this.textureGeneration;
    this.textureLoader.load(url, (texture) => {
      if (generation !== this.textureGeneration) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      this.globeTexture?.dispose?.();
      this.globeTexture = texture;
      this.earth.material.map = texture;
      this.earth.material.needsUpdate = true;
    }, undefined, () => {
      this.onAction('globe-texture-unavailable', input, { texture: textureId });
    });
  }

  syncMarkerVisibility() {
    const visible = new Set(this.hud.filteredLocations.map((item) => item.index));
    this.markerMeshes.forEach((marker, index) => {
      marker.visible = visible.has(index);
    });
    this.attentionRings.forEach((ring) => {
      ring.visible = visible.has(ring.userData.clusterIndex);
    });
  }

  selectCluster(index, input = 'unknown', { emit = true } = {}) {
    const cluster = this.payload.clusters[index];
    if (!cluster) return false;
    this.selectedIndex = index;
    this.hud.setSelected(index);
    this.markerMeshes.forEach((marker, markerIndex) => {
      marker.material.color.setHex(markerIndex === index ? 0xffffff : marker.userData.baseColor);
      const emphasis = markerIndex === index ? 1.55 : 1;
      marker.scale.setScalar(marker.userData.baseScale * emphasis);
    });
    if (emit) {
      this.onAction('open-fleet-location', input, {
        index,
        icao: clean(cluster.icao, 'UNKNOWN'),
        city: clean(cluster.city),
        country: clean(cluster.country),
        count: Number(cluster.count) || 0,
        hasActiveCase: Boolean(cluster.hasActiveCase),
        hasAog: Boolean(cluster.hasAog),
        hasVeryHighTime: Boolean(cluster.hasVeryHighTime),
        hasHighTime: Boolean(cluster.hasHighTime)
      });
    }
    return true;
  }

  handleHudAction(action, input = 'unknown') {
    if (!action) return;
    if (action.type === 'texture') this.applyGlobeTexture(action.texture, input);
    if (action.type === 'filter') this.syncMarkerVisibility();
    if (action.type === 'rotation') {
      this.rotationActive = !this.rotationActive;
      this.hud.setRotationActive(this.rotationActive);
    }
    if (action.type === 'recenter') this.globeRoot.rotation.set(0, -0.32, 0);
    if (action.type === 'select-location') this.selectCluster(action.index, input);
    if (action.type === 'open-selected' && this.selectedIndex >= 0) this.selectCluster(this.selectedIndex, input);
    this.onAction(`operations-${action.type}`, input, { ...action });
  }

  interactiveObjects() {
    if (!this.group.visible) return [];
    return [
      ...this.hud.interactiveObjects(),
      ...this.markerMeshes.filter((marker) => marker.visible),
      ...(this.liveAircraft ? [this.liveAircraft] : [])
    ];
  }

  handleObject(object, uv, input = 'xr') {
    if (this.hud.handleObject(object, uv, input)) return true;
    if (object?.userData?.xrOperationsLiveFlight) {
      this.onAction('open-live-flight', input, { ...this.payload.liveFlight });
      return true;
    }
    let node = object;
    while (node && !Number.isInteger(node.userData?.xrOperationsClusterIndex)) node = node.parent;
    if (!node) return false;
    return this.selectCluster(node.userData.xrOperationsClusterIndex, input);
  }

  fingerTargetAt(point) {
    if (!this.group.visible) return null;
    const hudRegion = this.hud.actionAtWorldPoint(point);
    if (hudRegion) return { kind: 'hud', key: `hud:${hudRegion.key}`, action: hudRegion.action };
    let nearest = null;
    let distance = 0.045;
    for (const marker of this.markerMeshes) {
      if (!marker.visible) continue;
      marker.getWorldPosition(this.markerWorldPosition);
      const candidate = this.markerWorldPosition.distanceTo(point);
      if (candidate < distance) {
        distance = candidate;
        nearest = marker;
      }
    }
    return nearest ? {
      kind: 'marker',
      key: `marker:${nearest.userData.xrOperationsClusterIndex}`,
      index: nearest.userData.xrOperationsClusterIndex
    } : null;
  }

  activateFingerTarget(target, input = 'xr') {
    if (!target) return false;
    if (target.kind === 'hud') {
      this.hud.activate(target.action, input);
      return true;
    }
    return target.kind === 'marker' ? this.selectCluster(target.index, input) : false;
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
      this.hud.beginReveal();
      this.onAction('operations-surface-open', 'system', { clusters: this.payload.clusters.length });
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
    this.group.position.copy(this.cameraPosition)
      .addScaledVector(this.forward, 1.48)
      .add(new THREE.Vector3(0, -0.12, 0));
    this.group.quaternion.copy(this.cameraQuaternion);
    this.placementPending = false;
  }

  update(delta, { camera = null } = {}) {
    if (!this.group.visible) return;
    this.placeForView(camera);
    if (this.rotationActive) this.globeRoot.rotation.y += Math.max(0, delta) * 0.055;
    this.hud.update(delta);
    const pulse = 1 + Math.sin(performance.now() * 0.0032) * 0.16;
    this.attentionRings.forEach((ring) => ring.scale.setScalar(pulse));
  }

  dispose() {
    this.clearMarkers();
    this.hud.dispose();
    this.globeTexture?.dispose?.();
    this.earth.geometry.dispose();
    this.earth.material.dispose();
    this.graticule.geometry.dispose();
    this.graticule.material.dispose();
    this.atmosphere.geometry.dispose();
    this.atmosphere.material.dispose();
  }
}
