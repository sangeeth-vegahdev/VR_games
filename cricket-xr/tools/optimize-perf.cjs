const fs = require('fs');

// 1. Optimize src/hud.js
let hud = fs.readFileSync('src/hud.js', 'utf8');
hud = hud.replace(
  '  set(partial) {\n    Object.assign(this.model, partial);\n    this.drawBoard();\n  }',
  '  set(partial) {\n    let changed = false;\n    for (const [k, v] of Object.entries(partial)) {\n      if (this.model[k] !== v) {\n        this.model[k] = v;\n        changed = true;\n      }\n    }\n    if (changed) this.drawBoard();\n  }'
);
hud = hud.replace(
  'this.board = new Panel(world, 2.4, 1.0, 400, [0, 2.6, -3.4]);',
  'this.board = new Panel(world, 2.4, 1.0, 280, [0, 2.6, -3.4]);'
);
fs.writeFileSync('src/hud.js', hud, 'utf8');
console.log('hud.js optimized');

// 2. Optimize src/stadium.js shadow map size
let stadium = fs.readFileSync('src/stadium.js', 'utf8');
stadium = stadium.replace(
  'sun.shadow.mapSize.set(2048, 2048);',
  'sun.shadow.mapSize.set(1024, 1024);'
);
fs.writeFileSync('src/stadium.js', stadium, 'utf8');
console.log('stadium.js optimized');

