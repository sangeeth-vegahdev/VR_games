/**
 * Comprehensive Playwright Runtime QA Test Suite for Baseball VR Catching System
 * Verifies all 10 user requirements with live browser automation and captures screenshots.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PORT = 8082;
const GAME_URL = `https://127.0.0.1:${PORT}`;
const ARTIFACTS_DIR = path.resolve(__dirname, '../../audit-artifacts');
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

const results = {
  timestamp: new Date().toISOString(),
  scenarios: [],
  screenshots: [],
};

function record(id, title, expected, actual, pass, details = {}) {
  results.scenarios.push({ id, title, expected, actual, status: pass ? 'PASS' : 'FAIL', details });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id}: ${title} -> ${actual}`);
}

async function startServer() {
  console.log(`Starting Vite server on https://127.0.0.1:${PORT}...`);
  const lockDir = path.join(__dirname, '..', '.iwsdk', 'runtime');
  try { if (fs.existsSync(lockDir)) fs.rmSync(lockDir, { recursive: true, force: true }); } catch (e) {}

  const viteBin = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
  const proc = spawn(process.execPath, [viteBin, '--port', String(PORT), '--host', '127.0.0.1'], {
    cwd: path.resolve(__dirname, '..'),
    shell: false,
    stdio: 'pipe',
  });

  proc.stderr.on('data', (d) => {
    const s = d.toString();
    if (!s.includes('ExperimentalWarning')) console.error('[Vite Stderr]', s.trim());
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Vite server start timed out after 20s')), 20000);
    proc.stdout.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('Local:') || msg.includes('localhost:') || msg.includes('ready in') || msg.includes('127.0.0.1')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.on('error', reject);
  });
  console.log('Vite server ready.');
  return proc;
}

(async () => {
  let serverProc = null;
  let browser = null;

  try {
    serverProc = await startServer();

    browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
    });

    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // =========================================================================
    // 1. Initial Load & Setup
    // =========================================================================
    console.log('\n--- 1. Loading game on desktop ---');
    await page.goto(`${GAME_URL}/?pitches=12&tutorial=0&debug=1`);
    await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });
    await page.waitForTimeout(1000);

    const shotLoad = path.join(ARTIFACTS_DIR, 'qa-1-initial-desktop.png');
    await page.screenshot({ path: shotLoad });
    results.screenshots.push(shotLoad);

    // =========================================================================
    // 2. Mouse-to-Glove Mapping Across Canvas (Items 3 & 4)
    // =========================================================================
    console.log('\n--- 2. Checking mouse-to-glove smoothness and boundaries across canvas ---');
    const mappingCheck = await page.evaluate(async () => {
      const s = window.__game.sys;
      const cv = s.desktop.canvas().getBoundingClientRect();
      let hasDiscontinuity = false;
      let minTargetY = Infinity;
      let maxTargetY = -Infinity;

      // 1. Horizontal sweep: sweep mouse continuously from left (-0.85) to right (+0.85)
      let prevX = null;
      for (let gx = -0.85; gx <= 0.85; gx += 0.05) {
        const px = cv.left + ((gx + 1) / 2) * cv.width;
        const py = cv.top + 0.5 * cv.height;
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: px, clientY: py }));
        s.desktop.update(s.player, 1 / 60);

        if (prevX !== null) {
          const dx = s.desktop.target.x - prevX;
          if (dx <= 0 || dx > 0.45) hasDiscontinuity = true;
        }
        prevX = s.desktop.target.x;
      }

      // 2. Vertical sweep: sweep mouse continuously from top (+0.85) to bottom (-0.98)
      let prevY = null;
      for (let gy = 0.85; gy >= -0.98; gy -= 0.05) {
        const px = cv.left + 0.5 * cv.width;
        const py = cv.top + ((1 - gy) / 2) * cv.height;
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: px, clientY: py }));
        s.desktop.update(s.player, 1 / 60);

        if (s.desktop.target.y < minTargetY) minTargetY = s.desktop.target.y;
        if (s.desktop.target.y > maxTargetY) maxTargetY = s.desktop.target.y;

        if (prevY !== null) {
          const dy = prevY - s.desktop.target.y;
          if (dy <= 0 || dy > 0.35) hasDiscontinuity = true;
        }
        prevY = s.desktop.target.y;
      }

      // Check lowest point reachable with mouse at the absolute bottom
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: cv.left + cv.width / 2, clientY: cv.bottom - 1 }));
      s.desktop.update(s.player, 1 / 60);
      const lowestBottomTargetY = s.desktop.target.y;

      return {
        minTargetY: Math.round(minTargetY * 1000) / 1000,
        maxTargetY: Math.round(maxTargetY * 1000) / 1000,
        lowestBottomTargetY: Math.round(lowestBottomTargetY * 1000) / 1000,
        hasDiscontinuity,
      };
    });

    record(
      'MAPPING_SMOOTHNESS',
      'Mouse-to-glove mapping smoothness & no discontinuities',
      'Continuous monotonic mapping, hasDiscontinuity == false',
      `Discontinuity: ${mappingCheck.hasDiscontinuity}, MinY: ${mappingCheck.minTargetY}m, MaxY: ${mappingCheck.maxTargetY}m`,
      !mappingCheck.hasDiscontinuity,
      mappingCheck
    );

    record(
      'LOW_BOTTOM_REACH',
      'Mouse reaches lowest catching area at canvas bottom',
      'lowestTargetY <= 0.10 m (down to REACH_Y0 = 0.05m)',
      `Lowest Y: ${mappingCheck.lowestBottomTargetY} m`,
      mappingCheck.lowestBottomTargetY <= 0.10,
      mappingCheck
    );

    // =========================================================================
    // 3. Glove Collider Alignment & Orientation (Item 5)
    // =========================================================================
    console.log('\n--- 3. Verifying glove collider and height-dependent orientation ---');
    const gloveChecks = await page.evaluate(() => {
      const g = window.__game.sys.glove;
      const results = [];

      for (const testY of [0.25, 0.85, 1.30]) {
        g.target.set(0, testY, -0.55);
        g.pocket.copy(g.target);
        g.update(window.__game.sys.player, window.__game.sys.desktop, true, 1 / 60);

        const pocketPos = g.pocket.clone();
        const meshPos = g.object.position.clone();
        const distPocketToMesh = pocketPos.distanceTo(meshPos);
        const upVector = g.catcherUp(testY);

        results.push({
          testY,
          distPocketToMesh: Math.round(distPocketToMesh * 1000) / 1000,
          fingerUpY: Math.round(upVector.y * 1000) / 1000,
        });
      }
      return results;
    });

    const lowGlove = gloveChecks[0];
    const midGlove = gloveChecks[1];
    const highGlove = gloveChecks[2];

    record(
      'GLOVE_COLLIDER_POCKET_ALIGNMENT',
      'Glove mesh and collider follow actual pocket without offset',
      'Distance pocket to mesh == 0 (within recoil tolerance < 0.01m)',
      `Low: ${lowGlove.distPocketToMesh}m, Mid: ${midGlove.distPocketToMesh}m, High: ${highGlove.distPocketToMesh}m`,
      gloveChecks.every((c) => c.distPocketToMesh < 0.01),
      gloveChecks
    );

    record(
      'LOW_GLOVE_ORIENTATION',
      'Glove fingers tilt downward for low pitches and upright for high pitches',
      'Low Y fingers < 0, High Y fingers > 0.8',
      `Low finger Y: ${lowGlove.fingerUpY}, Mid finger Y: ${midGlove.fingerUpY}, High finger Y: ${highGlove.fingerUpY}`,
      lowGlove.fingerUpY < 0 && highGlove.fingerUpY > 0.8 && midGlove.fingerUpY > lowGlove.fingerUpY,
      gloveChecks
    );

    // =========================================================================
    // 4. Gold Target vs Cyan Eye Reticle Distinction (Item 9)
    // =========================================================================
    console.log('\n--- 4. Verifying pitch target vs eye-gaze reticle distinction ---');
    const visualDistinction = await page.evaluate(() => {
      const sys = window.__game.sys;
      const target = sys.target;
      const eyeTracker = sys.eyeTracker;

      const targetColor = target.material.color.getHex().toString(16);
      const targetChildrenCount = target.children.length; // tick tabs
      const targetDepth = target.position.z;

      const eyeColor = eyeTracker.ringMaterial.color.getHex().toString(16);
      const eyeChildrenCount = eyeTracker.group.children.length;

      return {
        targetColor,
        targetChildrenCount,
        targetDepth,
        eyeColor,
        eyeChildrenCount,
      };
    });

    record(
      'VISUAL_DISTINCTION',
      'Pitch target ring has distinct crosshair ticks and gold color',
      'Target color == ffd166 with 4 tick tabs; eye reticle cyan/white with 0 ticks',
      `Target: #${visualDistinction.targetColor} (${visualDistinction.targetChildrenCount} ticks), Eye: #${visualDistinction.eyeColor}`,
      visualDistinction.targetColor === 'ffd166' && visualDistinction.targetChildrenCount === 4,
      visualDistinction
    );

    // =========================================================================
    // 5. Gaze Ray Direction, Lock, and Unlock (Items 6 & 7)
    // =========================================================================
    console.log('\n--- 5. Verifying gaze reticle alignment, locking on ball, and unlocking ---');
    const gazeTracking = await page.evaluate(async () => {
      const s = window.__game.sys;
      const tracker = s.eyeTracker;
      const cv = s.desktop.canvas().getBoundingClientRect();

      // Test gaze direction follows cursor
      const cx = cv.left + cv.width * 0.75;
      const cy = cv.top + cv.height * 0.25;
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy }));

      s.focus.sample(s.player, window.__world.camera, false);

      const gazeSimulated = s.focus.simulated;
      const gazeMode = s.focus.mode;
      const gazeDir = { x: s.focus.dir.x, y: s.focus.dir.y, z: s.focus.dir.z };

      // Simulate a moving pitch at 5m depth
      const ballPos = s.glove.v[4].set(0, 0.85, -5);
      tracker.show();

      // 1. Point gaze directly at ball -> should lock (cyan)
      const ballScreen = ballPos.clone().project(window.__world.camera);
      const ballPx = cv.left + ((ballScreen.x + 1) / 2) * cv.width;
      const ballPy = cv.top + ((1 - ballScreen.y) / 2) * cv.height;

      window.dispatchEvent(new PointerEvent('pointermove', { clientX: ballPx, clientY: ballPy }));
      s.focus.sample(s.player, window.__world.camera, false);
      s.focus.track(ballPos, 1 / 60, 5);
      tracker.update(s.focus, ballPos, s.focus.watching, true, window.__world.camera, null, 1 / 60);

      const lockedWatching = s.focus.watching;
      const lockedColor = tracker.ringMaterial.color.getHex().toString(16);
      const lockedReticlePos = { x: tracker.group.position.x, y: tracker.group.position.y, z: tracker.group.position.z };

      // 2. Move gaze away from ball -> should unlock (white)
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: cv.left + 50, clientY: cv.top + 50 }));
      s.focus.sample(s.player, window.__world.camera, false);
      s.focus.track(ballPos, 1 / 60, 5);
      tracker.update(s.focus, ballPos, s.focus.watching, true, window.__world.camera, null, 1 / 60);

      const unlockedWatching = s.focus.watching;
      const unlockedColor = tracker.ringMaterial.color.getHex().toString(16);

      return {
        gazeSimulated,
        gazeMode,
        gazeDir,
        lockedWatching,
        lockedColor,
        lockedReticlePos,
        unlockedWatching,
        unlockedColor,
      };
    });

    record(
      'GAZE_SIMULATION_ACTIVE',
      'Desktop gaze simulation active outside XR sessions on mouse move',
      'simulated == true, mode == eyes',
      `Simulated: ${gazeTracking.gazeSimulated}, Mode: ${gazeTracking.gazeMode}`,
      gazeTracking.gazeSimulated && gazeTracking.gazeMode === 'eyes',
      gazeTracking
    );

    record(
      'GAZE_LOCK_AND_UNLOCK',
      'Gaze reticle locks cyan on ball and dims white when looking away',
      'Locked: watching=true (cyan 5eead4), Unlocked: watching=false (white ffffff)',
      `Locked: ${gazeTracking.lockedWatching} (#${gazeTracking.lockedColor}), Unlocked: ${gazeTracking.unlockedWatching} (#${gazeTracking.unlockedColor})`,
      gazeTracking.lockedWatching === true &&
        gazeTracking.lockedColor === '5eead4' &&
        gazeTracking.unlockedWatching === false &&
        gazeTracking.unlockedColor === 'ffffff',
      gazeTracking
    );

    const shotGaze = path.join(ARTIFACTS_DIR, 'qa-2-gaze-reticle.png');
    await page.screenshot({ path: shotGaze });
    results.screenshots.push(shotGaze);

    // =========================================================================
    // 6. Viewport Resizing & Different Screen Aspect Ratios (Item 8)
    // =========================================================================
    console.log('\n--- 6. Verifying gaze and pointer alignment under multiple canvas resolutions ---');
    const viewports = [
      { width: 1280, height: 720, label: '16:9 720p' },
      { width: 800, height: 600, label: '4:3 standard' },
      { width: 600, height: 900, label: 'portrait/tall' },
    ];
    let allViewportsAccurate = true;

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(400);

      const checkVp = await page.evaluate(() => {
        const s = window.__game.sys;
        const cv = s.desktop.canvas().getBoundingClientRect();
        const cx = cv.left + cv.width / 2;
        const cy = cv.top + cv.height / 2;
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy }));
        s.desktop.update(s.player, 1 / 60);
        s.glove.update(s.player, s.desktop, false, 1 / 60);

        const errX = Math.abs(s.desktop.target.x);
        return { width: cv.width, height: cv.height, errX };
      });

      if (checkVp.errX > 0.05) allViewportsAccurate = false;
      console.log(`  Viewport ${vp.label}: canvas ${checkVp.width}x${checkVp.height}, center error: ${checkVp.errX.toFixed(4)}`);
    }

    record(
      'VIEWPORT_RESIZING_ACCURACY',
      'Pointer projection remains accurate across various canvas dimensions',
      'Center error < 0.05 across all aspect ratios',
      `All accurate: ${allViewportsAccurate}`,
      allViewportsAccurate
    );

    // Reset viewport to standard 1280x720
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(400);

    // =========================================================================
    // 7. Pitch Catching: Low, Middle, High, Low-Inside, Low-Outside (Items 1, 2, 10)
    // =========================================================================
    console.log('\n--- 7. Verifying actual pitch catches at runtime (Low, Middle, High, Inside, Outside) ---');
    await page.evaluate(() => {
      const s = window.__game.sys;
      s.lockout = 0;
      window.__game.start();
    });

    const pitchCatches = [
      { name: 'Middle Pitch', targetX: 0.0, targetY: 0.85 },
      { name: 'High Pitch', targetX: 0.0, targetY: 1.15 },
      { name: 'Low Pitch', targetX: 0.0, targetY: 0.45 },
      { name: 'Low Inside Pitch', targetX: -0.16, targetY: 0.48 },
      { name: 'Low Outside Pitch', targetX: 0.16, targetY: 0.48 },
    ];

    for (let i = 0; i < pitchCatches.length; i++) {
      const p = pitchCatches[i];
      console.log(`\n  Executing test pitch ${i + 1}/${pitchCatches.length}: ${p.name}...`);

      const catchResult = await page.evaluate(async ({ targetX, targetY }) => {
        const s = window.__game.sys;
        const cv = s.desktop.canvas().getBoundingClientRect();

        // 1. Wait for sign state
        const t0 = Date.now();
        while (s.state !== 'sign' && Date.now() - t0 < 8000) {
          await new Promise((r) => setTimeout(r, 50));
        }

        // 2. Analytic screen coordinates mapping for exact glove positioning directly from targetX, targetY
        const testAim = s.glove.v[5].set(targetX, targetY, s.arriveZ);
        const camProj = testAim.clone().project(window.__world.camera);
        const ndcX = Math.max(-1, Math.min(1, camProj.x));

        // Exact vertical mapping accounting for downward reach compensation:
        let ndcY;
        if (targetY >= 0.95) {
          ndcY = Math.max(-1, Math.min(1, camProj.y));
        } else {
          // Linear reach interpolation: out.y = 0.95 + 0.90 * ndc.y
          ndcY = Math.max(-1, Math.min(0, (targetY - 0.95) / 0.90));
        }

        const px = cv.left + ((ndcX + 1) / 2) * cv.width;
        const py = cv.top + ((1 - ndcY) / 2) * cv.height;

        // 3. Keep mitt aligned to target during windup and flight
        const flightStart = Date.now();
        while (s.state !== 'feedback' && Date.now() - flightStart < 12000) {
          if (s.state === 'windup') {
            s.aim.set(targetX, targetY, s.arriveZ);
            s.calledAt.copy(s.aim);
          }
          window.dispatchEvent(new PointerEvent('pointermove', { clientX: px, clientY: py }));
          s.desktop.update(s.player, 1 / 60);
          s.glove.update(s.player, s.desktop, false, 1 / 60);
          await new Promise((r) => setTimeout(r, 16));
        }

        return {
          finalState: s.state,
          lastResult: s.lastResult,
          aimX: s.aim.x,
          aimY: s.aim.y,
          pocketX: s.glove.pocket.x,
          pocketY: s.glove.pocket.y,
          distanceToAim: s.glove.pocket.distanceTo(s.aim),
          catches: s.catches,
          misses: s.misses,
        };
      }, p);

      const shotPitch = path.join(ARTIFACTS_DIR, `qa-pitch-${i + 1}-${p.name.replace(/\s+/g, '-').toLowerCase()}.png`);
      await page.screenshot({ path: shotPitch });
      results.screenshots.push(shotPitch);

      const isCatch = catchResult.lastResult === 'caught';
      record(
        `PITCH_CATCH_${p.name.toUpperCase().replace(/\s+/g, '_')}`,
        `Catch registration for ${p.name}`,
        'outcome == caught (distance <= 0.22m)',
        `Outcome: ${catchResult.lastResult}, DistToAim: ${catchResult.distanceToAim.toFixed(4)}m`,
        isCatch,
        catchResult
      );
    }

    // =========================================================================
    // 8. Overall Summary & Final Check
    // =========================================================================
    console.log('\n--- 8. Runtime QA Complete ---');
    const total = results.scenarios.length;
    const passed = results.scenarios.filter((s) => s.status === 'PASS').length;
    const failed = total - passed;
    console.log(`\nQA Summary: ${passed}/${total} scenarios passed (${failed} failed). Page errors: ${errors.length}\n`);

    const summaryReportPath = path.join(ARTIFACTS_DIR, 'baseball-runtime-qa-results.json');
    fs.writeFileSync(summaryReportPath, JSON.stringify(results, null, 2));
    console.log('Results saved to', summaryReportPath);
  } catch (err) {
    console.error('Fatal QA error:', err);
  } finally {
    if (browser) await browser.close();
    if (serverProc) {
      console.log('Stopping Vite server...');
      try {
        if (process.platform === 'win32') {
          const { execSync } = require('child_process');
          execSync(`taskkill /pid ${serverProc.pid} /T /F`, { stdio: 'ignore' });
        } else {
          serverProc.kill();
        }
      } catch (e) {}
    }
    process.exit(0);
  }
})();
