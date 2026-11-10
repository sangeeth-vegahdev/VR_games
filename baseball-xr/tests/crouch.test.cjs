// The catcher is crouched by default: the eyes sit at CATCHER_EYE_Y (1.1 m) on the desktop and in a
// headset, the called zone follows the eyes, and a hand held at standing chest height reaches the zone.
// Usage: GAME_URL=https://localhost:8082 node tests/crouch.test.cjs
const { chromium } = require('playwright');

const GAME_URL = process.env.GAME_URL || 'https://localhost:8082';
const EYE = 0.95;
const TOL = 0.03;

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const checks = {};
  const report = {};

  // ----- Desktop -----
  await page.goto(GAME_URL + '/?tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  report.desktopEyeY = await page.evaluate(() => window.__world.camera.getWorldPosition(window.__game.sys.glove.v[7]).y);
  checks[`desktop: eyes at ${EYE} m`] = Math.abs(report.desktopEyeY - EYE) < TOL;

  // The mitt's fingers: up when it is at the zone, down when it is held low (a catcher keeps it so).
  const fingersAt = async (gy) => {
    const r = await page.evaluate(() => {
      const r = window.__game.sys.desktop.canvas().getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height };
    });
    await page.mouse.move(r.x, r.y - (gy * r.h) / 2, { steps: 3 });
    await page.waitForTimeout(2500);
    return page.evaluate(() => {
      const s = window.__game.sys;
      // Second column of the mitt's world matrix: its local +Y (the fingers), in world space.
      return { pocketY: s.glove.pocket.y, fingersY: s.glove.object.matrixWorld.elements[5] };
    });
  };
  report.fingersZone = await fingersAt(0);
  report.fingersLow = await fingersAt(-0.6);
  checks['desktop: fingers up at the zone'] = report.fingersZone.fingersY > 0.2;
  checks['desktop: fingers down for a low ball (catcher keeps the mitt so)'] = report.fingersLow.fingersY < 0;

  // ----- Headset (hand mode): the rig is lowered, and a standing hand reaches the zone -----
  await page.evaluate(() => {
    window.IWER_DEVICE.primaryInputMode = 'hand';
    window.__world.launchXR();
  });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(2000);
  const xr = await page.evaluate(() => {
    const s = window.__game.sys;
    const head = s.player.head.getWorldPosition(s.glove.v[7]);
    return { headY: head.y, crouched: s.crouched, rigY: s.player.position.y, zone: Math.max(0.45, head.y - 0.35) };
  });
  report.headset = xr;
  checks[`headset: eyes at ${EYE} m after the crouch`] = Math.abs(xr.headY - EYE) < TOL && xr.crouched === true;
  checks[`headset: the zone is 35 cm under the eyes (${(EYE - 0.35).toFixed(2)} m)`] = Math.abs(xr.zone - (EYE - 0.35)) < TOL;

  // A hand held at standing chest height (1.25 m in the player's own frame) lands on the zone.
  await page.evaluate(async () => {
    const d = window.IWER_DEVICE;
    d.hands.left.connected = true;
    await d.remote.dispatch('set_hand_pose', { device: 'hand-left', poseId: 'open' });
    await d.remote.dispatch('set_transform', { device: 'hand-left', position: { x: 0, y: 1.25, z: -0.55 }, anchor: 'grip' });
  });
  await page.waitForTimeout(1200);
  const reach = await page.evaluate(() => {
    const s = window.__game.sys;
    const zone = { x: 0, y: Math.max(0.45, s.player.head.getWorldPosition(s.glove.v[7]).y - 0.35), z: -0.55 };
    const p = s.glove.pocket;
    return { pocket: { x: p.x, y: p.y, z: p.z }, zone, ok: s.glove.ok, dist: p.distanceTo(zone) };
  });
  report.handReach = reach;
  checks['headset: a hand at standing chest height reaches the zone (within 0.15 m)'] = reach.ok && reach.dist < 0.15;

  // The plate's back edge (ground level, z -0.55) is reached by the hand, from a relaxed bend.
  await page.evaluate(async () => {
    const s = window.__game.sys;
    await window.IWER_DEVICE.remote.dispatch('set_transform', {
      device: 'hand-left',
      position: { x: 0, y: 0.05 - s.player.position.y, z: -0.55 },
      anchor: 'grip',
    });
  });
  await page.waitForTimeout(1200);
  const plate = await page.evaluate(() => {
    const s = window.__game.sys;
    const p = s.glove.pocket;
    return { y: p.y, dist: Math.hypot(p.x, p.y - 0.05, p.z + 0.55), ok: s.glove.ok, handRefY: 0.05 - s.player.position.y };
  });
  report.plateReach = plate;
  checks['headset: a hand reaches the plate at ground level (within 0.15 m of the plate edge)'] = plate.ok && plate.dist < 0.15;

  // A hand pushed below the floor leaves the mitt on the ground, not through it.
  await page.evaluate(async () => {
    const s = window.__game.sys;
    await window.IWER_DEVICE.remote.dispatch('set_transform', {
      device: 'hand-left',
      position: { x: 0, y: -0.4 - s.player.position.y, z: -0.55 },
      anchor: 'grip',
    });
  });
  await page.waitForTimeout(1200);
  const under = await page.evaluate(() => ({ y: window.__game.sys.glove.pocket.y, ok: window.__game.sys.glove.ok }));
  report.mittBelowFloor = under;

  // The ring on the ground sits under the mitt, so a player looking down can find it.
  const ring = await page.evaluate(() => {
    const s = window.__game.sys;
    const p = s.glove.pocket;
    const r = s.groundRing.position;
    return { visible: s.groundRing.visible, dx: r.x - p.x, dz: r.z - p.z, y: r.y };
  });
  report.groundRing = ring;
  checks['headset: a ring on the ground shows where the mitt is'] =
    ring.visible && Math.hypot(ring.dx, ring.dz) < 0.02 && ring.y < 0.05;
  checks['headset: the mitt stays above the ground when the hand is pushed below it'] = under.ok && under.y >= 0.02;

  console.log(JSON.stringify(report, null, 2));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) {
    console.log((v ? 'PASS ' : 'FAIL ') + k);
    if (!v) bad++;
  }
  console.log((errors.length === 0 ? 'PASS ' : 'FAIL ') + 'no page errors');
  if (errors.length) console.log(errors);
  await browser.close();
  process.exit(bad || errors.length ? 1 : 0);
})();
