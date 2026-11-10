const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
      args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
    });

    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
    page.on('console', m => console.log('[Browser]', m.text()));
    page.on('pageerror', err => console.error('[PageError]', err.message));

    console.log('Navigating...');
    await page.goto('https://localhost:8082/?tutorial=0&device=metaQuest3', { waitUntil: 'domcontentloaded' });
    console.log('Waiting for __game and __world...');
    await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 20000 });
    console.log('App loaded.');

    const deskInfo = await page.evaluate(() => {
      const s = window.__game.sys;
      const cam = window.__world.camera;
      const pos = new (cam.position.constructor)();
      cam.getWorldPosition(pos);
      const dir = new (cam.position.constructor)();
      cam.getWorldDirection(dir);
      return {
        camWorldPos: { x: pos.x, y: pos.y, z: pos.z },
        camWorldDir: { x: dir.x, y: dir.y, z: dir.z },
        lowestReach: s.desktop.lowestReach(),
        zoneCenter: s.zoneCenter,
      };
    });
    console.log('Outside XR:', JSON.stringify(deskInfo, null, 2));

    await page.mouse.move(640, 360);
    await page.waitForTimeout(200);

    console.log('Launching XR...');
    await page.evaluate(() => window.__world.launchXR());
    await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
    console.log('XR launched.');

    const xrInfo = await page.evaluate(() => {
      const s = window.__game.sys;
      const cam = window.__world.camera;
      const pos = new (cam.position.constructor)();
      cam.getWorldPosition(pos);
      const dir = new (cam.position.constructor)();
      cam.getWorldDirection(dir);
      const proj = cam.projectionMatrix.elements;
      const fovY = 2 * Math.atan(1 / proj[5]) * (180 / Math.PI);
      return {
        camWorldPos: { x: pos.x, y: pos.y, z: pos.z },
        camWorldDir: { x: dir.x, y: dir.y, z: dir.z },
        fovY,
        lowestReach: s.desktop.lowestReach(),
        crouchBaseY: s.crouchBaseY,
        zoneCenter: s.zoneCenter,
      };
    });
    console.log('Inside XR (Quest 3):', JSON.stringify(xrInfo, null, 2));
  } catch (e) {
    console.error('Test error:', e);
  } finally {
    if (browser) await browser.close();
  }
})();
