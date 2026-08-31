import * as THREE from 'three';

const COLORS = {
  glass: '#07111f',
  glassSoft: 'rgba(7, 17, 31, 0.88)',
  border: 'rgba(198, 225, 240, 0.24)',
  text: '#edf8ff',
  muted: '#8ea6b7',
  cyan: '#67e8f9',
  amber: '#f5b942',
  green: '#43e58b',
  red: '#ff5b61'
};

const TOOL_ACTIONS = [
  ['acquire', 'ACQUIRE'],
  ['inspect', 'INSPECT'],
  ['compare', 'COMPARE'],
  ['voice', 'VOICE'],
  ['guide', 'GUIDE'],
  ['capture', 'CAPTURE'],
  ['clear', 'CLEAR']
];

const WORKFLOW = ['OBSERVE', 'IDENTIFY', 'VERIFY', 'RECORD'];
const HUD_ACTION_CUES = Object.freeze({
  acquire: 'spatial_acquire',
  inspect: 'workflow_step_advance',
  compare: 'workflow_step_advance',
  voice: 'ui_press_primary',
  guide: 'spatial_guide_begin',
  capture: 'ui_press_primary',
  clear: 'ui_cancel_retract',
  why: 'provenance_open'
});
const tempVector = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempBox = new THREE.Box3();

function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function easeOutCubic(value) {
  const t = clamp01(value);
  return 1 - ((1 - t) ** 3);
}

function windowedProgress(value, start, end) {
  return easeOutCubic((value - start) / Math.max(0.001, end - start));
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawPanelChrome(context, width, height, options = {}) {
  context.clearRect(0, 0, width, height);
  roundedRect(context, 3, 3, width - 6, height - 6, options.radius || 26);
  context.fillStyle = options.fill || COLORS.glassSoft;
  context.fill();
  context.strokeStyle = options.border || COLORS.border;
  context.lineWidth = options.lineWidth || 3;
  context.stroke();
}

function drawText(context, text, x, y, options = {}) {
  context.fillStyle = options.color || COLORS.text;
  context.font = `${options.weight || 500} ${options.size || 28}px ${options.family || 'system-ui, sans-serif'}`;
  context.textAlign = options.align || 'left';
  context.textBaseline = options.baseline || 'alphabetic';
  context.fillText(String(text || ''), x, y, options.maxWidth);
}

function wrapText(context, text, x, y, maxWidth, lineHeight, maxLines = 4) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  let line = '';
  let lineIndex = 0;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      context.fillText(line, x, y + lineIndex * lineHeight);
      line = word;
      lineIndex += 1;
      if (lineIndex >= maxLines) return;
    } else {
      line = candidate;
    }
  }
  if (line && lineIndex < maxLines) context.fillText(line, x, y + lineIndex * lineHeight);
}

function makeCanvasPanel({ width, height, worldWidth, worldHeight, draw, action = null }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    toneMapped: false,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldWidth, worldHeight), material);
  mesh.renderOrder = 1000;
  if (action) mesh.userData.xrHudAction = action;
  const panel = {
    canvas,
    context,
    texture,
    mesh,
    redraw(payload) {
      draw(context, width, height, payload || {});
      texture.needsUpdate = true;
    }
  };
  panel.redraw({});
  return panel;
}

function makeLineMaterial(color, opacity = 1) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
}

function createCornerGeometry(width = 0.45, height = 0.32) {
  const length = Math.min(width, height) * 0.2;
  const left = -width / 2;
  const right = width / 2;
  const top = height / 2;
  const bottom = -height / 2;
  const points = [
    left + length, top, 0, left, top, 0, left, top, 0, left, top - length, 0,
    right - length, top, 0, right, top, 0, right, top, 0, right, top - length, 0,
    left + length, bottom, 0, left, bottom, 0, left, bottom, 0, left, bottom + length, 0,
    right - length, bottom, 0, right, bottom, 0, right, bottom, 0, right, bottom + length, 0
  ];
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
}

function createOutlineGeometry(width = 0.45, height = 0.32) {
  const points = [
    new THREE.Vector3(-width / 2, height / 2, 0),
    new THREE.Vector3(width / 2, height / 2, 0),
    new THREE.Vector3(width / 2, -height / 2, 0),
    new THREE.Vector3(-width / 2, -height / 2, 0),
    new THREE.Vector3(-width / 2, height / 2, 0)
  ];
  return new THREE.BufferGeometry().setFromPoints(points);
}

export class XRMaintenanceHUD {
  constructor({ onAction, onSound } = {}) {
    this.onAction = onAction;
    this.onSound = onSound;
    this.context = {};
    this.workflowStage = 0;
    this.presenting = false;
    this.preview = false;
    this.presentationTarget = 0;
    this.placementPending = false;
    this.targetObject = null;
    this.targetData = null;
    this.targetContour = null;
    this.targetContourOwnsGeometry = false;
    this.targetVisibility = 0;
    this.targetVisibilityTarget = 0;
    this.forgetTargetPending = false;
    this.revealTime = 0;
    this.reducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    this.revealDuration = this.reducedMotion ? 0.55 : 2.15;
    this.provenanceExpanded = false;
    this.bounds = new THREE.Box3();
    this.interactives = [];
    this.focusedObject = null;
    this.pressedObject = null;
    this.pressTime = 0;

    this.group = new THREE.Group();
    this.group.name = 'MXGeniusMaintenanceHUD';
    this.group.visible = false;
    this.group.scale.setScalar(0.001);

    this.annotationGroup = new THREE.Group();
    this.annotationGroup.name = 'MXGeniusMaintenanceAnnotation';
    this.annotationGroup.visible = false;
    this.annotationGroup.scale.setScalar(0.001);

    this.buildStatusRail();
    this.buildWorkflowRail();
    this.buildEvidenceCard();
    this.buildActionBelt();
    this.buildProvenance();
    this.buildAnnotation();
    this.redrawAll();
  }

  objects() {
    return [this.group, this.annotationGroup];
  }

  buildStatusRail() {
    this.statusPanel = makeCanvasPanel({
      width: 1600,
      height: 120,
      worldWidth: 1.55,
      worldHeight: 0.115,
      draw: (context, width, height) => {
        drawPanelChrome(context, width, height, { radius: 30, fill: 'rgba(7, 17, 31, 0.95)' });
        drawText(context, 'MXGENIUS', 42, 75, { size: 38, weight: 700, color: COLORS.text });
        const caseId = this.context.caseId || this.context.case_id || 'PREVIEW';
        const aircraft = this.context.aircraftId || this.context.aircraft_id || 'AIRCRAFT';
        drawText(context, `CASE ${String(caseId).slice(0, 24)}`, 380, 72, { size: 29, weight: 600 });
        drawText(context, String(aircraft).slice(0, 20), 690, 72, { size: 29, weight: 600 });
        drawText(context, 'ATA 29 · HYDRAULIC', 930, 72, { size: 29, weight: 600 });
        const capabilities = this.context.capabilities || {};
        const capabilityRows = [
          ['SESSION', 1270, capabilities.session || (caseId === 'PREVIEW' ? 'preview' : 'ready')],
          ['LOCAL', 1400, capabilities.local || 'ready'],
          ['CLOUD', 1510, capabilities.cloud || 'unknown']
        ];
        capabilityRows.forEach(([label, x, status]) => {
          context.beginPath();
          context.arc(x - 25, 59, 8, 0, Math.PI * 2);
          context.fillStyle = ['ready', 'available', 'connected'].includes(status)
            ? COLORS.green
            : ['preview', 'degraded', 'relocalizing'].includes(status)
              ? COLORS.amber
              : ['failed', 'offline', 'denied'].includes(status)
                ? COLORS.red
                : COLORS.muted;
          context.fill();
          drawText(context, label, x, 69, { size: 20, weight: 600, color: COLORS.text });
        });
      }
    });
    this.statusPanel.mesh.position.set(0, 0.47, 0);
    this.group.add(this.statusPanel.mesh);
  }

  buildWorkflowRail() {
    this.workflowPanel = makeCanvasPanel({
      width: 360,
      height: 900,
      worldWidth: 0.29,
      worldHeight: 0.72,
      draw: (context, width, height) => {
        drawPanelChrome(context, width, height, { radius: 28, fill: 'rgba(7, 17, 31, 0.9)' });
        WORKFLOW.forEach((label, index) => {
          const y = 150 + index * 190;
          const completed = index < this.workflowStage;
          const active = index === this.workflowStage;
          if (index < WORKFLOW.length - 1) {
            context.fillStyle = completed ? COLORS.green : 'rgba(198,225,240,0.2)';
            context.fillRect(74, y + 35, 3, 125);
          }
          context.beginPath();
          context.arc(75, y, 30, 0, Math.PI * 2);
          context.fillStyle = active ? 'rgba(67,229,139,0.16)' : 'rgba(255,255,255,0.025)';
          context.fill();
          context.strokeStyle = completed || active ? COLORS.green : 'rgba(198,225,240,0.45)';
          context.lineWidth = 4;
          context.stroke();
          drawText(context, String(index + 1), 75, y + 2, {
            size: 25,
            weight: 600,
            align: 'center',
            baseline: 'middle',
            color: completed || active ? COLORS.green : COLORS.muted
          });
          drawText(context, label, 132, y + 10, {
            size: 28,
            weight: active ? 700 : 500,
            color: active ? COLORS.green : COLORS.text
          });
        });
      }
    });
    this.workflowPanel.mesh.position.set(-0.72, 0.01, 0);
    this.group.add(this.workflowPanel.mesh);
  }

  buildEvidenceCard() {
    this.evidencePanel = makeCanvasPanel({
      width: 620,
      height: 700,
      worldWidth: 0.49,
      worldHeight: 0.555,
      draw: (context, width, height) => {
        drawPanelChrome(context, width, height, { radius: 30, fill: 'rgba(7, 17, 31, 0.92)' });
        drawText(context, 'MXGENIUS', 42, 68, { size: 34, weight: 700 });
        context.fillStyle = 'rgba(198,225,240,0.18)';
        context.fillRect(42, 98, width - 84, 2);
        context.fillStyle = COLORS.text;
        context.font = '500 31px system-ui, sans-serif';
        wrapText(
          context,
          this.targetData?.summary || 'Select a component to begin a spatial inspection.',
          42,
          155,
          width - 84,
          42,
          5
        );
        const chips = this.targetData?.sources || ['NO ACTIVE EVIDENCE'];
        chips.slice(0, 3).forEach((chip, index) => {
          const y = 390 + index * 78;
          roundedRect(context, 42, y, width - 84, 58, 12);
          context.fillStyle = 'rgba(255,255,255,0.035)';
          context.fill();
          context.strokeStyle = 'rgba(198,225,240,0.2)';
          context.lineWidth = 2;
          context.stroke();
          context.beginPath();
          context.arc(76, y + 29, 9, 0, Math.PI * 2);
          context.fillStyle = index === 0 ? COLORS.amber : index === 1 ? COLORS.cyan : COLORS.green;
          context.fill();
          drawText(context, chip, 105, y + 38, { size: 24, weight: 600 });
        });
        context.fillStyle = 'rgba(198,225,240,0.18)';
        context.fillRect(42, 635, width - 84, 2);
        const provenanceLabel = !this.targetData
          ? 'SELECT A TARGET'
          : this.provenanceExpanded ? 'HIDE PROVENANCE' : 'WHY?';
        drawText(context, provenanceLabel, width / 2, 678, {
          size: 24,
          weight: 700,
          color: COLORS.cyan,
          align: 'center'
        });
      },
      action: 'why'
    });
    this.evidencePanel.mesh.position.set(0.71, 0.03, 0);
    this.group.add(this.evidencePanel.mesh);
    this.interactives.push(this.evidencePanel.mesh);
  }

  buildActionBelt() {
    const backing = makeCanvasPanel({
      width: 1500,
      height: 230,
      worldWidth: 1.28,
      worldHeight: 0.195,
      draw: (context, width, height) => {
        drawPanelChrome(context, width, height, { radius: 70, fill: 'rgba(7, 17, 31, 0.9)' });
      }
    });
    backing.mesh.position.set(0, -0.46, -0.008);
    this.group.add(backing.mesh);
    this.toolButtons = [];
    TOOL_ACTIONS.forEach(([action, label], index) => {
      const panel = makeCanvasPanel({
        width: 210,
        height: 180,
        worldWidth: 0.17,
        worldHeight: 0.145,
        action,
        draw: (context, width, height) => {
          context.clearRect(0, 0, width, height);
          if (action === 'voice') {
            context.beginPath();
            context.arc(width / 2, 72, 54, 0, Math.PI * 2);
            context.fillStyle = 'rgba(24, 106, 132, 0.55)';
            context.fill();
            context.strokeStyle = COLORS.cyan;
            context.lineWidth = 4;
            context.stroke();
          }
          const iconColor = action === 'clear' ? COLORS.muted : action === 'voice' ? COLORS.cyan : COLORS.text;
          context.strokeStyle = iconColor;
          context.lineWidth = 5;
          context.beginPath();
          context.arc(width / 2, 70, action === 'voice' ? 22 : 28, 0, Math.PI * 2);
          context.stroke();
          if (action === 'acquire') {
            context.strokeRect(width / 2 - 38, 32, 76, 76);
          } else if (action === 'guide') {
            context.moveTo(68, 92); context.lineTo(105, 50); context.lineTo(142, 92); context.stroke();
          } else if (action === 'capture') {
            context.strokeRect(68, 42, 74, 58);
          }
          drawText(context, label, width / 2, 158, { size: 20, weight: 650, align: 'center', color: iconColor });
        }
      });
      panel.mesh.position.set(-0.51 + index * 0.17, -0.46, 0.002);
      this.group.add(panel.mesh);
      this.toolButtons.push(panel);
      this.interactives.push(panel.mesh);
    });
  }

  buildProvenance() {
    this.provenancePanel = makeCanvasPanel({
      width: 900,
      height: 120,
      worldWidth: 0.7,
      worldHeight: 0.093,
      draw: (context, width, height) => {
        drawPanelChrome(context, width, height, { radius: 30, fill: 'rgba(7, 17, 31, 0.86)' });
        const nodes = [
          ['OBSERVATION', COLORS.amber, 160],
          ['INTERPRETATION', COLORS.cyan, 450],
          ['ACTION', COLORS.green, 745]
        ];
        nodes.forEach(([label, color, x], index) => {
          context.beginPath();
          context.arc(x - 80, 60, 10, 0, Math.PI * 2);
          context.fillStyle = color;
          context.fill();
          drawText(context, label, x - 55, 69, { size: 20, weight: 650 });
          if (index < nodes.length - 1) {
            drawText(context, '→', x + 85, 70, { size: 28, weight: 500, color: COLORS.muted });
          }
        });
      }
    });
    this.provenancePanel.mesh.position.set(0, -0.31, 0);
    this.provenancePanel.mesh.scale.setScalar(0.82);
    this.group.add(this.provenancePanel.mesh);
  }

  buildAnnotation() {
    this.cornerMaterial = makeLineMaterial(0xf5b942, 0);
    this.corners = new THREE.LineSegments(createCornerGeometry(), this.cornerMaterial);
    this.corners.renderOrder = 1002;
    this.annotationGroup.add(this.corners);

    this.outlineMaterial = new THREE.LineDashedMaterial({
      color: 0xf5b942,
      dashSize: 0.025,
      gapSize: 0.015,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    this.outline = new THREE.Line(createOutlineGeometry(), this.outlineMaterial);
    this.outline.computeLineDistances();
    this.outline.renderOrder = 1001;
    this.annotationGroup.add(this.outline);

    this.leader = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.006, 0.006).translate(0.5, 0, 0),
      new THREE.MeshBasicMaterial({ color: 0xf5b942, transparent: true, opacity: 0, depthTest: false, toneMapped: false })
    );
    this.leader.renderOrder = 1003;
    this.annotationGroup.add(this.leader);

    this.detailPanel = makeCanvasPanel({
      width: 620,
      height: 290,
      worldWidth: 0.56,
      worldHeight: 0.26,
      draw: (context, width, height) => {
        drawPanelChrome(context, width, height, { radius: 24, fill: 'rgba(7, 17, 31, 0.94)', border: 'rgba(245,185,66,0.72)' });
        drawText(context, this.targetData?.label || 'SELECTED COMPONENT', 38, 68, { size: 31, weight: 700 });
        drawText(context, `${String(this.targetData?.state || 'CANDIDATE').toUpperCase()} · ${Math.round((this.targetData?.confidence ?? 0.72) * 100)}%`, 38, 122, {
          size: 27,
          weight: 700,
          color: this.targetData?.state === 'confirmed' ? COLORS.green : COLORS.amber
        });
        context.fillStyle = 'rgba(198,225,240,0.18)';
        context.fillRect(38, 151, width - 76, 2);
        drawText(context, this.targetData?.measurement || 'VISUAL INSPECTION', 38, 205, { size: 29, weight: 600 });
        drawText(context, this.targetData?.measurementSource || 'Observation · unverified', 38, 252, { size: 20, weight: 500, color: COLORS.muted });
      }
    });
    this.detailPanel.mesh.geometry.translate(0.28, 0, 0);
    this.detailPanel.mesh.position.z = 0.01;
    this.detailPanel.mesh.scale.set(0.001, 1, 1);
    this.annotationGroup.add(this.detailPanel.mesh);

    this.effectMaterial = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    this.effectRing = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.085, 64), this.effectMaterial);
    this.effectRing.renderOrder = 1004;
    this.annotationGroup.add(this.effectRing);
  }

  redrawAll() {
    this.statusPanel?.redraw();
    this.workflowPanel?.redraw();
    this.evidencePanel?.redraw();
    this.detailPanel?.redraw();
  }

  setContext(context = {}) {
    this.context = { ...context };
    this.statusPanel.redraw();
  }

  setWorkflowStage(stage) {
    this.workflowStage = THREE.MathUtils.clamp(Number(stage) || 0, 0, WORKFLOW.length - 1);
    this.workflowPanel.redraw();
  }

  setPresenting(presenting, camera) {
    const wasVisible = this.presentationTarget > 0;
    this.presenting = Boolean(presenting);
    this.presentationTarget = this.presenting || this.preview ? 1 : 0;
    this.placementPending = this.presenting;
    if (this.presentationTarget > 0) {
      this.group.visible = true;
      if (camera) this.placeForView(camera);
      if (!wasVisible && this.targetObject) this.announceTarget();
    }
  }

  setPreview(preview, camera) {
    const wasVisible = this.presentationTarget > 0;
    this.preview = Boolean(preview);
    this.presentationTarget = this.presenting || this.preview ? 1 : 0;
    if (this.preview) {
      this.group.visible = true;
      this.placeForView(camera);
      if (!wasVisible && this.targetObject) this.announceTarget();
    }
  }

  placeForView(camera) {
    if (!camera) return;
    camera.getWorldPosition(tempVector);
    camera.getWorldQuaternion(tempQuaternion);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(tempQuaternion);
    this.group.position.copy(tempVector).add(forward.multiplyScalar(1.42));
    this.group.quaternion.copy(tempQuaternion);
    this.placementPending = false;
  }

  setTarget(object, data = {}) {
    if (!object) return false;
    this.forgetTargetPending = false;
    this.releaseTargetContour();
    this.targetObject = object;
    this.targetData = {
      label: String(data.label || object.name || 'SELECTED COMPONENT').slice(0, 42),
      state: data.state === 'confirmed' ? 'confirmed' : 'candidate',
      confidence: THREE.MathUtils.clamp(Number(data.confidence ?? 0.72), 0, 1),
      measurement: String(data.measurement || 'VISUAL INSPECTION').slice(0, 42),
      measurementSource: String(data.measurementSource || 'Observation · unverified').slice(0, 64),
      summary: String(data.summary || 'Selected geometry is ready for inspection. Verify identity and applicable maintenance evidence before acting.').slice(0, 260),
      sources: Array.isArray(data.sources) ? data.sources.map((value) => String(value).slice(0, 32)) : ['MODEL GEOMETRY', 'CASE CONTEXT', 'MANUAL LOOKUP']
    };
    this.setWorkflowStage(this.targetData.state === 'confirmed' ? 2 : 1);
    this.targetVisibilityTarget = 1;
    this.annotationGroup.visible = this.presentationTarget > 0;
    this.revealTime = 0;
    this.detailPanel.redraw();
    this.evidencePanel.redraw();
    const vertexCount = object.geometry?.attributes?.position?.count || 0;
    if (object.isMesh && object.geometry && vertexCount > 0 && vertexCount <= 250000) {
      const contourColor = this.targetData.state === 'confirmed' ? 0x43e58b : 0xf5b942;
      let edgeGeometry = null;
      if (vertexCount <= 20000) {
        edgeGeometry = new THREE.EdgesGeometry(object.geometry, 38);
      }
      const edgeSegmentCount = edgeGeometry?.attributes?.position?.count / 2 || 0;
      if (edgeGeometry && edgeSegmentCount <= 220) {
        const contourMaterial = new THREE.LineBasicMaterial({
          color: contourColor,
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
          toneMapped: false
        });
        this.targetContour = new THREE.LineSegments(edgeGeometry, contourMaterial);
        this.targetContourOwnsGeometry = true;
      } else {
        edgeGeometry?.dispose();
        const contourMaterial = new THREE.MeshBasicMaterial({
          color: contourColor,
          transparent: true,
          opacity: 0,
          side: THREE.BackSide,
          depthTest: true,
          depthWrite: false,
          toneMapped: false
        });
        this.targetContour = new THREE.Mesh(object.geometry, contourMaterial);
        this.targetContour.scale.setScalar(1.018);
        this.targetContourOwnsGeometry = false;
      }
      this.targetContour.name = 'MXGeniusTargetContour';
      this.targetContour.renderOrder = 1001;
      object.add(this.targetContour);
    }
    this.refreshTargetLayout();
    if (this.presentationTarget > 0) this.announceTarget();
    return true;
  }

  announceTarget() {
    if (!this.targetObject || !this.targetData) return;
    this.onSound?.(this.targetData.state === 'confirmed' ? 'spatial_confirm' : 'spatial_candidate', {
      object: this.targetObject,
      actionId: `hud-target-${this.targetData.state}`
    });
  }

  releaseTargetContour() {
    if (!this.targetContour) return;
    this.targetContour.removeFromParent();
    if (this.targetContourOwnsGeometry) this.targetContour.geometry.dispose();
    this.targetContour.material.dispose();
    this.targetContour = null;
    this.targetContourOwnsGeometry = false;
  }

  clearTarget({ forget = false } = {}) {
    this.targetVisibilityTarget = 0;
    this.forgetTargetPending ||= Boolean(forget);
    this.setFocusedObject(null, { sound: false });
  }

  finalizeTargetClear() {
    if (!this.forgetTargetPending) return;
    this.releaseTargetContour();
    this.targetObject = null;
    this.targetData = null;
    this.forgetTargetPending = false;
    this.provenanceExpanded = false;
    this.setWorkflowStage(0);
    this.detailPanel.redraw();
    this.evidencePanel.redraw();
  }

  refreshTargetLayout(camera) {
    if (!this.targetObject) return;
    tempBox.setFromObject(this.targetObject);
    if (tempBox.isEmpty()) return;
    const center = tempBox.getCenter(new THREE.Vector3());
    const size = tempBox.getSize(new THREE.Vector3());
    this.annotationGroup.position.copy(center);
    if (camera) {
      camera.getWorldQuaternion(tempQuaternion);
      this.annotationGroup.quaternion.copy(tempQuaternion);
    }
    const frameWidth = THREE.MathUtils.clamp(Math.max(size.x, size.z) * 1.12, 0.24, 0.78);
    const frameHeight = THREE.MathUtils.clamp(size.y * 1.16, 0.2, 0.62);
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;
    if (Math.abs((this.lastFrameWidth || 0) - frameWidth) > 0.001 || Math.abs((this.lastFrameHeight || 0) - frameHeight) > 0.001) {
      this.corners.geometry.dispose();
      this.corners.geometry = createCornerGeometry(frameWidth, frameHeight);
      this.outline.geometry.dispose();
      this.outline.geometry = createOutlineGeometry(frameWidth, frameHeight);
      this.outline.computeLineDistances();
      this.lastFrameWidth = frameWidth;
      this.lastFrameHeight = frameHeight;
    }
    const leaderStart = frameWidth / 2;
    const leaderLength = 0.2;
    this.leader.position.set(leaderStart, frameHeight * 0.12, 0.006);
    this.leader.userData.fullLength = leaderLength;
    this.detailPanel.mesh.position.set(leaderStart + leaderLength, frameHeight * 0.12, 0.012);
  }

  restartReveal() {
    if (!this.targetObject) return false;
    this.targetVisibilityTarget = 1;
    this.annotationGroup.visible = true;
    this.revealTime = 0;
    return true;
  }

  toggleProvenance() {
    this.provenanceExpanded = !this.provenanceExpanded;
    this.evidencePanel.redraw();
    return this.provenanceExpanded;
  }

  emit(action, input, target = {}) {
    this.onAction?.(action, input, {
      actionId: `hud-${action}`,
      component: this.targetData?.label || null,
      ...target
    });
  }

  setFocusedObject(object, { sound = true } = {}) {
    let node = object;
    while (node && !node.userData?.xrHudAction && node !== this.group) node = node.parent;
    const next = node?.userData?.xrHudAction ? node : null;
    if (next === this.focusedObject) return false;
    this.focusedObject = next;
    if (next && sound) this.onSound?.('ui_focus_soft', { actionId: `hud-focus-${next.userData.xrHudAction}` });
    return true;
  }

  handleObject(object, input = 'unknown') {
    let node = object;
    while (node) {
      const action = node.userData?.xrHudAction;
      if (action) {
        if (action === 'why' && !this.targetData) return true;
        this.pressedObject = node;
        this.pressTime = 0.14;
        if (action === 'acquire') this.restartReveal();
        else if (action === 'clear') this.clearTarget();
        else if (action === 'why') this.toggleProvenance();
        else if (action === 'inspect') this.setWorkflowStage(1);
        else if (action === 'compare') this.setWorkflowStage(2);
        else if (action === 'capture') this.setWorkflowStage(3);
        const cue = HUD_ACTION_CUES[action];
        if (cue) this.onSound?.(cue, {
          object: cue.startsWith('spatial_') ? this.targetObject : null,
          actionId: `hud-${action}`
        });
        this.emit(action, input, { provenanceExpanded: this.provenanceExpanded });
        return true;
      }
      if (node === this.group) break;
      node = node.parent;
    }
    return false;
  }

  fingerTargetAt(worldPoint) {
    if (!this.group.visible) return null;
    for (const target of this.interactives) {
      this.bounds.setFromObject(target).expandByScalar(0.012);
      if (this.bounds.containsPoint(worldPoint)) return target;
    }
    return null;
  }

  interactiveObjects() {
    return this.group.visible ? this.interactives : [];
  }

  update(delta = 1 / 60, time = 0, { camera } = {}) {
    const safeDelta = Math.max(0, delta);
    const blend = 1 - Math.exp(-10 * safeDelta);
    this.pressTime = Math.max(0, this.pressTime - safeDelta);
    if (this.pressTime === 0) this.pressedObject = null;
    this.interactives.forEach((object) => {
      const isPressed = object === this.pressedObject;
      const isFocused = object === this.focusedObject;
      const targetScale = isPressed ? 0.92 : isFocused ? 1.045 : 1;
      const next = THREE.MathUtils.lerp(object.scale.x, targetScale, blend);
      object.scale.setScalar(next);
    });
    const currentScale = this.group.scale.x;
    const nextScale = THREE.MathUtils.lerp(currentScale, this.presentationTarget, blend);
    this.group.scale.setScalar(Math.max(0.001, nextScale));
    if (this.presentationTarget === 0 && nextScale < 0.012) this.group.visible = false;
    if (this.preview && camera) this.placeForView(camera);
    else if (this.placementPending && camera) this.placeForView(camera);

    const targetBlend = 1 - Math.exp(-12 * safeDelta);
    const effectiveTargetVisibility = this.targetVisibilityTarget * this.presentationTarget;
    if (effectiveTargetVisibility > 0) this.annotationGroup.visible = true;
    this.targetVisibility = THREE.MathUtils.lerp(this.targetVisibility, effectiveTargetVisibility, targetBlend);
    if (this.targetContour) this.targetContour.material.opacity = this.targetVisibility;
    this.annotationGroup.scale.setScalar(Math.max(0.001, this.targetVisibility));
    if (effectiveTargetVisibility === 0 && this.targetVisibility < 0.012) {
      this.annotationGroup.visible = false;
      this.finalizeTargetClear();
    }
    if (!this.annotationGroup.visible || !this.targetObject) return;

    this.refreshTargetLayout(camera);
    this.revealTime = Math.min(this.revealDuration, this.revealTime + safeDelta);
    const progress = clamp01(this.revealTime / this.revealDuration);
    const brackets = windowedProgress(progress, 0, 0.28);
    const outline = windowedProgress(progress, 0.18, 0.5);
    const leader = windowedProgress(progress, 0.42, 0.72);
    const card = windowedProgress(progress, 0.62, 0.9);
    const effect = windowedProgress(progress, 0.84, 1);

    this.cornerMaterial.opacity = brackets;
    this.corners.scale.setScalar(1.18 - brackets * 0.18);
    this.outlineMaterial.opacity = outline * 0.92;
    if (this.targetContour) this.targetContour.material.opacity = outline * 0.72 * this.targetVisibility;
    this.leader.material.opacity = leader;
    this.leader.scale.x = Math.max(0.001, (this.leader.userData.fullLength || 0.16) * leader);
    this.detailPanel.mesh.scale.set(Math.max(0.001, card), 0.88 + card * 0.12, 1);
    this.detailPanel.mesh.material.opacity = card;
    this.effectRing.scale.setScalar(1 + effect * 1.8);
    this.effectMaterial.opacity = this.reducedMotion ? 0 : Math.sin(effect * Math.PI) * 0.72;

    const provenanceTarget = this.provenanceExpanded ? 1 : 0.82;
    const provenanceScale = THREE.MathUtils.lerp(this.provenancePanel.mesh.scale.x, provenanceTarget, blend);
    this.provenancePanel.mesh.scale.setScalar(provenanceScale);
    this.provenancePanel.mesh.material.opacity = this.provenanceExpanded ? 1 : 0.72;
  }
}
