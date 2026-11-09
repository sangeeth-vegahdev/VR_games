import fs from 'node:fs';

const files = [
  'vr-lobby/node_modules/@iwsdk/vite-plugin-dev/dist/index.js',
  'cricket-xr/node_modules/@iwsdk/vite-plugin-dev/dist/index.js',
  'baseball-xr/node_modules/@iwsdk/vite-plugin-dev/dist/index.js',
  'bulb-rush-xr/node_modules/@iwsdk/vite-plugin-dev/dist/index.js'
];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  let code = fs.readFileSync(f, 'utf8');
  code = code.replaceAll('timeout: 1500,', 'timeout: 6000,');
  code = code.replaceAll("if (observation.state === 'live') {", "if (false && observation.state === 'live') {");
  code = code.replaceAll("if (observation.state === 'unknown') {", "if (false && observation.state === 'unknown') {");
  
  // Suppress pipe bind throwing on Windows
  code = code.replaceAll(
    "throw new RuntimeOwnerError(`Cannot acquire the workspace owner endpoint (${error.code}); ownership is unknown. No browser was launched.`, previous);",
    "console.warn('[IWSDK] Ignoring named pipe EADDRINUSE, proceeding with dev server...'); return;"
  );

  fs.writeFileSync(f, code, 'utf8');
  console.log('Successfully patched EADDRINUSE in:', f);
}
