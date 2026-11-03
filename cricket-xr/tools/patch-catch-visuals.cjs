const fs = require('fs');

// 1. Update src/fx.js
let fx = fs.readFileSync('src/fx.js', 'utf8');
fx = fx.replace(/const geo = new SphereGeometry\(0\.025, 8, 6\);/, 'const geo = new SphereGeometry(0.012, 8, 6);');
fx = fx.replace(/const BURST_COUNT = 36;/, 'const BURST_COUNT = 32;');
fx = fx.replace(/const BURST_LIFE = 0\.7;/, 'const BURST_LIFE = 0.45;');
fx = fx.replace(
  'bit.vel.set(Math.random() * 2 - 1, Math.random() * 1.5 + 0.3, Math.random() * 2 - 1).multiplyScalar(1.6);',
  'const angle = Math.random() * Math.PI * 2;\n      const speed = 0.5 + Math.random() * 0.7;\n      bit.vel.set(Math.cos(angle) * speed, Math.sin(angle) * speed + 0.35, (Math.random() - 0.75) * 0.3);'
);
fs.writeFileSync('src/fx.js', fx, 'utf8');
console.log('fx.js successfully patched');

// 2. Update src/game.js
let game = fs.readFileSync('src/game.js', 'utf8');
game = game.replace(
  'if (this.heldBy) this.ball.position.copy(this.palm[this.heldBy]);',
  'if (this.heldBy) {\n      this.ball.scale.setScalar(0.55);\n      this.ball.position.copy(this.palm[this.heldBy]);\n      this.ball.position.z -= 0.035;\n      this.ball.position.y += 0.02;\n      this.ball.position.x += (this.heldBy === "left" ? 0.02 : -0.02);\n    }'
);
fs.writeFileSync('src/game.js', game, 'utf8');
console.log('game.js successfully patched');

