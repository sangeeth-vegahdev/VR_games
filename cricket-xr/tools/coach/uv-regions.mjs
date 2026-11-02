// Writes the body mesh's UV triangles, each tagged with the clothing region of its dominant bone.
// Usage: node uv-regions.mjs <body.gltf> <out.json>   (see README.md)
import { NodeIO } from '@gltf-transform/core';
import fs from 'node:fs';

const [, , src, out] = process.argv;
const doc = await new NodeIO().read(src);
const root = doc.getRoot();
const node = root.listNodes().find((n) => n.getMesh() && n.getMesh().listPrimitives()[0].getAttribute('TEXCOORD_0') && n.getName().startsWith('SuperHero'));
const skin = node.getSkin();
const jointNames = skin.listJoints().map((j) => j.getName());
const prim = node.getMesh().listPrimitives()[0];
const uv = prim.getAttribute('TEXCOORD_0');
const joints = prim.getAttribute('JOINTS_0');
const weights = prim.getAttribute('WEIGHTS_0');
const pos = prim.getAttribute('POSITION');
const idx = prim.getIndices();

function region(name) {
  if (/^(spine_0[123]|clavicle_|upperarm_)/.test(name)) return 'shirt';
  if (/^(pelvis|thigh_|calf_)/.test(name)) return 'trousers';
  if (/^(foot_|ball_)/.test(name)) return 'shoes';
  return 'skin';
}

const vRegion = [];
const j = [], w = [], p = [];
for (let i = 0; i < uv.getCount(); i++) {
  joints.getElement(i, j);
  weights.getElement(i, w);
  pos.getElement(i, p);
  let best = 0;
  for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k;
  vRegion.push(region(jointNames[j[best]]));
}
const tris = [];
const t = [];
for (let i = 0; i < idx.getCount(); i += 3) {
  const vs = [idx.getScalar(i), idx.getScalar(i + 1), idx.getScalar(i + 2)];
  const counts = {};
  for (const v of vs) counts[vRegion[v]] = (counts[vRegion[v]] || 0) + 1;
  const r = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const uvs = vs.map((v) => (uv.getElement(v, t), [t[0], t[1]]));
  tris.push([r, uvs]);
}
fs.writeFileSync(out, JSON.stringify(tris));
const totals = {};
for (const [r] of tris) totals[r] = (totals[r] || 0) + 1;
console.log(totals, 'joints:', jointNames.length);
