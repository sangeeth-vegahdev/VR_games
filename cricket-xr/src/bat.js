import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector2,
} from '@iwsdk/core';

// A full-size cricket bat built in code (no file to download), in metres.
// The bat's local +Y runs from the top of the handle (y = 0) to the toe (y = BAT.length).
// The flat hitting face points along local +Z; the rounded back (the "spine") bulges towards -Z.

export const BAT = {
  length: 0.86,
  handle: 0.31, // top of handle to the splice
  grip: 0.1, // where a one-handed grip holds it, from the top
  sweetSpot: 0.64, // from the top: the middle of the hitting area
};

const BLADE = { width: 0.108, edge: 0.034, spine: 0.06, shoulder: 0.05 };

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Pale willow with long straight grain, and a two-colour label near the shoulder.
function willowTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const g = c.getContext('2d');
  const base = g.createLinearGradient(0, 0, 128, 0);
  base.addColorStop(0, '#d9b97c');
  base.addColorStop(0.5, '#ecd3a0');
  base.addColorStop(1, '#d9b97c');
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 512);
  const rand = seeded(5);
  for (let i = 0; i < 26; i++) {
    const x = rand() * 128;
    g.strokeStyle = `rgba(150,105,55,${0.12 + rand() * 0.18})`;
    g.lineWidth = 0.6 + rand() * 1.2;
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y <= 512; y += 32) g.lineTo(x + Math.sin(y * 0.02 + i) * 1.5, y);
    g.stroke();
  }
  // Label: v = 0 is the top of the blade (the shoulder end).
  g.fillStyle = '#1e305c';
  g.fillRect(0, 40, 128, 34);
  g.fillStyle = '#d4a017';
  g.fillRect(0, 74, 128, 7);
  g.fillStyle = '#1e305c';
  g.fillRect(0, 81, 128, 4);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Blade: a box whose back is pushed out into a rounded spine, thickest low down where the
// ball is struck, with sloped shoulders at the top and a slightly rounded toe.
function bladeGeometry(len) {
  const { width, edge, spine, shoulder } = BLADE;
  const geo = new BoxGeometry(width, len, 1, 10, 28, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i); // -len/2 (toe) .. len/2 (shoulder)
    const back = p.getZ(i) < 0;
    const fromTop = len / 2 - y; // 0 at the shoulder
    const along = fromTop / len; // 0 shoulder .. 1 toe
    // Spine thickness: thin at the shoulder, peaks about 70% down, eases off at the toe.
    const peak = Math.exp(-((along - 0.7) ** 2) / 0.12);
    const s = edge + (spine - edge) * (0.45 + 0.55 * peak);
    const across = Math.min(1, Math.abs(x) / (width / 2));
    const z = back ? -(edge * 0.55 + (s - edge * 0.55) * (1 - across * across)) : 0;
    // Shoulders: the top corners slope in towards the handle.
    let w = 1;
    if (fromTop < shoulder) w = 0.62 + 0.38 * Math.sin((fromTop / shoulder) * (Math.PI / 2));
    // Toe: corners rounded off a little.
    const toe = len / 2 + y; // 0 at the toe
    if (toe < 0.02) w *= 0.94 + 0.06 * (toe / 0.02);
    p.setXYZ(i, x * w, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

// Handle: a lathe with fine ridges for the rubber grip, a rounded top and a flared splice.
function handleGeometry(len) {
  const pts = [];
  pts.push(new Vector2(0, 0));
  pts.push(new Vector2(0.012, 0.002));
  pts.push(new Vector2(0.0175, 0.008));
  const ridges = len - 0.06;
  for (let i = 0; i <= 80; i++) {
    const y = 0.012 + (i / 80) * ridges;
    pts.push(new Vector2(0.0178 + 0.0009 * Math.sin(i * Math.PI), y));
  }
  pts.push(new Vector2(0.0165, len - 0.04));
  pts.push(new Vector2(0.0165, len));
  return new LatheGeometry(pts, 16);
}

let shared = null;
function parts() {
  if (shared) return shared;
  const bladeLen = BAT.length - BAT.handle;
  shared = {
    blade: bladeGeometry(bladeLen),
    handle: handleGeometry(BAT.handle - 0.02),
    splice: new CylinderGeometry(0.017, 0.028, 0.05, 14),
    wood: new MeshStandardMaterial({ map: willowTexture(), roughness: 0.55, metalness: 0 }),
    grip: new MeshStandardMaterial({ color: 0x9e1b24, roughness: 0.85, metalness: 0 }),
  };
  return shared;
}

// Returns a Group for one bat: origin at the top of the handle, running along +Y to the toe.
export function makeBat() {
  const p = parts();
  const bladeLen = BAT.length - BAT.handle;
  const bat = new Group();

  const handle = new Mesh(p.handle, p.grip);
  bat.add(handle); // lathe runs along +Y from y = 0

  const splice = new Mesh(p.splice, p.wood);
  splice.position.y = BAT.handle - 0.005;
  splice.position.z = -0.012;
  bat.add(splice);

  const blade = new Mesh(p.blade, p.wood);
  blade.position.y = BAT.handle + bladeLen / 2;
  blade.rotation.z = Math.PI; // the box's +Y (shoulder) end towards the handle; face stays on +Z
  bat.add(blade);

  bat.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return bat;
}
