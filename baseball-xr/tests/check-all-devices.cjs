const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
  });

  for (const dev of ['metaQuest3', 'metaQuestPro', 'metaVRGlasses']) {
    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
    await page.goto(`https://localhost:8082/?tutorial=0&device=${dev}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 20000 });
    await page.evaluate(() => window.__world.launchXR());
    await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });

    const info = await page.evaluate(() => {
      const g = window.__game.sys;
      const cam = window.__world.camera;
      const proj = cam.projectionMatrix.elements;
      const fovY = 2 * Math.atan(1 / proj[5]) * (180 / Math.PI);
      const camPos = new (cam.position.constructor)();
      cam.getWorldPosition(camPos);
      return {
        camPos: { x: camPos.x, y: camPos.y, z: camPos.z },
        fovY,
        lowestReach: g.desktop.lowestReach(),
        zoneFloor: 0.45,
      };
    });
    console.log(`Device: ${dev}`, info);
    await page.close();
  }

  // Also check outside XR (desktop non-XR mode)
  const pageDesk = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  await pageDesk.goto('https://localhost:8082/?tutorial=0', { waitUntil: 'domcontentloaded' });
  await pageDesk.waitForFunction(() => window.__game && window.__world, null, { timeout: 20000 });
  const deskInfo = await pageDesk.evaluate(() => {
    const g = window.__game.sys;
    const cam = window.__world.camera;
    const camPos = new (cam.position.constructor)();
    cam.getWorldPosition(camPos);
    const proj = cam.projectionMatrix.elements;
    const fovY = 2 * Math.atan(1 / proj[5]) * (180 / Math.PI);
    return {
      camPos: { x: camPos.x, y: camPos.y, z: camPos.z },
      fovY,
      lowestReach: g.desktop.lowestReach(),
    };
  });
  console.log('Outside XR (Desktop browser):', deskInfo);

  await browser.close();
})();

