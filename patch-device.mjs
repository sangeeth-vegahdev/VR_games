import fs from 'node:fs';
import path from 'node:path';

const APPS = ['vr-lobby', 'cricket-xr', 'baseball-xr', 'bulb-rush-xr'];

for (const app of APPS) {
  const chunksDir = path.join(app, 'node_modules', '@iwsdk', 'vite-plugin-dev', 'dist', 'injection', 'chunks');
  if (!fs.existsSync(chunksDir)) continue;
  
  for (const file of fs.readdirSync(chunksDir)) {
    if (!file.endsWith('.js')) continue;
    const fullPath = path.join(chunksDir, file);
    let code = fs.readFileSync(fullPath, 'utf8');
    
    if (code.includes('const t=mD[e.device]')) {
      code = code.replace(
        'const t=mD[e.device]',
        'const _dev=new URL(location.href).searchParams.get("device")||localStorage.getItem("iwsdk:device")||e.device;const t=mD[_dev]||mD[e.device]'
      );
      fs.writeFileSync(fullPath, code, 'utf8');
      console.log('Patched device switcher in:', fullPath);
    }
  }
}

