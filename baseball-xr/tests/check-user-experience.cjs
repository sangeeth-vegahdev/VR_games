const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
  });

  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  
  // Test both with default URL (like user does)
  await page.goto('https://localhost:8082/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 20000 });

  const deviceModes = await page.evaluate(() => {
    return {
      hasIWER: !!window.IWER_DEVICE,
      primaryInputMode: window.IWER_DEVICE?.primaryInputMode,
      selectedDevice: localStorage.getItem('iwsdk:device'),
    };
  });
  console.log('Page initial state:', deviceModes);

  // User enters XR by clicking the Enter VR button or launching XR
  await page.evaluate(() => window.__world.launchXR());
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(500);

  const xrState = await page.evaluate(() => {
    const s = window.__game.sys;
    const session = window.__world.session;
    const sources = session ? Array.from(session.inputSources).map(src => ({
      handedness: src.handedness,
      hasHand: !!src.hand,
      hasGamepad: !!src.gamepad,
      targetRayMode: src.targetRayMode,
    })) : [];

    return {
      sources,
      handsLive: s.desktop.handsLive(s.player),
      desktopActive: s.desktop.active,
      desktopSeen: s.desktop.seen,
      glovePocket: { x: s.glove.pocket.x, y: s.glove.pocket.y, z: s.glove.pocket.z },
    };
  });
  console.log('After entering XR:', xrState);

  // User moves the mouse across the screen
  await page.mouse.move(640, 360);
  await page.waitForTimeout(100);
  await page.mouse.move(800, 500);
  await page.waitForTimeout(100);

  const afterMove = await page.evaluate(() => {
    const s = window.__game.sys;
    return {
      handsLive: s.desktop.handsLive(s.player),
      controllersMoved: s.desktop.controllersMoved(s.player),
      desktopActive: s.desktop.active,
      desktopSeen: s.desktop.seen,
      glovePocket: { x: s.glove.pocket.x, y: s.glove.pocket.y, z: s.glove.pocket.z },
    };
  });
  console.log('After user moves mouse:', afterMove);

  await browser.close();
})();

