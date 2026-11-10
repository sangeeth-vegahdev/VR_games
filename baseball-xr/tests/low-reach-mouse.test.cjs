// How low can the mouse put the mitt in an XR session, for different head tilts? The mouse maps to
// what the player sees, so a low pitch is only reachable once the head is tilted down far enough.
// For each tilt, the pointer is put on the bottom edge of the canvas and the mitt's lowest height is
// compared with a low pitch (0.30 m under the zone's centre, as in hand-catch.test.cjs LOW=1).
// Usage: GAME_URL=https://localhost:8082 node tests/low-reach-mouse.test.cjs
const { chromium } = require('playwright');

const GAME_URL = process.env.GAME_URL || 'https://localhost:8082';
const TILTS_DEG = [0, -10, -20, -30];
const HEAD_Y = 1.6;

function pitchQuat(deg) {
  const a = (deg * Math.PI) / 180;
  return { x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(GAME_URL + '/?tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });
  await page.evaluate(() => {
    window.IWER_DEVICE.primaryInputMode = 'controller';
    window.__world.launchXR();
  });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  const rows = [];
  for (const deg of TILTS_DEG) {
    await page.evaluate(async ({ y, q }) => {
      await window.IWER_DEVICE.remote.dispatch('set_transform', {
        device: 'headset',
        position: { x: 0, y, z: 0 },
        orientation: q,
      });
    }, { y: HEAD_Y, q: pitchQuat(deg) });
    // Pointer on the bottom edge of the canvas.
    const rect = await page.evaluate(() => {
      const r = window.__game.sys.desktop.canvas().getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height - 2 };
    });
    await page.mouse.move(rect.x, rect.y, { steps: 3 });
    // Let the mitt settle on its target (poll until it stops moving, up to 8 s).
    let last = null;
    const t0 = Date.now();
    let state;
    do {
      await page.waitForTimeout(300);
      state = await page.evaluate(() => {
        const s = window.__game.sys;
        const cam = s.glove.v[7];
        window.__world.camera.getWorldPosition(cam);
        return { target: s.desktop.target.y, clamped: s.desktop.clamped, headY: cam.y };
      });
      const stable = last !== null && Math.abs(state.target - last) < 0.002;
      last = state.target;
      if (stable) break;
    } while (Date.now() - t0 < 8000);
    const lowAim = Math.max(0.45, state.headY - 0.35) - 0.3;
    rows.push({
      headTiltDeg: deg,
      lowestMittY: Math.round(state.target * 1000) / 1000,
      lowAimY: Math.round(lowAim * 1000) / 1000,
      canReachLowPitch: state.target <= lowAim + 0.02,
    });
  }

  console.log(JSON.stringify(rows, null, 2));
  const firstReach = rows.find((r) => r.canReachLowPitch);
  console.log(
    firstReach
      ? `RESULT: the mouse reaches a low pitch from a head tilt of ${firstReach.headTiltDeg} deg (or more down)`
      : 'RESULT: the mouse cannot reach a low pitch at any tested head tilt',
  );

  // The sign warns when the called spot is out of the mouse's reach (level head, mouse on the bottom
  // edge). Checked on real signs: the warning must agree with the geometry each time.
  await page.evaluate(async ({ y }) => {
    await window.IWER_DEVICE.remote.dispatch('set_transform', {
      device: 'headset',
      position: { x: 0, y, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });
  }, { y: HEAD_Y });
  await page.evaluate(() => {
    window.__game.sys.lockout = 0;
    window.__game.start();
  });
  const signs = [];
  for (let i = 0; i < 2; i++) {
    await page.waitForFunction(() => window.__game.state === 'sign', null, { timeout: 60000 });
    const r = await page.evaluate(() => {
      const s = window.__game.sys;
      const lowest = s.desktop.lowestReach();
      return { calledY: s.calledAt.y, lowest, warned: s.lowOutOfReach, active: s.desktop.active };
    });
    signs.push({ ...r, agrees: r.warned === r.calledY < r.lowest - 0.02 });
    await page.waitForFunction(() => window.__game.state !== 'sign', null, { timeout: 60000 });
  }
  console.log(JSON.stringify(signs, null, 2));
  const signsOk = signs.length === 2 && signs.every((x) => x.agrees && x.active);
  console.log((signsOk ? 'PASS ' : 'FAIL ') + 'the low-ball warning on the sign agrees with the mouse reach');
  console.log((errors.length === 0 ? 'PASS ' : 'FAIL ') + 'no page errors');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
