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

  const info = await page.evaluate(() => {
    const cam = window.__world.camera;
    const proj = cam.projectionMatrix.elements;
    // proj[5] is 1 / tan(fov_y / 2)
    const fovY = 2 * Math.atan(1 / proj[5]) * (180 / Math.PI);
    return {
      camPos: cam.position,
      proj5: proj[5],
      fovY,
      lowestReach: window.__game.sys.desktop.lowestReach(),
    };
  });
  console.log('Camera FOV and lowest reach in XR:', info);
  await browser.close();
})();

