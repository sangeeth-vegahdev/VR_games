import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Hovered,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshMatcapMaterial,
  PlaneGeometry,
  PokeInteractable,
  Pressed,
  Quaternion,
  RayInteractable,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TubeGeometry,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import { Bulb, UiButton } from './bulb-components.js';
import { CFG, COLORS } from './config.js';

// The wall of bulbs: four curved rows of hanging Edison bulbs around the player's head, inside arm's
// reach, plus the buttons below it. Everything lives in one group (the "rig") that the game moves to
// wherever the player is sitting.
//
// Each bulb is one ECS entity that is both ray-interactable (pinch ray, gaze, controller ray, mouse) and
// poke-interactable (a fingertip pressing into it), so every way of touching works without extra code.
// What you see is drawn by five instanced meshes (glass, filament, its mount, cap and socket, the pool of
// light on the board), so the 38 bulbs cost five draw calls.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function glowTexture() {
  return canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

function crossTexture() {
  return canvasTexture(128, (g, s) => {
    g.strokeStyle = '#ffffff';
    g.lineWidth = s * 0.14;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(s * 0.26, s * 0.26);
    g.lineTo(s * 0.74, s * 0.74);
    g.moveTo(s * 0.74, s * 0.26);
    g.lineTo(s * 0.26, s * 0.74);
    g.stroke();
  });
}

// Gold bulbs carry a star, so the three bulb types differ by shape as well as colour.
function starTexture() {
  return canvasTexture(128, (g, s) => {
    g.fillStyle = '#ffffff';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = (i % 2 ? 0.17 : 0.4) * s;
      g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  });
}

// A look-up image for clear glass: see-through in the middle, bright at the very edge, and the reflection
// of a tall window on one shoulder.
function glassMatcap() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, s, s);
    const rim = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
    rim.addColorStop(0, 'rgb(14,14,14)');
    rim.addColorStop(0.72, 'rgb(38,38,38)');
    rim.addColorStop(0.92, 'rgb(190,190,190)');
    rim.addColorStop(1, 'rgb(255,255,255)');
    g.fillStyle = rim;
    g.beginPath();
    g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.translate(s * 0.31, s * 0.32);
    g.rotate(-0.42);
    const hi = g.createLinearGradient(0, -s * 0.13, 0, s * 0.13);
    hi.addColorStop(0, 'rgba(255,255,255,0)');
    hi.addColorStop(0.2, 'rgba(255,255,255,0.9)');
    hi.addColorStop(0.8, 'rgba(255,255,255,0.75)');
    hi.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hi;
    g.beginPath();
    g.roundRect(-s * 0.035, -s * 0.13, s * 0.07, s * 0.26, s * 0.03);
    g.fill();
    g.restore();
    // A small second glint low on the other side.
    const lo = g.createRadialGradient(s * 0.67, s * 0.72, 0, s * 0.67, s * 0.72, s * 0.09);
    lo.addColorStop(0, 'rgba(255,255,255,0.35)');
    lo.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lo;
    g.fillRect(0, 0, s, s);
  });
}

function brassMatcap() {
  return canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s * 0.42, s * 0.34, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, '#fff3d0');
    grad.addColorStop(0.3, '#d8ae68');
    grad.addColorStop(0.75, '#6e4c22');
    grad.addColorStop(1, '#241808');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

// Shapes for a bulb of radius 1, hanging with its cap up and the centre of the glass at the origin.
function glassGeometry() {
  const pts = [];
  for (let i = 0; i <= 11; i++) {
    const a = -Math.PI / 2 + (i / 11) * (Math.PI * 0.62);
    pts.push(new Vector2(Math.max(0.001, Math.cos(a)), Math.sin(a)));
  }
  pts.push(new Vector2(0.64, 1.0), new Vector2(0.52, 1.2), new Vector2(0.46, 1.4));
  return new LatheGeometry(pts, 18);
}

// The brass screw base and the black socket above it, in one shape with a colour per vertex.
function capGeometry() {
  const pts = [new Vector2(0.44, 1.36)];
  for (let i = 0; i < 2; i++) {
    const y = 1.4 + i * 0.14;
    pts.push(new Vector2(0.5, y), new Vector2(0.44, y + 0.07));
  }
  pts.push(new Vector2(0.44, 1.68), new Vector2(0.58, 1.69), new Vector2(0.6, 1.72), new Vector2(0.56, 1.9), new Vector2(0.3, 1.95), new Vector2(0.001, 1.96));
  const geo = new LatheGeometry(pts, 14);
  const p = geo.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = p.getY(i) > 1.685 ? 0.13 : 1;
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new BufferAttribute(c, 3));
  return geo;
}

// A real coil: a tight spiral strung between the two support wires, sagging a little in the middle.
function filamentGeometry() {
  const turns = 5;
  const n = turns * 8;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = u * turns * Math.PI * 2;
    pts.push(new Vector3(-0.36 + 0.72 * u, 0.2 - 0.09 * Math.sin(Math.PI * u) + Math.cos(a) * 0.055, Math.sin(a) * 0.055));
  }
  return new TubeGeometry(new CatmullRomCurve3(pts), n + 12, 0.017, 3, false);
}

// The glass stem in the neck and the two wires that hold the filament up.
function mountGeometry() {
  const wire = (x) => new TubeGeometry(new CatmullRomCurve3([new Vector3(x * 0.25, 1.05, 0), new Vector3(x * 0.6, 0.6, 0), new Vector3(x, 0.2, 0)]), 8, 0.02, 4, false);
  const stem = new CylinderGeometry(0.1, 0.2, 0.42, 8);
  stem.translate(0, 1.2, 0);
  return mergeSimple([wire(-0.36), wire(0.36), stem]);
}

// Joins simple indexed shapes into one.
function mergeSimple(list) {
  const pos = [];
  const nor = [];
  const idx = [];
  let base = 0;
  for (const g of list) {
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    for (const v of g.index.array) idx.push(v + base);
    base += g.attributes.position.count;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  out.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  out.setIndex(idx);
  return out;
}

// The board behind the bulbs: dark brushed metal, the second row picked out (as in the sketch).
function backingTexture() {
  const t = canvasTexture(256, (g, s) => {
    const base = g.createLinearGradient(0, 0, 0, s);
    base.addColorStop(0, '#0d1022');
    base.addColorStop(1, '#090b18');
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.018})`;
      g.fillRect(Math.random() * s, Math.random() * s, 30 + Math.random() * 90, 1);
    }
    const y = (v) => s * ((CFG.boardTop - v) / (CFG.boardTop - CFG.boardBase));
    const r1 = CFG.rowPitch * 0.5;
    const hi = g.createLinearGradient(0, y(r1 + 0.0505), 0, y(r1 - 0.0445));
    hi.addColorStop(0, 'rgba(45,90,220,0.22)');
    hi.addColorStop(1, 'rgba(45,90,220,0.1)');
    g.fillStyle = hi;
    g.fillRect(0, y(r1 + 0.0505), s, y(r1 - 0.0445) - y(r1 + 0.0505));
  });
  return t;
}

// A button drawn on a canvas: rounded, glowing outline, centred label.
class Button {
  constructor(label, w, h, accent) {
    this.w = w;
    this.h = h;
    this.accent = accent;
    this.label = label;
    this.selected = false;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(w * 2400);
    this.canvas.height = Math.round(h * 2400);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.mesh = new Mesh(
      new PlaneGeometry(w, h),
      new MeshBasicMaterial({ map: this.texture, transparent: true, side: DoubleSide, depthWrite: false }),
    );
    this.draw();
  }

  draw() {
    const { canvas } = this;
    const g = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    g.clearRect(0, 0, W, H);
    const r = H * 0.5;
    g.beginPath();
    g.roundRect(8, 8, W - 16, H - 16, r - 8);
    g.fillStyle = this.selected ? this.accent : 'rgba(14, 18, 40, 0.92)';
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = this.accent;
    g.stroke();
    g.fillStyle = this.selected ? '#06101c' : '#f4f7ff';
    g.font = `800 ${Math.round(H * 0.42)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(this.label, W / 2, H / 2 + H * 0.03, W * 0.88);
    this.texture.needsUpdate = true;
  }

  set(label, selected) {
    if (label === this.label && selected === this.selected) return;
    this.label = label;
    this.selected = selected;
    this.draw();
  }
}

export class Board {
  constructor(world) {
    this.world = world;
    this.rig = new Group();
    this.rigEntity = world.createTransformEntity(this.rig);

    this.glow = glowTexture();
    this.cross = crossTexture();
    this.star = starTexture();
    this.tmpColor = new Color();
    this.glassColor = new Color();
    this.filColor = new Color();
    this.white = new Color(0xffffff);
    this.cyan = new Color(COLORS.target);
    this.tmpV = new Vector3();
    this.tmpM = new Matrix4();
    this.tmpQ = new Quaternion();
    this.tmpS = new Vector3();
    this.tmpP = new Vector3();
    this.clearGlass = new Color(0.32, 0.34, 0.38);
    this.yAxis = new Vector3(0, 1, 0);

    // Shared geometry and materials.
    this.ringGeo = new RingGeometry(0.95, 1, 64);
    this.haloGeo = new PlaneGeometry(1, 1);
    this.hitGeo = new SphereGeometry(1, 8, 6);
    this.hitMat = new MeshBasicMaterial({ visible: false });
    this.decalGeo = new PlaneGeometry(1.15, 1.15);

    this.bulbs = [];
    this.buttons = {};
    this.buttonsVisible = true;
    this.buildFrame();
    this.buildBulbs();
    this.buildButtons();
  }

  // ---------- construction ----------
  buildFrame() {
    const R = CFG.boardRadius;
    const arcW = CFG.bulbPitch * CFG.rows[0]; // all rows share the width of the 9-bulb row
    const half = (arcW / 2 + 0.01) / R;
    this.half = half;
    const rows = CFG.rows.length;
    const top = CFG.boardTop;
    const bottom = CFG.boardBase;
    const back = new Mesh(
      new CylinderGeometry(R + 0.05, R + 0.05, top - bottom, 48, 1, true, Math.PI - half, half * 2),
      new MeshBasicMaterial({ map: backingTexture(), side: DoubleSide }),
    );
    back.position.y = (top + bottom) / 2;
    this.rig.add(back);

    const arc = (y, mat, tube) => {
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const a = -half + (half * 2 * i) / 40;
        pts.push(new Vector3(Math.sin(a) * R, y, -Math.cos(a) * R));
      }
      this.rig.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 48, tube, 6, false), mat));
    };
    // A clean neon frame at the same depth as the glass, so no line ever passes behind a bulb.
    const neon = new MeshBasicMaterial({ color: 0x35f2ff });
    arc(top, neon, 0.0028);
    arc(bottom, neon, 0.0028);
    for (const a of [-half, half]) {
      const side = new Mesh(new CylinderGeometry(0.0028, 0.0028, top - bottom, 6), neon);
      side.position.set(Math.sin(a) * R, (top + bottom) / 2, -Math.cos(a) * R);
      this.rig.add(side);
    }
    // A black cable along each row for the bulbs to hang from.
    const cable = new MeshBasicMaterial({ color: 0x1b1e2a });
    for (let r = 0; r < rows; r++) {
      const y = ((rows - 1) / 2 - r) * CFG.rowPitch;
      const scale = Math.min(1, arcW / CFG.rows[r] / CFG.bulbPitch);
      arc(y + CFG.bulbRadius * scale * 1.95, cable, 0.0016);
    }
  }

  buildBulbs() {
    const R = CFG.boardRadius;
    const arcW = CFG.bulbPitch * CFG.rows[0];
    const rows = CFG.rows.length;
    const total = CFG.rows.reduce((a, b) => a + b, 0);

    this.glassMesh = new InstancedMesh(
      glassGeometry(),
      new MeshMatcapMaterial({ matcap: glassMatcap(), transparent: true, blending: AdditiveBlending, depthWrite: false }),
      total,
    );
    this.glassMesh.renderOrder = 2;
    this.filMesh = new InstancedMesh(filamentGeometry(), new MeshBasicMaterial({ color: 0xffffff }), total);
    this.mountMesh = new InstancedMesh(mountGeometry(), new MeshBasicMaterial({ color: 0x4c5060 }), total);
    this.capMesh = new InstancedMesh(capGeometry(), new MeshMatcapMaterial({ matcap: brassMatcap(), vertexColors: true }), total);
    // The pool of light each bulb throws on the board behind it.
    this.wallMesh = new InstancedMesh(
      this.haloGeo,
      new MeshBasicMaterial({ map: this.glow, transparent: true, blending: AdditiveBlending, depthWrite: false }),
      total,
    );
    this.wallMesh.renderOrder = 1;
    for (const m of [this.glassMesh, this.filMesh, this.mountMesh, this.capMesh, this.wallMesh]) {
      m.frustumCulled = false;
      this.rig.add(m);
    }

    let index = 0;
    for (let r = 0; r < rows; r++) {
      const n = CFG.rows[r];
      const pitch = arcW / n;
      const scale = Math.min(1, pitch / CFG.bulbPitch); // the 11-bulb row has smaller bulbs
      const radius = CFG.bulbRadius * scale;
      const y = ((rows - 1) / 2 - r) * CFG.rowPitch;
      for (let c = 0; c < n; c++) {
        const theta = ((c - (n - 1) / 2) * pitch) / R;
        const node = new Group();
        node.position.set(Math.sin(theta) * R, y, -Math.cos(theta) * R);
        node.rotation.y = -theta; // face the player
        this.rig.add(node);

        const haloMat = new MeshBasicMaterial({
          map: this.glow,
          color: COLORS.idle,
          transparent: true,
          opacity: 0,
          blending: AdditiveBlending,
          depthWrite: false,
        });
        const halo = new Mesh(this.haloGeo, haloMat);
        halo.scale.setScalar(radius * 5);
        halo.position.z = radius * 0.95;
        halo.renderOrder = 5;
        node.add(halo);

        const ringMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false });
        const ring = new Mesh(this.ringGeo, ringMat);
        ring.position.z = radius * 0.9;
        ring.renderOrder = 6;
        ring.visible = false;
        node.add(ring);

        const decalMat = new MeshBasicMaterial({ map: this.cross, color: 0xffffff, transparent: true, depthWrite: false, opacity: 0.95 });
        const decal = new Mesh(this.decalGeo, decalMat);
        decal.scale.setScalar(radius * 1.25);
        decal.position.z = radius * 1.0;
        decal.renderOrder = 7;
        decal.visible = false;
        node.add(decal);

        const hit = new Mesh(this.hitGeo, this.hitMat);
        hit.scale.setScalar(CFG.hitRadius * scale);
        node.add(hit);

        const entity = this.world.createTransformEntity(node, this.rigEntity);
        entity.addComponent(Bulb, { index }).addComponent(RayInteractable).addComponent(PokeInteractable);

        this.bulbs.push({
          index,
          row: r,
          col: c,
          cols: n,
          radius,
          scale,
          node,
          halo,
          haloMat,
          ringMat,
          ring,
          decal,
          entity,
          mode: 'idle', // idle | target | gold | decoy
          surge: false,
          t0: 0, // performance.now() (ms) when it lit
          life: 1, // seconds it stays lit
          flashT: 0,
          resolvedAt: -1e9, // performance.now() (ms) when a touch, a miss or a strike last settled this bulb
          flashColor: new Color(COLORS.good),
          flashKind: '',
          flashStart: 0,
          hover: 0,
          press: 0,
          pulse: 0,
        });
        // The cap does not change colour; give glass and filament a colour slot now.
        this.glassMesh.setColorAt(index, this.white);
        this.filMesh.setColorAt(index, this.white);
        this.wallMesh.setColorAt(index, this.white);
        index++;
      }
    }
  }

  buildButtons() {
    const R = CFG.boardRadius;
    const make = (action, label, x, y, w, h, accent) => {
      const b = new Button(label, w, h, accent);
      const theta = x / R;
      const node = new Group();
      node.position.set(Math.sin(theta) * R, y, -Math.cos(theta) * R + 0.01);
      node.rotation.y = -theta;
      node.add(b.mesh);
      // A little thicker and wider than it looks, so a fingertip or a ray finds it easily.
      const pad = new Mesh(new BoxGeometry(w + 0.012, h + 0.012, 0.05), this.hitMat);
      node.add(pad);
      this.rig.add(node);
      const entity = this.world.createTransformEntity(node, this.rigEntity);
      entity.addComponent(UiButton, { action }).addComponent(RayInteractable).addComponent(PokeInteractable);
      b.node = node;
      b.entity = entity;
      b.interactive = true;
      b.press = 0;
      b.hover = 0;
      this.buttons[action] = b;
    };
    make('start', 'START', 0, -0.238, 0.26, 0.085, '#35f2ff');
    make('hearts3', '3 HEARTS', -0.25, -0.238, 0.18, 0.07, '#ff5c7c');
    make('hearts5', '5 HEARTS', 0.25, -0.238, 0.18, 0.07, '#ff5c7c');
    make('exit', 'LOBBY', 0, -0.305, 0.16, 0.042, '#38bdf8');
    make('surge', 'SURGE! OR CLAP', 0, -0.238, 0.3, 0.09, '#ff7dff');
    this.setButton('exit', false);
    this.setButton('surge', false);
  }

  // A hidden button must not catch rays or fingers either, so it stops being interactable.
  setButton(key, on) {
    const b = this.buttons[key];
    b.node.visible = on;
    if (b.interactive === on) return;
    b.interactive = on;
    // Drop any press/hover left over from the last use: a stuck Pressed tag means the next tap never
    // registers as a new press (this is what made PLAY AGAIN unresponsive).
    for (const tag of [Pressed, Hovered]) if (b.entity.hasComponent(tag)) b.entity.removeComponent(tag);
    if (on) b.entity.addComponent(RayInteractable).addComponent(PokeInteractable);
    else b.entity.removeComponent(RayInteractable).removeComponent(PokeInteractable);
  }

  // ---------- control ----------
  // Moves the whole board so it is centred on the player (x/y/z = head, yaw in radians).
  place(x, y, z, yaw) {
    this.rig.position.set(x, y, z);
    this.rig.rotation.y = yaw;
  }

  setButtonsVisible(v, inXR = false) {
    this.buttonsVisible = v;
    this.setButton('start', v);
    this.setButton('hearts3', v);
    this.setButton('hearts5', v);
    this.setButton('exit', v);
  }

  setSurgeButton(v) {
    this.setButton('surge', v);
  }

  bulbWorldPos(i, out) {
    return this.bulbs[i].node.getWorldPosition(out);
  }

  light(i, mode, life, now, surge = false) {
    const b = this.bulbs[i];
    b.mode = mode;
    b.surge = surge;
    b.t0 = now;
    b.life = life;
    b.ring.visible = mode === 'target' || mode === 'gold';
    b.decal.visible = mode === 'decoy' || mode === 'gold';
    if (b.decal.visible) {
      b.decal.material.map = mode === 'gold' ? this.star : this.cross;
      b.decal.material.opacity = 0.95;
    }
  }

  off(i) {
    const b = this.bulbs[i];
    b.mode = 'idle';
    b.surge = false;
    b.ring.visible = false;
    b.decal.visible = false;
  }

  flash(i, kind, now) {
    const b = this.bulbs[i];
    b.flashKind = kind;
    b.flashStart = now;
    b.flashT = 1;
    b.flashColor.set(kind === 'hit' ? COLORS.good : kind === 'gold' ? COLORS.gold : kind === 'surge' ? COLORS.surge : COLORS.bad);
    b.press = 1;
  }

  // Flash every bulb at once (game over, surge). Used at most once per event: nothing here strobes.
  flashAll(kind, now) {
    for (const b of this.bulbs) this.flash(b.index, kind, now);
  }

  idleBulbs(out) {
    out.length = 0;
    for (const b of this.bulbs) if (b.mode === 'idle' && b.flashT <= 0.05) out.push(b.index);
    return out;
  }

  // ---------- frame ----------
  // attract: the idle bulbs ripple (title / results). energy 0..1 brightens the idle glow in play.
  // beat 1..0 follows the music; surge is true during a surge.
  update(dt, now, nowMs, attract, energy, beat = 0, surge = false) {
    const k = 1 - Math.exp(-18 * dt);
    for (const b of this.bulbs) {
      const hovered = b.entity.hasComponent(Hovered);
      b.hover += ((hovered ? 1 : 0) - b.hover) * k;
      if (b.press > 0) b.press = Math.max(0, b.press - dt * 5);
      if (b.flashT > 0) b.flashT = Math.min(1, Math.max(0, 1 - (nowMs - b.flashStart) / 380));

      let color = COLORS.idle;
      let inten = 0.035 + 0.03 * energy + 0.015 * Math.sin(now * 1.7 + b.index) + (0.05 + 0.07 * energy) * beat;
      let halo = 0.03 + 0.06 * beat * energy;
      let scale = 1;
      let haloColor = COLORS.idle;
      const remaining = b.life - (nowMs - b.t0) / 1000;
      const frac = clamp01(remaining / b.life);

      if (surge && b.mode === 'idle') {
        // The wall hums in the surge colour, a wave rolling along the rows with the music.
        const w = Math.pow(Math.max(0, Math.sin(now * 3 - b.col * 0.6 - b.row * 0.9)), 6);
        color = COLORS.surge;
        haloColor = color;
        inten = 0.12 + 0.5 * w;
        halo = 0.05 + 0.2 * w;
      } else if (attract) {
        const isFlank = b.col <= 1 || b.col >= b.cols - 2;
        if (isFlank) {
          // Left and right flank bulbs: bright white start beacons visible beside the title card.
          const pulse = 0.5 + 0.5 * Math.sin(now * 2.8 + (b.col <= 1 ? 0 : Math.PI));
          inten = 0.95 + 0.55 * pulse;
          halo = 0.35 + 0.3 * pulse;
          color = 0xffffff;
          haloColor = COLORS.cyan;
        } else {
          const w = Math.pow(Math.max(0, Math.sin(now * 2.2 - b.col * 0.55 - b.row * 1.1)), 8);
          inten = 0.04 + 1.3 * w;
          halo = 0.04 + 0.45 * w;
          this.tmpColor.set(COLORS.idle).lerp(this.cyan, w * 0.75);
          color = this.tmpColor.getHex();
          haloColor = color;
        }
      }

      if (b.mode === 'target' || b.mode === 'gold') {
        const gold = b.mode === 'gold';
        color = gold ? COLORS.gold : b.surge ? COLORS.surge : COLORS.target;
        haloColor = color;
        // Time nearly up: a slow pulse, kept well under the 3 flashes a second that can trouble photosensitive players.
        const hurry = frac < 0.3 ? 0.5 + 0.5 * Math.sin(now * 14) : 1;
        inten = (gold ? 1.7 : 1.6) * (0.55 + 0.45 * hurry);
        halo = 0.95 * (0.5 + 0.5 * hurry);
        scale = 1.06 + 0.03 * Math.sin(now * 9);
        b.ringMat.color.setHex(color);
        b.ringMat.opacity = 0.95;
        b.ring.scale.setScalar(b.radius * (1.2 + 1.25 * frac));
      } else if (b.mode === 'decoy') {
        color = COLORS.decoy;
        haloColor = color;
        const fade = frac < 0.25 ? frac / 0.25 : 1;
        inten = (1.1 + 0.35 * Math.sin(now * 6)) * fade + 0.1;
        halo = 0.6 * fade;
        b.decal.material.opacity = 0.95 * fade;
      }

      if (b.flashT > 0) {
        const f = b.flashT;
        color = b.flashColor.getHex();
        haloColor = color;
        inten = Math.max(inten, 0.2 + 1.9 * f * f);
        halo = Math.max(halo, 0.95 * f);
        scale *= 1 + (b.flashKind === 'hit' || b.flashKind === 'gold' || b.flashKind === 'surge' ? 0.28 : 0.12) * f;
      }

      if (attract && (b.col <= 1 || b.col >= b.cols - 2)) {
        if (b.hover > 0.05) {
          b.ringMat.color.setHex(0x35f2ff);
          b.ringMat.opacity = Math.min(0.95, b.hover * 1.5);
          b.ring.scale.setScalar(b.radius * (1.2 + 0.2 * b.hover));
          b.ring.visible = true;
        } else if (b.mode === 'idle') {
          b.ring.visible = false;
        }
      }

      inten += 0.45 * b.hover;
      scale *= 1 + 0.15 * b.hover;
      scale *= 1 - 0.14 * b.press;

      // Glass: the colour, as bright as the bulb. Filament: an ember when idle, white-hot when lit.
      // Unlit glass is clear, with only its reflections; lit, it fills with colour.
      const lit = clamp01(inten * 1.1);
      this.tmpColor.setHex(color).multiplyScalar(0.35 + 0.65 * lit);
      this.glassColor.copy(this.clearGlass).lerp(this.tmpColor, lit);
      this.glassMesh.setColorAt(b.index, this.glassColor);
      this.filColor.setHex(color).lerp(this.white, clamp01(inten - 0.5));
      this.filColor.multiplyScalar(Math.min(1, 0.2 + inten * 1.2));
      this.filMesh.setColorAt(b.index, this.filColor);
      this.tmpColor.setHex(haloColor).multiplyScalar(Math.min(0.75, 0.02 + inten * 0.5));
      this.wallMesh.setColorAt(b.index, this.tmpColor);

      b.haloMat.color.setHex(haloColor);
      b.haloMat.opacity = halo;
      b.halo.visible = halo > 0.03; // an invisible glow costs no draw call
      b.node.scale.setScalar(scale);

      this.tmpQ.setFromAxisAngle(this.yAxis, b.node.rotation.y);
      this.tmpS.setScalar(b.radius * scale);
      this.tmpM.compose(b.node.position, this.tmpQ, this.tmpS);
      this.glassMesh.setMatrixAt(b.index, this.tmpM);
      this.filMesh.setMatrixAt(b.index, this.tmpM);
      this.mountMesh.setMatrixAt(b.index, this.tmpM);
      this.capMesh.setMatrixAt(b.index, this.tmpM);
      const toWall = (CFG.boardRadius + 0.045) / CFG.boardRadius;
      this.tmpP.set(b.node.position.x * toWall, b.node.position.y, b.node.position.z * toWall);
      this.tmpS.setScalar(b.radius * 5.5);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      this.wallMesh.setMatrixAt(b.index, this.tmpM);
    }
    this.glassMesh.instanceMatrix.needsUpdate = true;
    this.filMesh.instanceMatrix.needsUpdate = true;
    this.mountMesh.instanceMatrix.needsUpdate = true;
    this.capMesh.instanceMatrix.needsUpdate = true;
    this.wallMesh.instanceMatrix.needsUpdate = true;
    this.wallMesh.instanceColor.needsUpdate = true;
    this.glassMesh.instanceColor.needsUpdate = true;
    this.filMesh.instanceColor.needsUpdate = true;

    // Buttons: a small pop under the finger.
    for (const key in this.buttons) {
      const bt = this.buttons[key];
      if (!bt.node.visible) continue;
      const hovered = bt.entity.hasComponent(Hovered);
      bt.hover += ((hovered ? 1 : 0) - bt.hover) * k;
      if (bt.press > 0) bt.press = Math.max(0, bt.press - dt * 6);
      const pulse = key === 'start' ? 1 + 0.025 * Math.sin(now * 3.2) : key === 'surge' ? 1 + 0.05 * Math.sin(now * 7) : 1;
      bt.node.scale.setScalar(pulse * (1 + 0.07 * bt.hover) * (1 - 0.1 * bt.press));
    }
  }

  setHearts(selected) {
    this.buttons.hearts3.set('3 HEARTS', selected === 3);
    this.buttons.hearts5.set('5 HEARTS', selected === 5);
  }

  setStartLabel(text) {
    this.buttons.start.set(text, false);
  }
}
