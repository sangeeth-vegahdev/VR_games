const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
      args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
    });

    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await page.goto('https://localhost:8082/?autoxr=1&tutorial=0', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const debugInfo = await page.evaluate(() => {
      const g = window.__game.sys;
      const head = g.player.head;
      const qBefore = { x: head.quaternion.x, y: head.quaternion.y, z: head.quaternion.z, w: head.quaternion.w };
      
      // Rotate 45 deg down
      const angle = (45 * Math.PI) / 180;
      head.quaternion.set(Math.sin(angle/2), 0, 0, Math.cos(angle/2));
      head.updateMatrixWorld(true);
      const qAfter = { x: head.quaternion.x, y: head.quaternion.y, z: head.quaternion.z, w: head.quaternion.w };

      g.updateCrouch(1/60);
      return {
        qBefore,
        qAfter,
        gazeDir: { x: g.gazeDirTmp.x, y: g.gazeDirTmp.y, z: g.gazeDirTmp.z },
        rigY: g.player.position.y,
        crouchBaseY: g.crouchBaseY,
      };
    });

    console.log(JSON.stringify(debugInfo, null, 2));

  } finally {
    if (browser) await browser.close();
  }
})();

