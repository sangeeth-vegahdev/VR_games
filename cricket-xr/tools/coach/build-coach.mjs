// Builds public/models/coach.glb: Quaternius "Universal Base Characters" male (CC0), dressed in
// a painted training kit (paint-kit.py), with clips from the "Universal Animation Library" (CC0),
// which shares the same skeleton.
// Usage: node build-coach.mjs <char dir> <UAL1_Standard.glb> <painted dir> <out.glb> clipName[=newName] ...
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, resample } from '@gltf-transform/functions';
import fs from 'node:fs';

const [, , charDir, ualPath, paintDir, out, ...clipArgs] = process.argv;
const io = new NodeIO();
const doc = await io.read(`${charDir}/Superhero_Male_FullBody.gltf`);
const root = doc.getRoot();
const byName = (name) => root.listNodes().find((n) => n.getName() === name);

// ---- textures: the painted kit for the body ----
const tex = (file, mime = 'image/jpeg') => doc.createTexture(file).setImage(fs.readFileSync(`${paintDir}/${file}`)).setMimeType(mime).setURI(file);
const body = root.listMaterials().find((m) => m.getName() === 'MI_Superhero_Male');
body.setBaseColorTexture(tex('coach_basecolor.jpg')).setNormalTexture(tex('coach_normal.jpg')).setMetallicRoughnessTexture(tex('coach_rough.jpg'));
body.setDoubleSided(false);

// ---- hair: the game puts a cap on him, so the separate hair mesh is left out (the head texture
// has short cropped hair). The eyebrows share the hair material: give them smaller maps.
const hairBase = tex('hair_basecolor.jpg');
const hairNormal = tex('hair_normal.jpg');
for (const m of root.listMaterials()) if (m.getName() === 'MI_Hair_1') m.setBaseColorTexture(hairBase).setNormalTexture(hairNormal);

// ---- animations: copy the wanted clips onto our skeleton by bone name ----
const ual = await io.read(ualPath);
const wanted = new Map(clipArgs.map((a) => { const [from, to] = a.split('='); return [from, to || from]; }));
const pelvisScale = byName('pelvis').getTranslation()[2] / 0.9167;
for (const anim of ual.getRoot().listAnimations()) {
  if (!wanted.has(anim.getName())) continue;
  const copy = doc.createAnimation(wanted.get(anim.getName()));
  for (const ch of anim.listChannels()) {
    const target = ch.getTargetNode();
    const path = ch.getTargetPath();
    const name = target.getName();
    const dst = byName(name);
    if (!dst) continue;
    // Rotations carry the motion. Bone lengths differ between the rigs, so translations are
    // dropped, except the pelvis (the body's bob and weight shift), scaled to this body.
    if (path === 'scale') continue;
    if (path === 'translation' && name !== 'pelvis') continue;
    const s = ch.getSampler();
    const input = doc.createAccessor().setArray(s.getInput().getArray().slice()).setType('SCALAR');
    let arr = s.getOutput().getArray().slice();
    if (path === 'translation') arr = arr.map((v) => v * pelvisScale);
    const output = doc.createAccessor().setArray(arr).setType(s.getOutput().getType());
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation());
    copy.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(dst).setTargetPath(path).setSampler(sampler));
  }
  console.log('clip', anim.getName(), '->', wanted.get(anim.getName()), copy.listChannels().length, 'channels');
}

// ---- trim: unused vertex streams, then prune and compact ----
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) for (const sem of ['TEXCOORD_1', 'TEXCOORD_2', 'TEXCOORD_3', 'COLOR_0', 'COLOR_1']) p.setAttribute(sem, null);
const buffer = root.listBuffers()[0];
for (const a of root.listAccessors()) a.setBuffer(buffer);
for (const b of root.listBuffers().slice(1)) b.dispose();
for (const t of root.listTextures()) t.setURI('');
await doc.transform(resample(), dedup(), prune());
await io.write(out, doc);
console.log('wrote', out, fs.statSync(out).size, 'bytes');
