import {
  BufferAttribute,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { bestText, CFG, gridSize, tileRects } from './config.js';
import { pickTile } from './gaze.js';
import { ART_LAYOUT, paintTile } from './tile-art.js';

const RING_THICKNESS = 0.0035;
const REST_COLOR = new Color(0.8, 0.8, 0.8); // tiles rest slightly dim, so the one you look at lifts
const FOCUS_COLOR = new Color(1, 1, 1);
const DIM_COLOR = new Color(0.12, 0.12, 0.12); // the others, once a game is opening
const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';

function roundedRect(w, h, r) {
  const [x, y] = [-w / 2, -h / 2];
  const shape = new Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const geo = new ShapeGeometry(shape, 6);
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - x) / w;
    uv[i * 2 + 1] = (pos.getY(i) - y) / h;
  }
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  return geo;
}

function texture(canvas, renderer) {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  if (renderer) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

class SportTile {
  constructor(game, rect, renderer) {
    this.game = game;
    this.rect = rect;
    this.layout = ART_LAYOUT[game.art];
    this.focus = 0; // 0..1, eased
    this.wantFocus = false;
    this.dimmed = false;

    this.material = new MeshBasicMaterial({
      map: texture(paintTile(game.art, rect.w / rect.h), renderer),
      toneMapped: false,
      color: REST_COLOR,
    });
    this.mesh = new Mesh(roundedRect(rect.w, rect.h, CFG.grid.cornerR), this.material);
    this.mesh.position.set(rect.x, rect.y, 0);
    this.mesh.userData.gameId = game.id;
    this.label = this.buildLabel(renderer);
    this.mesh.add(this.label);
  }

  // The tiles carry no text at rest. The name fades in on the one you are looking at.
  buildLabel(renderer) {
    const best = bestText(this.game);
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 200;
    const g = canvas.getContext('2d');
    const right = this.layout.labelSide === 'right';
    g.textAlign = right ? 'right' : 'left';
    g.textBaseline = 'alphabetic';
    const x = right ? canvas.width - 8 : 8;
    g.shadowColor = 'rgba(0,0,0,0.85)';
    g.shadowBlur = 16;
    g.fillStyle = '#ffffff';
    g.font = `600 60px ${FONT}`;
    g.fillText(this.game.title, x, best ? 122 : 186);
    if (best) {
      g.fillStyle = '#d4d8d6';
      g.font = `500 46px ${FONT}`;
      g.fillText(best, x, 186);
    }
    const w = 0.24;
    const h = (w * canvas.height) / canvas.width;
    const inset = 0.016;
    this.labelMaterial = new MeshBasicMaterial({
      map: texture(canvas, renderer),
      transparent: true,
      opacity: 0,
      toneMapped: false,
      depthWrite: false,
    });
    const label = new Mesh(new PlaneGeometry(w, h), this.labelMaterial);
    const sign = right ? 1 : -1;
    label.position.set(sign * (this.rect.w / 2 - inset - w / 2), -(this.rect.h / 2 - inset - h / 2), 0.002);
    return label;
  }

  ringCentre() {
    return {
      x: this.rect.x + (this.layout.ringX - 0.5) * this.rect.w,
      y: this.rect.y - (this.layout.ringY - 0.5) * this.rect.h,
    };
  }

  update(dt) {
    this.focus += ((this.wantFocus ? 1 : 0) - this.focus) * (1 - Math.exp(-14 * dt));
    const k = this.focus;
    this.mesh.scale.setScalar(1 + 0.006 * k);
    this.mesh.position.z = 0.006 * k;
    const target = this.dimmed ? DIM_COLOR : REST_COLOR;
    this.material.color.copy(target).lerp(FOCUS_COLOR, this.dimmed ? 0 : k);
    this.labelMaterial.opacity = this.dimmed ? 0 : k;
  }
}

// The white ring: one ring that glides to the tile you are looking at, so the eye follows it instead of
// hunting for where it reappeared.
class GazeRing {
  constructor() {
    const radius = CFG.grid.tileH / 2 - 0.004;
    this.material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: DoubleSide,
      toneMapped: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(new RingGeometry(radius - RING_THICKNESS, radius, 96), this.material);
    this.mesh.position.z = 0.02;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.want = new Vector3(0, 0, 0.02);
    this.opacity = 0;
    this.closing = 0;
  }

  update(dt, tile) {
    const show = !!tile;
    if (tile) {
      const c = tile.ringCentre();
      this.want.set(c.x, c.y, 0.02);
      if (this.opacity < 0.02) this.mesh.position.copy(this.want); // appearing: no slide in from the old tile
    }
    this.mesh.position.lerp(this.want, 1 - Math.exp(-22 * dt));
    this.opacity += ((show ? 1 : 0) - this.opacity) * (1 - Math.exp(-16 * dt));
    this.material.opacity = this.opacity;
    this.mesh.visible = this.opacity > 0.01;
    this.mesh.scale.setScalar(1 - 0.2 * this.closing);
  }
}

export class TileGrid {
  constructor(world) {
    this.root = new Group();
    this.rects = tileRects();
    this.size = gridSize();
    const renderer = world.renderer;
    this.tiles = CFG.games.map((game, i) => new SportTile(game, this.rects[i], renderer));
    for (const t of this.tiles) this.root.add(t.mesh);
    this.ring = new GazeRing();
    this.root.add(this.ring.mesh);
    this.focused = -1;
    this.o = new Vector3();
    this.d = new Vector3();
    this.q = new Quaternion();
    this.placeOnDesktop();
    world.createTransformEntity(this.root);
  }

  placeOnDesktop(lift = 0) {
    this.root.position.set(0, CFG.grid.height + lift, -CFG.grid.distance);
    this.root.rotation.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
  }

  // In a headset the grid goes straight ahead of the player at eye level, seated or standing.
  placeFacing(head, forward) {
    const f = this.d.set(forward.x, 0, forward.z);
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
    f.normalize();
    this.root.position.copy(head).addScaledVector(f, CFG.grid.distance);
    this.root.rotation.set(0, Math.atan2(-f.x, -f.z), 0);
    this.root.updateMatrixWorld(true);
  }

  // Which tile does this world-space ray land on? Returns its index, or -1.
  pick(origin, dir) {
    const o = this.root.worldToLocal(this.o.copy(origin));
    this.root.getWorldQuaternion(this.q).invert();
    const d = this.d.copy(dir).applyQuaternion(this.q);
    if (d.z >= -1e-4) return -1; // pointing away from the grid
    const t = -o.z / d.z;
    return pickTile(o.x + d.x * t, o.y + d.y * t, this.rects, this.focused, CFG.grid.gap, CFG.grid.stickiness);
  }

  setFocus(index) {
    this.focused = index;
    this.tiles.forEach((t, i) => {
      t.wantFocus = i === index;
    });
  }

  beginLaunch(index) {
    this.setFocus(index);
    this.tiles.forEach((t, i) => {
      t.dimmed = i !== index;
    });
  }

  update(dt, launchProgress = 0) {
    for (const t of this.tiles) t.update(dt);
    this.ring.closing = launchProgress;
    this.ring.update(dt, this.tiles[this.focused] || null);
  }
}
