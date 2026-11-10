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

    const xrStatus = await page.evaluate(async () => {
      const world = window.__world;
      const game = window.__game?.sys;
      const renderer = world?.renderer;

      // Check if session is active
      const inSession = !!world?.session;
      
      // Let's measure frame times using XRSession requestAnimationFrame if in session, or window.rAF
      return new Promise((resolve) => {
        let frameCount = 0;
        let lastTime = performance.now();
        const deltas = [];

        function onFrame(now) {
          const delta = now - lastTime;
          lastTime = now;
          if (frameCount > 0) deltas.push(delta);
          frameCount++;
          if (frameCount < 60) {
            if (world?.session) {
              world.session.requestAnimationFrame(onFrame);
            } else {
              requestAnimationFrame(onFrame);
            }
          } else {
            const sum = deltas.reduce((a, b) => a + b, 0);
            const avg = sum / deltas.length;
            const sorted = [...deltas].sort((a, b) => a - b);
            resolve({
              inSession,
              avgMs: avg,
              fps: 1000 / avg,
              p95: sorted[Math.floor(sorted.length * 0.95)],
              worst: sorted[sorted.length - 1],
              calls: renderer?.info?.render?.calls,
              triangles: renderer?.info?.render?.triangles,
            });
          }
        }

        if (world?.session) {
          world.session.requestAnimationFrame(onFrame);
        } else {
          requestAnimationFrame(onFrame);
        }
      });
    });

    console.log('--- XR PERFORMANCE ---');
    console.log(JSON.stringify(xrStatus, null, 2));

  } catch (err) {
    console.error('Fatal in test:', err);
  } finally {
    if (browser) await browser.close();
  }
})();

