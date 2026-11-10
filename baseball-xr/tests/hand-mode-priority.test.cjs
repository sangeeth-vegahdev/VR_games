// In an IWER XR session in hand mode, the tracked hand must drive the mitt, and the mouse (used to
// drag the emulator's virtual hands) must not steer it. The mouse still works over the bottom bar.
// Usage: GAME_URL=https://localhost:8082 node tests/hand-mode-priority.test.cjs
const { chromium } = require('playwright');

const GAME_URL = process.env.GAME_URL || 'https://localhost:8082';

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
    window.IWER_DEVICE.primaryInputMode = 'hand';
    window.__world.launchXR();
  });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Connect the left hand (the default mitt hand) with an open pose, then place it in the air.
  await page.evaluate(async () => {
    const d = window.IWER_DEVICE;
    d.hands.left.connected = true;
    await d.remote.dispatch('set_hand_pose', { device: 'hand-left', poseId: 'open' });
    await d.remote.dispatch('set_transform', { device: 'hand-left', position: { x: 0.2, y: 1.1, z: -0.5 }, anchor: 'grip' });
  });
  await page.waitForTimeout(600);

  const snap = () =>
    page.evaluate(() => {
      const s = window.__game.sys;
      const g = s.player.gripSpaces.left;
      const grip = g.getWorldPosition(s.glove.v[7]);
      return {
        handLive: s.desktop.handsLive(s.player),
        mouseActive: s.desktop.active,
        mitt: s.glove.ok,
        pocket: { x: s.glove.pocket.x, y: s.glove.pocket.y, z: s.glove.pocket.z },
        grip: { x: grip.x, y: grip.y, z: grip.z },
      };
    });

  const results = {};
  // Drag the mouse about the page; with a live hand it must not steer the mitt.
  await page.mouse.move(640, 360);
  await page.mouse.move(700, 200);
  await page.waitForTimeout(300);
  results.mouseOverHand = await snap();

  // Move the hand: the mitt must follow it.
  await page.evaluate(async () => {
    await window.IWER_DEVICE.remote.dispatch('set_transform', { device: 'hand-left', position: { x: -0.3, y: 0.7, z: -0.5 }, anchor: 'grip' });
  });
  await page.waitForTimeout(500);
  results.handMoved = await snap();

  console.log(JSON.stringify(results, null, 2));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const checks = {
    'hand is live': results.handMoved.handLive === true,
    'mouse does not drive the mitt while a hand is live': results.mouseOverHand.mouseActive === false,
    'mitt is tracked by the hand': results.handMoved.mitt === true,
    'mitt follows the hand (< 0.25 m)': dist(results.handMoved.pocket, results.handMoved.grip) < 0.25,
    'mitt moved with the hand': dist(results.handMoved.pocket, results.mouseOverHand.pocket) > 0.2,
    'no page errors': errors.length === 0,
  };
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) {
    console.log((v ? 'PASS ' : 'FAIL ') + k);
    if (!v) bad++;
  }
  if (errors.length) console.log(errors);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
