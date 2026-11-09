// Tests Meta Quest controls (Hand tracking, Touch controllers, Mitt swapping, and Gaze tracking)
// under IWER Meta Quest 3 emulation.
const { chromium } = require('playwright');

const GAME_URL = process.env.GAME_URL || 'https://localhost:8082';

(async () => {
  console.log('=== TESTING META QUEST CONTROLS (GLOVE UP BASEBALL) ===\n');

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
  });

  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(GAME_URL + '/?pitches=6&tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });

  // 1. Enter VR with Meta Quest 3 profile
  await page.evaluate(() => {
    const d = window.IWER_DEVICE;
    d.primaryInputMode = 'hand';
    window.__world.launchXR();
  });

  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  // 2. Test Meta Quest Hand Tracking & Mitt Movement
  const handTest = await page.evaluate(async () => {
    const s = window.__game.sys;
    const d = window.IWER_DEVICE;

    for (const side of ['left', 'right']) {
      d.hands[side].connected = true;
      await d.remote.dispatch('set_hand_pose', { device: 'hand-' + side, poseId: 'open' });
    }

    s.glove.update(s.player, s.desktop, true, 1 / 60);
    const mittTracked = s.glove.ok;
    const mittSide = s.glove.side;

    // Touch green marker ball to start round (no buttons, no pinch)
    const markerPos = s.marker.position;
    await d.remote.dispatch('set_transform', {
      device: 'hand-left',
      position: { x: markerPos.x, y: markerPos.y, z: markerPos.z },
      anchor: 'grip',
    });

    s.lockout = 0;
    s.state = 'idle';
    s.player.gripSpaces.left.position.set(markerPos.x, markerPos.y, markerPos.z);
    s.player.gripSpaces.left.visible = true;
    s.glove.update(s.player, s.desktop, true, 1 / 60);
    s.updateMenu();
    const startedWithMittTouch = s.state === 'ready';

    return {
      mittTracked,
      mittSide,
      startedWithMittTouch,
      currentState: s.state,
    };
  });

  // 3. Test Touch Controller Mode (Grip Space Driving Mitt)
  const controllerTest = await page.evaluate(async () => {
    const s = window.__game.sys;
    const d = window.IWER_DEVICE;

    d.primaryInputMode = 'controller';
    s.glove.useJoints = false; // controller grip mode

    const markerPos = s.marker.position;
    const leftGrip = s.player.gripSpaces.left;
    leftGrip.position.set(markerPos.x, markerPos.y, markerPos.z);
    leftGrip.visible = true;

    s.lockout = 0;
    s.state = 'over';
    s.glove.update(s.player, s.desktop, true, 1 / 60);
    s.updateMenu();
    const startedWithController = s.state === 'ready';

    return {
      startedWithController,
      gloveOk: s.glove.ok,
    };
  });

  // 4. Test 3D Orb Mitt Hand Swap (Left / Right Hand Swap in VR)
  const swapTest = await page.evaluate(async () => {
    const s = window.__game.sys;
    const d = window.IWER_DEVICE;

    d.primaryInputMode = 'hand';
    s.glove.useJoints = true;

    const initialSide = s.glove.side;
    s.state = 'idle';
    s.swapLockout = 0;

    // Move right hand to touch gold swap orb
    const swapPos = s.swapOrb.position;
    const rightGrip = s.player.gripSpaces.right;
    rightGrip.position.set(swapPos.x, swapPos.y, swapPos.z);
    rightGrip.visible = true;
    s.updateMenu();
    const swappedSide = s.glove.side;

    return {
      initialSide,
      swappedSide,
      swappedSuccess: swappedSide !== initialSide,
    };
  });

  // 5. Test Eye Tracking and Reticle in Ballpark
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
    s.ball.position.set(0, 1.2, -8.0);
    s.eyeTracker.show();

    // Look at ball
    lookAt(s.ball.position);
    s.focus.sample(s.player, s.world.camera, true);
    s.focus.track(s.ball.position, 1 / 60, 8.0);
    s.eyeTracker.update(s.focus, s.ball.position, s.focus.watching, true, s.world.camera, s.desktop, 1 / 60);

    const lockedOn = s.focus.watching === true;
    const reticleAtBall = s.eyeTracker.group.position.distanceTo(s.ball.position) < 0.15;
    const reticleColor = s.eyeTracker.ringMaterial.color.getHex() === 0x5eead4;

    // Look away
    lookAt(new V(4.0, 5.0, -8.0));
    s.focus.sample(s.player, s.world.camera, true);
    s.focus.track(s.ball.position, 1 / 60, 8.0);
    s.eyeTracker.update(s.focus, s.ball.position, s.focus.watching, true, s.world.camera, s.desktop, 1 / 60);

    const lookedAway = s.focus.watching === false;
    const reticleMoved = s.eyeTracker.group.position.distanceTo(s.ball.position) > 2.0;

    return {
      lockedOn,
      reticleAtBall,
      reticleColor,
      lookedAway,
      reticleMoved,
    };
  });

  // 6. Test Universal Menu Pause
  const pauseTest = await page.evaluate(async () => {
    const s = window.__game.sys;

    s.world.visibilityState.value = 'visible-blurred';
    s.update(1 / 60);
    const pausedInMenu = s.paused;

    s.world.visibilityState.value = 'visible';
    s.update(1 / 60);
    const resumed = !s.paused;

    return {
      pausedInMenu,
      resumed,
    };
  });

  await browser.close();

  const results = {
    'hand tracking drives catcher mitt in real-time': handTest.mittTracked,
    'round starts by touching green ball with mitt (no buttons)': handTest.startedWithMittTouch,
    'round starts with Touch controller grip pose': controllerTest.startedWithController,
    'interactive 3D orb swaps mitt between left and right hands': swapTest.swappedSuccess,
    'eye gaze locks onto pitch and glows cyan-teal': gazeTest.lockedOn && gazeTest.reticleAtBall && gazeTest.reticleColor,
    'eye gaze reticle moves away when looking away': gazeTest.lookedAway && gazeTest.reticleMoved,
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
