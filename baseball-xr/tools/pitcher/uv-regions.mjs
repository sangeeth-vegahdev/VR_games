// Writes the body mesh's UV triangles, each tagged with the uniform part its dominant bone carries,
// plus the triangle's rest-pose 3D position (so pants length, socks and the jersey number can be
// placed by height and by facing).
// Usage: node uv-regions.mjs <body.gltf> <out.json>   (see README.md)
import { NodeIO } from '@gltf-transform/core';
import fs from 'node:fs';

const [, , src, out] = process.argv;
const doc = await new NodeIO().read(src);
const root = doc.getRoot();
const node = root
  .listNodes()
  .find((n) => n.getMesh() && n.getMesh().listPrimitives()[0].getAttribute('TEXCOORD_0') && n.getName().startsWith('SuperHero'));
const jointNames = node.getSkin().listJoints().map((j) => j.getName());
const prim = node.getMesh().listPrimitives()[0];
const uv = prim.getAttribute('TEXCOORD_0');
const joints = prim.getAttribute('JOINTS_0');
const weights = prim.getAttribute('WEIGHTS_0');
const pos = prim.getAttribute('POSITION');
const idx = prim.getIndices();

function part(name) {
  if (/^(spine_0[123]|clavicle_|upperarm_)/.test(name)) return 'jersey';
  if (/^lowerarm_/.test(name)) return 'sleeve'; // the long-sleeve undershirt
  if (/^(pelvis|thigh_)/.test(name)) return 'pants';
  if (/^calf_/.test(name)) return 'calf'; // split into pants and sock by height in paint-uniform.py
  if (/^(foot_|ball_)/.test(name)) return 'shoes';
  return 'skin';
}

const vPart = [];
const j = [], w = [], p = [];
const P = [];
let minY = Infinity, maxY = -Infinity;
for (let i = 0; i < uv.getCount(); i++) {
  joints.getElement(i, j);
  weights.getElement(i, w);
  pos.getElement(i, p);
  let best = 0;
  for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k;
  vPart.push(part(jointNames[j[best]]));
  P.push([p[0], p[1], p[2]]);
}
const tris = [];
const t = [];
for (let i = 0; i < idx.getCount(); i += 3) {
  const vs = [idx.getScalar(i), idx.getScalar(i + 1), idx.getScalar(i + 2)];
  const counts = {};
  for (const v of vs) counts[vPart[v]] = (counts[vPart[v]] || 0) + 1;
  const r = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const uvs = vs.map((v) => (uv.getElement(v, t), [t[0], t[1]]));
  const xyz = vs.map((v) => P[v].map((c) => +c.toFixed(4)));
  for (const q of xyz) { minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
  tris.push([r, uvs, xyz]);
}
fs.writeFileSync(out, JSON.stringify(tris));
const totals = {};
for (const [r] of tris) totals[r] = (totals[r] || 0) + 1;
console.log(totals, 'joints:', jointNames.length, 'y range:', minY.toFixed(3), maxY.toFixed(3));
