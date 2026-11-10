// Starts all 3 games and the Central VR Lobby concurrently,
// and opens Chrome with Meta WebXR Emulator (IWER) enabled.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APPS = [
  { name: 'VR Lobby', dir: 'vr-lobby', port: 8080 },
  { name: 'Cricket Catch', dir: 'cricket-xr', port: 8081 },
  { name: 'Glove Up (Baseball)', dir: 'baseball-xr', port: 8082 },
  { name: 'Bulb Rush', dir: 'bulb-rush-xr', port: 8083 },
];

console.log('========================================================');
console.log('   VR GAMES HUB: CENTRAL LOBBY & EXPERIENCES');
console.log('========================================================\n');

// 1. Clean stale runtime locks before starting
for (const app of APPS) {
  const lockDir = path.join(__dirname, app.dir, '.iwsdk', 'runtime');
  try {
    if (fs.existsSync(lockDir)) {
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  } catch (e) {
    // ignore
  }
}

const procs = [];
let lobbyReady = false;

for (const app of APPS) {
  console.log(`[STARTING] ${app.name} on port ${app.port}...`);
  const viteBin = path.join(__dirname, app.dir, 'node_modules', 'vite', 'bin', 'vite.js');
  
  const proc = spawn(process.execPath, [viteBin, '--port', String(app.port), '--host', '0.0.0.0'], {
    cwd: path.join(__dirname, app.dir),
    stdio: 'pipe',
    shell: false,
    env: { ...process.env, VR_GAMES_NO_AUTOSTART: '1' }, // this script starts the games, so the lobby must not
  });

  proc.stdout.on('data', (d) => {
    const text = d.toString().trim();
    if (text.includes('Local:')) {
      console.log(`[READY] ${app.name} -> https://localhost:${app.port}`);
      if (app.port === 8080 && !lobbyReady) {
        lobbyReady = true;
        console.log('\n>>> Launching Google Chrome with Meta WebXR Emulator (IWER)...');
        console.log('    Opening VR Lobby (8080), Cricket Catch (8081), and Glove Up (8082)...');
        spawn('cmd.exe', ['/c', 'start', 'chrome', 'https://localhost:8080', 'https://localhost:8081', 'https://localhost:8082', '--ignore-certificate-errors', '--allow-insecure-localhost'], {
          detached: true,
          stdio: 'ignore',
        });
      }
    }
  });

  proc.stderr.on('data', (d) => {
    const text = d.toString().trim();
    if (text && !text.includes('deprecated') && !text.includes('warn') && !text.includes('IWSDK Dev Summary')) {
      console.error(`[${app.name} ERR] ${text}`);
    }
  });

  procs.push(proc);
}

console.log('\nAll 4 servers launched. Open https://localhost:8080.\nOn a Quest use https://<this-PC-LAN-IP>:8080.\n');

process.on('SIGINT', () => {
  console.log('\nShutting down all servers...');
  for (const p of procs) p.kill();
  process.exit(0);
});
