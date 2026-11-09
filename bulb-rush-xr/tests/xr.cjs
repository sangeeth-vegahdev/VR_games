// Headset-session test using IWER's emulated Quest with emulated tracked hands (no controllers).
// Checks: the board centres on the player, the hand models draw, and a fingertip POKE into START and
// then into a lit bulb works end to end. Needs the dev server (npx vite --port 8083).
const { chromium } = require('playwright');
const GAME_URL = process.env.GAME_URL || 'https://localhost:8083';
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); if (!ok) failures++; };

(async () => {
  const browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'] });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|favicon/.test(m.text()) && errors.push(m.text()));
  await page.goto(GAME_URL + '/?hearts=3&tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
  await page.evaluate(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; window.__world.launchXR(); });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 20000 });
  check('XR session starts with hand tracking', true);
  // The software renderer is slow, so give the board's settle-and-centre timer time to finish.
  await page.waitForFunction(() => { const s = window.__game.sys; s.readHead(); return s.anchorTimer <= 0 && Math.abs(s.board.rig.position.z - s.head.z) < 0.01; }, null, { timeout: 90000 });

  const placed = await page.evaluate(() => {
    const s = window.__game.sys;
    s.readHead();
    const r = s.board.rig.position;
    return { head: s.head.toArray().map((v) => +v.toFixed(2)), rig: r.toArray().map((v) => +v.toFixed(2)) };
  });
  console.log('placement', JSON.stringify(placed));
  check('board is centred on the seated player', Math.abs(placed.rig[0] - placed.head[0]) < 0.05 && Math.abs(placed.rig[2] - placed.head[2]) < 0.05 && Math.abs(placed.rig[1] - (placed.head[1] - 0.145)) < 0.05);

  const inFront = await page.evaluate(() => {
    const s = window.__game.sys;
    s.readHead();
    const v = s.board.bulbWorldPos(14, s.v2.clone()).sub(s.head).normalize();
    return v.dot(s.fwd);
  });
  check('the board is in front of the player (not behind)', inFront > 0.9, 'dot=' + inFront.toFixed(2));

  const drawn = await page.waitForFunction(() => {
    const h = window.__world.input.xr.visualAdapters.hand;
    return ['left', 'right'].every((k) => h[k].visual && h[k].visual.constructor.name === 'SkinHand' && h[k].visual.model.visible);
  }, null, { timeout: 20000 }).then(() => true, () => false);
  check('solid hand models draw', drawn);

  // Poke: put the right index fingertip at a world point, pointing -Z, then push forward.
  async function poke(target) {
    return page.evaluate(async (t) => {
      const d = window.IWER_DEVICE;
      const set = (z) => d.remote.dispatch('set_transform', { device: 'hand-right', position: { x: t.x, y: t.y - 0.0, z }, orientation: { fingers: [0, 0, -1], palm: [0, -1, 0] }, anchor: 'index-finger-tip' });
      for (let k = 0; k <= 14; k++) { await set(t.z + 0.12 - k * 0.012); await new Promise((r) => setTimeout(r, 260)); }
    }, target);
  }
  // Move the left hand away so only one hand is involved.
  await page.evaluate(() => window.IWER_DEVICE.remote.dispatch('set_transform', { device: 'hand-left', position: { x: -0.5, y: 0.8, z: 0.2 }, orientation: { fingers: [0, 0, -1], palm: [0, -1, 0] }, anchor: 'grip' }));

  const startPos = await page.evaluate(() => { const s = window.__game.sys; const v = s.board.buttons.start.node.getWorldPosition(s.v.clone()); return { x: v.x, y: v.y, z: v.z }; });
  await page.waitForTimeout(700);
  await poke(startPos);
  const st = await page.evaluate(() => window.__game.state);
  check('fingertip poke on START begins the game', st === 'countdown' || st === 'play', 'state=' + st);
  await page.evaluate(() => window.IWER_DEVICE.remote.dispatch('set_transform', { device: 'hand-right', position: { x: 0.3, y: 0.8, z: 0.2 }, orientation: { fingers: [0, 0, -1], palm: [0, -1, 0] }, anchor: 'grip' }));

  await page.waitForFunction(() => window.__game.state === 'play', null, { timeout: 150000 });
  // The software renderer is slow enough for targets to time out between test steps; keep the round alive.
  await page.evaluate(() => { window.__game.sys.hearts = 99; });
  // Wait for a target and freeze it in the same step (the software renderer is slow), then poke it.
  await page.waitForFunction(() => {
    const s = window.__game.sys;
    if (!s.active.some((x) => x.kind !== 'decoy')) return false;
    s.active.forEach((q) => (s.board.bulbs[q.i].life = 600));
    return true;
  }, null, { timeout: 60000 });
  const tgt = await page.evaluate(() => {
    const s = window.__game.sys;
    const a = s.active.find((x) => x.kind !== 'decoy');
    const v = s.board.bulbWorldPos(a.i, s.v.clone());
    return { x: v.x, y: v.y, z: v.z, i: a.i };
  });
  const score0 = await page.evaluate(() => window.__game.score);
  await poke(tgt);
  const res = await page.evaluate(() => ({ score: window.__game.score, hearts: window.__game.hearts }));
  check('fingertip poke on the lit bulb scores', res.score > score0, `${score0} -> ${res.score}`);

  // Pinch. With gazeTracking on (iwsdk.config.json) the SDK disables the hand far-ray while a gaze source exists and the
  // emulated gaze only hits when no hand is near the board, so a far pointer cannot be aimed reliably from a script.
  // What this checks is the game's own pinch handling, with a REAL WebXR select event: pinching right after pointing at
  // the lit bulb (the pointer slips off as the fingers close, so the game remembers it for a moment) must score it.
  await page.evaluate(() => window.IWER_DEVICE.remote.dispatch('set_transform', { device: 'hand-right', position: { x: 0.3, y: 0.8, z: 0.2 }, orientation: { fingers: [0, 0, -1], palm: [0, -1, 0] }, anchor: 'grip' }));
  await page.waitForFunction(() => {
    const s = window.__game.sys;
    if (s.state !== 'play' || !s.active.some((x) => x.kind !== 'decoy')) return false;
    s.active.forEach((q) => (s.board.bulbs[q.i].life = 600));
    return true;
  }, null, { timeout: 120000 });
  const pinch = await page.evaluate(async () => {
    const d = window.IWER_DEVICE;
    const s = window.__game.sys;
    const lit = s.active.find((x) => x.kind !== 'decoy').i;
    const before = s.score;
    s.hovLive = lit; // "the pointer was on this lit bulb a moment ago" (while it now rests on some other, dark bulb)
    s.hovLiveT = s.clock;
    await d.remote.dispatch('set_select_value', { device: 'hand-right', value: 1 });
    await new Promise((r) => setTimeout(r, 900));
    await d.remote.dispatch('set_select_value', { device: 'hand-right', value: 0 });
    return { lit, before, after: s.score, wrong: s.wrong };
  });
  const rayScore = pinch.after;
  const aim = { score: pinch.before };
  check('pinch right after pointing at the lit bulb scores it', rayScore > aim.score && pinch.wrong === 0, `${aim.score} -> ${rayScore}`);
  await page.screenshot({ path: __dirname + '/out/8-xr.png' });
  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
