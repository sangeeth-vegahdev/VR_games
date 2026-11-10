const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function readObject(hash) {
  const dir = hash.substring(0, 2);
  const file = hash.substring(2);
  const objPath = path.join('c:/Users/sange/Desktop/vr-games/.git/objects', dir, file);
  if (!fs.existsSync(objPath)) return null;
  const compressed = fs.readFileSync(objPath);
  const decompressed = zlib.inflateSync(compressed);
  const nullIdx = decompressed.indexOf(0);
  const header = decompressed.subarray(0, nullIdx).toString();
  const content = decompressed.subarray(nullIdx + 1);
  return { header, content };
}

function parseTree(hash) {
  const obj = readObject(hash);
  if (!obj) return null;
  const entries = [];
  let buf = obj.content;
  while (buf.length > 0) {
    const spaceIdx = buf.indexOf(32); // space
    const mode = buf.subarray(0, spaceIdx).toString();
    const nullIdx = buf.indexOf(0, spaceIdx);
    const name = buf.subarray(spaceIdx + 1, nullIdx).toString();
    const sha = buf.subarray(nullIdx + 1, nullIdx + 21).toString('hex');
    entries.push({ mode, name, sha });
    buf = buf.subarray(nullIdx + 21);
  }
  return entries;
}

function findPath(treeSha, parts) {
  let curr = treeSha;
  for (const part of parts) {
    const entries = parseTree(curr);
    if (!entries) return null;
    const match = entries.find(e => e.name === part);
    if (!match) return null;
    curr = match.sha;
  }
  return curr;
}

function showCommitFile(commitHash, filePath) {
  const commitObj = readObject(commitHash);
  const text = commitObj.content.toString('utf8');
  const treeSha = text.split('\n')[0].split(' ')[1];
  const blobSha = findPath(treeSha, filePath.split('/'));
  if (!blobSha) {
    console.log(`File ${filePath} not found in commit ${commitHash}`);
    return null;
  }
  const blob = readObject(blobSha);
  return blob.content.toString('utf8');
}

console.log('=== GAZE.JS in 068dada ===');
const gaze06 = showCommitFile('068dadaffa640c00cf85f2cc670729e04dca3594', 'baseball-xr/src/gaze.js');
console.log(gaze06);

console.log('=== EYE-TRACKER.JS in 068dada ===');
const eye06 = showCommitFile('068dadaffa640c00cf85f2cc670729e04dca3594', 'baseball-xr/src/eye-tracker.js');
console.log(eye06);
