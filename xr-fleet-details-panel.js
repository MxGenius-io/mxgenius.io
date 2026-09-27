import * as THREE from 'three';

function clean(value, fallback = '—') {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

function fit(value, max = 44) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

export function buildJetNetDetailModel(bundle, summary = {}) {
  const aircraft = bundle?.aircraft?.aircraft || {};
  const ident = aircraft.identification || {};
  const airframe = aircraft.airframe || {};
  const maintenance = aircraft.maintenance || {};
  const apu = aircraft.apu || {};
  const engines = Array.isArray(bundle?.engines?.engines) ? bundle.engines.engines : [];
  const sections = [
    ['Identification', [
      ['Aircraft ID', ident.aircraftid], ['Serial Number', ident.sernbr], ['Year Manufactured', ident.yearmfg],
      ['Year Delivered', ident.yeardlv], ['Category/Size', ident.categorysize], ['Purchase Date', ident.purchasedate],
      ['Reg Expires', ident.regnbrexpires]
    ]],
    ['Base Location', [
      ['Airport', ident.baseairport], ['ICAO', ident.baseicao], ['IATA', ident.baseiata], ['City', ident.basecity],
      ['State', ident.basestate], ['Country', ident.basecountry]
    ]],
    ['Airframe', [
      ['AFTT', airframe.aftt], ['Landings', airframe.landings], ['Est AFTT', airframe.estaftt], ['As of Date', airframe.timesasofdate]
    ]],
    ['Engines', engines.flatMap((engine, index) => [
      [`Engine ${engine.position || index + 1}`, [engine.engine_make, engine.engine_model].filter(Boolean).join(' ')],
      ['Serial', engine.serial_number], ['Total Time', engine.tsn], ['Cycles', engine.csn], ['Overhaul (TSO)', engine.tso], ['Program', engine.program]
    ])],
    ['APU', [['Model', apu.model], ['Serial', apu.sernbr], ['TTSNEW', apu.ttsnew], ['SOH', apu.soh], ['Program', apu.maintenanceprogram]]],
    ['Maintenance', [
      ['Maintained', maintenance.maintained], ['AF Program', maintenance.airframemaintenanceprogram],
      ['Tracking', maintenance.airframetrackingprogram], ['MTOW', maintenance.weightscapacity],
      ['Certifications', (maintenance.certifications || []).join(', ')]
    ]],
    ['Avionics', (aircraft.avionics || []).map((item) => ['System', item.name])],
    ['Company Relationships', (aircraft.companyrelationships || []).map((item) => [item.relationtype || 'Company', item.name])],
    ['Flight Activity', (aircraft.flights || []).map((item) => [`${item.flightyear || ''} ${item.flightmonth || ''}`.trim(), `${item.flights || '—'} flights · ${item.flighthours || '—'} hours`])],
    ['Interior', (aircraft.interior || []).map((item) => [item.name, item.description])],
    ['Exterior', (aircraft.exterior || []).map((item) => [item.name, item.description])]
  ];
  const lines = [];
  sections.forEach(([title, rows]) => {
    const available = rows.filter(([, value]) => value !== undefined && value !== null && String(value).trim());
    if (!available.length) return;
    lines.push({ type: 'section', text: title });
    available.forEach(([label, value]) => lines.push({ type: 'row', label, value }));
  });
  return {
    id: ident.aircraftid || summary.aircraftid || summary.id || null,
    make: ident.make || summary.make,
    model: ident.model || summary.model,
    registration: ident.regnbr || summary.regnbr || summary.registration,
    pictures: (bundle?.pictures?.pictures || []).map((picture) => picture.pictureurl).filter((url) => /^https:\/\//i.test(String(url))),
    lines
  };
}

export class XRFleetDetailsPanel {
  constructor({ client = globalThis.MXApplicationClient, token = 'LIVE_TOKEN', onAction = () => {}, onVisibilityChange = () => {} } = {}) {
    this.client = client;
    this.token = token;
    this.onAction = onAction;
    this.onVisibilityChange = onVisibilityChange;
    this.location = null;
    this.locationIndex = -1;
    this.listPage = 0;
    this.detailPage = 0;
    this.imagePage = 0;
    this.detailModel = null;
    this.hitRegions = [];
    this.targetScale = 0;
    this.closing = false;
    this.requestGeneration = 0;
    this.imageGeneration = 0;
    this.objectUrls = new Set();
    this.hitPoint = new THREE.Vector3();

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 1280;
    this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.group = new THREE.Group();
    this.group.name = 'FleetAircraftDetails';
    this.group.scale.setScalar(0.001);
    this.group.visible = false;
    this.surface = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.9),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthTest: false })
    );
    this.surface.name = 'FleetAircraftDetailsSurface';
    this.surface.renderOrder = 60;
    this.group.add(this.surface);
    this.imageGrid = new THREE.Group();
    this.imageGrid.name = 'JetNetImageGrid';
    this.imageGrid.visible = false;
    this.group.add(this.imageGrid);
  }

  addRegion(x, y, width, height, action) {
    this.hitRegions.push({ x, y, width, height, action, key: JSON.stringify(action) });
  }

  frame(title, subtitle = '', tone = '#22d3ee') {
    const ctx = this.context;
    this.hitRegions = [];
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = 'rgba(7, 17, 31, 0.985)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.strokeStyle = tone;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, this.canvas.width - 6, this.canvas.height - 6);
    ctx.fillStyle = '#67e8f9';
    ctx.font = '700 28px ui-monospace, monospace';
    ctx.fillText(title, 44, 62);
    ctx.fillStyle = '#8fa8bc';
    ctx.font = '24px system-ui, sans-serif';
    ctx.fillText(fit(subtitle, 60), 44, 102);
    this.button(842, 30, 146, 'CLOSE', { type: 'close' });
  }

  button(x, y, width, label, action) {
    const ctx = this.context;
    ctx.fillStyle = '#10283a';
    ctx.fillRect(x, y, width, 64);
    ctx.strokeStyle = '#2d6077';
    ctx.strokeRect(x, y, width, 64);
    ctx.fillStyle = '#dff7ff';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + width / 2, y + 41);
    ctx.textAlign = 'left';
    this.addRegion(x, y, width, 64, action);
  }

  drawLocation() {
    const cluster = this.location || {};
    const aircraft = Array.isArray(cluster.aircraft) ? cluster.aircraft : [];
    const pageCount = Math.max(1, Math.ceil(aircraft.length / 8));
    this.listPage = THREE.MathUtils.clamp(this.listPage, 0, pageCount - 1);
    const rows = aircraft.slice(this.listPage * 8, (this.listPage + 1) * 8);
    this.frame('FLEET LOCATION', [cluster.city, cluster.country].filter(Boolean).join(', '));
    const ctx = this.context;
    ctx.fillStyle = '#f4fbff';
    ctx.font = '700 68px system-ui, sans-serif';
    ctx.fillText(clean(cluster.icao, 'UNKNOWN'), 42, 188);
    ctx.fillStyle = '#8fa8bc';
    ctx.font = '26px system-ui, sans-serif';
    ctx.fillText(`${aircraft.length.toLocaleString()} JetNet aircraft · select a record`, 44, 230);
    rows.forEach((record, index) => {
      const y = 270 + index * 104;
      ctx.fillStyle = index % 2 ? '#0b1928' : '#0e2031';
      ctx.fillRect(36, y, 952, 90);
      ctx.fillStyle = '#eaf7ff';
      ctx.font = '700 31px ui-monospace, monospace';
      ctx.fillText(fit(record.regnbr, 12), 56, y + 38);
      ctx.fillStyle = '#b8cddd';
      ctx.font = '24px system-ui, sans-serif';
      ctx.fillText(fit([record.make, record.model].filter(Boolean).join(' '), 40), 250, y + 36);
      ctx.fillStyle = '#718da3';
      ctx.font = '21px system-ui, sans-serif';
      ctx.fillText(fit(record.owner, 46), 250, y + 69);
      ctx.fillStyle = record.urgency === 'AOG' ? '#fb7185' : record.urgency === 'Other' ? '#34d399' : '#fbbf24';
      ctx.font = '700 20px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(clean(record.urgency), 956, y + 53);
      ctx.textAlign = 'left';
      this.addRegion(36, y, 952, 90, { type: 'open-aircraft', aircraft: record });
    });
    if (!rows.length) {
      ctx.fillStyle = '#fbbf24';
      ctx.font = '27px system-ui, sans-serif';
      ctx.fillText('No aircraft records were cached for this location.', 44, 340);
    }
    this.footer(this.listPage, pageCount, 'list-page');
    this.texture.needsUpdate = true;
  }

  footer(page, pageCount, type) {
    this.button(36, 1190, 170, 'PREVIOUS', { type, delta: -1 });
    this.context.fillStyle = '#718da3';
    this.context.font = '23px ui-monospace, monospace';
    this.context.textAlign = 'center';
    this.context.fillText(`${page + 1} / ${pageCount}`, 512, 1231);
    this.context.textAlign = 'left';
    this.button(818, 1190, 170, 'NEXT', { type, delta: 1 });
  }

  drawAircraft() {
    if (!this.detailModel) return;
    const pageCount = Math.max(1, Math.ceil(this.detailModel.lines.length / 13));
    this.detailPage = THREE.MathUtils.clamp(this.detailPage, 0, pageCount - 1);
    this.frame('JETNET AIRCRAFT', `${clean(this.detailModel.make)} ${clean(this.detailModel.model)}`);
    this.button(36, 122, 150, 'BACK', { type: 'back' });
    const ctx = this.context;
    ctx.fillStyle = '#f4fbff';
    ctx.font = '700 48px ui-monospace, monospace';
    ctx.fillText(clean(this.detailModel.registration), 220, 167);
    const imagePages = Math.max(1, Math.ceil(this.detailModel.pictures.length / 6));
    if (this.detailModel.pictures.length) {
      this.button(650, 122, 150, 'IMG PREV', { type: 'image-page', delta: -1 });
      this.button(838, 122, 150, 'IMG NEXT', { type: 'image-page', delta: 1 });
      ctx.fillStyle = '#718da3';
      ctx.font = '19px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`IMAGES ${this.imagePage + 1} / ${imagePages} · ${this.detailModel.pictures.length} TOTAL`, 988, 211);
      ctx.textAlign = 'left';
    }
    this.detailModel.lines.slice(this.detailPage * 13, (this.detailPage + 1) * 13).forEach((line, index) => {
      const y = 500 + index * 50;
      if (line.type === 'section') {
        ctx.fillStyle = '#67e8f9';
        ctx.font = '700 24px ui-monospace, monospace';
        ctx.fillText(line.text.toUpperCase(), 44, y + 31);
      } else {
        ctx.fillStyle = '#8fa8bc';
        ctx.font = '22px system-ui, sans-serif';
        ctx.fillText(fit(line.label, 24), 58, y + 31);
        ctx.fillStyle = '#eaf7ff';
        ctx.textAlign = 'right';
        ctx.fillText(fit(line.value, 45), 970, y + 31);
        ctx.textAlign = 'left';
      }
    });
    this.footer(this.detailPage, pageCount, 'detail-page');
    this.texture.needsUpdate = true;
  }

  clearImages() {
    this.imageGeneration += 1;
    this.imageGrid.visible = false;
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls.clear();
    while (this.imageGrid.children.length) {
      const child = this.imageGrid.children[0];
      this.imageGrid.remove(child);
      child.geometry?.dispose?.();
      child.material?.map?.dispose?.();
      child.material?.dispose?.();
    }
  }

  populateImages(urls) {
    this.clearImages();
    const generation = this.imageGeneration;
    const pageCount = Math.max(1, Math.ceil(urls.length / 6));
    this.imagePage = THREE.MathUtils.clamp(this.imagePage, 0, pageCount - 1);
    const sources = urls.slice(this.imagePage * 6, (this.imagePage + 1) * 6).filter((url) => /^https:\/\//i.test(String(url)));
    if (!sources.length) return;
    this.imageGrid.visible = true;
    sources.forEach((sourceUrl, index) => {
      const material = new THREE.MeshBasicMaterial({ color: 0x13283a, toneMapped: false, side: THREE.DoubleSide, depthTest: false });
      const image = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.105), material);
      image.position.set(-0.22 + (index % 3) * 0.22, 0.20 - Math.floor(index / 3) * 0.12, 0.012);
      image.renderOrder = 61;
      this.imageGrid.add(image);
      void this.client?.aircraftImageBlobUrl?.(sourceUrl).then((objectUrl) => {
        if (!objectUrl) throw new Error('JetNet image proxy returned no content');
        if (generation !== this.imageGeneration || !image.parent) return URL.revokeObjectURL(objectUrl);
        this.objectUrls.add(objectUrl);
        new THREE.TextureLoader().load(objectUrl, (texture) => {
          this.objectUrls.delete(objectUrl);
          URL.revokeObjectURL(objectUrl);
          if (generation !== this.imageGeneration || !image.parent) return texture.dispose();
          texture.colorSpace = THREE.SRGBColorSpace;
          material.map = texture;
          material.color.setHex(0xffffff);
          material.needsUpdate = true;
        }, undefined, () => material.color.setHex(0x3a1720));
      }).catch(() => material.color.setHex(0x3a1720));
    });
  }

  async openAircraft(summary, input = 'unknown') {
    this.onAction('fleet-aircraft-selected', input, {
      id: summary.aircraftid || summary.id || null,
      registration: summary.regnbr || summary.registration || null,
      family: [summary.make, summary.model].filter(Boolean).join(' ') || null,
      make: summary.make || null,
      model: summary.model || null,
      location: this.location ? {
        icao: this.location.icao || null,
        city: this.location.city || null,
        country: this.location.country || null,
        latitude: this.location.lat,
        longitude: this.location.lng
      } : null
    });
    const generation = ++this.requestGeneration;
    this.clearImages();
    this.frame('JETNET AIRCRAFT', 'Loading aircraft, engine, and gallery records…');
    this.texture.needsUpdate = true;
    try {
      if (!this.client?.aircraftBundle) throw new Error('Fleet detail service is unavailable');
      const bundle = await this.client.aircraftBundle({ id: summary.aircraftid || summary.id, token: this.token });
      if (generation !== this.requestGeneration) return;
      this.detailModel = buildJetNetDetailModel(bundle, summary);
      this.detailPage = 0;
      this.imagePage = 0;
      this.populateImages(this.detailModel.pictures);
      this.drawAircraft();
      this.onAction('fleet-aircraft-loaded', input, { id: this.detailModel.id, imageCount: this.detailModel.pictures.length });
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      this.frame('JETNET AIRCRAFT', 'Aircraft details are temporarily unavailable.', '#fb7185');
      this.button(36, 122, 150, 'BACK', { type: 'back' });
      this.context.fillStyle = '#fb7185';
      this.context.font = '26px system-ui, sans-serif';
      this.context.fillText(fit(error?.message || 'Fleet source request failed', 64), 44, 250);
      this.texture.needsUpdate = true;
      this.onAction('fleet-aircraft-error', input, { message: error?.message || 'Fleet source request failed' });
    }
  }

  openLocation(cluster, index, input = 'unknown') {
    this.requestGeneration += 1;
    this.location = cluster;
    this.locationIndex = index;
    this.listPage = 0;
    this.detailModel = null;
    this.clearImages();
    this.drawLocation();
    this.group.visible = true;
    this.group.scale.setScalar(0.001);
    this.targetScale = 1;
    this.closing = false;
    this.onVisibilityChange(true);
    this.onAction('fleet-details-open', input, { index, icao: cluster?.icao || null });
  }

  close(input = 'unknown') {
    if (!this.group.visible && this.targetScale === 0) return;
    this.requestGeneration += 1;
    this.targetScale = 0;
    this.closing = true;
    this.clearImages();
    this.onAction('fleet-details-close', input, {});
  }

  activate(action, input = 'unknown') {
    if (!action) return false;
    if (action.type === 'close') this.close(input);
    else if (action.type === 'open-aircraft') void this.openAircraft(action.aircraft, input);
    else if (action.type === 'back') {
      this.requestGeneration += 1;
      this.detailModel = null;
      this.clearImages();
      this.drawLocation();
    } else if (action.type === 'list-page') {
      this.listPage += action.delta;
      this.drawLocation();
    } else if (action.type === 'detail-page') {
      this.detailPage += action.delta;
      this.drawAircraft();
    } else if (action.type === 'image-page') {
      this.imagePage += action.delta;
      this.populateImages(this.detailModel?.pictures || []);
      this.drawAircraft();
    } else return false;
    return true;
  }

  actionForUv(uv) {
    if (!uv) return null;
    const x = uv.x * this.canvas.width;
    const y = (1 - uv.y) * this.canvas.height;
    return this.hitRegions.find((region) => x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height) || null;
  }

  handleObject(object, uv, input = 'unknown') {
    return object === this.surface ? this.activate(this.actionForUv(uv)?.action, input) : false;
  }

  actionAtWorldPoint(point) {
    if (!this.group.visible || this.group.scale.x < 0.8) return null;
    this.surface.updateMatrixWorld(true);
    this.surface.worldToLocal(this.hitPoint.copy(point));
    if (Math.abs(this.hitPoint.z) > 0.04 || Math.abs(this.hitPoint.x) > 0.36 || Math.abs(this.hitPoint.y) > 0.45) return null;
    return this.actionForUv({ x: this.hitPoint.x / 0.72 + 0.5, y: this.hitPoint.y / 0.9 + 0.5 });
  }

  interactiveObjects() {
    return this.group.visible ? [this.surface] : [];
  }

  update(delta) {
    if (!this.group.visible) return;
    const blend = 1 - Math.exp(-12 * Math.max(0, delta));
    const next = THREE.MathUtils.lerp(this.group.scale.x, this.targetScale, blend);
    this.group.scale.setScalar(Math.max(0.001, next));
    if (this.targetScale === 0 && next < 0.012) {
      this.group.visible = false;
      if (this.closing) {
        this.closing = false;
        this.onVisibilityChange(false);
      }
    }
  }

  dispose() {
    this.requestGeneration += 1;
    this.clearImages();
    this.texture.dispose();
    this.surface.geometry.dispose();
    this.surface.material.dispose();
    this.group.removeFromParent();
  }
}
