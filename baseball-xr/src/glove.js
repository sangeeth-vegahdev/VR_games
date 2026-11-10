import {
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from '@iwsdk/core';

// A catcher's mitt built in code, made to be looked at up close: it is on the player's hand the whole
// game, and they mostly see its back.
//
// - The body is padded leather with two surfaces: a deep, broken-in pocket in front and a bulged back,
//   joined by a rolled binding that is laced all the way round (each lace wraps over the roll).
// - A raised thumb pad runs down the thumb side, a heel roll along the bottom, an H-web of leather
//   strips across the top of the thumb side.
// - On the back: finger-stall ridges, the opening for the hand, a strap with a club patch.
// - Pebble-grain leather with a bump map, darker where it is broken in.
// - Closing the mitt folds it along a hinge between the thumb and the fingers, the way a real mitt
//   closes; every part bends with it.
//
// Local axes: +Y towards the fingertips, +Z out of the palm (the pocket opens this way), +X towards
// the thumb. The origin is the centre of the pocket: where a caught ball sits.

// ---------- shape ----------
const A = 0.142; // half width of the outline
const B_TOP = 0.152; // to the top of the finger section
const B_BOT = 0.168; // to the bottom of the heel
const N = 2.25; // superellipse exponent: a little fuller than an ellipse, like a real mitt
const RIM_Z = 0.02; // front edge of the rim
const POCKET_Z = -0.058; // the bottom of the pocket, at its centre
const BACK_RIM_Z = RIM_Z - 0.046;
const BACK_Z = -0.112; // the back, at its most bulged
const ROLL_R = 0.024; // the rolled binding
const HINGE_X = 0.03; // the fold line, between the thumb and the fingers
const HINGE_Z = -0.04;
// The shape above is drawn a little large; the built mitt is scaled to a real catcher's mitt
// (about 30 cm across, 33 cm tall, 15 cm deep). Everything below works in built (scaled) units.
const SCALE = 0.88;

// The outline at angle t (0 = thumb side, PI/2 = top).
function outline(t, out) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const x = A * Math.sign(c) * Math.abs(c) ** (2 / N);
  const b = s >= 0 ? B_TOP : B_BOT;
  const y = b * Math.sign(s) * Math.abs(s) ** (2 / N);
  return out.set(x, y - 0.006);
}

// Depth of the front (pocket) and back surfaces at radial fraction u (0 centre, 1 rim).
const frontZ = (u) => RIM_Z + (POCKET_Z - RIM_Z) * Math.max(0, 1 - u * u) ** 1.15;
const backZ = (u) => BACK_RIM_Z + (BACK_Z - BACK_RIM_Z) * Math.max(0, 1 - u * u) ** 0.7;

// Radial fraction of the local point (x, y): 1 on the outline.
const tmp2 = new Vector2();
function radialU(x, y) {
  const t = Math.atan2(y + 0.006, x);
  outline(t, tmp2);
  const r = Math.hypot(x, y + 0.006);
  const R = Math.hypot(tmp2.x, tmp2.y + 0.006);
  return r / R;
}

// ---------- leather ----------
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Pebble grain, as a height field: soft overlapping bumps. Returns a Float32Array of SxS.
function grainHeight(S, seed) {
  const h = new Float32Array(S * S);
  const rand = seeded(seed);
  for (let i = 0; i < 3200; i++) {
    const cx = rand() * S;
    const cy = rand() * S;
    const r = 1.3 + rand() * 2.6;
    const a = 0.6 + rand() * 0.4;
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d >= 1) continue;
        const x = (Math.floor(cx) + dx + S) % S;
        const y = (Math.floor(cy) + dy + S) % S;
        h[y * S + x] += a * (1 - d * d) ** 2;
      }
    }
  }
  // fine creases
  for (let i = 0; i < 60; i++) {
    let x = rand() * S;
    let y = rand() * S;
    const ang = rand() * Math.PI;
    for (let k = 0; k < 18; k++) {
      x += Math.cos(ang) + (rand() - 0.5) * 0.6;
      y += Math.sin(ang) + (rand() - 0.5) * 0.6;
      const ix = ((Math.floor(x) % S) + S) % S;
      const iy = ((Math.floor(y) % S) + S) % S;
      h[iy * S + ix] -= 0.35;
    }
  }
  return h;
}

function canvas(S) {
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  return c;
}

// A tiling leather colour map and its matching normal map.
function leatherMaps(base, seed) {
  const S = 256;
  const h = grainHeight(S, seed);
  let min = Infinity;
  let max = -Infinity;
  for (const v of h) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const col = canvas(S);
  const nrm = canvas(S);
  const cc = col.getContext('2d');
  const nc = nrm.getContext('2d');
  const ci = cc.createImageData(S, S);
  const ni = nc.createImageData(S, S);
  const r0 = parseInt(base.slice(1, 3), 16);
  const g0 = parseInt(base.slice(3, 5), 16);
  const b0 = parseInt(base.slice(5, 7), 16);
  const rand = seeded(seed + 7);
  const at = (x, y) => h[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = (at(x, y) - min) / (max - min);
      const shade = 0.82 + 0.3 * v + (rand() - 0.5) * 0.04;
      const i = (y * S + x) * 4;
      ci.data[i] = Math.min(255, r0 * shade);
      ci.data[i + 1] = Math.min(255, g0 * shade);
      ci.data[i + 2] = Math.min(255, b0 * shade);
      ci.data[i + 3] = 255;
      const dx = (at(x + 1, y) - at(x - 1, y)) * 1.4;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 1.4;
      const len = Math.hypot(dx, dy, 1);
      ni.data[i] = 128 + (-dx / len) * 127;
      ni.data[i + 1] = 128 + (dy / len) * 127;
      ni.data[i + 2] = 128 + (1 / len) * 127;
      ni.data[i + 3] = 255;
    }
  }
  cc.putImageData(ci, 0, 0);
  nc.putImageData(ni, 0, 0);
  const map = new CanvasTexture(col);
  map.colorSpace = SRGBColorSpace;
  const normalMap = new CanvasTexture(nrm);
  normalMap.colorSpace = LinearSRGBColorSpace;
  for (const t of [map, normalMap]) {
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
    t.anisotropy = 4;
  }
  return { map, normalMap };
}

function patchTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.ellipse(128, 64, 124, 60, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = fg;
  ctx.lineWidth = 6;
  ctx.setLineDash([10, 7]);
  ctx.beginPath();
  ctx.ellipse(128, 64, 112, 50, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = fg;
  ctx.font = 'italic 700 62px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 68);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

const STYLES = {
  // The player's mitt: caramel leather, a darker broken-in pocket, dark laces.
  catcher: { shell: '#b8722f', pocket: '#8a4c1e', roll: '#9c5a23', lace: 0x3b2210, strap: 0x2b1a0e, patchBg: '#b0182a', patchFg: '#ffffff', seed: 3 },
  // The pitcher's glove: black leather with tan laces.
  pitcher: { shell: '#2a2627', pocket: '#1c191a', roll: '#302b2c', lace: 0xb4834f, strap: 0x151313, patchBg: '#ffffff', patchFg: '#b0182a', seed: 11 },
};

const cache = {};
function materials(style) {
  if (cache[style]) return cache[style];
  const st = STYLES[style];
  const shell = leatherMaps(st.shell, st.seed);
  const pocket = leatherMaps(st.pocket, st.seed + 1);
  const roll = leatherMaps(st.roll, st.seed + 2);
  const leather = (maps, roughness) =>
    new MeshStandardMaterial({ map: maps.map, normalMap: maps.normalMap, normalScale: new Vector2(0.32, 0.32), roughness, metalness: 0, vertexColors: true });
  cache[style] = [
    leather(shell, 0.58), // 0 shell (back, thumb pad, finger stalls)
    leather(pocket, 0.72), // 1 pocket (front)
    leather(roll, 0.5), // 2 binding roll, heel, web
    new MeshStandardMaterial({ color: st.lace, roughness: 0.65, vertexColors: true }), // 3 laces
    new MeshStandardMaterial({ color: st.strap, roughness: 0.8, vertexColors: true }), // 4 hand opening
  ];
  cache[style].patch = new MeshStandardMaterial({ map: patchTexture('Aces', st.patchBg, st.patchFg), roughness: 0.5, side: DoubleSide });
  return cache[style];
}

// ---------- geometry building ----------
// Pieces are appended per material, then joined into one geometry with a group per material, so the
// whole mitt can be bent (closed) in one pass over its vertices.
class Parts {
  constructor(count) {
    this.lists = Array.from({ length: count }, () => ({ pos: [], nrm: [], uv: [], col: [], idx: [] }));
  }

  // Adds a three.js geometry (indexed or not). shade(x, y, z) gives a vertex colour multiplier.
  add(m, geo, uvScale = 1, shade = null) {
    const L = this.lists[m];
    const base = L.pos.length / 3;
    const p = geo.attributes.position;
    const n = geo.attributes.normal;
    const t = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      L.pos.push(x, y, z);
      L.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      L.uv.push(t ? t.getX(i) * uvScale : x * 9, t ? t.getY(i) * uvScale : y * 9);
      const k = shade ? shade(x, y, z) : 1;
      L.col.push(k, k, k);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) L.idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < p.count; i++) L.idx.push(base + i);
  }

  build() {
    const pos = [], nrm = [], uv = [], col = [], idx = [];
    const g = new BufferGeometry();
    let start = 0;
    this.lists.forEach((L, m) => {
      const base = pos.length / 3;
      pos.push(...L.pos);
      nrm.push(...L.nrm);
      uv.push(...L.uv);
      col.push(...L.col);
      for (const i of L.idx) idx.push(base + i);
      g.addGroup(start, L.idx.length, m);
      start += L.idx.length;
    });
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }
}

function fromArrays(pos, idx, uv) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// One surface of the body: a polar grid inside the outline at depth zf(u). `flip` turns it to face -Z.
function bodySurface(zf, flip, RU = 16, RT = 64) {
  const pos = [];
  const idx = [];
  const o = new Vector2();
  pos.push(0, -0.006, zf(0)); // centre
  for (let i = 1; i <= RU; i++) {
    const u = i / RU;
    for (let j = 0; j < RT; j++) {
      outline((j / RT) * Math.PI * 2, o);
      pos.push(o.x * u, (o.y + 0.006) * u - 0.006, zf(u));
    }
  }
  const ring = (i) => 1 + (i - 1) * RT;
  for (let j = 0; j < RT; j++) {
    const a = 1 + j;
    const b = 1 + ((j + 1) % RT);
    if (flip) idx.push(0, b, a);
    else idx.push(0, a, b);
  }
  for (let i = 1; i < RU; i++) {
    for (let j = 0; j < RT; j++) {
      const a = ring(i) + j;
      const b = ring(i) + ((j + 1) % RT);
      const c = ring(i + 1) + j;
      const d = ring(i + 1) + ((j + 1) % RT);
      if (flip) idx.push(a, d, c, a, b, d);
      else idx.push(a, c, d, a, d, b);
    }
  }
  return fromArrays(pos, idx, null);
}

// A tube along `points`, radius r(t) (t 0..1), optionally squashed (sx across, sz out of the surface).
function tube(points, r, { closed = false, seg = 64, radial = 10, squash = 1, upHint = new Vector3(0, 0, 1) } = {}) {
  const curve = new CatmullRomCurve3(points, closed, 'catmullrom', 0.5);
  const pos = [];
  const uv = [];
  const idx = [];
  const P = new Vector3();
  const T = new Vector3();
  const Nn = new Vector3();
  const Bn = new Vector3();
  const len = curve.getLength();
  const rings = closed ? seg : seg + 1;
  for (let i = 0; i < rings; i++) {
    const t = i / seg;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    // A stable frame: Nn is upHint made perpendicular to the tangent, Bn completes it.
    Nn.copy(upHint).addScaledVector(T, -upHint.dot(T)).normalize();
    Bn.crossVectors(T, Nn).normalize();
    const rr = r(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cx = Math.cos(a) * rr;
      const cy = Math.sin(a) * rr * squash;
      pos.push(P.x + Nn.x * cy + Bn.x * cx, P.y + Nn.y * cy + Bn.y * cx, P.z + Nn.z * cy + Bn.z * cx);
      uv.push((t * len) / 0.12, j / radial);
    }
  }
  for (let i = 0; i < seg; i++) {
    const i2 = closed ? (i + 1) % rings : i + 1;
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = i2 * (radial + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return fromArrays(pos, idx, uv);
}

// A point on the front (pocket) surface, raised by `lift`, at outline angle t and fraction u.
function onFront(t, u, lift, out = new Vector3()) {
  const o = outline(t, new Vector2());
  return out.set(o.x * u, (o.y + 0.006) * u - 0.006, frontZ(u) + lift);
}
function onBack(t, u, lift, out = new Vector3()) {
  const o = outline(t, new Vector2());
  return out.set(o.x * u, (o.y + 0.006) * u - 0.006, backZ(u) - lift);
}
const deg = (d) => (d * Math.PI) / 180;
// A padded roll's radius along its length: full in the middle, rounding off to a closed end.
const roll = (r0) => (t) => r0 * Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 0.45 + 0.0004;

// Geometry is shared by every mitt of the same detail. q = 1 for the player's mitt (seen up close),
// lower for the pitcher's glove 18 m away (same shape, fewer triangles).
const BUILT = {};
function geometry(q = 1) {
  if (BUILT[q]) return BUILT[q];
  const parts = new Parts(5);
  const n = (v, min = 3) => Math.max(min, Math.round(v * q));
  // Broken-in: darker towards the centre of the pocket, lighter on worn edges.
  const pocketShade = (x, y) => 0.72 + 0.3 * Math.min(1, radialU(x, y)) ** 1.5;
  const backShade = (x, y) => 0.92 + 0.1 * Math.min(1, radialU(x, y));

  parts.add(1, bodySurface(frontZ, false, n(16), n(64, 16)), 1, pocketShade);
  parts.add(0, bodySurface(backZ, true, n(16), n(64, 16)), 1, backShade);

  // The rolled binding all round the rim, and its laces.
  const rimPts = [];
  for (let i = 0; i < 72; i++) {
    const p = onFront((i / 72) * Math.PI * 2, 1, 0);
    p.z = (RIM_Z + BACK_RIM_Z) / 2;
    rimPts.push(p);
  }
  const rimCurve = new CatmullRomCurve3(rimPts, true, 'catmullrom', 0.5);
  parts.add(2, tube(rimPts, () => ROLL_R, { closed: true, seg: n(144, 24), radial: n(12, 6) }), 1, () => 1.05);
  const LACES = n(46, 20);
  const P = new Vector3();
  const T = new Vector3();
  const O = new Vector3();
  const Z = new Vector3(0, 0, 1);
  for (let i = 0; i < LACES; i++) {
    const t = (i + 0.5) / LACES;
    rimCurve.getPointAt(t, P);
    rimCurve.getTangentAt(t, T);
    O.crossVectors(T, Z).normalize(); // outward, in the mitt's plane
    if (O.x * P.x + O.y * (P.y + 0.006) < 0) O.negate();
    // A lace loop wraps over the roll: from the front face, round the outside, to the back face,
    // slanting along the rim a little (as real binding laces do).
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const a = -0.25 + (k / 8) * (Math.PI + 0.5);
      const rr = ROLL_R + 0.0025;
      const along = (k / 8 - 0.5) * 0.012;
      pts.push(new Vector3().copy(P).addScaledVector(Z, Math.cos(a) * rr).addScaledVector(O, Math.sin(a) * rr).addScaledVector(T, along));
    }
    parts.add(3, tube(pts, () => 0.0036, { seg: n(10, 4), radial: n(5, 3), squash: 0.55, upHint: O }), 1, () => 0.9 + ((i * 37) % 10) / 50);
  }

  // Thumb pad: a raised padded roll down the thumb side, tapering at both ends.
  const thumbPts = [];
  for (let k = 0; k <= 10; k++) thumbPts.push(onFront(deg(-60 + k * 8.4), 0.84, 0.02 + 0.006 * Math.sin((k / 10) * Math.PI)));
  parts.add(0, tube(thumbPts, roll(0.03), { seg: n(40, 10), radial: n(12, 6) }), 1, () => 1.0);
  // Heel roll along the bottom.
  const heelPts = [];
  for (let k = 0; k <= 8; k++) heelPts.push(onFront(deg(208 + k * 15.5), 0.82, 0.02));
  parts.add(2, tube(heelPts, roll(0.027), { seg: n(36, 10), radial: n(12, 6) }), 1, () => 0.95);
  // Lace along the heel roll.
  const heelLace = [];
  for (let k = 0; k <= 8; k++) heelLace.push(onFront(deg(212 + k * 14.5), 0.7, 0.012));
  parts.add(3, tube(heelLace, roll(0.003), { seg: n(30, 8), radial: n(5, 3) }), 1);

  // H-web across the top of the thumb side: two strips running out to the rim, a bar between them,
  // laced through.
  for (const a of [34, 72]) {
    const pts = [];
    for (let k = 0; k <= 5; k++) pts.push(onFront(deg(a), 0.5 + k * 0.094, 0.013));
    parts.add(2, tube(pts, roll(0.012), { seg: n(16, 6), radial: n(8, 4), squash: 0.4 }), 1, () => 0.85);
  }
  const bar = [];
  for (let k = 0; k <= 6; k++) bar.push(onFront(deg(34 + k * 6.33), 0.74, 0.018));
  parts.add(2, tube(bar, roll(0.012), { seg: n(16, 6), radial: n(8, 4), squash: 0.4 }), 1, () => 0.85);
  // Lacing criss-crossing the web.
  for (const [a0, a1] of [[36, 70], [70, 36]]) {
    for (const [u0, u1] of [[0.56, 0.7], [0.78, 0.94]]) {
      const pts = [];
      for (let k = 0; k <= 4; k++) pts.push(onFront(deg(a0 + ((a1 - a0) * k) / 4), u0 + ((u1 - u0) * k) / 4, 0.022));
      parts.add(3, tube(pts, () => 0.003, { seg: n(10, 4), radial: n(5, 3) }), 1);
    }
  }

  // Back: finger-stall ridges running up to the top of the rim, laced at their tips.
  for (const [a, w] of [[100, 0.011], [118, 0.012], [138, 0.012], [160, 0.011]]) {
    const pts = [];
    for (let k = 0; k <= 6; k++) pts.push(onBack(deg(a), 0.2 + k * 0.13, 0.004));
    parts.add(0, tube(pts, roll(w), { seg: n(20, 6), radial: n(8, 4), squash: 0.7 }), 1, () => 0.85);
  }
  // The hand opening and the strap across the lower back.
  // A padded lip round the hand opening at the wrist, and the strap above it.
  const open = [];
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    open.push(onBack(deg(270) + Math.cos(a) * 0.24, 0.86 + Math.sin(a) * 0.07, 0.003));
  }
  parts.add(4, tube(open, () => 0.007, { closed: true, seg: n(40, 12), radial: n(8, 4), squash: 0.6 }), 1);
  const strap = [];
  for (let k = 0; k <= 8; k++) strap.push(onBack(deg(215 + k * 13.7), 0.64, 0.008));
  parts.add(2, tube(strap, roll(0.02), { seg: n(30, 8), radial: n(10, 4), squash: 0.3 }), 1, () => 0.7);

  const g = parts.build();
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i++) p[i] *= SCALE;
  BUILT[q] = { geometry: g, base: p.slice(), baseN: g.attributes.normal.array.slice() };
  return BUILT[q];
}

// ---------- closing: fold along the hinge ----------
// Each point turns about the vertical hinge line through (HINGE_X, HINGE_Z): the thumb side folds
// in a lot, the finger side a little, more towards the top than at the heel.
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function bendAngle(x, y, k) {
  x /= SCALE;
  y /= SCALE;
  const top = 0.45 + 0.55 * smooth(-0.15, 0.08, y);
  if (x > HINGE_X) return -k * 1.05 * smooth(0, 0.07, x - HINGE_X) * top;
  return k * 0.42 * smooth(0, 0.1, HINGE_X - x) * top;
}

function bend(src, srcN, dst, dstN, k) {
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    const a = bendAngle(x, y, k);
    if (a === 0) {
      dst[i] = x; dst[i + 1] = y; dst[i + 2] = z;
      dstN[i] = srcN[i]; dstN[i + 1] = srcN[i + 1]; dstN[i + 2] = srcN[i + 2];
      continue;
    }
    const c = Math.cos(a);
    const s = Math.sin(a);
    const hx = HINGE_X * SCALE;
    const hz = HINGE_Z * SCALE;
    const dx = x - hx;
    const dz = z - hz;
    dst[i] = hx + dx * c + dz * s;
    dst[i + 1] = y;
    dst[i + 2] = -dx * s + dz * c + hz;
    const nx = srcN[i], nz = srcN[i + 2];
    dstN[i] = nx * c + nz * s;
    dstN[i + 1] = srcN[i + 1];
    dstN[i + 2] = -nx * s + nz * c;
  }
}

export function makeMitt(style = 'catcher') {
  const shared = geometry(style === 'pitcher' ? 0.4 : 1);
  const mats = materials(style);
  // Each mitt bends its own copy of the vertices.
  const geo = shared.geometry.clone();
  const body = new Mesh(geo, mats);
  body.name = `mitt-${style}-body`;
  const mitt = new Group();
  mitt.name = `mitt-${style}`;
  mitt.add(body);

  // Club patch on the strap.
  const badge = new Mesh(new CylinderGeometry(1, 1, 0.003, 28), mats.patch);
  badge.scale.set(0.034 * SCALE, 1, 0.02 * SCALE);
  badge.rotation.x = -Math.PI / 2;
  badge.rotation.z = Math.PI;
  const at = onBack(deg(270), 0.62, 0.02);
  badge.position.copy(at).multiplyScalar(SCALE);
  mitt.add(badge);

  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  geo.computeBoundingSphere();
  if (geo.boundingSphere) {
    geo.boundingSphere.radius = Math.max(geo.boundingSphere.radius, 0.45);
  }
  let closed = -1;
  const api = {
    object: mitt,
    // 0 open, 1 folded shut round a ball.
    setClose(v) {
      const k = Math.max(0, Math.min(1, v));
      if (Math.abs(k - closed) < 0.015) return;
      closed = k;
      bend(shared.base, shared.baseN, pos.array, nrm.array, k);
      pos.needsUpdate = true;
      nrm.needsUpdate = true;
    },
    get closed() {
      return Math.max(0, closed);
    },
    // Where a caught ball rests, in the mitt's own space: where it hit, sunk into the leather of the
    // pocket (kept inside the pocket's face).
    restPoint(x, y, ballRadius, out) {
      const r = Math.hypot(x, y);
      const lim = 0.07;
      if (r > lim) {
        x *= lim / r;
        y *= lim / r;
      }
      const u = Math.min(1, radialU(x / SCALE, y / SCALE));
      return out.set(x, y, frontZ(u) * SCALE + ballRadius - 0.012);
    },
  };
  api.setClose(0);
  return api;
}

// Where on the mitt a catch landed (its own space): pocket, web, heel or edge.
export function catchSpot(x, y) {
  x /= SCALE;
  y /= SCALE;
  if (Math.hypot(x, y) < 0.055) return 'pocket';
  if (y > 0.04 && x > 0.015) return 'web';
  if (y < -0.08) return 'heel';
  return 'edge';
}

export const MITT_SIZE = { halfWidth: A * SCALE, halfHeight: B_BOT * SCALE, depth: (RIM_Z - BACK_Z) * SCALE };
