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

// Read HEAD
const head = fs.readFileSync('c:/Users/sange/Desktop/vr-games/.git/HEAD', 'utf8').trim();
console.log('HEAD:', head);
let refHash = '';
if (head.startsWith('ref: ')) {
  const refPath = path.join('c:/Users/sange/Desktop/vr-games/.git', head.slice(5));
  if (fs.existsSync(refPath)) {
    refHash = fs.readFileSync(refPath, 'utf8').trim();
  }
} else {
  refHash = head;
}
console.log('Current commit hash:', refHash);

let curr = refHash;
for (let i = 0; i < 15 && curr; i++) {
  const obj = readObject(curr);
  if (!obj) {
    console.log('Object not found in loose objects (might be packed):', curr);
    break;
  }
  const text = obj.content.toString('utf8');
  const lines = text.split('\n');
  const msgIdx = lines.findIndex(l => l === '');
  const commitMsg = lines.slice(msgIdx + 1).join('\n').trim();
  console.log(`Commit ${curr.slice(0, 7)}: ${commitMsg.split('\n')[0]}`);
  
  const parentLine = lines.find(l => l.startsWith('parent '));
  curr = parentLine ? parentLine.split(' ')[1] : null;
}

