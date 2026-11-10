const { chromium } = require('playwright');

(async () => {
  let browser = null;
  try {
    browser = await chromium.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
      args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
    });

    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
    page.on('console', m => {
      const text = m.text();
      if (!text.includes('[THREE]') && !text.includes('favicon')) {
        console.log('[Browser]', text);
      }
    });

    await page.goto('https://localhost:8082/?tutorial=0&device=metaQuest3', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 20000 });
    console.log('Game initialized');

    // Launch XR
    await page.evaluate(() => {
      window.__world.launchXR();
    });
    await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
    console.log('XR Session active');

    // Give it a moment to settle
    await page.waitForTimeout(1000);

    // Inspect input sources and initial state
    const initInfo = await page.evaluate(() => {
      const g = window.__game.sys;
      const session = window.__world.session;
      const sources = session ? Array.from(session.inputSources).map(s => ({
        handedness: s.handedness,
        targetRayMode: s.targetRayMode,
        hasHand: !!s.hand,
        hasGamepad: !!s.gamepad,
      })) : [];

      return {
        state: g.state,
        crouchBaseY: g.crouchBaseY,
        headPos: { x: g.head.x, y: g.head.y, z: g.head.z },
        camPos: { x: window.__world.camera.position.x, y: window.__world.camera.position.y, z: window.__world.camera.position.z },
        gloveSide: g.glove.side,
        gloveOk: g.glove.ok,
        desktopActive: g.desktop.active,
        desktopSeen: g.desktop.seen,
        sources,
      };
    });
    console.log('Initial session info:', JSON.stringify(initInfo, null, 2));

    // Now start the round
    await page.evaluate(() => {
      window.__game.start();
    });

    // Wait for pitch to be called
    await page.waitForFunction(() => window.__game.sys.state === 'sign' || window.__game.sys.state === 'windup', null, { timeout: 5000 });

    const pitchInfo = await page.evaluate(() => {
      const g = window.__game.sys;
      return {
        call: g.call,
        calledAt: { x: g.calledAt.x, y: g.calledAt.y, z: g.calledAt.z },
        pitchType: g.pitchType.name,
      };
    });
    console.log('Pitch called:', pitchInfo);

    // Let's force a low pitch call:
    await page.evaluate(() => {
      const g = window.__game.sys;
      g.call = 'down';
      g.offset.x = 0;
      g.offset.y = -0.22; // Low pitch near bottom of strike zone
      g.calledAt.set(g.zoneCenter.x + g.offset.x, g.zoneCenter.y + g.offset.y, -0.55);
      g.target.position.copy(g.calledAt);
    });

    // Wait until flying
    await page.waitForFunction(() => window.__game.sys.state === 'flying', null, { timeout: 10000 });
    console.log('Ball is flying!');

    // Check where the called target projects on the screen!
    const screenTarget = await page.evaluate(() => {
      const g = window.__game.sys;
      const camera = window.__world.camera;
      const targetPos = g.calledAt.clone();
      const p = targetPos.project(camera);
      const cv = g.desktop.canvas();
      const rect = cv.getBoundingClientRect();
      const screenX = rect.left + ((p.x + 1) / 2) * rect.width;
      const screenY = rect.top + ((-p.y + 1) / 2) * rect.height;

      return {
        calledAt: { x: g.calledAt.x, y: g.calledAt.y, z: g.calledAt.z },
        ndc: { x: p.x, y: p.y },
        screen: { x: screenX, y: screenY },
        canvasRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        lowestReach: g.desktop.lowestReach(),
      };
    });
    console.log('Screen target projection:', screenTarget);

    // Move the actual Playwright mouse to the screen coordinates of the gold target ring!
    await page.mouse.move(screenTarget.screen.x, screenTarget.screen.y);
    await page.waitForTimeout(50);

    // Check where the desktop pointer and glove pocket ended up!
    const mouseResult = await page.evaluate(() => {
      const g = window.__game.sys;
      return {
        desktopNdc: { x: g.desktop.ndc.x, y: g.desktop.ndc.y },
        desktopTarget: { x: g.desktop.target.x, y: g.desktop.target.y, z: g.desktop.target.z },
        glovePocket: { x: g.glove.pocket.x, y: g.glove.pocket.y, z: g.glove.pocket.z },
        calledAt: { x: g.calledAt.x, y: g.calledAt.y, z: g.calledAt.z },
        gloveOk: g.glove.ok,
        desktopActive: g.desktop.active,
        distancePocketToTarget: g.glove.pocket.distanceTo(g.calledAt),
      };
    });
    console.log('Glove position after moving mouse to target:', mouseResult);

    // Wait for pitch to resolve
    await page.waitForFunction(() => window.__game.sys.state === 'feedback', null, { timeout: 5000 });

    const finalResult = await page.evaluate(() => {
      const g = window.__game.sys;
      return {
        lastResult: g.lastResult,
        spot: g.spot,
        catches: g.catches,
        misses: g.misses,
        nearest: g.nearest,
      };
    });
    console.log('Final catch result:', finalResult);

  } catch (err) {
    console.error('Error in investigation:', err);
  } finally {
    if (browser) await browser.close();
  }
})();

