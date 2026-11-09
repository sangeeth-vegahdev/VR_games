import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
// Ports must match `port` in src/config.js: the tiles open these directly.
const GAME_SERVERS = [
  { dir: 'cricket-xr', port: 8081 },
  { dir: 'baseball-xr', port: 8082 },
  { dir: 'bulb-rush-xr', port: 8083 },
];

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

// A tile opens its game on that game's own port, so a lobby with no game servers shows "refused to connect".
// Start whichever are not already running. start-all.mjs starts them itself and sets VR_GAMES_NO_AUTOSTART.
function startGameServers() {
  return {
    name: 'vr-lobby-start-game-servers',
    apply: 'serve',
    async configureServer() {
      if (process.env.VR_GAMES_NO_AUTOSTART) return;
      for (const { dir, port } of GAME_SERVERS) {
        if (await isPortOpen(port)) continue;
        const cwd = path.join(REPO_ROOT, dir);
        const viteBin = path.join(cwd, 'node_modules', 'vite', 'bin', 'vite.js');
        if (!existsSync(viteBin)) {
          console.warn(`[lobby] ${dir} is not installed, run "npm install" there. Its tile will not open.`);
          continue;
        }
        console.log(`[lobby] Starting ${dir} on port ${port}`);
        // strictPort: a game on any other port could not be reached from its tile.
        const game = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort'], {
          cwd,
          stdio: 'inherit',
        });
        process.once('exit', () => game.kill());
      }
    },
  };
}

export default defineConfig({
  plugins: [iwsdkDev(), startGameServers()],
  server: {
    host: '0.0.0.0',
    port: 8080,
    open: false,
    proxy: {
      '/cricket': {
        target: 'http://localhost:8081',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/cricket/, ''),
      },
      '/baseball': {
        target: 'http://localhost:8082',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/baseball/, ''),
      },
      '/bulbrush': {
        target: 'http://localhost:8083',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/bulbrush/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});

