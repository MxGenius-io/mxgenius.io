import * as THREE from 'three';

function safeMediaUrl(value) {
  try {
    const url = new URL(String(value || ''), window.location.href);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')) return url.href;
  } catch { /* invalid or absent URL */ }
  return '';
}

function cleanSelector(selector) {
  if (!selector || typeof selector !== 'object') return null;
  const meshName = String(selector.meshName || '').trim();
  const path = String(selector.path || '').trim();
  return meshName || path ? { ...(meshName ? { meshName } : {}), ...(path ? { path } : {}) } : null;
}

export class XRMediaPanel {
  constructor({ video, onAction, onMeshSelector }) {
    this.video = video;
    this.onAction = onAction;
    this.onMeshSelector = onMeshSelector;
    this.definition = null;
    this.activeCueIndex = -1;
    this.presentationTarget = 0;
    this.bounds = new THREE.Box3();

    this.group = new THREE.Group();
    this.group.name = 'MXGeniusProcedureMedia';
    this.group.position.set(0.78, 1.48, -1.35);
    this.group.rotation.y = -0.28;
    this.group.visible = false;
    this.group.scale.setScalar(0.001);

    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(0.82, 0.56),
      new THREE.MeshBasicMaterial({ color: 0x07111f, transparent: true, opacity: 0.94, side: THREE.DoubleSide })
    );
    back.position.z = -0.012;
    this.group.add(back);

    this.texture = new THREE.VideoTexture(video);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.76, 0.4275),
      new THREE.MeshBasicMaterial({ map: this.texture, color: 0xffffff, toneMapped: false, side: THREE.DoubleSide })
    );
    this.screen.position.y = 0.035;
    this.screen.userData.xrMediaAction = 'toggle-playback';
    this.group.add(this.screen);

    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 1024;
    this.labelCanvas.height = 128;
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTexture.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.76, 0.095),
      new THREE.MeshBasicMaterial({ map: this.labelTexture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    );
    this.label.position.y = -0.225;
    this.label.userData.xrMediaAction = 'toggle-playback';
    this.group.add(this.label);

    this.video.addEventListener('play', () => this.updateLabel());
    this.video.addEventListener('pause', () => this.updateLabel());
    this.video.addEventListener('ended', () => {
      this.activeCueIndex = -1;
      this.updateLabel();
      this.emit('tutorial-ended', 'media');
    });
    this.updateLabel();
  }

  configure(definition) {
    const mediaUrl = safeMediaUrl(definition?.mediaUrl);
    if (!mediaUrl) {
      this.clear();
      return false;
    }

    const cues = Array.isArray(definition.cues)
      ? definition.cues.map((cue) => ({
          time: Math.max(0, Number(cue?.time) || 0),
          meshSelector: cleanSelector(cue?.meshSelector),
          label: String(cue?.label || '').trim()
        })).filter((cue) => cue.meshSelector).sort((a, b) => a.time - b.time)
      : [];

    this.definition = {
      id: String(definition.id || 'procedure-media'),
      title: String(definition.title || 'Procedure media').trim().slice(0, 120),
      mediaUrl,
      meshSelector: cleanSelector(definition.meshSelector),
      cues
    };
    this.activeCueIndex = -1;
    this.video.pause();
    this.video.src = mediaUrl;
    this.video.load();
    this.updateLabel();
    return true;
  }

  clear() {
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.definition = null;
    this.activeCueIndex = -1;
    this.group.visible = false;
    this.updateLabel();
  }

  setPresenting(presenting) {
    const shouldShow = Boolean(presenting && this.definition);
    this.presentationTarget = shouldShow ? 1 : 0;
    if (shouldShow) this.group.visible = true;
    if (!shouldShow) this.video.pause();
  }

  async toggle(input = 'unknown') {
    if (!this.definition) return false;
    if (this.video.paused) {
      try {
        await this.video.play();
        if (this.definition.meshSelector) this.onMeshSelector?.(this.definition.meshSelector);
        this.emit('tutorial-play', input);
      } catch (error) {
        this.emit('tutorial-playback-blocked', input, { reason: error?.name || 'playback-failed' });
      }
    } else {
      this.video.pause();
      this.emit('tutorial-pause', input);
    }
    this.updateLabel();
    return true;
  }

  emit(action, input, extra = {}) {
    this.onAction?.(action, input, {
      tutorialId: this.definition?.id || null,
      title: this.definition?.title || 'Procedure media',
      currentTime: Number(this.video.currentTime) || 0,
      ...extra
    });
  }

  update(delta = 1 / 60) {
    const currentScale = this.group.scale.x;
    const blend = 1 - Math.exp(-12 * Math.max(0, delta));
    const nextScale = THREE.MathUtils.lerp(currentScale, this.presentationTarget, blend);
    this.group.scale.setScalar(Math.max(0.001, nextScale));
    if (this.presentationTarget === 0 && nextScale < 0.012) this.group.visible = false;
    if (!this.definition || this.video.paused || !this.definition.cues.length) return;
    let cueIndex = -1;
    for (let index = 0; index < this.definition.cues.length; index += 1) {
      if (this.video.currentTime >= this.definition.cues[index].time) cueIndex = index;
      else break;
    }
    if (cueIndex < 0 || cueIndex === this.activeCueIndex) return;
    this.activeCueIndex = cueIndex;
    const cue = this.definition.cues[cueIndex];
    this.onMeshSelector?.(cue.meshSelector);
    this.emit('tutorial-cue', 'timeline', { cueIndex, cueLabel: cue.label || null, meshSelector: cue.meshSelector });
  }

  handleObject(object, input) {
    let node = object;
    while (node && node !== this.group) {
      if (node.userData?.xrMediaAction === 'toggle-playback') {
        this.toggle(input);
        return true;
      }
      node = node.parent;
    }
    return false;
  }

  fingerTargetAt(worldPoint) {
    if (!this.group.visible) return null;
    for (const target of [this.screen, this.label]) {
      this.bounds.setFromObject(target).expandByScalar(0.018);
      if (this.bounds.containsPoint(worldPoint)) return target;
    }
    return null;
  }

  interactiveObjects() {
    return this.group.visible ? [this.screen, this.label] : [];
  }

  updateLabel() {
    const context = this.labelCanvas.getContext('2d');
    context.clearRect(0, 0, this.labelCanvas.width, this.labelCanvas.height);
    context.fillStyle = '#07111f';
    context.fillRect(0, 0, this.labelCanvas.width, this.labelCanvas.height);
    context.fillStyle = '#67e8f9';
    context.font = '600 36px system-ui, sans-serif';
    context.fillText(this.video.paused ? 'SELECT TO PLAY' : 'SELECT TO PAUSE', 32, 50);
    context.fillStyle = '#e8f4ff';
    context.font = '32px system-ui, sans-serif';
    context.fillText((this.definition?.title || 'No procedure media linked').slice(0, 56), 32, 98);
    this.labelTexture.needsUpdate = true;
  }
}
