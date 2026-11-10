const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--ignore-certificate-errors',
        '--use-gl=angle',
        '--use-angle=gl',
        '--enable-webgl',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();
    page.on('console', (msg) => {
      const txt = msg.text();
      if (!txt.includes('[vite]') && !txt.includes('Download the React DevTools')) {
        console.log('[Browser]', txt);
      }
    });

    console.log('1. Loading game on https://localhost:8082/?tutorial=0&device=metaQuest3');
    await page.goto('https://localhost:8082/?tutorial=0&device=metaQuest3', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 20000 });

    // Test A: Performance outside XR and shadow map autoUpdate check
    const perfCheck = await page.evaluate(async () => {
      const world = window.__world;
      const shadowAuto = world.renderer?.shadowMap?.autoUpdate;

      const deltas = [];
      let count = 0;
      let last = performance.now();
      await new Promise((resolve) => {
        function onF(now) {
          const dt = now - last;
          last = now;
          if (count > 0) deltas.push(dt);
          count++;
          if (count < 60) requestAnimationFrame(onF);
          else resolve();
        }
        requestAnimationFrame(onF);
      });
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      return {
        avgMs: +avg.toFixed(2),
        fps: +(1000 / avg).toFixed(1),
        shadowAutoUpdate: shadowAuto,
      };
    });
    console.log(`Performance & Shadow Check: ${perfCheck.fps} FPS (avg ${perfCheck.avgMs} ms), shadowAutoUpdate = ${perfCheck.shadowAutoUpdate}`);
    assert.strictEqual(perfCheck.shadowAutoUpdate, false, 'renderer.shadowMap.autoUpdate must be false');

    // Test B: Deep crouch on desktop
    const desktopCrouchCheck = await page.evaluate(() => {
      const g = window.__game.sys;
      g.desktop.ndc.y = 0;
      g.updateCrouch(0.1);
      const camYNormal = window.__world.camera.position.y;

      g.desktop.ndc.y = -1;
      for (let i = 0; i < 30; i++) g.updateCrouch(1 / 60);
      const camYDown = window.__world.camera.position.y;

      g.desktop.ndc.y = 0;
      for (let i = 0; i < 30; i++) g.updateCrouch(1 / 60);

      return {
        camYNormal: +camYNormal.toFixed(3),
        camYDown: +camYDown.toFixed(3),
        crouchDelta: +(camYNormal - camYDown).toFixed(3),
      };
    });
    console.log('Desktop Deep Crouch Test:', desktopCrouchCheck);
    assert.ok(desktopCrouchCheck.crouchDelta > 0.25, `Desktop camera must crouch deeper when looking down (crouched ${desktopCrouchCheck.crouchDelta}m)`);

    // Test C: Launch WebXR session
    console.log('2. Launching WebXR session in Quest 3 emulator...');
    await page.evaluate(async () => {
      if (window.IWER_DEVICE) window.IWER_DEVICE.primaryInputMode = 'hand';
      await window.__world.launchXR();
    });
    await page.waitForTimeout(1000);
    console.log('XR session active.');

    // Test D: Deep crouch in WebXR
    const xrCrouchCheck = await page.evaluate(() => {
      const g = window.__game.sys;
      const rig = g.player;

      // 1. Level gaze stance
      g.player.head.quaternion.set(0, 0, 0, 1);
      g.crouchBaseY = null;
      g.updateCrouch(1 / 60);
      const rigYForward = rig.position.y;

      // 2. Looking down at 45 degrees
      const angle = -(45 * Math.PI) / 180;
      g.player.head.quaternion.setFromAxisAngle(new (window.__world.camera.position.constructor)(1, 0, 0), angle);
      g.crouchBaseY = null;
      g.updateCrouch(1 / 60);
      const rigYDown = rig.position.y;

      // Reset
      g.player.head.quaternion.set(0, 0, 0, 1);
      g.crouchBaseY = null;
      g.updateCrouch(1 / 60);

      return {
        rigYForward: +rigYForward.toFixed(3),
        rigYDown: +rigYDown.toFixed(3),
        crouchDelta: +(rigYForward - rigYDown).toFixed(3),
      };
    });
    console.log('WebXR Deep Crouch Test:', xrCrouchCheck);
    assert.ok(xrCrouchCheck.crouchDelta > 0.20, `XR rig must crouch deeper when head tilts down (crouched ${xrCrouchCheck.crouchDelta}m)`);

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
          lowestReach: g.desktop.lowestReach(),
        };
      });

      await page.mouse.move(proj.screenX, proj.screenY);
      await page.waitForTimeout(60);

      // Check gaze tracking and glove position during flight
      const flightState = await page.evaluate(() => {
        const g = window.__game.sys;
        return {
          gloveOk: g.glove.ok,
          glovePocketY: +g.glove.pocket.y.toFixed(3),
          desktopActive: g.desktop.active,
          reticleVisible: g.eyeTracker.visible,
          reticleColor: '#' + g.eyeTracker.ringMaterial.color.getHexString(),
          focusWatching: g.focus.watching,
        };
      });
      console.log('Flight state:', flightState);

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
      results.push({ name: sc.name, ...outcome, ...flightState });
      assert.strictEqual(outcome.result, 'caught', `Must catch ${sc.name}`);
    }

    // Capture screenshot
    const shotPath = path.join('C:\\Users\\sange\\.gemini\\antigravity\\brain\\268950bb-3b2c-4033-a379-10d005ef01e2', 'verified-fixes-v2.png');
    await page.screenshot({ path: shotPath });
    console.log(`\nScreenshot saved: ${shotPath}`);

    console.log('\n--- ALL VERIFICATIONS PASSED SUCCESSFULLY ---');
    console.log(JSON.stringify({ results }, null, 2));

  } catch (err) {
    console.error('Verification failed:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();

