import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  MeshLambertMaterial,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from '@iwsdk/core';
import { COACH_Z, READY_ANGLE } from './config.js';

const mat = (color, extra = {}) => new MeshStandardMaterial({ color, roughness: 0.9, ...extra });

// Small seeded generator so the crowd looks the same on every run.
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
  add(world, new HemisphereLight(0xcfe6ff, 0x4a7a3a, 0.45));
}

// Ground layers sit only millimetres apart, so they are drawn in a fixed order with no depth
// writes. That stays correct even on a coarse depth buffer, where thin layers would z-fight.
function layer(mesh, order) {
  mesh.renderOrder = order;
  mesh.material.depthWrite = false;
  return mesh;
}

function buildGround(world) {
  const grass = new Mesh(new CircleGeometry(60, 64), mat(0x3f8f3a));
  grass.rotation.x = -Math.PI / 2;
  add(world, layer(grass, -4));

  // Mowing stripes: alternating lighter bands across the field.
  const stripeMat = mat(0x489a42);
  for (let i = -6; i <= 6; i += 2) {
    const stripe = new Mesh(new BoxGeometry(5, 0.02, 90), stripeMat);
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

function buildStands(world) {
  // Boundary rope.
  const rope = new Mesh(new TorusGeometry(34, 0.08, 8, 96), mat(0xffffff));
  rope.rotation.x = Math.PI / 2;
  rope.position.y = 0.08;
  add(world, rope);

  // Crowd: two rings of little heads, each tinted a random shirt colour.
  const rand = seeded(7);
  const palette = [0xe63946, 0xf1faee, 0x457b9d, 0xffd166, 0x06d6a0, 0xef476f, 0x118ab2];
  const tint = new Color();
  const tiers = [
    { radius: 38, y: 1.2, count: 360 },
    { radius: 42, y: 3.0, count: 420 },
  ];
  for (const tier of tiers) {
    const wall = new Mesh(new CylinderGeometry(tier.radius + 0.6, tier.radius + 0.6, tier.y * 1.6, 48, 1, true), new MeshLambertMaterial({ color: 0x2b3245, side: DoubleSide }));
    wall.position.y = tier.y * 0.8;
    add(world, wall);

    // One merged mesh (a single draw call) instead of hundreds of instances.
    const base = new SphereGeometry(0.28, 5, 3);
    const basePos = base.attributes.position;
    const baseNormal = base.attributes.normal;
    const baseIndex = base.index.array;
    const n = basePos.count;
    const positions = new Float32Array(tier.count * n * 3);
    const normals = new Float32Array(tier.count * n * 3);
    const colors = new Float32Array(tier.count * n * 3);
    const indices = new Uint32Array(tier.count * baseIndex.length);
    for (let i = 0; i < tier.count; i++) {
      const a = (i / tier.count) * Math.PI * 2 + rand() * 0.02;
      const r = tier.radius - 0.4 + rand() * 0.8;
      const cx = Math.cos(a) * r;
      const cy = tier.y + 0.7 + rand() * 0.15;
      const cz = Math.sin(a) * r - 8;
      const k = 0.8 + rand() * 0.5;
      tint.setHex(palette[Math.floor(rand() * palette.length)]);
      for (let v = 0; v < n; v++) {
        const o = (i * n + v) * 3;
        positions[o] = cx + basePos.getX(v) * k;
        positions[o + 1] = cy + basePos.getY(v) * k;
        positions[o + 2] = cz + basePos.getZ(v) * k;
        normals[o] = baseNormal.getX(v);
        normals[o + 1] = baseNormal.getY(v);
        normals[o + 2] = baseNormal.getZ(v);
        colors[o] = tint.r;
        colors[o + 1] = tint.g;
        colors[o + 2] = tint.b;
      }
      for (let j = 0; j < baseIndex.length; j++) indices[i * baseIndex.length + j] = baseIndex[j] + i * n;
    }
    const merged = new BufferGeometry();
    merged.setAttribute('position', new BufferAttribute(positions, 3));
    merged.setAttribute('normal', new BufferAttribute(normals, 3));
    merged.setAttribute('color', new BufferAttribute(colors, 3));
    merged.setIndex(new BufferAttribute(indices, 1));
    const people = new Mesh(merged, new MeshLambertMaterial({ vertexColors: true }));
    people.frustumCulled = false;
    add(world, people);
  }

  // Floodlight poles.
  const pole = mat(0x9aa3b5);
  const lamp = mat(0xfff6c2, { emissive: 0xfff2a8, emissiveIntensity: 1.4 });
  for (const a of [0.6, 2.2, 3.8, 5.4]) {
    const x = Math.cos(a) * 36;
    const z = Math.sin(a) * 36 - 8;
    const mast = new Mesh(new CylinderGeometry(0.25, 0.4, 24, 8), pole);
    mast.position.set(x, 12, z);
    add(world, mast);
    const head = new Mesh(new BoxGeometry(4, 2, 0.6), lamp);
    head.position.set(x, 24.5, z);
    head.lookAt(0, 24.5, -8);
    add(world, head);
  }
}

// The coach stands at the far end, faces the player (+Z) and swings the bat.
// Returns the bat pivot, which the game rotates around X to animate the swing.
function buildCoach(world) {
  const coach = new Group();
  coach.position.set(0, 0, COACH_Z);

  const shirt = mat(0x1d4e89);
  const skin = mat(0xd9a679);
  const pants = mat(0xf4f4f4);

  const legs = new Mesh(new CapsuleGeometry(0.17, 0.55, 4, 10), pants);
  legs.position.y = 0.55;
  coach.add(legs);
  const torso = new Mesh(new CapsuleGeometry(0.22, 0.5, 4, 10), shirt);
  torso.position.y = 1.2;
  coach.add(torso);
  const head = new Mesh(new SphereGeometry(0.15, 16, 12), skin);
  head.position.y = 1.75;
  coach.add(head);
  const cap = new Mesh(new SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x12395f));
  cap.position.y = 1.78;
  coach.add(cap);

  const pivot = new Group();
  pivot.position.set(0.3, 1.25, 0.15);
  pivot.rotation.x = READY_ANGLE;
  coach.add(pivot);
  const handle = new Mesh(new CylinderGeometry(0.025, 0.025, 0.3, 10), mat(0x2a2a2a));
  handle.position.y = 0.15;
  pivot.add(handle);
  const blade = new Mesh(new BoxGeometry(0.11, 0.62, 0.045), mat(0xe2c27d, { roughness: 0.6 }));
  blade.position.y = 0.6;
  pivot.add(blade);

  add(world, coach);
  return pivot;
}

export function buildStadium(world) {
  buildLights(world);
  buildGround(world);
  buildStumps(world, -19.4);
  buildStumps(world, 0.4);
  buildStands(world);
  return buildCoach(world);
}
