const fs = require('fs');
const path = require('path');

const gamePath = path.join(__dirname, '..', 'src', 'game.js');
let src = fs.readFileSync(gamePath, 'utf8').replace(/\r\n/g, '\n');

const oldBlock = `    this.side = Math.random() < 0.5 ? -1 : 1;
    this.swingA = lerp(CFG.swingBase, CFG.swingMax, ramp);`;

const newBlock = `    const isStraight = this.isHighCatch ? (Math.random() < 0.6) : (Math.random() < 0.3);
    if (isStraight) {
      this.side = 0;
      this.swingA = 0;
    } else {
      this.side = Math.random() < 0.5 ? -1 : 1;
      this.swingA = lerp(CFG.swingBase, CFG.swingMax, ramp);
    }`;

if (src.includes(oldBlock)) {
  src = src.replace(oldBlock, newBlock);
  fs.writeFileSync(gamePath, src, 'utf8');
  console.log('Successfully updated game.js with straight and curved trajectory variations');
} else {
  console.log('Block not found or already updated');
}

