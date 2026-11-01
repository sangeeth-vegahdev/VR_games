import {
  AssetManager,
  Box3,
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
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

function buildLights(world) {
  const sun = new DirectionalLight(0xfff1d6, 1.5);
  sun.position.set(-12, 30, 10);
  add(world, sun);
  add(world, new HemisphereLight(0xcfe6ff, 0x4a7a3a, 0.55));
}

// Ground layers sit only millimetres apart, so they are drawn in a fixed order with no depth
// writes. That stays correct even on a coarse depth buffer, where thin layers would z-fight.
function layer(mesh, order) {
  mesh.renderOrder = order;
  mesh.material.depthWrite = false;
  return mesh;
}

function buildGround(world) {
  const grass = new Mesh(new CircleGeometry(80, 64), mat(0x4a9a3f));
  grass.rotation.x = -Math.PI / 2;
  add(world, layer(grass, -4));

  // Mowing stripes: alternating lighter bands across the field.
  const stripeMat = mat(0x56a84a);
  for (let i = -6; i <= 6; i += 2) {
    const stripe = new Mesh(new BoxGeometry(5, 0.02, 64), stripeMat);
    stripe.position.set(i * 5, 0.01, -9);
    add(world, layer(stripe, -3));
  }

  const pitch = new Mesh(new BoxGeometry(3.05, 0.02, 24), mat(0xc9a96b));
  pitch.position.set(0, 0.03, -9.5);
  add(world, layer(pitch, -2));

  // Creases at both ends.
  const white = mat(0xffffff, { roughness: 0.6 });
  for (const z of [-0.2, -19.2]) {
    const line = new Mesh(new BoxGeometry(3.05, 0.012, 0.06), white);
    line.position.set(0, 0.046, z);
    add(world, layer(line, -1));
  }
}

function buildStumps(world, z) {
  const wood = mat(0xf0e2bd, { roughness: 0.5 });
  const group = new Group();
  for (const x of [-0.11, 0, 0.11]) {
    const stump = new Mesh(new CylinderGeometry(0.018, 0.018, 0.71, 10), wood);
    stump.position.set(x, 0.355, 0);
    group.add(stump);
  }
  for (const x of [-0.055, 0.055]) {
    const bail = new Mesh(new CylinderGeometry(0.01, 0.01, 0.11, 8), wood);
    bail.rotation.z = Math.PI / 2;
    bail.position.set(x, 0.72, 0);
    group.add(bail);
  }
  group.position.set(0, 0, z);
  add(world, group);
}

// ---------- scenery from CC0 models ----------
const FIELD_CENTER_Z = -9; // the pitch runs from the player (z = 0) to the coach (z = -18)
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
  buildStumps(world, -19.4);
  buildStumps(world, 0.4);
  buildScenery(world);
}
