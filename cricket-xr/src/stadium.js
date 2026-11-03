import {
  AssetManager,
  Box3,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';

const mat = (color, extra = {}) => new MeshStandardMaterial({ color, roughness: 0.9, ...extra });

// Small seeded generator so the scenery looks the same on every run.
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

// Pitch layout, in metres. The player stands at z = 0 facing -Z; the coach is at the far end.
const STUMPS_NEAR = 0.4;
const STUMPS_FAR = -19.4;
const PITCH = { width: 3.05, near: 2.4, far: -21.4 }; // z range the pitch strip covers
const FIELD_CENTER_Z = -9; // the pitch runs from the player (z = 0) to the coach

// Late-afternoon sun from behind the player's left, casting soft shadows over the pitch only
// (the shadow camera is kept tight around it, so one 2048 map stays sharp and cheap).
function buildLights(world) {
  const sun = new DirectionalLight(0xfff1d6, 1.7);
  sun.position.set(-10, 24, 4);
  sun.target.position.set(0, 0, -9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const cam = sun.shadow.camera;
  cam.left = -7;
  cam.right = 7;
  cam.top = 15;
  cam.bottom = -15;
  cam.near = 5;
  cam.far = 60;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  add(world, sun);
  add(world, sun.target);
  add(world, new HemisphereLight(0xcfe6ff, 0x4a7a3a, 0.6));
}

// ---------- ground textures, drawn in code ----------

// Grass: an 8 m tile of fine blade noise with two mowing stripes (they run along the pitch).
function grassTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#4c9a40';
  g.fillRect(0, 0, S, S);
  // Mowing stripes: the light band is the grass laid away from the viewer.
  const band = g.createLinearGradient(0, 0, S, 0);
  band.addColorStop(0, 'rgba(255,255,220,0.0)');
  band.addColorStop(0.02, 'rgba(255,255,220,0.09)');
  band.addColorStop(0.48, 'rgba(255,255,220,0.09)');
  band.addColorStop(0.5, 'rgba(0,30,0,0.06)');
  band.addColorStop(0.98, 'rgba(0,30,0,0.06)');
  band.addColorStop(1, 'rgba(255,255,220,0.0)');
  g.fillStyle = band;
  g.fillRect(0, 0, S, S);
  const rand = seeded(21);
  for (let i = 0; i < 22000; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const l = rand();
    g.fillStyle = l < 0.5 ? `rgba(20,60,15,${0.18 + rand() * 0.2})` : `rgba(170,215,110,${0.12 + rand() * 0.18})`;
    g.fillRect(x, y, 1, 2 + rand() * 3);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Pitch: rolled clay with wear, painted creases to the Laws' measurements, and scuffed
// footmarks where the bowler lands and the batter stands.
function pitchTexture() {
  const W = 256;
  const H = 2048;
  const len = PITCH.near - PITCH.far;
  const zToY = (z) => ((PITCH.near - z) / len) * H; // canvas y from world z
  const xToX = (x) => (x / PITCH.width + 0.5) * W;
  const m = W / PITCH.width; // pixels per metre across

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#cfb680';
  g.fillRect(0, 0, W, H);
  // Greener edges, where the strip meets the outfield.
  const edge = g.createLinearGradient(0, 0, W, 0);
  edge.addColorStop(0, 'rgba(90,140,60,0.55)');
  edge.addColorStop(0.08, 'rgba(90,140,60,0.0)');
  edge.addColorStop(0.92, 'rgba(90,140,60,0.0)');
  edge.addColorStop(1, 'rgba(90,140,60,0.55)');
  g.fillStyle = edge;
  g.fillRect(0, 0, W, H);
  const rand = seeded(9);
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(120,95,50,${0.06 + rand() * 0.1})` : `rgba(240,225,180,${0.05 + rand() * 0.1})`;
    g.fillRect(rand() * W, rand() * H, 1 + rand() * 2, 1 + rand() * 2);
  }
  // Worn, darker patches round both batting creases.
  for (const z of [STUMPS_NEAR - 1.2, STUMPS_FAR + 1.2]) {
    for (let i = 0; i < 70; i++) {
      const x = (rand() - 0.5) * 1.6;
      const zz = z + (rand() - 0.5) * 2.2;
      g.fillStyle = `rgba(110,80,40,${0.05 + rand() * 0.08})`;
      g.beginPath();
      g.ellipse(xToX(x), zToY(zz), 3 + rand() * 6, 5 + rand() * 9, rand() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Creases, 5 cm white lines.
  g.fillStyle = '#f7f5ee';
  const line = 0.05;
  const hLine = (z, x0, x1) => g.fillRect(xToX(x0), zToY(z) - (line * H) / len / 2, (x1 - x0) * m, Math.max(2, (line * H) / len));
  const vLine = (x, z0, z1) => g.fillRect(xToX(x) - (line * m) / 2, zToY(z0), line * m, zToY(z1) - zToY(z0));
  for (const [stumps, dir] of [
    [STUMPS_NEAR, -1],
    [STUMPS_FAR, 1],
  ]) {
    const popping = stumps + dir * 1.22;
    hLine(stumps, -1.32, 1.32); // bowling crease, through the stumps
    hLine(popping, -PITCH.width / 2, PITCH.width / 2); // popping crease
    for (const x of [-1.32, 1.32]) {
      // Return creases: from the popping crease back past the stumps.
      const zA = popping;
      const zB = stumps - dir * 1.22;
      vLine(x, Math.max(zA, zB), Math.min(zA, zB));
    }
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Ground layers sit only millimetres apart, so they are drawn in a fixed order with no depth
// writes. That stays correct even on a coarse depth buffer, where thin layers would z-fight.
function layer(mesh, order) {
  mesh.renderOrder = order;
  mesh.material.depthWrite = false;
  mesh.receiveShadow = true;
  return mesh;
}

function buildGround(world) {
  // Outfield: tiled grass, with a gentle large-scale tone change from vertex colours so the tiling
  // does not read as a repeat.
  const SIZE = 180;
  const geo = new PlaneGeometry(SIZE, SIZE, 45, 45);
  const rand = seeded(4);
  const colors = [];
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const v = 0.92 + 0.06 * Math.sin(x * 0.11 + 1.3) * Math.cos(y * 0.09) + 0.03 * rand();
    colors.push(v, v, v);
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const grassMap = grassTexture();
  grassMap.repeat.set(SIZE / 8, SIZE / 8);
  const grass = new Mesh(geo, new MeshStandardMaterial({ map: grassMap, vertexColors: true, roughness: 0.95 }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.z = FIELD_CENTER_Z;
  add(world, layer(grass, -4));

  // The square: a closer-mown, lighter rectangle the pitch sits in.
  const square = new Mesh(new PlaneGeometry(9, 28), new MeshStandardMaterial({ color: 0x6fb257, transparent: true, opacity: 0.35, roughness: 0.95 }));
  square.rotation.x = -Math.PI / 2;
  square.position.set(0, 0.008, (PITCH.near + PITCH.far) / 2);
  add(world, layer(square, -3));

  const pitch = new Mesh(new PlaneGeometry(PITCH.width, PITCH.near - PITCH.far), new MeshStandardMaterial({ map: pitchTexture(), roughness: 0.92 }));
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(0, 0.016, (PITCH.near + PITCH.far) / 2);
  add(world, layer(pitch, -2));

  // Boundary rope, laid on the grass inside the fence.
  const rope = new Mesh(new TorusGeometry(27.5, 0.045, 6, 220), mat(0xf2efe6, { roughness: 0.8 }));
  rope.rotation.x = -Math.PI / 2;
  rope.position.set(0, 0.045, FIELD_CENTER_Z);
  add(world, rope);
}

function buildStumps(world, z) {
  const wood = mat(0xf0e2bd, { roughness: 0.5 });
  const group = new Group();
  for (const x of [-0.11, 0, 0.11]) {
    const stump = new Mesh(new CylinderGeometry(0.018, 0.018, 0.71, 10), wood);
    stump.position.set(x, 0.355, 0);
    stump.castShadow = true;
    group.add(stump);
  }
  for (const x of [-0.055, 0.055]) {
    const bail = new Mesh(new CylinderGeometry(0.01, 0.01, 0.11, 8), wood);
    bail.rotation.z = Math.PI / 2;
    bail.position.set(x, 0.72, 0);
    bail.castShadow = true;
    group.add(bail);
  }
  group.position.set(0, 0, z);
  add(world, group);
}

// Sightscreen: the big white board behind the bowler's end, so a red ball stands out against it.
function buildSightscreen(world) {
  const white = mat(0xf4f4f0, { roughness: 0.75 });
  const steel = mat(0x5d6670, { roughness: 0.5, metalness: 0.3 });
  const screen = new Group();
  const board = new Mesh(new BoxGeometry(10, 4.2, 0.12), white);
  board.position.y = 0.45 + 2.1;
  screen.add(board);
  for (const x of [-4.6, -1.5, 1.5, 4.6]) {
    const leg = new Mesh(new BoxGeometry(0.12, 0.6, 0.9), steel);
    leg.position.set(x, 0.3, -0.3);
    screen.add(leg);
  }
  screen.position.set(0, 0, FIELD_CENTER_Z - 27);
  add(world, screen);
}

// ---------- scenery from CC0 models ----------
const box = new Box3();
const size = new Vector3();

// Adds a model at a polar position around the field centre, sized by height or by width,
// standing on the ground. Each call gets a fresh clone from the asset manager.
function place(world, key, { angle, radius, height, width, rotY = 0 }) {
  const model = AssetManager.getGLTF(key).scene;
  box.setFromObject(model);
  box.getSize(size);
  const scale = width ? width / size.x : height / size.y;

  const holder = new Group();
  model.position.set(0, -box.min.y, 0);
  holder.add(model);
  holder.scale.setScalar(scale);
  holder.position.set(Math.cos(angle) * radius, 0, FIELD_CENTER_Z + Math.sin(angle) * radius);
  holder.rotation.y = rotY;
  add(world, holder);
}

function buildScenery(world) {
  const rand = seeded(11);

  // Boundary: a ring of fence panels, each rotated to follow the circle.
  const FENCE_RADIUS = 30;
  const panels = 44;
  const chord = 2 * FENCE_RADIUS * Math.sin(Math.PI / panels);
  for (let i = 0; i < panels; i++) {
    const angle = (i / panels) * Math.PI * 2;
    place(world, 'fence', {
      angle,
      radius: FENCE_RADIUS,
      width: chord * 1.02,
      rotY: Math.atan2(-Math.cos(angle), -Math.sin(angle)),
    });
  }

  // Hedge of bushes just outside the fence.
  for (let i = 0; i < 46; i++) {
    place(world, rand() < 0.5 ? 'bush' : 'bush-large', {
      angle: (i / 46) * Math.PI * 2 + rand() * 0.05,
      radius: 32 + rand() * 2.5,
      height: 1.2 + rand() * 1.1,
      rotY: rand() * Math.PI * 2,
    });
  }

  // Tree line behind that.
  const trees = ['tree-oak', 'tree-pine', 'tree-pine-tall', 'tree-fat'];
  for (let i = 0; i < 70; i++) {
    place(world, trees[Math.floor(rand() * trees.length)], {
      angle: (i / 70) * Math.PI * 2 + rand() * 0.08,
      radius: 37 + rand() * 12,
      height: 7 + rand() * 6,
      rotY: rand() * Math.PI * 2,
    });
  }

  // A pavilion tent and a few rocks for landmarks.
  place(world, 'tent', { angle: -0.9, radius: 34.5, height: 4.5, rotY: 0.6 });
  for (let i = 0; i < 9; i++) {
    place(world, rand() < 0.5 ? 'rock-large' : 'rock-small', {
      angle: rand() * Math.PI * 2,
      radius: 33.5 + rand() * 3,
      height: 0.6 + rand() * 1.2,
      rotY: rand() * Math.PI * 2,
    });
  }
}

export function buildStadium(world) {
  buildLights(world);
  buildGround(world);
  buildStumps(world, STUMPS_FAR);
  buildStumps(world, STUMPS_NEAR);
  buildSightscreen(world);
  buildScenery(world);
}
