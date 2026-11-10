import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector2,
} from '@iwsdk/core';
import { MOUND_HEIGHT, MOUND_Z, PLATE_Z } from './config.js';

// A ballpark under the lights, drawn entirely in code: striped outfield, painted infield dirt and
// chalk, a raised mound with its rubber, home plate and the bases, an outfield wall with a dark
// batter's eye straight behind the pitcher (so the white ball stands out), stands full of fans,
// light towers and a starry sky. Nothing is downloaded.
//
// Layout (metres): the catcher is at the origin facing -Z. Home plate's point is at z = PLATE_Z,
// the rubber 18.44 m beyond it, first base to the catcher's right (+X).

const mat = (color, extra = {}) => new MeshStandardMaterial({ color, roughness: 0.9, ...extra });

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function add(world, object, parent) {
  return world.createTransformEntity(object, parent);
}

const BASE = 27.43; // 90 ft base paths
const DIAG = BASE / Math.SQRT2;
const P = { x: 0, z: PLATE_Z }; // home plate's point
const FIRST = { x: DIAG, z: PLATE_Z - DIAG };
const SECOND = { x: 0, z: PLATE_Z - 2 * DIAG };
const THIRD = { x: -DIAG, z: PLATE_Z - DIAG };
const RUBBER = { x: 0, z: MOUND_Z };
// Distance from the plate to the outfield wall, by angle from straight-away centre field (radians,
// + towards first base): 100 m down the lines, 122 m to centre.
const wallDistance = (phi) => 100 + 22 * Math.cos(phi * 2) ** 2 * (Math.abs(phi) < Math.PI / 4 ? 1 : 0);
// Direction from the plate for angle phi (0 = centre field, -Z).
const dirX = (phi) => Math.sin(phi);
const dirZ = (phi) => -Math.cos(phi);

// ---------- light ----------
// The banks of floodlights are approximated by one strong key light from high behind home plate
// (casting the pitcher's and the ball's shadows on the dirt), a cooler fill, and the sky.
function buildLights(world) {
  const key = new DirectionalLight(0xfff6e8, 2.3);
  key.position.set(6, 30, 14);
  key.target.position.set(0, 0, MOUND_Z * 0.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const cam = key.shadow.camera;
  cam.left = -5;
  cam.right = 5;
  cam.top = 14;
  cam.bottom = -14;
  cam.near = 5;
  cam.far = 80;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 1;
  key.shadow.autoUpdate = false;
  key.shadow.needsUpdate = true;
  add(world, key);
  add(world, key.target);
  const fill = new DirectionalLight(0xc8d8ff, 0.7);
  fill.position.set(-20, 25, -30);
  add(world, fill);
  add(world, new HemisphereLight(0xb8c8ff, 0x2c4a2a, 0.75));
}

// ---------- ground ----------
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(c, repeat) {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
  }
  return t;
}

// Outfield grass: a 12 m tile with two mowing bands and fine blade noise.
function grassTexture() {
  const S = 512;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3f8f3a';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#4fa548';
  ctx.fillRect(0, 0, S, S / 2);
  const rand = seeded(21);
  for (let i = 0; i < 26000; i++) {
    const light = rand() < 0.45;
    ctx.fillStyle = light ? 'rgba(160,220,120,0.10)' : 'rgba(10,40,10,0.14)';
    ctx.fillRect(rand() * S, rand() * S, 1, 1 + rand() * 3);
  }
  return tex(c, true);
}

// Dirt pattern used by the infield painter: base colour plus grain.
function dirt(ctx, w, h, rand, alphaMask) {
  ctx.save();
  if (alphaMask) ctx.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < (w * h) / 30; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(90,50,25,0.16)' : 'rgba(255,225,190,0.10)';
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
  ctx.restore();
}

const DIRT = '#b07c52';
const CHALK = 'rgba(250,250,245,0.95)';

// The infield, painted onto a 66 m square around the diamond: the dirt arc, the grass square inside
// the base paths, the mound and base cut-outs, and the foul lines. Grass areas are left
// transparent so the outfield's mowing stripes show through.
const IF_SIZE = 66;
const IF_CZ = PLATE_Z - 20.5;
function infieldTexture() {
  const S = 2048;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const k = S / IF_SIZE;
  const X = (x) => (x + IF_SIZE / 2) * k;
  const Z = (z) => (z - (IF_CZ - IF_SIZE / 2)) * k;
  const rand = seeded(5);

  // The dirt arc: 29 m from the rubber, between (just outside) the foul lines.
  ctx.fillStyle = DIRT;
  ctx.beginPath();
  ctx.moveTo(X(P.x), Z(P.z));
  const spread = Math.PI / 4 + 0.06;
  for (let i = 0; i <= 64; i++) {
    const a = -spread + (2 * spread * i) / 64;
    // point on the arc around the rubber, along direction a from the plate
    const dx = dirX(a);
    const dz = dirZ(a);
    // distance t from the plate where the ray meets the circle |p - rubber| = 29
    const ox = P.x - RUBBER.x;
    const oz = P.z - RUBBER.z;
    const b = ox * dx + oz * dz;
    const t = -b + Math.sqrt(b * b - (ox * ox + oz * oz - 29 * 29));
    ctx.lineTo(X(P.x + dx * t), Z(P.z + dz * t));
  }
  ctx.closePath();
  ctx.fill();

  // The grass square inside the base paths (cut out of the dirt).
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const inset = 1.0;
  const sq = [
    [P.x, P.z - inset * Math.SQRT2 - 3.2],
    [FIRST.x - inset * Math.SQRT2, FIRST.z],
    [SECOND.x, SECOND.z + inset * Math.SQRT2],
    [THIRD.x + inset * Math.SQRT2, THIRD.z],
  ];
  ctx.beginPath();
  sq.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Dirt circles: the mound, the home-plate area, and cut-outs round each base.
  ctx.fillStyle = DIRT;
  const circle = (x, z, r) => {
    ctx.beginPath();
    ctx.arc(X(x), Z(z), r * k, 0, Math.PI * 2);
    ctx.fill();
  };
  circle(RUBBER.x, RUBBER.z + 0.6, 2.74);
  circle(P.x, P.z - 0.3, 4.0);
  for (const b of [FIRST, SECOND, THIRD]) circle(b.x, b.z, 2.0);
  dirt(ctx, S, S, rand, true);

  // Grass edge: a soft darker lip where dirt meets grass, so the edge reads.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.strokeStyle = 'rgba(80,50,25,0.35)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  sq.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // Foul lines, from the plate out past the dirt (the outfield part is a separate strip).
  ctx.strokeStyle = CHALK;
  ctx.lineWidth = 0.08 * k;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(X(P.x + s * 1.0), Z(P.z - 1.0));
    ctx.lineTo(X(P.x + s * 40), Z(P.z - 40));
    ctx.stroke();
  }
  return tex(c, false);
}

// The home-plate circle in fine detail (it is right under the player's eyes): dirt, chalked
// batter's boxes and the catcher's box.
const HOME_SIZE = 9;
function homeTexture() {
  const S = 1024;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const k = S / HOME_SIZE;
  const cz = P.z - 0.3;
  const X = (x) => (x + HOME_SIZE / 2) * k;
  const Z = (z) => (z - (cz - HOME_SIZE / 2)) * k;
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.36, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, DIRT);
  g.addColorStop(0.96, DIRT);
  g.addColorStop(1, 'rgba(176,124,82,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  dirt(ctx, S, S, seeded(9), true);
  // Raked arcs in the dirt.
  ctx.strokeStyle = 'rgba(90,55,30,0.12)';
  ctx.lineWidth = 2;
  for (let r = 1.6; r < 4.2; r += 0.18) {
    ctx.beginPath();
    ctx.arc(X(P.x), Z(cz), r * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Batter's boxes: 4 ft x 6 ft, 6 in either side of the plate.
  ctx.strokeStyle = CHALK;
  ctx.lineWidth = 0.075 * k;
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? 0.215 + 0.15 : -0.215 - 0.15 - 1.22;
    ctx.strokeRect(X(x0), Z(P.z - 0.43 - 0.92 + 0.3), 1.22 * k, 1.83 * k);
  }
  // Catcher's box behind the plate.
  ctx.beginPath();
  ctx.moveTo(X(-0.55), Z(P.z + 0.5));
  ctx.lineTo(X(-0.55), Z(P.z + 2.4));
  ctx.lineTo(X(0.55), Z(P.z + 2.4));
  ctx.lineTo(X(0.55), Z(P.z + 0.5));
  ctx.stroke();
  return tex(c, false);
}

function layer(mesh, order) {
  mesh.renderOrder = order;
  mesh.material.depthWrite = false;
  mesh.receiveShadow = true;
  return mesh;
}

function buildGround(world) {
  // Outfield and foul ground: one big tiled lawn.
  const SIZE = 300;
  const geo = new PlaneGeometry(SIZE, SIZE, 30, 30);
  const map = grassTexture();
  map.repeat.set(SIZE / 12, SIZE / 12);
  const grass = new Mesh(geo, new MeshStandardMaterial({ map, roughness: 0.95 }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0, 0, -60);
  add(world, layer(grass, -5));

  const infield = new Mesh(
    new PlaneGeometry(IF_SIZE, IF_SIZE),
    new MeshStandardMaterial({ map: infieldTexture(), transparent: true, roughness: 0.97 }),
  );
  infield.rotation.x = -Math.PI / 2;
  infield.position.set(0, 0.006, IF_CZ);
  add(world, layer(infield, -4));

  const home = new Mesh(
    new PlaneGeometry(HOME_SIZE, HOME_SIZE),
    new MeshStandardMaterial({ map: homeTexture(), transparent: true, roughness: 0.97 }),
  );
  home.rotation.x = -Math.PI / 2;
  home.position.set(0, 0.012, P.z - 0.3);
  add(world, layer(home, -3));

  // Foul lines across the outfield, out to the wall.
  const chalk = new MeshBasicMaterial({ color: 0xf4f4ee });
  for (const s of [-1, 1]) {
    const len = wallDistance(Math.PI / 4) - 40;
    const line = new Mesh(new PlaneGeometry(0.1, len), chalk);
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = -s * (Math.PI / 4);
    const mid = 40 + len / 2;
    line.position.set(P.x + s * (mid / Math.SQRT2), 0.01, P.z - mid / Math.SQRT2);
    add(world, layer(line, -2));
  }
}

// ---------- the diamond's hardware ----------
function buildMound(world) {
  const dirtMat = mat(0xa8744b, { roughness: 1 });
  // Flat top round the rubber, then a gentle slope down to the field.
  const profile = [
    new Vector2(0, MOUND_HEIGHT),
    new Vector2(0.9, MOUND_HEIGHT),
    new Vector2(1.7, MOUND_HEIGHT * 0.72),
    new Vector2(2.4, MOUND_HEIGHT * 0.25),
    new Vector2(2.74, 0.0),
  ];
  const mound = new Mesh(new LatheGeometry(profile, 48), dirtMat);
  mound.position.set(RUBBER.x, 0.003, RUBBER.z + 0.4);
  mound.receiveShadow = true;
  add(world, mound);
  const rubber = new Mesh(new BoxGeometry(0.61, 0.03, 0.15), mat(0xf6f6f2, { roughness: 0.6 }));
  rubber.position.set(RUBBER.x, MOUND_HEIGHT + 0.012, RUBBER.z - 0.075);
  rubber.receiveShadow = true;
  add(world, rubber);
  // The rosin bag behind the rubber.
  const rosin = new Mesh(new BoxGeometry(0.12, 0.05, 0.09), mat(0xe8e2d2));
  rosin.position.set(RUBBER.x + 0.5, MOUND_HEIGHT * 0.9, RUBBER.z - 0.7);
  add(world, rosin);
}

function buildPlateAndBases(world) {
  const white = mat(0xf8f8f4, { roughness: 0.55 });
  // Home plate: a five-sided slab, 17 in across, its point towards the catcher.
  const s = new Shape();
  s.moveTo(0, 0);
  s.lineTo(0.216, -0.216);
  s.lineTo(0.216, -0.432);
  s.lineTo(-0.216, -0.432);
  s.lineTo(-0.216, -0.216);
  s.closePath();
  const plateGeo = new ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1 });
  plateGeo.rotateX(Math.PI / 2); // shape's +Y (towards the pitcher) to -Z
  const plate = new Mesh(plateGeo, white);
  plate.position.set(P.x, 0.022, P.z);
  plate.receiveShadow = true;
  add(world, plate);
  // Black rubber edge round the plate.
  const edge = new Mesh(plateGeo, mat(0x1d1d1d));
  edge.scale.set(1.06, 0.9, 1.04);
  edge.position.set(P.x, 0.02, P.z + 0.008);
  add(world, edge);
  for (const b of [FIRST, SECOND, THIRD]) {
    const bag = new Mesh(new BoxGeometry(0.38, 0.08, 0.38), white);
    bag.position.set(b.x, 0.04, b.z);
    bag.rotation.y = Math.PI / 4;
    add(world, bag);
  }
}

// ---------- wall, batter's eye, stands, lights ----------
function adTexture(lines, bg, fg) {
  const c = canvas(1024, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = fg;
  ctx.font = 'italic 800 78px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(lines, 512, 68);
  return tex(c, false);
}

// A band of wall following wallDistance(), from angle a0 to a1, made of flat panels.
function wallBand(a0, a1, segments, height, y0, material, offset = 0) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments;
    const r = wallDistance(a) + offset;
    const x = P.x + dirX(a) * r;
    const z = P.z + dirZ(a) * r;
    pos.push(x, y0, z, x, y0 + height, z);
    uv.push(i / segments, 0, i / segments, 1);
    if (i < segments) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new Mesh(g, material);
}

function buildWall(world) {
  const pad = mat(0x14402a, { roughness: 0.85, side: DoubleSide });
  const A = Math.PI / 4;
  add(world, wallBand(-A, A, 90, 3.0, 0, pad));
  const yellow = new MeshBasicMaterial({ color: 0xf2c230, side: DoubleSide });
  add(world, wallBand(-A, A, 90, 0.12, 3.0, yellow));
  // Foul poles.
  const poleMat = mat(0xf2c230, { roughness: 0.5 });
  for (const s of [-1, 1]) {
    const r = wallDistance(A);
    const pole = new Mesh(new CylinderGeometry(0.15, 0.15, 22, 10), poleMat);
    pole.position.set(P.x + s * dirX(A) * r, 11, P.z + dirZ(A) * r);
    add(world, pole);
  }
  // Ad boards along the wall, either side of the batter's eye.
  const ads = [
    ['Glove Up', '#b0182a', '#ffffff'],
    ['Aces Baseball', '#1a2448', '#f2c230'],
    ['Eyes on the Ball', '#f2c230', '#1a2448'],
    ['Home of the Aces', '#ffffff', '#b0182a'],
  ];
  let n = 0;
  for (const s of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const [text, bg, fg] = ads[n++ % ads.length];
      const a0 = s * (0.2 + i * 0.27);
      const a1 = a0 + s * 0.22;
      const board = wallBand(Math.min(a0, a1), Math.max(a0, a1), 12, 1.1, 1.2, new MeshBasicMaterial({ map: adTexture(text, bg, fg), side: DoubleSide }), -0.06);
      add(world, board);
    }
  }

  // Batter's eye: a dark, plain backdrop in centre field so the pitch is seen against it.
  const eye = mat(0x0c2418, { roughness: 1, side: DoubleSide });
  const r = wallDistance(0) + 3;
  const board = new Mesh(new BoxGeometry(34, 14, 1), eye);
  board.position.set(P.x, 7, P.z - r);
  add(world, board);

  // A scoreboard high above it.
  const c = canvas(1024, 384);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0d1424';
  ctx.fillRect(0, 0, 1024, 384);
  ctx.strokeStyle = '#f2c230';
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 1004, 364);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'italic 800 120px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('ACES', 512, 150);
  ctx.fillStyle = '#f2c230';
  ctx.font = '700 64px system-ui, sans-serif';
  ctx.fillText('GLOVE UP  •  BULLPEN NIGHT', 512, 270);
  const sb = new Mesh(new PlaneGeometry(26, 9.75), new MeshBasicMaterial({ map: tex(c, false) }));
  sb.position.set(P.x, 20, P.z - r - 0.6);
  sb.rotation.y = 0;
  add(world, sb);
  const legs = mat(0x2a2f38, { roughness: 0.6 });
  for (const x of [-9, 9]) {
    const leg = new Mesh(new BoxGeometry(0.8, 6, 0.8), legs);
    leg.position.set(P.x + x, 15, P.z - r - 1.2);
    add(world, leg);
  }
}

// A sloped bank of seats (part of a cone around home plate) with a crowd on it.
function stand(world, people, { a0, a1, rIn, rOut, y0, y1, center = P }) {
  const concrete = mat(0x5a606c, { roughness: 0.95, side: DoubleSide });
  // CylinderGeometry measures theta from +Z towards +X; our angles are from -Z, so theta = PI - a.
  const seats = new Mesh(
    new CylinderGeometry(rOut, rIn, y1 - y0, 48, 1, true, Math.PI - a1, a1 - a0),
    concrete,
  );
  seats.position.set(center.x, (y0 + y1) / 2, center.z);
  add(world, seats);
  // Fans in rows up the slope.
  const rows = Math.floor((rOut - rIn) / 1.3);
  for (let row = 0; row < rows; row++) {
    const f = (row + 0.5) / rows;
    const r = rIn + (rOut - rIn) * f;
    const y = y0 + (y1 - y0) * f;
    const count = Math.floor(((a1 - a0) * r) / 0.85);
    for (let i = 0; i < count; i++) {
      if (people.rand() < 0.25) continue; // some empty seats
      const a = a0 + ((i + 0.5) / count) * (a1 - a0);
      people.push(center.x + dirX(a) * r, y, center.z + dirZ(a) * r, a);
    }
  }
}

class Crowd {
  constructor() {
    this.rand = seeded(77);
    this.items = [];
  }

  push(x, y, z, a) {
    this.items.push([x, y, z, a]);
  }

  // Each fan is two cut-out cards facing home plate: shoulders and body (tinted by shirt colour) and
  // a round head (tinted by skin tone). Rounded silhouettes, four triangles a fan.
  build(world) {
    const n = this.items.length;
    const card = (draw) => {
      const c = canvas(64, 64);
      draw(c.getContext('2d'));
      const t = tex(c, false);
      return new MeshBasicMaterial({ map: t, alphaTest: 0.5, side: DoubleSide });
    };
    const bodyMat = card((ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(4, 64);
      ctx.lineTo(4, 26);
      ctx.quadraticCurveTo(4, 6, 24, 4);
      ctx.lineTo(40, 4);
      ctx.quadraticCurveTo(60, 6, 60, 26);
      ctx.lineTo(60, 64);
      ctx.closePath();
      ctx.fill();
      // a little shading down the sides, so the body reads as round
      const g = ctx.createLinearGradient(0, 0, 64, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.25)');
      g.addColorStop(0.3, 'rgba(0,0,0,0)');
      g.addColorStop(0.7, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    });
    const headMat = card((ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(32, 34, 25, 29, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-atop';
      // hair on top for some
      ctx.fillStyle = 'rgba(40,25,15,0.85)';
      ctx.fillRect(0, 0, 64, 16);
    });
    const body = new InstancedMesh(new PlaneGeometry(0.5, 0.62), bodyMat, n);
    const head = new InstancedMesh(new PlaneGeometry(0.24, 0.28), headMat, n);
    const shirts = [0xb0182a, 0xb0182a, 0xb0182a, 0xffffff, 0x1a2448, 0x1a2448, 0xf2c230, 0x6a7a8a, 0x2c6e49, 0xd65a31, 0x333333];
    const skins = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x5c3a21];
    const m = new Matrix4();
    const c = new Color();
    for (let i = 0; i < n; i++) {
      const [x, y, z] = this.items[i];
      const bob = this.rand() * 0.08;
      m.makeRotationY(Math.atan2(P.x - x, P.z - z)); // face home plate
      m.setPosition(x, y + 0.31 + bob, z);
      body.setMatrixAt(i, m);
      m.setPosition(x, y + 0.74 + bob, z);
      head.setMatrixAt(i, m);
      body.setColorAt(i, c.setHex(shirts[Math.floor(this.rand() * shirts.length)]));
      head.setColorAt(i, c.setHex(skins[Math.floor(this.rand() * skins.length)]));
    }
    add(world, body);
    add(world, head);
    return n;
  }
}

function glowTexture() {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.15, 'rgba(255,250,220,0.85)');
  g.addColorStop(0.45, 'rgba(255,240,200,0.18)');
  g.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return tex(c, false);
}

function buildLightTowers(world) {
  const steel = mat(0x3a3f48, { roughness: 0.6, metalness: 0.3 });
  const lamp = new MeshBasicMaterial({ color: 0xfffbe8 });
  const glow = new SpriteMaterial({ map: glowTexture(), color: 0xfff3d0, blending: AdditiveBlending, depthWrite: false, transparent: true });
  const spots = [
    [-0.95, 70], [-0.55, 112], [-1.6, 55], [0.95, 70], [0.55, 112], [1.6, 55], [-2.5, 48], [2.5, 48],
  ];
  // All the lamps of all the towers are one instanced mesh: one draw call instead of 144.
  const LAMPS = 18;
  const lamps = new InstancedMesh(new BoxGeometry(0.9, 0.9, 0.2), lamp, spots.length * LAMPS);
  const local = new Matrix4();
  const m = new Matrix4();
  const poleGeo = new CylinderGeometry(0.5, 0.8, 38, 8);
  const bankGeo = new BoxGeometry(8, 4.2, 0.6);
  let k = 0;
  for (const [a, r] of spots) {
    const g = new Group();
    const h = 38;
    const pole = new Mesh(poleGeo, steel);
    pole.position.y = h / 2;
    g.add(pole);
    const bank = new Mesh(bankGeo, steel);
    bank.position.y = h + 2;
    g.add(bank);
    const halo = new Sprite(glow);
    halo.scale.set(24, 16, 1);
    halo.position.set(0, h + 2, 1.5);
    g.add(halo);
    g.position.set(P.x + dirX(a) * r, 0, P.z + dirZ(a) * r);
    g.lookAt(P.x, 0, P.z - 20); // lamps face the field
    g.updateMatrixWorld(true);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        local.makeTranslation(-3.1 + col * 1.24, h + 0.8 + row * 1.25, 0.35);
        lamps.setMatrixAt(k++, m.multiplyMatrices(g.matrixWorld, local));
      }
    }
    add(world, g);
  }
  add(world, lamps);
}

function buildSky(world) {
  const rand = seeded(42);
  const pos = [];
  for (let i = 0; i < 900; i++) {
    const u = rand() * Math.PI * 2;
    const v = 0.12 + rand() * 0.85; // above the stands only
    const r = 320;
    pos.push(Math.cos(u) * Math.cos(v) * r, Math.sin(v) * r, Math.sin(u) * Math.cos(v) * r - 60);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const stars = new Points(g, new PointsMaterial({ color: 0xdfe8ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.8, depthWrite: false }));
  add(world, stars);
}

// Behind the catcher: the backstop wall and netting, and the stands rising over it.
function buildBackstop(world) {
  const wallMat = mat(0x1d2a40, { roughness: 0.9, side: DoubleSide });
  const wall = new Mesh(new CylinderGeometry(18, 18, 2.2, 40, 1, true, -1.0, 2.0), wallMat);
  wall.position.set(P.x, 1.1, P.z);
  add(world, wall);
  const net = new MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.25, side: DoubleSide, depthWrite: false });
  const netting = new Mesh(new CylinderGeometry(18, 18, 9, 40, 1, true, -1.0, 2.0), net);
  netting.position.set(P.x, 6.7, P.z);
  add(world, netting);
}

export function buildBallpark(world) {
  buildLights(world);
  buildGround(world);
  buildMound(world);
  buildPlateAndBases(world);
  buildWall(world);
  buildBackstop(world);
  const crowd = new Crowd();
  // Infield stands: along both foul lines and round behind home plate.
  stand(world, crowd, { a0: Math.PI / 4 + 0.2, a1: Math.PI - 0.18, rIn: 30, rOut: 48, y0: 2, y1: 15 });
  stand(world, crowd, { a0: -Math.PI + 0.18, a1: -Math.PI / 4 - 0.2, rIn: 30, rOut: 48, y0: 2, y1: 15 });
  stand(world, crowd, { a0: Math.PI - 0.18, a1: Math.PI + 0.18, rIn: 19, rOut: 38, y0: 2.5, y1: 16 });
  // Outfield bleachers either side of the batter's eye.
  stand(world, crowd, { a0: 0.16, a1: Math.PI / 4 - 0.02, rIn: 127, rOut: 143, y0: 3.2, y1: 15 });
  stand(world, crowd, { a0: -Math.PI / 4 + 0.02, a1: -0.16, rIn: 127, rOut: 143, y0: 3.2, y1: 15 });
  const fans = crowd.build(world);
  buildLightTowers(world);
  buildSky(world);
  return { fans };
}
