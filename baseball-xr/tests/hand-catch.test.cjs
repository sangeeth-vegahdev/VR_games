// A complete catch with a tracked hand, in IWER hand mode. A three-pitch round is played: for each
// pitch, the test moves the left hand (the mitt hand) until its pocket sits on the spot the ball
// will cross (the game's own aim point), then lets the pitch come. Counts catches and misses.
// Usage: GAME_URL=https://localhost:8082 node tests/hand-catch.test.cjs
const { chromium } = require('playwright');

const GAME_URL = process.env.GAME_URL || 'https://localhost:8082';
const PITCHES = Number(process.env.PITCHES || 3);
// LOW=1: each pitch is sent to a low spot (0.30 m under the zone's centre, the depth of a low ball), so
// the hand has to reach down, not just the mitt's usual spot.
const LOW = process.env.LOW === '1';

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(GAME_URL + `/?tutorial=0&pitches=${PITCHES}`);
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });
  await page.evaluate(() => {
    window.IWER_DEVICE.primaryInputMode = 'hand';
    window.__world.launchXR();
  });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  await page.evaluate(async () => {
    const d = window.IWER_DEVICE;
    d.hands.left.connected = true;
    await d.remote.dispatch('set_hand_pose', { device: 'hand-left', poseId: 'open' });
    await d.remote.dispatch('set_transform', { device: 'hand-left', position: { x: 0, y: 1.0, z: -0.5 }, anchor: 'grip' });
  });
  await page.waitForTimeout(600);

  // Start the round (the mitt touches the green ball, as in a headset).
  await page.evaluate(() => {
    const s = window.__game.sys;
    s.lockout = 0;
    window.__game.start();
  });

  // Play it out: while a pitch is being set or thrown, put the mitt on the crossing point.
  const log = await page.evaluate(async ({ pass_low }) => {
    const s = window.__game.sys;
    const d = window.IWER_DEVICE;
    const out = { corrections: 0, seen: [] };
    const started = Date.now();
    let lastPitch = -1;
    while (s.state !== 'over' && Date.now() - started < 300000) {
      if (s.state === 'sign') s.__lowSet = false; // each new pitch is sent low again
      if (s.pitchNo !== lastPitch && s.state === 'feedback') {
        out.seen.push({ pitch: s.pitchNo, result: s.lastResult });
        lastPitch = s.pitchNo;
      }
      if (s.state === 'windup' || s.state === 'flying') {
        if (pass_low && s.state === 'windup' && !s.__lowSet) {
          // Test lever: the aim is read at release, so moving it here sends this pitch low.
          s.aim.y = s.zoneCenter.y - 0.3;
          s.__lowSet = true;
          out.lowAim = s.aim.y;
        }
        const aim = s.aim;
        const pocket = s.glove.pocket;
        const dx = aim.x - pocket.x;
        const dy = aim.y - pocket.y;
        const dz = aim.z - pocket.z;
        if (Math.hypot(dx, dy, dz) > 0.01) {
          const g = s.player.gripSpaces.left;
          const t = s.glove.v[6];
          g.getWorldPosition(t);
          await d.remote.dispatch('set_transform', {
            device: 'hand-left',
            // The emulator reads positions in the player's frame; the rig is lowered for the crouch.
            position: {
              x: t.x + dx - s.player.position.x,
              y: t.y + dy - s.player.position.y,
              z: t.z + dz - s.player.position.z,
            },
            anchor: 'grip',
          });
          out.corrections++;
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    out.finalState = s.state;
    out.catches = s.catches;
    out.misses = s.misses;
    out.mouseDriving = s.desktop.active;
    out.handTracked = s.glove.ok;
    return out;
  }, { pass_low: LOW });

  console.log(JSON.stringify(log, null, 2));
  const checks = {
    'the round finished': log.finalState === 'over',
    'the mitt was driven by the hand, not the mouse': log.mouseDriving === false,
    [`caught ${PITCHES} of ${PITCHES} pitches with the hand`]: log.catches === PITCHES && log.misses === 0,
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
