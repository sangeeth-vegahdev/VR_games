const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
  });

  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  await page.goto('https://localhost:8082/?tutorial=0&device=metaQuest3', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 20000 });
  await page.evaluate(() => window.__world.launchXR());
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(500);

  // 1. Move mouse to (640, 400)
  await page.mouse.move(640, 400);
  await page.waitForTimeout(100);

  const state1 = await page.evaluate(() => {
    const s = window.__game.sys;
    return {
      desktopActive: s.desktop.active,
      desktopSeen: s.desktop.seen,
      glovePocket: { x: s.glove.pocket.x, y: s.glove.pocket.y, z: s.glove.pocket.z },
    };
  });
  console.log('1. After mouse move:', state1);

  // 2. Click mouse at (640, 400)
  console.log('Clicking canvas...');
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(100);

  const state2 = await page.evaluate(() => {
    const s = window.__game.sys;
    const grip = s.player?.gripSpaces?.left;
    const gripPos = grip ? grip.getWorldPosition(new s.glove.pocket.constructor()) : null;
    return {
      desktopActive: s.desktop.active,
      desktopSeen: s.desktop.seen,
      controllersMoved: s.desktop.controllersMoved(s.player),
      handsLive: s.desktop.handsLive(s.player),
      glovePocket: { x: s.glove.pocket.x, y: s.glove.pocket.y, z: s.glove.pocket.z },
      gripPos,
    };
  });
  console.log('2. After click:', state2);

  await browser.close();
})();

