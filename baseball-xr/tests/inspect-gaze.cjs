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
    await page.goto('https://localhost:8082/?autoxr=1&tutorial=0', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const info = await page.evaluate(() => {
      const world = window.__world;
      const game = window.__game?.sys;
      const player = game?.player || world?.player;
      const iwer = window.IWER_DEVICE;

      return {
        hasIwer: !!iwer,
        iwerDevice: iwer?.device,
        iwerGazeMode: iwer?.gazeMode,
        iwerKeys: iwer ? Object.keys(iwer) : [],
        playerHead: !!player?.head,
        playerEyeSpace: !!player?.eyeSpace,
        playerGazeOrigin: player?.gazeOrigin,
        focusMode: game?.focus?.mode,
        focusOrigin: game?.focus?.origin,
        focusDir: game?.focus?.dir,
        cameraPos: world?.camera?.position,
        cameraDir: world?.camera?.getWorldDirection(new (world.camera.position.constructor)()),
        eyeTrackerVisible: game?.eyeTracker?.visible,
        eyeTrackerGroupVisible: game?.eyeTracker?.group?.visible,
        eyeTrackerPos: game?.eyeTracker?.group?.position,
      };
    });

    console.log('--- IWER & GAZE STATE ---');
    console.log(JSON.stringify(info, null, 2));

  } catch (e) {
    console.error(e);
  } finally {
    if (browser) await browser.close();
  }
})();

