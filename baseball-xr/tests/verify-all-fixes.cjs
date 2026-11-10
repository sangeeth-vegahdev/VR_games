const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

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

    console.log('1. Loading game on https://localhost:8082/?tutorial=0&device=metaQuest3');
    await page.goto('https://localhost:8082/?tutorial=0&device=metaQuest3', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 20000 });

    // Test A: Performance outside XR
    const perfDesk = await page.evaluate(async () => {
      return new Promise((resolve) => {
        let count = 0;
        let last = performance.now();
        const deltas = [];
        function onF(now) {
          const dt = now - last;
          last = now;
          if (count > 0) deltas.push(dt);
          count++;
          if (count < 60) requestAnimationFrame(onF);
          else {
            const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
            resolve({ avgMs: +avg.toFixed(2), fps: +(1000 / avg).toFixed(1) });
          }
        }
        requestAnimationFrame(onF);
      });
    });
    console.log(`Desktop Framerate: ${perfDesk.fps} FPS (avg ${perfDesk.avgMs} ms)`);

    // Test B: Deep crouch when looking down
    const crouchCheck = await page.evaluate(() => {
      const g = window.__game.sys;
      // Start with normal desktop view
      g.desktop.ndc.y = 0;
      g.updateCrouch(0.1);
      const camYNormal = window.__world.camera.position.y;

      // Mouse moved to bottom (looking down)
      g.desktop.ndc.y = -1.0;
      for (let i = 0; i < 30; i++) g.updateCrouch(1 / 60);
      const camYDown = window.__world.camera.position.y;

      return { camYNormal, camYDown, crouchDelta: +(camYNormal - camYDown).toFixed(3) };
    });
    console.log('Deep Crouch Test (Desktop):', crouchCheck);
    assert.ok(crouchCheck.crouchDelta > 0.20, `Crouch must drop camera by > 0.20m when looking down (dropped ${crouchCheck.crouchDelta}m)`);

    // Test C: Launch XR session
    console.log('2. Launching WebXR session...');
    await page.evaluate(() => window.__world.launchXR());
    await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
    await page.waitForTimeout(1000);
    console.log('XR session active.');

    // Test D: XR Crouch when looking down
    const xrCrouchCheck = await page.evaluate(() => {
      const g = window.__game.sys;
      const rig = g.player;

      // 1. Level gaze stance
      g.headQ.set(0, 0, 0, 1);
      g.crouchBaseY = null;
      g.updateCrouch(1 / 60);
      const rigYForward = rig.position.y;

      // 2. Looking down at 45 degrees
      const angle = -(45 * Math.PI) / 180;
      g.headQ.setFromAxisAngle(new (window.__world.camera.position.constructor)(1, 0, 0), angle);
      g.crouchBaseY = null;
      g.updateCrouch(1 / 60);
      const rigYDown = rig.position.y;

      // Reset
      g.headQ.set(0, 0, 0, 1);
      g.crouchBaseY = null;
      g.updateCrouch(1 / 60);

      return { rigYForward: +rigYForward.toFixed(3), rigYDown: +rigYDown.toFixed(3), crouchDelta: +(rigYForward - rigYDown).toFixed(3) };
    });
    console.log('Deep Crouch Test (XR Headset):', xrCrouchCheck);
    assert.ok(xrCrouchCheck.crouchDelta > 0.20, `XR rig must lower by > 0.20m when head tilts down (lowered ${xrCrouchCheck.crouchDelta}m)`);

    // Test E: Low catches in XR session
    console.log('3. Starting round and testing low catches in WebXR...');
    await page.evaluate(() => window.__game.start());

    const lowScenarios = [
      { name: 'Low Middle Pitch', call: 'down', offsetY: -0.15, offsetX: 0 },
      { name: 'Low Away Pitch', call: 'down-away', offsetY: -0.16, offsetX: 0.16 },
      { name: 'Low In Pitch', call: 'down-in', offsetY: -0.16, offsetX: -0.16 },
    ];

    const results = [];
    for (let i = 0; i < lowScenarios.length; i++) {
      const sc = lowScenarios[i];
      console.log(`\nTesting ${sc.name} (${i + 1}/${lowScenarios.length})...`);

      // Wait for sign / windup
      await page.waitForFunction(() => {
        const s = window.__game.sys;
        return s.state === 'sign' || s.state === 'windup' || s.state === 'ready';
      }, null, { timeout: 10000 });

      // Override call
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

      // Move mouse to target position in screen coords
      const proj = await page.evaluate(() => {
        const g = window.__game.sys;
        const cam = window.__world.camera;
        const p = g.calledAt.clone().project(cam);
        const cv = g.desktop.canvas();
        const r = cv.getBoundingClientRect();
        return {
          screenX: r.left + ((p.x + 1) / 2) * r.width,
          screenY: r.top + ((-p.y + 1) / 2) * r.height,
          calledAtY: g.calledAt.y,
        };
      });

      await page.mouse.move(proj.screenX, proj.screenY);
      await page.waitForTimeout(50);

      // Check gaze tracking state during flight
      const gazeState = await page.evaluate(() => {
        const g = window.__game.sys;
        return {
          mode: g.focus.mode,
          watching: g.focus.watching,
          reticleVisible: g.eyeTracker.visible,
          reticleColor: '#' + g.eyeTracker.ringMaterial.color.getHexString(),
          gazeOriginY: +g.focus.origin.y.toFixed(2),
        };
      });
      console.log('Gaze state during flight:', gazeState);

      // Wait for feedback
      await page.waitForFunction(() => window.__game.sys.state === 'feedback', null, { timeout: 6000 });

      const outcome = await page.evaluate(() => {
        const g = window.__game.sys;
        return {
          result: g.lastResult,
          catches: g.catches,
          misses: g.misses,
          focus: g.lastFocus,
          nearest: g.nearest,
        };
      });
      console.log(`Outcome for ${sc.name}:`, outcome);
      results.push({ name: sc.name, ...outcome });
      assert.strictEqual(outcome.result, 'caught', `Must catch ${sc.name}`);
    }

    // Capture screenshot
    const shotPath = path.join('C:\\Users\\sange\\.gemini\\antigravity\\brain\\268950bb-3b2c-4033-a379-10d005ef01e2', 'verified-low-catches-final.png');
    await page.screenshot({ path: shotPath });
    console.log(`\nScreenshot saved: ${shotPath}`);

    console.log('\n--- ALL VERIFICATIONS PASSED ---');
    console.log(JSON.stringify({ results, perfDesk }, null, 2));

  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
