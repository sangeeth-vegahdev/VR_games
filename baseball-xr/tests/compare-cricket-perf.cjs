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
    await page.goto('https://localhost:8081/?autoxr=1&tutorial=0', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const perf = await page.evaluate(async () => {
      const world = window.__world;
      const renderer = world?.renderer;
      return new Promise(resolve => {
        let count = 0;
        let last = performance.now();
        const deltas = [];
        function onF(now) {
          const dt = now - last;
          last = now;
          if (count > 0) deltas.push(dt);
          count++;
          if (count < 30) {
            if (world?.session) world.session.requestAnimationFrame(onF);
            else requestAnimationFrame(onF);
          } else {
            const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
            resolve({
              avgMs: +avg.toFixed(2),
              fps: +(1000 / avg).toFixed(1),
              calls: renderer?.info?.render?.calls,
              triangles: renderer?.info?.render?.triangles,
            });
          }
        }
        if (world?.session) world.session.requestAnimationFrame(onF);
        else requestAnimationFrame(onF);
      });
    });

    console.log('--- CRICKET XR PERF ---');
    console.log(JSON.stringify(perf, null, 2));

  } catch (e) {
    console.error(e);
  } finally {
    if (browser) await browser.close();
  }
})();

