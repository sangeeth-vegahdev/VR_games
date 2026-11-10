const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PORT = 8082;
const GAME_URL = `https://127.0.0.1:${PORT}`;

async function startServer() {
  const lockDir = path.join(__dirname, '..', '.iwsdk', 'runtime');
  try { if (fs.existsSync(lockDir)) fs.rmSync(lockDir, { recursive: true, force: true }); } catch (e) {}

  const viteBin = path.join(__dirname, '../node_modules/vite/bin/vite.js');
  const proc = spawn(process.execPath, [viteBin, '--port', String(PORT), '--host', '127.0.0.1'], {
    cwd: path.resolve(__dirname, '..'),
    shell: false,
    stdio: 'pipe',
  });

  proc.stderr.on('data', d => console.error('[Vite err]', d.toString()));
  proc.stdout.on('data', d => console.log('[Vite out]', d.toString()));

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Vite timeout')), 15000);
    proc.stdout.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('Local:') || msg.includes('localhost:') || msg.includes('ready in')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.on('error', reject);
  });
  return proc;
}

(async () => {
  let browser = null;
  try {
    console.log('Connecting to existing server at ' + GAME_URL);

    browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
    });

    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
    page.on('console', m => console.log('[Browser Log]', m.text()));
    page.on('pageerror', e => console.error('[Browser Error]', e.message));

    await page.goto(`${GAME_URL}/?tutorial=0&debug=1`);
    await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });
    console.log('Page loaded');

    // Launch XR
    await page.evaluate(() => {
      window.IWER_DEVICE.primaryInputMode = 'controller';
      window.__world.launchXR();
    });
    await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
    console.log('XR Session active');
    await page.waitForTimeout(1500);

    // Test mouse moves at various Y screen positions in XR
    const testPoints = [
      { name: 'Top edge', pyPercent: 0.05 },
      { name: 'Center', pyPercent: 0.50 },
      { name: 'Lower quarter', pyPercent: 0.75 },
      { name: 'Above bottom bar', pyPercent: 0.85 },
      { name: 'Inside bottom bar', pyPercent: 0.95 },
      { name: 'Bottom edge', pyPercent: 0.99 },
    ];

    const results = [];
    for (const pt of testPoints) {
      const res = await page.evaluate(async (p) => {
        const s = window.__game.sys;
        const cv = s.desktop.canvas();
        const rect = cv.getBoundingClientRect();
        const px = rect.left + rect.width / 2;
        const py = rect.top + rect.height * p.pyPercent;

        // Move mouse
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: px, clientY: py }));
        s.desktop.update(s.player, 1 / 60);
        s.glove.update(s.player, s.desktop, true, 1 / 60);

        const camPos = new (window.__world.camera.position.constructor)();
        window.__world.camera.getWorldPosition(camPos);
        const camDir = new (window.__world.camera.position.constructor)();
        window.__world.camera.getWorldDirection(camDir);

        return {
          name: p.name,
          pyPercent: p.pyPercent,
          ndc: { x: s.desktop.ndc.x, y: s.desktop.ndc.y },
          desktopActive: s.desktop.active,
          desktopSeen: s.desktop.seen,
          desktopTarget: { x: s.desktop.target.x, y: s.desktop.target.y, z: s.desktop.target.z },
          glovePocket: { x: s.glove.pocket.x, y: s.glove.pocket.y, z: s.glove.pocket.z },
          gloveOk: s.glove.ok,
          camPos: { x: camPos.x, y: camPos.y, z: camPos.z },
          camDir: { x: camDir.x, y: camDir.y, z: camDir.z },
          lowestReach: s.desktop.lowestReach(),
          cameraType: window.__world.camera.constructor.name,
          xrCameraType: window.__world.renderer?.xr?.getCamera?.()?.constructor?.name,
        };
      }, pt);
      results.push(res);
      await page.waitForTimeout(100);
    }

    console.log('RESULTS:\n', JSON.stringify(results, null, 2));

  } catch (e) {
    console.error('Fatal error:', e);
  } finally {
    if (browser) await browser.close();
  }
})();
