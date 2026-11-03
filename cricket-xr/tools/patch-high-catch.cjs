const fs = require('fs');
const path = require('path');

const gamePath = path.join(__dirname, '..', 'src', 'game.js');
let src = fs.readFileSync(gamePath, 'utf8').replace(/\r\n/g, '\n');

if (!src.includes('this.isHighCatch = this.ballNo > 3')) {
  src = src.replace('  beginThrow() {\n    this.ballNo++;\n', '  beginThrow() {\n    this.ballNo++;\n    this.isHighCatch = this.ballNo > 3 && Math.random() < 0.25;\n');
}

fs.writeFileSync(gamePath, src, 'utf8');
console.log('Normalized and patched beginThrow in game.js');
