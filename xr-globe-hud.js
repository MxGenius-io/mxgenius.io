import * as THREE from 'three';

const FILTERS = Object.freeze([
  { id: 'all', label: 'ALL FLEET' },
  { id: 'active', label: 'ACTIVE CASE' },
  { id: 'aog', label: 'AOG' },
  { id: 'time', label: 'HIGH TIME' }
]);

const TEXTURES = Object.freeze([
  { id: 'night', label: 'NIGHT', glyph: 'N' },
  { id: 'blue', label: 'BLUE', glyph: 'B' },
  { id: 'dark', label: 'DARK', glyph: 'D' },
  { id: 'water', label: 'OCEAN', glyph: 'O' },
  { id: 'map', label: 'MAP', glyph: 'M' }
]);

function clean(value, fallback = '—') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function fit(value, max) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function roundedRect(context, x, y, width, height, radius = 18) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function clusterTone(cluster) {
  if (cluster?.hasActiveCase) return { color: '#22d3ee', label: 'ACTIVE' };
  if (cluster?.hasAog) return { color: '#fb7185', label: 'AOG' };
  if (cluster?.hasVeryHighTime) return { color: '#f59e0b', label: '12K+' };
  if (cluster?.hasHighTime) return { color: '#fbbf24', label: '8K+' };
  return { color: '#34d399', label: 'CURRENT' };
}

export class XRGlobeHUD {
  constructor({ fleet = {}, onAction = () => {} } = {}) {
    this.fleet = fleet;
    this.onAction = onAction;
    this.filter = 'all';
    this.texture = 'blue';
    this.rotationActive = true;
    this.page = 0;
    this.pageSize = 5;
    this.selectedIndex = -1;
    this.hitRegions = [];
    this.filteredLocations = [];
    this.presentationTarget = 1;
    this.hitPoint = new THREE.Vector3();

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1400;
    this.canvas.height = 980;
    this.context = this.canvas.getContext('2d');
    this.textureMap = new THREE.CanvasTexture(this.canvas);
    this.textureMap.colorSpace = THREE.SRGBColorSpace;

    this.group = new THREE.Group();
    this.group.name = 'FleetBrowserParityHUD';
    this.surface = new THREE.Mesh(
      new THREE.PlaneGeometry(1.03, 0.72),
      new THREE.MeshBasicMaterial({
        map: this.textureMap,
        transparent: true,
        toneMapped: false,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false
      })
    );
    this.surface.name = 'FleetBrowserParitySurface';
    this.surface.renderOrder = 40;
    this.group.add(this.surface);
    this.setLocations();
  }

  interactiveObjects() {
    return [this.surface];
  }

  matchesFilter(cluster) {
    if (this.filter === 'active') return Boolean(cluster.hasActiveCase);
    if (this.filter === 'aog') return Boolean(cluster.hasAog);
    if (this.filter === 'time') return Boolean(cluster.hasVeryHighTime || cluster.hasHighTime);
    return true;
  }

  setLocations() {
    const clusters = Array.isArray(this.fleet?.clusters) ? this.fleet.clusters : [];
    this.filteredLocations = clusters
      .map((cluster, index) => ({ cluster, index }))
      .filter(({ cluster }) => this.matchesFilter(cluster))
      .sort((a, b) => (Number(b.cluster.count) || 0) - (Number(a.cluster.count) || 0));
    const pageCount = Math.max(1, Math.ceil(this.filteredLocations.length / this.pageSize));
    this.page = THREE.MathUtils.clamp(this.page, 0, pageCount - 1);
    this.draw();
  }

  setFilter(filter) {
    if (!FILTERS.some((item) => item.id === filter)) return;
    this.filter = filter;
    this.page = 0;
    this.setLocations();
  }

  setTexture(texture) {
    if (!TEXTURES.some((item) => item.id === texture)) return;
    this.texture = texture;
    this.draw();
  }

  setRotationActive(active) {
    this.rotationActive = Boolean(active);
    this.draw();
  }

  setSelected(index) {
    this.selectedIndex = Number.isInteger(index) ? index : -1;
    this.draw();
  }

  beginReveal() {
    this.group.visible = true;
    this.group.scale.setScalar(0.001);
    this.presentationTarget = 1;
  }

  update(delta) {
    if (!this.group.visible) return;
    const blend = 1 - Math.exp(-10 * Math.max(0, delta));
    const next = THREE.MathUtils.lerp(this.group.scale.x, this.presentationTarget, blend);
    this.group.scale.setScalar(Math.max(0.001, next));
  }

  addHitRegion(x, y, width, height, action, key) {
    this.hitRegions.push({ x, y, width, height, action, key: key || JSON.stringify(action) });
  }

  drawCard(x, y, width, height, { fill = '#0b1728', stroke = '#213a50', radius = 16 } = {}) {
    roundedRect(this.context, x, y, width, height, radius);
    this.context.fillStyle = fill;
    this.context.fill();
    this.context.strokeStyle = stroke;
    this.context.lineWidth = 2;
    this.context.stroke();
  }

  drawButton(x, y, width, height, label, action, { active = false, accent = '#22d3ee', fontSize = 23 } = {}) {
    this.drawCard(x, y, width, height, {
      fill: active ? 'rgba(14, 53, 73, 0.98)' : 'rgba(11, 25, 42, 0.96)',
      stroke: active ? accent : '#28445a',
      radius: 14
    });
    this.context.fillStyle = active ? '#f0fdff' : '#b8cddd';
    this.context.font = `700 ${fontSize}px system-ui, sans-serif`;
    this.context.textAlign = 'center';
    this.context.textBaseline = 'middle';
    this.context.fillText(label, x + width / 2, y + height / 2 + 1);
    this.context.textAlign = 'left';
    this.context.textBaseline = 'alphabetic';
    this.addHitRegion(x, y, width, height, action);
  }

  draw() {
    const ctx = this.context;
    const { width, height } = this.canvas;
    this.hitRegions = [];
    ctx.clearRect(0, 0, width, height);

    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, 'rgba(7, 17, 31, 0.985)');
    background.addColorStop(1, 'rgba(3, 9, 20, 0.97)');
    roundedRect(ctx, 5, 5, width - 10, height - 10, 28);
    ctx.fillStyle = background;
    ctx.fill();
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.58)';
    ctx.lineWidth = 5;
    ctx.stroke();

    this.drawCard(24, 24, 128, height - 48, { fill: 'rgba(9, 18, 34, 0.96)', stroke: '#243b53', radius: 22 });
    ctx.fillStyle = '#67e8f9';
    ctx.font = '800 22px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MAP', 88, 70);

    TEXTURES.forEach((item, index) => {
      const y = 100 + index * 112;
      const active = item.id === this.texture;
      this.drawButton(43, y, 90, 82, item.glyph, { type: 'texture', texture: item.id }, {
        active,
        accent: '#22d3ee',
        fontSize: 30
      });
      ctx.fillStyle = active ? '#67e8f9' : '#718da3';
      ctx.font = '700 16px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(item.label, 88, y + 103);
    });

    ctx.fillStyle = '#506b80';
    ctx.font = '700 14px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('STATUS', 88, 705);
    [['#22d3ee', 'ACTIVE'], ['#fb7185', 'AOG'], ['#f59e0b', 'TIME']].forEach(([tone, label], index) => {
      const y = 738 + index * 48;
      ctx.fillStyle = tone;
      ctx.beginPath();
      ctx.arc(59, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8fa8bc';
      ctx.font = '700 14px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, 76, y + 5);
    });

    const mainX = 182;
    const mainWidth = width - mainX - 28;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#67e8f9';
    ctx.font = '800 28px ui-monospace, monospace';
    ctx.fillText('FLEET CONTEXT', mainX, 59);
    ctx.fillStyle = '#718da3';
    ctx.font = '700 18px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('SPATIAL COMMAND · LIVE CACHED CONTEXT', width - 38, 58);
    ctx.textAlign = 'left';

    const countries = new Set((this.fleet.clusters || []).map((cluster) => clean(cluster.country, '')).filter(Boolean)).size;
    const stats = [
      ['AIRCRAFT', Number(this.fleet.totalAircraft) || 0],
      ['MAPPED', Number(this.fleet.mappedAircraft) || 0],
      ['COUNTRIES', countries]
    ];
    const statGap = 16;
    const statWidth = (mainWidth - statGap * 2) / 3;
    stats.forEach(([label, value], index) => {
      const x = mainX + index * (statWidth + statGap);
      this.drawCard(x, 88, statWidth, 112, { fill: 'rgba(10, 27, 45, 0.9)', stroke: 'rgba(45, 96, 119, 0.82)' });
      ctx.fillStyle = '#718da3';
      ctx.font = '700 18px ui-monospace, monospace';
      ctx.fillText(label, x + 20, 122);
      ctx.fillStyle = '#eaf7ff';
      ctx.font = '800 44px ui-monospace, monospace';
      ctx.fillText(Number(value).toLocaleString(), x + 20, 177);
    });

    const filterY = 224;
    const filterGap = 12;
    const filterWidth = (mainWidth - filterGap * (FILTERS.length - 1)) / FILTERS.length;
    FILTERS.forEach((item, index) => {
      const x = mainX + index * (filterWidth + filterGap);
      this.drawButton(x, filterY, filterWidth, 60, item.label, { type: 'filter', filter: item.id }, {
        active: item.id === this.filter,
        accent: item.id === 'aog' ? '#fb7185' : item.id === 'time' ? '#f59e0b' : '#22d3ee',
        fontSize: 18
      });
    });

    ctx.fillStyle = '#8fa8bc';
    ctx.font = '700 18px ui-monospace, monospace';
    ctx.fillText('LOCATIONS', mainX, 327);
    ctx.fillStyle = '#506b80';
    ctx.textAlign = 'right';
    ctx.fillText(`${this.filteredLocations.length} RESULTS`, width - 38, 327);
    ctx.textAlign = 'left';

    const pageCount = Math.max(1, Math.ceil(this.filteredLocations.length / this.pageSize));
    const rows = this.filteredLocations.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize);
    rows.forEach(({ cluster, index }, rowIndex) => {
      const y = 350 + rowIndex * 92;
      const selected = index === this.selectedIndex;
      const tone = clusterTone(cluster);
      this.drawCard(mainX, y, mainWidth, 76, {
        fill: selected ? 'rgba(15, 52, 70, 0.98)' : rowIndex % 2 ? 'rgba(8, 22, 38, 0.88)' : 'rgba(11, 27, 44, 0.9)',
        stroke: selected ? '#67e8f9' : '#1e374c',
        radius: 14
      });
      ctx.fillStyle = tone.color;
      ctx.fillRect(mainX, y + 12, 5, 52);
      ctx.fillStyle = selected ? '#ffffff' : '#dff7ff';
      ctx.font = '800 26px ui-monospace, monospace';
      ctx.fillText(fit(cluster.icao, 8), mainX + 24, y + 33);
      ctx.fillStyle = '#8fa8bc';
      ctx.font = '500 19px system-ui, sans-serif';
      ctx.fillText(fit([cluster.city, cluster.country].filter(Boolean).join(', '), 43), mainX + 24, y + 60);
      ctx.fillStyle = '#eaf7ff';
      ctx.font = '800 29px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText((Number(cluster.count) || 0).toLocaleString(), width - 198, y + 45);
      roundedRect(ctx, width - 174, y + 21, 122, 34, 17);
      ctx.fillStyle = `${tone.color}26`;
      ctx.fill();
      ctx.strokeStyle = tone.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = tone.color;
      ctx.font = '800 16px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(tone.label, width - 113, y + 44);
      ctx.textAlign = 'left';
      this.addHitRegion(mainX, y, mainWidth, 76, { type: 'select-location', index }, `location-${index}`);
    });

    if (!rows.length) {
      this.drawCard(mainX, 350, mainWidth, 168, { fill: 'rgba(8, 22, 38, 0.72)', stroke: '#1e374c' });
      ctx.fillStyle = '#8fa8bc';
      ctx.font = '600 24px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No fleet locations match this quick filter.', mainX + mainWidth / 2, 432);
      ctx.textAlign = 'left';
    }

    const footerY = 840;
    this.drawButton(mainX, footerY, 122, 72, '‹', { type: 'page', delta: -1 }, { fontSize: 42 });
    ctx.fillStyle = '#8fa8bc';
    ctx.font = '700 20px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.page + 1} / ${pageCount}`, mainX + 192, footerY + 45);
    ctx.textAlign = 'left';
    this.drawButton(mainX + 262, footerY, 122, 72, '›', { type: 'page', delta: 1 }, { fontSize: 42 });
    this.drawButton(mainX + 414, footerY, 244, 72, this.rotationActive ? 'PAUSE ROTATION' : 'START ROTATION', { type: 'rotation' }, {
      active: this.rotationActive,
      fontSize: 18
    });
    this.drawButton(mainX + 674, footerY, 208, 72, 'RECENTER', { type: 'recenter' }, { fontSize: 19 });
    this.drawButton(mainX + 898, footerY, mainWidth - 898, 72, 'OPEN SELECTED', { type: 'open-selected' }, {
      active: this.selectedIndex >= 0,
      fontSize: 17
    });

    ctx.fillStyle = '#506b80';
    ctx.font = '600 16px ui-monospace, monospace';
    ctx.fillText('GRIP: MOVE · TWO-GRIP: SCALE · SELECT: OPEN LOCATION', mainX, 951);
    this.textureMap.needsUpdate = true;
  }

  actionForUv(uv) {
    if (!uv) return null;
    const x = uv.x * this.canvas.width;
    const y = (1 - uv.y) * this.canvas.height;
    return this.hitRegions.find((region) => x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height) || null;
  }

  handleObject(object, uv, input = 'unknown') {
    if (object !== this.surface) return false;
    const region = this.actionForUv(uv);
    if (!region) return false;
    this.activate(region.action, input);
    return true;
  }

  actionAtWorldPoint(point) {
    if (!this.group.visible || this.group.scale.x < 0.8) return null;
    this.surface.updateMatrixWorld(true);
    this.surface.worldToLocal(this.hitPoint.copy(point));
    if (Math.abs(this.hitPoint.z) > 0.04 || Math.abs(this.hitPoint.x) > 0.515 || Math.abs(this.hitPoint.y) > 0.36) return null;
    const uv = {
      x: this.hitPoint.x / 1.03 + 0.5,
      y: this.hitPoint.y / 0.72 + 0.5
    };
    return this.actionForUv(uv);
  }

  activate(action, input) {
    if (!action) return;
    if (action.type === 'filter') this.setFilter(action.filter);
    if (action.type === 'texture') this.setTexture(action.texture);
    if (action.type === 'page') {
      const pageCount = Math.max(1, Math.ceil(this.filteredLocations.length / this.pageSize));
      this.page = THREE.MathUtils.clamp(this.page + action.delta, 0, pageCount - 1);
      this.draw();
    }
    this.onAction(action, input);
  }

  dispose() {
    this.textureMap.dispose();
    this.surface.geometry.dispose();
    this.surface.material.dispose();
    this.group.removeFromParent();
  }
}
