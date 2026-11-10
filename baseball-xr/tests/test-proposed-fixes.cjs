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

    const testResults = await page.evaluate(async () => {
      const world = window.__world;
      const game = window.__game?.sys;
      const renderer = world?.renderer;

      if (!game || !renderer) return { error: 'Game not ready' };

      // 1. Test performance with shadowMap.autoUpdate = false
      renderer.shadowMap.autoUpdate = false;

      // 2. Test deep crouch when looking down
      // Simulate looking down in XR by tilting player.head
      const initialRigY = game.player?.position?.y ?? 0;
      
      // Let's test crouching calculation
      const testTilts = [0, 0.2, 0.4, 0.6, 0.8];
      const crouchDeltas = testTilts.map(tilt => {
        const extraCrouch = Math.min(0.35, tilt * 0.50);
        return { tilt, extraCrouch };
      });

      // 3. Test gaze tracking in XR
      game.focus.sample(game.player, world.camera, true);
      const xrGazeMode = game.focus.mode;
      const xrGazeOrigin = { ...game.focus.origin };
      const xrGazeDir = { ...game.focus.dir };

      // 4. Test ball flight gaze tracking
      const dummyBallPos = new (game.ball.position.constructor)(0, 0.60, -10);
      game.focus.track(dummyBallPos, 0.1, 10);
      const isWatchingHead = game.focus.watching;

      // 5. Measure framerate over 40 frames
      const fpsResult = await new Promise(res => {
        let count = 0;
        let last = performance.now();
        const deltas = [];
        function onF(now) {
          const dt = now - last;
          last = now;
          if (count > 0) deltas.push(dt);
          count++;
          if (count < 40) {
            if (world.session) world.session.requestAnimationFrame(onF);
            else requestAnimationFrame(onF);
          } else {
            const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
            res({ avgMs: +avg.toFixed(2), fps: +(1000 / avg).toFixed(1) });
          }
        }
        if (world.session) world.session.requestAnimationFrame(onF);
        else requestAnimationFrame(onF);
      });

      return {
        fpsResult,
        crouchDeltas,
        xrGazeMode,
        xrGazeOrigin,
        xrGazeDir,
        isWatchingHead,
      };
    });

    console.log('--- TEST RESULTS ---');
    console.log(JSON.stringify(testResults, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    if (browser) await browser.close();
  }
})();

