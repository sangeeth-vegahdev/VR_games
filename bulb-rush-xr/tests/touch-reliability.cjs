// Regression test for "I touched the right bulb and it still said TOO SLOW".
//
// Cause: the SDK's touch pointer only reports a press on the frame a fingertip goes from "away" to "near the board",
// then stays "down". A finger resting on the board, or sliding from bulb to bulb, never produced a new press.
// GameSystem.watchTouch() now reads the fingertip position every frame. This test drives a REAL emulated tracked
// hand (IWER) and checks:
//   1. CONTROL: with watchTouch switched off, a finger that is already on the board misses a lit bulb (the old bug).
//   2. a finger already resting on a bulb that lights scores it
//   3. a finger sliding along the board onto the next lit bulb scores it
//   4. a red X is never punished while the hand is merely resting on it, and costs exactly ONE heart when touched
//   5. a touch that lands a hair after the ring ran out (hitGrace) still scores; one far too late is TOO SLOW
//   6. pinch + poke arriving twice on one bulb scores once and never reads as a stray touch
// Needs the dev server (npx vite --port 8083).
const { chromium } = require('playwright');
const GAME_URL = process.env.GAME_URL || 'https://localhost:8083';
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); if (!ok) failures++; };

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|favicon/.test(m.text()) && errors.push(m.text()));
  await page.goto(GAME_URL + '/?hearts=5&tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
  await page.evaluate(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; window.__world.launchXR(); });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 20000 });
  await page.waitForFunction(() => { const s = window.__game.sys; s.readHead(); return s.anchorTimer <= 0 && Math.abs(s.board.rig.position.z - s.head.z) < 0.01; }, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const h = window.__world.input.xr.visualAdapters.hand;
    return ['left', 'right'].every((k) => h[k].visual && h[k].visual.constructor.name === 'SkinHand' && h[k].visual.model.visible);
  }, null, { timeout: 30000 });

  // ---- helpers that run in the page ----
  await page.evaluate(() => {
    const d = window.IWER_DEVICE;
    const hand = (side) => window.__world.input.xr.visualAdapters.hand[side].visual.model;
    window.T = {
      tip: (side) => hand(side).getObjectByName('index-finger-tip').getWorldPosition(new window.__game.sys.v.constructor()),
      async put(side, x, y, z) {
        await d.remote.dispatch('set_transform', { device: 'hand-' + side, position: { x, y, z }, orientation: { fingers: [0, 0, -1], palm: [0, -1, 0] }, anchor: 'index-finger-tip' });
        for (let k = 0; k < 400; k++) { // wait until the tracked fingertip is really there
          const p = window.T.tip(side);
          if (Math.hypot(p.x - x, p.y - y, p.z - z) < 0.012) return true;
          await new Promise((r) => setTimeout(r, 50));
        }
        return false;
      },
      pos: (i) => window.__game.sys.board.bulbWorldPos(i, new window.__game.sys.v.constructor()),
      // a clean play state: no random spawns, nothing lit, hands parked far from the board
      async arena() {
        const s = window.__game.sys;
        s.beginRound();
        s.hud.showCard(false);
        s.state = 'play';
        s.tutorial = false;
        s.surgeT = 0;
        s.clearLit(false);
        s.spawnIn = 1e9;
        s.spawnWave = () => {}; // an expiry re-arms the spawner; keep the arena deterministic
        s.hearts = s.heartsPick;
        s.streak = 0;
        s.score = 0; s.hits = 0; s.wrong = 0; s.expired = 0;
        for (const b of s.board.bulbs) { b.resolvedAt = -1e9; b.flashT = 0; }
        await window.T.put('left', -0.6, 0.7, 0.3);
        await window.T.put('right', 0.5, 0.7, 0.3);
      },
      lit(i, kind = 'target', life = 600) { const s = window.__game.sys; s.light(i, kind, life, performance.now()); },
      frames: (n) => new Promise((res) => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }),
    };
  });
  const BULB = 14; // a middle bulb in the second row (the one the first tutorial bulb uses)
  const NEXT = 15; // its right-hand neighbour, 8 cm away

  const scoreOf = () => page.evaluate(() => ({ hits: window.__game.sys.hits, hearts: window.__game.hearts, wrong: window.__game.sys.wrong, expired: window.__game.sys.expired, streak: window.__game.streak, active: window.__game.sys.active.length }));
  const target = (i) => page.evaluate((i) => { const p = window.T.pos(i); return { x: p.x, y: p.y, z: p.z }; }, i);

  // ---- 1. CONTROL: the old behaviour (SDK press only) misses a lit bulb under a resting finger ----
  await page.evaluate(() => window.T.arena());
  let t = await target(BULB);
  await page.evaluate((t) => window.T.put('right', t.x, t.y, t.z + 0.02), t); // fingertip resting 2 cm in front of the glass
  await page.evaluate(() => { window.__realWatch = window.__game.sys.watchTouch; window.__game.sys.watchTouch = () => {}; });
  await page.evaluate((i) => window.T.lit(i), BULB);
  await page.evaluate(() => window.T.frames(25));
  let r = await scoreOf();
  check('CONTROL (polling off): a resting finger does NOT score a bulb that lights under it  [the reported bug]', r.hits === 0, JSON.stringify(r));
  await page.evaluate(() => { window.__game.sys.watchTouch = window.__realWatch; });

  // ---- 2. fixed: the same situation now scores ----
  await page.evaluate(() => window.T.frames(10));
  r = await scoreOf();
  check('resting finger on a lit bulb scores it', r.hits === 1 && r.expired === 0 && r.hearts === 5, JSON.stringify(r));

  // ---- 3. sliding onto the next lit bulb ----
  await page.evaluate(() => window.T.arena());
  t = await target(BULB);
  await page.evaluate((t) => window.T.put('right', t.x, t.y, t.z + 0.02), t);
  await page.evaluate(() => window.T.frames(6));
  const t2 = await target(NEXT);
  await page.evaluate((i) => window.T.lit(i), NEXT);
  // slide in several small steps, like a real hand, never leaving the board
  for (let k = 1; k <= 4; k++) {
    await page.evaluate((a) => window.T.put('right', a.x, a.y, a.z), { x: t.x + (t2.x - t.x) * (k / 4), y: t.y + (t2.y - t.y) * (k / 4), z: t.z + (t2.z - t.z) * (k / 4) + 0.02 });
  }
  await page.evaluate(() => window.T.frames(8));
  r = await scoreOf();
  check('finger sliding along the board onto the next lit bulb scores it', r.hits === 1 && r.hearts === 5, JSON.stringify(r));

  // ---- 4. red X: resting hand is safe, a fresh touch costs exactly one heart ----
  await page.evaluate(() => window.T.arena());
  t = await target(BULB);
  await page.evaluate((t) => window.T.put('right', t.x, t.y, t.z + 0.02), t);
  await page.evaluate(() => window.T.frames(5));
  await page.evaluate((i) => window.T.lit(i, 'decoy', 600), BULB);
  await page.evaluate(() => window.T.frames(25));
  r = await scoreOf();
  check('a hand already resting on a bulb that turns into a red X is not punished', r.hearts === 5 && r.active === 1, JSON.stringify(r));
  await page.evaluate(() => window.T.put('right', 0.5, 0.7, 0.3)); // lift away
  await page.evaluate(() => window.T.frames(10));
  await page.evaluate((t) => window.T.put('right', t.x, t.y, t.z + 0.02), t); // and touch it
  await page.evaluate(() => window.T.frames(25));
  r = await scoreOf();
  check('touching a red X costs exactly one heart (and it goes dark)', r.hearts === 4 && r.active === 0, JSON.stringify(r));

  // ---- 5. grace window (deterministic: call the game's own expiry step directly) ----
  await page.evaluate(() => window.T.arena());
  const g1 = await page.evaluate((i) => {
    const s = window.__game.sys;
    window.T.lit(i, 'target', 0.4);
    s.board.bulbs[i].t0 = performance.now() - 460; // 60 ms past the end of its ring
    s.updatePlay(0.016, performance.now());
    return { stillLit: s.entry(i) !== null, expired: s.expired, hearts: s.hearts };
  }, BULB);
  check('a target 60 ms past its ring is still hittable (hitGrace), not yet TOO SLOW', g1.stillLit && g1.expired === 0 && g1.hearts === 5, JSON.stringify(g1));
  const g2 = await page.evaluate((i) => {
    const s = window.__game.sys;
    s.board.bulbs[i].t0 = performance.now() - 900; // far past it
    s.updatePlay(0.016, performance.now());
    return { stillLit: s.entry(i) !== null, expired: s.expired, hearts: s.hearts };
  }, BULB);
  check('a target left far too long still ends as TOO SLOW (one heart)', !g2.stillLit && g2.expired === 1 && g2.hearts === 4, JSON.stringify(g2));

  // ---- 6. one gesture arriving twice ----
  await page.evaluate(() => window.T.arena());
  await page.evaluate((i) => { window.T.lit(i); window.T.lit(i + 1); }, BULB); // a second lit bulb keeps hasReal() true
  const dbl = await page.evaluate((i) => {
    const s = window.__game.sys;
    s.onBulb(i);
    const after1 = { hits: s.hits, wrong: s.wrong, streak: s.streak };
    s.board.bulbs[i].resolvedAt -= 200; // the duplicate lands 200 ms later (old code: 114 ms was already read as a stray touch)
    s.onBulb(i);
    return { after1, hits: s.hits, wrong: s.wrong, streak: s.streak };
  }, BULB);
  check('pinch + poke on one bulb scores once and never breaks the streak', dbl.after1.hits === 1 && dbl.hits === 1 && dbl.wrong === 0 && dbl.streak === 1, JSON.stringify(dbl));

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
