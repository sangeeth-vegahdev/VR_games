import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { gridSize } from './config.js';

// First-visit guide: one line above the grid that changes when the player has done what it asked. Remembered
// once a game has been opened. `?guide=0` turns it off, `?guide=1` forces it (tests).

const KEY = 'vr-hub-guide-seen';
const param = new URLSearchParams(globalThis.location?.search ?? '').get('guide');

function seenBefore() {
  if (param === '0') return true;
  if (param === '1') return false;
  try {
    return localStorage.getItem(KEY) === '1';
  } catch (e) {
    return false;
  }
}

export const GUIDE_TEXT = {
  desktop: 'Point at a sport. Click.',
  look: 'Look at a sport.',
  pinch: 'Pinch. That is the tap.',
};

export function guideStep(inXR, hasFocus) {
  if (!inXR) return 'desktop';
  return hasFocus ? 'pinch' : 'look';
}

export class LobbyGuide {
  constructor(parent) {
    this.active = !seenBefore();
    this.step = null;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 96;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const w = 0.62;
    const h = (w * this.canvas.height) / this.canvas.width;
    this.panel = new Mesh(
      new PlaneGeometry(w, h),
      new MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthWrite: false }),
    );
    this.panel.position.set(0, gridSize().h / 2 + h / 2 + 0.004, 0);
    this.panel.visible = false;
    parent.add(this.panel);
  }

  draw(text) {
    const { canvas } = this;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#ffffff';
    g.font = '600 58px "Segoe UI", system-ui, -apple-system, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, canvas.width / 2, canvas.height / 2);
    this.texture.needsUpdate = true;
  }

  update(inXR, hasFocus) {
    this.panel.visible = this.active;
    if (!this.active) return;
    const step = guideStep(inXR, hasFocus);
    if (step !== this.step) {
      this.step = step;
      this.draw(GUIDE_TEXT[step]);
    }
  }

  // A game was opened: the guide has done its job.
  complete() {
    if (!this.active) return;
    this.active = false;
    this.panel.visible = false;
    try {
      localStorage.setItem(KEY, '1');
    } catch (e) {
      /* not saved: the guide just shows again next time */
    }
  }
}
