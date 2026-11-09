// Tests Meta Quest controls (Hand tracking, Touch controllers, and Gaze tracking)
// under IWER Meta Quest 3 emulation.
const { chromium } = require('playwright');

const GAME_URL = process.env.GAME_URL || 'https://localhost:8081';

(async () => {
  console.log('=== TESTING META QUEST CONTROLS (CRICKET CATCH) ===\n');

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
  });

  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(GAME_URL + '/?balls=6&tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });

  // 1. Enter VR with Meta Quest 3 profile
  const initInfo = await page.evaluate(() => {
    const d = window.IWER_DEVICE;
    d.primaryInputMode = 'hand';
    window.__world.launchXR();
    return {
      device: d.deviceProfile || 'metaQuest3',
      inputMode: d.primaryInputMode,
    };
  });

  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  // 2. Test Meta Quest Hand Tracking (Controller-free)
  const handTest = await page.evaluate(async () => {
    const s = window.__game.sys;
    const d = window.IWER_DEVICE;

    // Both hands connected with open hand pose (no pinch)
    for (const side of ['left', 'right']) {
      d.hands[side].connected = true;
      await d.remote.dispatch('set_hand_pose', { device: 'hand-' + side, poseId: 'open' });
    }

    s.readPalms();
    const handsDetected = s.palmOk.left && s.palmOk.right;
    const hasNormals = s.palmNormalOk.left && s.palmNormalOk.right;

    // Touch green marker ball to start round (No buttons, no pinching)
    const markerPos = s.marker.position;
    await d.remote.dispatch('set_transform', {
      device: 'hand-right',
      position: { x: markerPos.x, y: markerPos.y, z: markerPos.z },
      anchor: 'grip',
    });

    s.updateRestart();
    const startedWithHandTouch = s.state === 'ready';

    return {
      handsDetected,
      hasNormals,
      startedWithHandTouch,
      currentState: s.state,
    };
  });

  // 3. Test Meta Quest Controller Mode (Holding Touch Controllers)
  const controllerTest = await page.evaluate(async () => {
    const s = window.__game.sys;
    const d = window.IWER_DEVICE;

    // Switch input mode to controller
    d.primaryInputMode = 'controller';
    s.palmFromJoints = false; // controller grip mode

    // Move controller to restart marker
    const markerPos = s.marker.position;
    const rightGrip = s.player.gripSpaces.right;
    rightGrip.position.set(markerPos.x, markerPos.y, markerPos.z);
    rightGrip.visible = true;

    s.lockout = 0;
    s.state = 'over';
    s.readPalms();
    s.updateRestart();
    const startedWithController = s.state === 'ready';

    return {
      startedWithController,
      palmOk: s.palmOk.right,
    };
  });

  // 4. Test Meta Quest Eye Tracking and Gaze Reticle
  const gazeTest = await page.evaluate(async () => {
    const s = window.__game.sys;
    const d = window.IWER_DEVICE;
    const V = s.ball.position.constructor;

    // Aim the emulated eyes (the mouse stands in for them in IWER) at a world point. The head stays put,
    // so the emulator's own gaze ray can not fight a faked head turn.
    const lookAt = (target) => {
      const from = s.player.head.getWorldPosition(new V());
      const d = target.clone().sub(from);
      s.focus.emuX = d.x / -d.z / Math.tan((38 * Math.PI) / 180);
      s.focus.emuY = d.y / -d.z / Math.tan((30 * Math.PI) / 180);
      s.focus.emuMoved = true;
    };

    s.state = 'flying';
    s.ball.position.set(0, 1.4, -6.0);
    s.eyeTracker.show();

    // Look at ball
    lookAt(s.ball.position);
    s.focus.sample(s.player, s.world.camera, true);
    s.focus.track(s.ball.position, 1 / 60, 6.0);
    s.eyeTracker.update(s.focus, s.ball.position, s.focus.watching, true, s.world.camera, s.desktop, 1 / 60);

    const lockedOn = s.focus.watching === true;
    const reticleAtBall = s.eyeTracker.group.position.distanceTo(s.ball.position) < 0.15;
    const reticleColor = s.eyeTracker.ringMaterial.color.getHex() === 0x5eead4; // cyan-teal

    // Look away (30 degrees up/left)
    lookAt(new V(-3.0, 4.0, -6.0));
    s.focus.sample(s.player, s.world.camera, true);
    s.focus.track(s.ball.position, 1 / 60, 6.0);
    s.eyeTracker.update(s.focus, s.ball.position, s.focus.watching, true, s.world.camera, s.desktop, 1 / 60);

    const lookedAway = s.focus.watching === false;
    const reticleMoved = s.eyeTracker.group.position.distanceTo(s.ball.position) > 1.5;

    return {
      lockedOn,
      reticleAtBall,
      reticleColor,
      lookedAway,
      reticleMoved,
    };
  });

  // 5. Test Headset Menu Pause (VisibilityState)
  const pauseTest = await page.evaluate(async () => {
    const s = window.__game.sys;
    const initialPaused = s.paused;

    // Simulate opening Meta Quest universal menu / removing headset
    s.world.visibilityState.value = 'visible-blurred';
    s.update(1 / 60);
    const pausedInMenu = s.paused;

    // Simulate returning to game
    s.world.visibilityState.value = 'visible';
    s.update(1 / 60);
    const resumed = !s.paused;

    return {
      initialPaused,
      pausedInMenu,
      resumed,
    };
  });

  await browser.close();

  const results = {
    'hand tracking detected both hands via joint hierarchy': handTest.handsDetected,
    'hand tracking extracted 3D palm orientations': handTest.hasNormals,
    'round starts by touching green ball with bare hand (no pinch)': handTest.startedWithHandTouch,
    'round starts by touching green ball with Touch controller': controllerTest.startedWithController,
    'eye gaze locks onto ball and glows cyan-teal': gazeTest.lockedOn && gazeTest.reticleAtBall && gazeTest.reticleColor,
    'eye gaze reticle moves away when looking away from ball': gazeTest.lookedAway && gazeTest.reticleMoved,
    'game automatically pauses when Meta Quest universal menu opens': pauseTest.pausedInMenu && pauseTest.resumed,
    'no console errors': errors.length === 0,
  };

  console.log('RESULTS:');
  for (const [desc, ok] of Object.entries(results)) {
    console.log(ok ? 'PASS' : 'FAIL', desc);
  }

  const allPass = Object.values(results).every(Boolean);
  process.exit(allPass ? 0 : 1);
})();
