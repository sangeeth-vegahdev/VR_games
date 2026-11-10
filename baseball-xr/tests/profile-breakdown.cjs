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

    await page.goto('https://localhost:8082/?tutorial=0', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const timing = await page.evaluate(async () => {
      const world = window.__world;
      const game = window.__game?.sys;
      const renderer = world?.renderer;

      if (!game || !renderer) return { error: 'No game or renderer found' };

      // Patch methods to measure execution times
      const measures = {
        gameUpdate: [],
        desktopUpdate: [],
        gloveUpdate: [],
        diagnosticsUpdate: [],
        pitcherUpdate: [],
        rendererRender: [],
        shadowPass: [],
      };

      // Wrap game.update
      const origGameUpdate = game.update.bind(game);
      game.update = function(dt) {
        const t0 = performance.now();
        origGameUpdate(dt);
        measures.gameUpdate.push(performance.now() - t0);
      };

      // Wrap desktop.update
      const origDesktopUpdate = game.desktop.update.bind(game.desktop);
      game.desktop.update = function(...args) {
        const t0 = performance.now();
        origDesktopUpdate(...args);
        measures.desktopUpdate.push(performance.now() - t0);
      };

      // Wrap glove.update
      const origGloveUpdate = game.glove.update.bind(game.glove);
      game.glove.update = function(...args) {
        const t0 = performance.now();
        origGloveUpdate(...args);
        measures.gloveUpdate.push(performance.now() - t0);
      };

      // Wrap diagnostics.update
      if (game.diagnostics) {
        const origDiagUpdate = game.diagnostics.update.bind(game.diagnostics);
        game.diagnostics.update = function(...args) {
          const t0 = performance.now();
          origDiagUpdate(...args);
          measures.diagnosticsUpdate.push(performance.now() - t0);
        };
      }

      // Wrap pitcher.update
      const origPitcherUpdate = game.pitcher.update.bind(game.pitcher);
      game.pitcher.update = function(...args) {
        const t0 = performance.now();
        origPitcherUpdate(...args);
        measures.pitcherUpdate.push(performance.now() - t0);
      };

      // Wrap renderer.render
      const origRender = renderer.render.bind(renderer);
      renderer.render = function(...args) {
        const t0 = performance.now();
        origRender(...args);
        measures.rendererRender.push(performance.now() - t0);
      };

      // Measure 60 frames
      await new Promise((res) => {
        let count = 0;
        function step() {
          count++;
          if (count < 60) {
            requestAnimationFrame(step);
          } else {
            res();
          }
        }
        requestAnimationFrame(step);
      });

      const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3) : 0;
      const max = (arr) => arr.length ? Math.max(...arr).toFixed(3) : 0;

      return {
        gameUpdate: { avg: avg(measures.gameUpdate), max: max(measures.gameUpdate) },
        desktopUpdate: { avg: avg(measures.desktopUpdate), max: max(measures.desktopUpdate) },
        gloveUpdate: { avg: avg(measures.gloveUpdate), max: max(measures.gloveUpdate) },
        diagnosticsUpdate: { avg: avg(measures.diagnosticsUpdate), max: max(measures.diagnosticsUpdate) },
        pitcherUpdate: { avg: avg(measures.pitcherUpdate), max: max(measures.pitcherUpdate) },
        rendererRender: { avg: avg(measures.rendererRender), max: max(measures.rendererRender) },
      };
    });

    console.log('--- TIMING BREAKDOWN ---');
    console.log(JSON.stringify(timing, null, 2));

  } catch (err) {
    console.error('Fatal in test:', err);
  } finally {
    if (browser) await browser.close();
  }
})();

