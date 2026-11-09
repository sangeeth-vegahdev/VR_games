import fs from 'node:fs';

const files = [
  'vr-lobby/node_modules/@iwsdk/vite-plugin-dev/dist/index.js',
  'cricket-xr/node_modules/@iwsdk/vite-plugin-dev/dist/index.js',
  'baseball-xr/node_modules/@iwsdk/vite-plugin-dev/dist/index.js',
  'bulb-rush-xr/node_modules/@iwsdk/vite-plugin-dev/dist/index.js'
];

const target = `function createInjectionModuleSource(bundle) {
    return \`import { startIwsdkDevRuntime } from \${JSON.stringify(INJECTION_RUNTIME_ID_PREFIX + path.basename(bundle.entryPath))};
startIwsdkDevRuntime(\${bundle.config});\`;
}`;

const replacement = `function createInjectionModuleSource(bundle) {
    return \`import { startIwsdkDevRuntime } from \${JSON.stringify(INJECTION_RUNTIME_ID_PREFIX + path.basename(bundle.entryPath))};
const __cfg = \${bundle.config};
const __d = new URL(location.href).searchParams.get("device") || localStorage.getItem("iwsdk:device");
if (__d) __cfg.device = __d;
startIwsdkDevRuntime(__cfg);\`;
}`;

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  let code = fs.readFileSync(f, 'utf8');
  if (code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync(f, code, 'utf8');
    console.log('Patched createInjectionModuleSource in:', f);
  } else {
    console.log('Target not found in:', f);
  }
}

