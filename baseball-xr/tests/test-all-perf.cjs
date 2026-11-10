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

    const report = await page.evaluate(async () => {
      const world = window.__world;
      const renderer = world?.renderer;
      const scene = world?.scene;

      async function measure(name, frames = 30) {
        return new Promise((res) => {
          let count = 0;
          let last = performance.now();
          const list = [];
          function onF(now) {
            const dt = now - last;
            last = now;
            if (count > 0) list.push(dt);
            count++;
            if (count < frames) {
              if (world?.session) world.session.requestAnimationFrame(onF);
              else requestAnimationFrame(onF);
            } else {
              const avg = list.reduce((a, b) => a + b, 0) / list.length;
              res({ name, avgMs: +avg.toFixed(2), fps: +(1000 / avg).toFixed(1) });
            }
          }
          if (world?.session) world.session.requestAnimationFrame(onF);
          else requestAnimationFrame(onF);
        });
      }

      const out = [];
      out.push(await measure('1. Baseline'));

      // Test A: Disable shadowMap autoUpdate
      renderer.shadowMap.autoUpdate = false;
      out.push(await measure('2. shadowMap.autoUpdate = false'));

      // Test B: Change crowd materials to MeshBasicMaterial
      scene.traverse((obj) => {
        if (obj.isInstancedMesh && obj.material?.isMeshStandardMaterial) {
          obj.material = new (obj.material.constructor)({
            map: obj.material.map,
            alphaTest: 0.5,
            side: obj.material.side,
          });
        }
      });
      out.push(await measure('3. After Crowd Material Check'));

      // Test C: Hide light towers / halos
      scene.traverse((obj) => {
        if (obj.isSprite) obj.visible = false;
      });
      out.push(await measure('4. Halos hidden'));

      // Test D: Pixel ratio / resolution
      const origPixelRatio = renderer.getPixelRatio();
      renderer.setPixelRatio(1.0);
      out.push(await measure(`5. PixelRatio 1.0 (was ${origPixelRatio})`));

      return out;
    });

    console.log(JSON.stringify(report, null, 2));

  } catch (e) {
    console.error(e);
  } finally {
    if (browser) await browser.close();
  }
})();

