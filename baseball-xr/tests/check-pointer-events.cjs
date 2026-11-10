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

  // Move mouse to the center of canvas (x: 640, y: 360) BEFORE launching XR
  await page.mouse.move(640, 360);
  await page.waitForTimeout(100);

  const beforeXR = await page.evaluate(() => {
    const s = window.__game.sys;
    return {
      desktopActive: s.desktop.active,
      desktopSeen: s.desktop.seen,
      desktopNdc: { x: s.desktop.ndc.x, y: s.desktop.ndc.y },
      glovePocket: { x: s.glove.pocket.x, y: s.glove.pocket.y, z: s.glove.pocket.z },
    };
  });
  console.log('Before XR after mouse move to (640, 360):', beforeXR);

  // Now Launch XR
  await page.evaluate(() => window.__world.launchXR());
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  console.log('XR Session active');

  await page.waitForTimeout(500);

  const afterXRLaunch = await page.evaluate(() => {
    const s = window.__game.sys;
    return {
      desktopActive: s.desktop.active,
      desktopSeen: s.desktop.seen,
      desktopNdc: { x: s.desktop.ndc.x, y: s.desktop.ndc.y },
      glovePocket: { x: s.glove.pocket.x, y: s.glove.pocket.y, z: s.glove.pocket.z },
    };
  });
  console.log('Immediately after XR launch:', afterXRLaunch);

  // Now move mouse inside XR to (640, 500)
  await page.mouse.move(640, 500);
  await page.waitForTimeout(100);

  const afterMoveInXR = await page.evaluate(() => {
    const s = window.__game.sys;
    // Call update to simulate frame step
    s.desktop.update(s.player, 1 / 60);
    s.glove.update(s.player, s.desktop, true, 1 / 60);
    return {
      desktopActive: s.desktop.active,
      desktopSeen: s.desktop.seen,
      desktopNdc: { x: s.desktop.ndc.x, y: s.desktop.ndc.y },
      glovePocket: { x: s.glove.pocket.x, y: s.glove.pocket.y, z: s.glove.pocket.z },
      gloveOk: s.glove.ok,
      inHeadset: s.inHeadset(),
      controllersMoved: s.desktop.controllersMoved(s.player),
      handsLive: s.desktop.handsLive(s.player),
    };
  });
  console.log('After moving mouse to (640, 500) in XR:', afterMoveInXR);

  // Now move mouse to (640, 680) - near bottom
  await page.mouse.move(640, 680);
  await page.waitForTimeout(100);

  const nearBottom = await page.evaluate(() => {
    const s = window.__game.sys;
    s.desktop.update(s.player, 1 / 60);
    s.glove.update(s.player, s.desktop, true, 1 / 60);
    return {
      desktopActive: s.desktop.active,
      desktopSeen: s.desktop.seen,
      desktopNdc: { x: s.desktop.ndc.x, y: s.desktop.ndc.y },
      glovePocket: { x: s.glove.pocket.x, y: s.glove.pocket.y, z: s.glove.pocket.z },
      desktopTarget: { x: s.desktop.target.x, y: s.desktop.target.y, z: s.desktop.target.z },
    };
  });
  console.log('After moving mouse to (640, 680):', nearBottom);

  await browser.close();
})();

