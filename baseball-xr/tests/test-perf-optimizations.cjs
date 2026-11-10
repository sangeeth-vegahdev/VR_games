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

    const results = await page.evaluate(async () => {
      const world = window.__world;
      const renderer = world?.renderer;

      async function measure(label, count = 45) {
        return new Promise((resolve) => {
          let frames = 0;
          let last = performance.now();
          const deltas = [];
          function step(now) {
            const dt = now - last;
            last = now;
            if (frames > 0) deltas.push(dt);
            frames++;
            if (frames < count) {
              if (world?.session) world.session.requestAnimationFrame(step);
              else requestAnimationFrame(step);
            } else {
              const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
              resolve({
                label,
                avgMs: +avg.toFixed(2),
                fps: +(1000 / avg).toFixed(1),
                calls: renderer.info.render.calls,
              });
            }
          }
          if (world?.session) world.session.requestAnimationFrame(step);
          else requestAnimationFrame(step);
        });
      }

      const res = [];
      // 1. Baseline
      res.push(await measure('1. Baseline'));

      // 2. Turn off shadow map autoUpdate
      renderer.shadowMap.autoUpdate = false;
      res.push(await measure('2. shadowMap.autoUpdate = false'));

      // 3. Disable shadowMap altogether
      renderer.shadowMap.enabled = false;
      res.push(await measure('3. shadowMap.enabled = false'));

      return res;
    });

    console.log('--- OPTIMIZATION EXPERIMENT ---');
    console.log(JSON.stringify(results, null, 2));

  } catch (err) {
    console.error('Fatal in test:', err);
  } finally {
    if (browser) await browser.close();
  }
})();

