const { chromium } = require('playwright');
const path = require('path');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
      args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
    });

    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
    page.on('console', m => {
      const t = m.text();
      if (!t.includes('[THREE]') && !t.includes('warning X4122') && !t.includes('favicon')) {
        console.log('[Browser]', t);
      }
    });

    console.log('Navigating to game...');
    await page.goto('https://localhost:8082/?tutorial=0&device=metaQuest3', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 20000 });

    console.log('Launching XR session (Meta Quest 3 in IWER)...');
    await page.mouse.move(640, 360);
    await page.evaluate(() => window.__world.launchXR());
    await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
    await page.waitForTimeout(1000);
    console.log('XR session running.');

    // Start round
    await page.evaluate(() => window.__game.start());

    const lowScenarios = [
      { name: 'Low Middle Pitch', call: 'down', offsetY: -0.13, offsetX: 0 },
      { name: 'Low Away Pitch', call: 'down-away', offsetY: -0.15, offsetX: 0.16 },
      { name: 'Low In Pitch', call: 'down-in', offsetY: -0.15, offsetX: -0.16 },
    ];

    const results = [];

    for (let i = 0; i < lowScenarios.length; i++) {
      const sc = lowScenarios[i];
      console.log(`\n--- Testing ${sc.name} (${i + 1}/${lowScenarios.length}) ---`);

      // Wait for sign / windup
      await page.waitForFunction(() => {
        const s = window.__game.sys;
        return s.state === 'sign' || s.state === 'windup' || s.state === 'ready';
      }, null, { timeout: 10000 });

      // Override call to guarantee the low scenario
      await page.evaluate((s) => {
        const g = window.__game.sys;
        g.call = s.call;
        g.offset.x = s.offsetX;
        g.offset.y = s.offsetY;
        g.calledAt.set(g.zoneCenter.x + g.offset.x, g.zoneCenter.y + g.offset.y, -0.55);
        g.target.position.copy(g.calledAt);
      }, sc);

      // Wait for ball to be flying
      await page.waitForFunction(() => window.__game.sys.state === 'flying', null, { timeout: 10000 });

      // Project target to screen coordinates
      const proj = await page.evaluate(() => {
        const g = window.__game.sys;
        const cam = window.__world.camera;
        const p = g.calledAt.clone().project(cam);
        const cv = g.desktop.canvas();
        const r = cv.getBoundingClientRect();
        return {
          calledAt: { x: g.calledAt.x, y: g.calledAt.y, z: g.calledAt.z },
          screenX: r.left + ((p.x + 1) / 2) * r.width,
          screenY: r.top + ((-p.y + 1) / 2) * r.height,
        };
      });

      console.log(`Target in 3D: (${proj.calledAt.x.toFixed(2)}, ${proj.calledAt.y.toFixed(2)}) -> Screen: (${Math.round(proj.screenX)}, ${Math.round(proj.screenY)})`);

      // Move mouse to target
      await page.mouse.move(proj.screenX, proj.screenY);
      await page.waitForTimeout(50);

      // Check alignment
      const align = await page.evaluate(() => {
        const g = window.__game.sys;
        const dist = g.glove.pocket.distanceTo(g.calledAt);
        return {
          glovePocket: { x: g.glove.pocket.x, y: g.glove.pocket.y, z: g.glove.pocket.z },
          distanceToTarget: dist,
          desktopActive: g.desktop.active,
          fingerDirY: g.glove.v[0].y,
        };
      });
      console.log(`Alignment check: dist=${(align.distanceToTarget * 100).toFixed(1)}cm, desktopActive=${align.desktopActive}, fingerY=${align.fingerDirY.toFixed(2)}`);

      // Wait for catch feedback
      await page.waitForFunction(() => window.__game.sys.state === 'feedback', null, { timeout: 5000 });

      const outcome = await page.evaluate(() => {
        const g = window.__game.sys;
        return {
          lastResult: g.lastResult,
          spot: g.spot,
          catches: g.catches,
          misses: g.misses,
          nearest: g.nearest,
        };
      });
      console.log(`Outcome: result=${outcome.lastResult}, spot=${outcome.spot}, catches=${outcome.catches}, misses=${outcome.misses}`);

      results.push({ name: sc.name, ...outcome, alignDistCm: align.distanceToTarget * 100 });

      // Wait for next pitch ready
      await page.waitForTimeout(1200);
    }

    const shotPath = path.resolve(__dirname, 'low-catch-verification.png');
    await page.screenshot({ path: shotPath });
    console.log(`\nScreenshot saved: ${shotPath}`);

    console.log('\n=== FINAL VERIFICATION SUMMARY ===');
    console.table(results);

    const allPassed = results.every(r => r.lastResult === 'caught');
    if (allPassed) {
      console.log('SUCCESS: All low catches registered perfectly!');
    } else {
      console.error('FAILURE: Some low catches missed.');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution failed:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();

