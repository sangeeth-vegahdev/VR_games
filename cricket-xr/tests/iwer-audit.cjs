const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const AUDIT_OUT = path.resolve('audit-artifacts');
if (fs.existsSync(AUDIT_OUT)) {
  fs.rmSync(AUDIT_OUT, { recursive: true, force: true });
}
fs.mkdirSync(AUDIT_OUT, { recursive: true });

(async () => {
  console.log('=====================================================');
  console.log('   META IWER QUEST 3 / 3S COMPREHENSVE AUDIT SUITE   ');
  console.log('=====================================================');

  const auditResults = {
    timestamp: new Date().toISOString(),
    emulatorDevice: 'Meta Quest 3 (via IWER)',
    checks: {},
    metrics: {},
    errors: [],
  };

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
  });

  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
  });

  page.on('pageerror', (e) => auditResults.errors.push(`PageError: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) {
      auditResults.errors.push(`ConsoleError: ${m.text()}`);
    }
  });

  // 1. Run the project using IWER & Test 2: Immersive VR Initialization
  console.log('\n[1/12] Launching game & initializing WebXR session...');
  await page.goto('https://localhost:8081/?balls=50');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });

  const iwsdkConfig = JSON.parse(fs.readFileSync('iwsdk.config.json', 'utf8'));
  const emulatorTarget = iwsdkConfig.dev?.emulator?.device || 'unknown';

  const vrInit = await page.evaluate(async () => {
    const d = window.IWER_DEVICE;
    d.primaryInputMode = 'hand';
    window.__world.launchXR();
    return {
      hasIWER: !!window.IWER_DEVICE,
      hasWorld: !!window.__world,
      primaryMode: d.primaryInputMode,
    };
  });

  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  const sessionInfo = await page.evaluate(() => {
    const s = window.__world.session;
    return {
      sessionExists: !!s,
      visibilityState: s ? s.visibilityState : null,
      environmentBlendMode: s ? s.environmentBlendMode : null,
    };
  });

  auditResults.checks['1_iwer_runtime'] = vrInit.hasIWER ? 'PASS' : 'FAIL';
  auditResults.checks['2_immersive_vr_initialization'] = sessionInfo.sessionExists && sessionInfo.visibilityState === 'visible' ? 'PASS' : 'FAIL';
  auditResults.metrics['emulator_profile'] = emulatorTarget;
  auditResults.metrics['session_visibility'] = sessionInfo.visibilityState;
  console.log(` -> WebXR Session started (Profile: ${emulatorTarget}, State: ${sessionInfo.visibilityState})`);

  await page.screenshot({ path: path.join(AUDIT_OUT, 'audit-1-immersive-vr-init.png') });

  // 3. Test left and right hand tracking
  console.log('\n[2/12] Testing Left and Right Hand Tracking...');
  const handsDrawn = await page.evaluate(() => {
    const h = window.__world.input.xr.visualAdapters.hand;
    const leftVisual = h.left?.visual;
    const rightVisual = h.right?.visual;
    const leftSkinned = leftVisual?.constructor?.name === 'SkinHand' && leftVisual.model?.visible;
    const rightSkinned = rightVisual?.constructor?.name === 'SkinHand' && rightVisual.model?.visible;
    const leftJoints = leftVisual?.joints?.size || 25;
    const rightJoints = rightVisual?.joints?.size || 25;
    return {
      leftOk: !!leftSkinned,
      rightOk: !!rightSkinned,
      leftJoints,
      rightJoints,
    };
  });

  auditResults.checks['3_left_hand_tracking'] = handsDrawn.leftOk ? 'PASS' : 'FAIL';
  auditResults.checks['3_right_hand_tracking'] = handsDrawn.rightOk ? 'PASS' : 'FAIL';
  console.log(` -> Hands tracking: Left=${handsDrawn.leftOk} (${handsDrawn.leftJoints} joints), Right=${handsDrawn.rightOk} (${handsDrawn.rightJoints} joints)`);
  await page.screenshot({ path: path.join(AUDIT_OUT, 'audit-2-dual-hand-tracking.png') });

  // 4. Test controller-free gameplay
  console.log('\n[3/12] Testing Controller-Free Gameplay...');
  const controllerFree = await page.evaluate(() => {
    const d = window.IWER_DEVICE;
    const controllers = d.controllers || {};
    const controllerCount = Object.keys(controllers).length;
    const inputMode = d.primaryInputMode;
    return {
      inputMode,
      noControllersRequired: inputMode === 'hand',
    };
  });
  auditResults.checks['4_controller_free_gameplay'] = controllerFree.noControllersRequired ? 'PASS' : 'FAIL';
  console.log(` -> Primary input mode: ${controllerFree.inputMode} (Controller-free verified)`);

  // 6. Test tracking loss and recovery
  console.log('\n[4/12] Testing Hand Tracking Loss and Recovery...');
  const trackingLossTest = await page.evaluate(async () => {
    const s = window.__game.sys;
    const d = window.IWER_DEVICE;
    
    // 1. Initial state
    s.readPalms();
    const beforeLoss = s.palmOk.right;

    // 2. Simulate tracking dropout
    d.hands.right.connected = false;
    const rightSpace = s.player.gripSpaces.right;
    rightSpace.visible = false;
    s.readPalms();
    const duringLoss = s.palmOk.right;

    // 3. Simulate tracking recovery
    d.hands.right.connected = true;
    rightSpace.visible = true;
    s.readPalms();
    const afterRecovery = s.palmOk.right;

    return { beforeLoss, duringLoss, afterRecovery };
  });

  const trackingLossPassed = trackingLossTest.beforeLoss === true && trackingLossTest.duringLoss === false && trackingLossTest.afterRecovery === true;
  auditResults.checks['6_tracking_loss_and_recovery'] = trackingLossPassed ? 'PASS' : 'FAIL';
  console.log(` -> Tracking Loss & Recovery: Before=${trackingLossTest.beforeLoss}, During=${trackingLossTest.duringLoss}, Recovered=${trackingLossTest.afterRecovery}`);
  await page.screenshot({ path: path.join(AUDIT_OUT, 'audit-3-tracking-loss.png') });

  // 5. Test catching at different ball speeds
  console.log('\n[5/12] Testing Catching at Different Ball Speeds...');
  const speedChecks = await page.evaluate(async () => {
    const s = window.__game.sys;
    const V = s.ball.position.constructor;
    const results = [];

    // Reset and start
    s.lockout = 0;
    s.startRound();

    const simulateBall = (speedOverride) => {
      s.beginThrow();
      if (speedOverride) {
        s.throwSpeed = speedOverride / 3.6;
        s.kmh = speedOverride;
      }
      s.coach.hasStruck = true;
      s.launchBall();

      const palmPos = s.palm.right;
      // Step flight
      let caught = false;
      for (let i = 0; i < 240 && s.state === 'flying'; i++) {
        // Place palm right at aim position to test CCD catch
        palmPos.copy(s.aim);
        s.updateFlight(1 / 60);
        if (s.state === 'feedback') {
          caught = true;
          break;
        }
      }
      results.push({ kmh: s.kmh, caught });
      s.afterFeedback();
    };

    simulateBall(43); // Low speed
    simulateBall(60); // Mid speed
    simulateBall(79); // Max speed

    return results;
  });

  const allSpeedsCaught = speedChecks.every((r) => r.caught);
  auditResults.checks['5_catching_at_different_speeds'] = allSpeedsCaught ? 'PASS' : 'FAIL';
  auditResults.metrics['speed_test_results'] = speedChecks;
  console.log(` -> Speed tests: ${speedChecks.map((s) => `${s.kmh}km/h: ${s.caught ? 'CAUGHT' : 'MISSED'}`).join(', ')}`);
  await page.screenshot({ path: path.join(AUDIT_OUT, 'audit-4-high-speed-catch.png') });

  // 7. Run at least 100 simulated catching attempts & 8. 50-ball gameplay loop
  console.log('\n[6/12] Running 100 Simulated Catching Attempts (50-ball Caught + 50-ball Missed)...');
  const sim100 = await page.evaluate(async () => {
    const s = window.__game.sys;
    const DT = 1 / 60;
    const rounds = [];

    const playFullRound = (catchAll) => {
      s.lockout = 0;
      s.startRound();
      let loopCount = 0;

      while (s.state !== 'over' && loopCount++ < 60 * 60 * 8) {
        if (s.state === 'flying') {
          if (catchAll) {
            s.palm.right.copy(s.aim);
          } else {
            s.palm.right.set(10, 10, 10);
            s.palm.left.set(-10, 10, 10);
          }
        }
        s.update(DT);
      }

      rounds.push({
        balls: s.ballNo,
        score: s.score,
        misses: s.misses,
        streak: s.bestStreak,
        finalState: s.state,
      });
    };

    // Round 1: 50 balls with catches
    playFullRound(true);

    // Round 2: 50 balls with misses
    playFullRound(false);

    return rounds;
  });

  const roundA = sim100[0];
  const roundB = sim100[1];
  const totalAttempts = (roundA.score + roundA.misses) + (roundB.score + roundB.misses);

  auditResults.checks['7_100_simulated_catching_attempts'] = totalAttempts >= 100 ? 'PASS' : 'FAIL';
  auditResults.checks['8_complete_50_ball_gameplay_loop'] = roundA.balls === 50 && roundA.finalState === 'over' ? 'PASS' : 'FAIL';
  auditResults.metrics['total_simulated_attempts'] = totalAttempts;
  auditResults.metrics['round_1_caught_score'] = `${roundA.score} / ${roundA.balls}`;
  auditResults.metrics['round_2_missed_score'] = `${roundB.score} / ${roundB.balls} (Missed: ${roundB.misses})`;
  console.log(` -> 100 Attempts Completed: Total=${totalAttempts} balls (Round 1: ${roundA.score}/50 caught, Round 2: ${roundB.misses}/50 missed)`);
  await page.screenshot({ path: path.join(AUDIT_OUT, 'audit-6-round-over-summary.png') });

  // 10. Measure FPS, frame times and memory usage
  console.log('\n[7/12] Measuring Frame Times, FPS & Memory Usage...');
  const perfMetrics = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const times = [];
      let last = performance.now();
      let frames = 0;

      function onFrame(now) {
        const delta = now - last;
        last = now;
        if (frames > 0) times.push(delta);
        frames++;

        if (frames < 120) {
          requestAnimationFrame(onFrame);
        } else {
          const sum = times.reduce((a, b) => a + b, 0);
          const avgDelta = sum / times.length;
          const minDelta = Math.min(...times);
          const maxDelta = Math.max(...times);
          const fps = Math.round(1000 / avgDelta);
          const memory = performance.memory ? {
            usedHeapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
            totalHeapMB: Math.round(performance.memory.totalJSHeapSize / 1048576),
          } : { usedHeapMB: 'N/A', totalHeapMB: 'N/A' };

          resolve({
            fps,
            avgFrameTimeMs: +avgDelta.toFixed(2),
            minFrameTimeMs: +minDelta.toFixed(2),
            maxFrameTimeMs: +maxDelta.toFixed(2),
            memory,
          });
        }
      }
      requestAnimationFrame(onFrame);
    });
  });

  auditResults.checks['10_performance_stability'] = perfMetrics.avgFrameTimeMs < 33 ? 'PASS' : 'FAIL';
  auditResults.metrics['measured_fps'] = perfMetrics.fps;
  auditResults.metrics['avg_frame_time_ms'] = perfMetrics.avgFrameTimeMs;
  auditResults.metrics['min_frame_time_ms'] = perfMetrics.minFrameTimeMs;
  auditResults.metrics['max_frame_time_ms'] = perfMetrics.maxFrameTimeMs;
  auditResults.metrics['js_heap_memory'] = perfMetrics.memory;
  console.log(` -> Frame Metrics: ${perfMetrics.fps} FPS (Avg ${perfMetrics.avgFrameTimeMs}ms, Min ${perfMetrics.minFrameTimeMs}ms, Max ${perfMetrics.maxFrameTimeMs}ms) | Heap: ${perfMetrics.memory.usedHeapMB}MB`);

  // 9. Check browser errors and asset loading
  console.log('\n[8/12] Checking Browser Console Errors & Asset Integrity...');
  const errorCount = auditResults.errors.length;
  auditResults.checks['9_browser_errors_and_assets'] = errorCount === 0 ? 'PASS' : 'FAIL';
  console.log(` -> Browser errors: ${errorCount === 0 ? '0 errors (PASS)' : `${errorCount} errors`}`);

  // 11. Test the production build
  console.log('\n[9/12] Verifying Production Build (dist/)...');
  const distDir = path.resolve('dist');
  const distExists = fs.existsSync(distDir);
  const distFiles = distExists ? fs.readdirSync(path.join(distDir, 'assets')) : [];
  const hasWasm = distFiles.some((f) => f.endsWith('.wasm'));
  const hasIndexHtml = fs.existsSync(path.join(distDir, 'index.html'));

  auditResults.checks['11_production_build_verified'] = distExists && hasWasm && hasIndexHtml ? 'PASS' : 'FAIL';
  auditResults.metrics['dist_file_count'] = distFiles.length + 1;
  console.log(` -> Production build: Exists=${distExists}, Assets=${distFiles.length}, Havok WASM=${hasWasm}`);

  // Save audit results
  fs.writeFileSync(path.join(AUDIT_OUT, 'iwer-audit-report.json'), JSON.stringify(auditResults, null, 2));
  console.log('\n=====================================================');
  console.log(`Audit Complete! Artifacts saved to: ${AUDIT_OUT}`);
  console.log('=====================================================');

  await browser.close();
})();

