// Meta Quest hand-tracking: can a player START the game with a real-hand pinch (no keyboard, no controller)?
// Scenarios: (1) ray-pinch aimed at START, (2) pinch aimed at empty space, (3) pinch on 5 HEARTS must not start.
// Needs the dev server (npx vite --port 8083).
const { chromium } = require('playwright');
const GAME_URL = process.env.GAME_URL || 'https://localhost:8083';
const SIDE = process.env.SIDE || 'hand-right';
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); if (!ok) failures++; };

async function session(browser) {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 700 } });
  await page.goto(GAME_URL + '/?hearts=3&tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
  await page.evaluate(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; window.__world.launchXR(); });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 20000 });
  await page.waitForFunction(() => { const s = window.__game.sys; s.readHead(); return s.anchorTimer <= 0 && Math.abs(s.board.rig.position.z - s.head.z) < 0.01; }, null, { timeout: 90000 });
  await page.evaluate(() => window.IWER_DEVICE.remote.dispatch('set_transform', { device: 'hand-left', position: { x: -0.5, y: 0.8, z: 0.2 }, orientation: { fingers: [0, 0, -1], palm: [0, -1, 0] }, anchor: 'grip' }));
  await page.waitForTimeout(800);
  return page;
}

// Aim a hand's ray at a world point (or a direction offset) and pinch for a moment.
async function aimPinch(page, target, pinch = true) {
  await page.evaluate(async ({ t, side, pinch }) => {
    const d = window.IWER_DEVICE;
    const o = { x: side === 'hand-left' ? -0.25 : 0.25, y: 1.3, z: -0.05 };
    const dx = t.x - o.x, dy = t.y - o.y, dz = t.z - o.z;
    const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI, pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
    const p = (pitch * Math.PI) / 360, y = (yaw * Math.PI) / 360;
    const q = { x: Math.cos(y) * Math.sin(p), y: Math.cos(p) * Math.sin(y), z: -Math.sin(y) * Math.sin(p), w: Math.cos(y) * Math.cos(p) };
    await d.remote.dispatch('set_transform', { device: side, position: o, orientation: q });
    await new Promise((r) => setTimeout(r, 1200));
    if (pinch) {
      await d.remote.dispatch('set_select_value', { device: side, value: 1 });
      await new Promise((r) => setTimeout(r, 900));
      await d.remote.dispatch('set_select_value', { device: side, value: 0 });
    } else {
      await new Promise((r) => setTimeout(r, 1800)); // just point and wait: no pinch
    }
    await new Promise((r) => setTimeout(r, 700));
  }, { t: target, side: SIDE, pinch });
}
const btn = (page, name) => page.evaluate((n) => { const s = window.__game.sys; const v = s.board.buttons[n].node.getWorldPosition(s.v.clone()); return { x: v.x, y: v.y, z: v.z }; }, name);

(async () => {
  const browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'] });

  let page = await session(browser);
  await aimPinch(page, await btn(page, 'start'));
  let st = await page.evaluate(() => window.__game.state);
  check(`[${SIDE}] ray-pinch aimed at START begins the game`, st === 'countdown' || st === 'play', 'state=' + st);
  await page.close();

  page = await session(browser);
  const sky = await page.evaluate(() => { const s = window.__game.sys; s.readHead(); return { x: s.head.x - 0.5, y: s.head.y + 1.2, z: s.head.z - 1.2 }; });
  await aimPinch(page, sky);
  st = await page.evaluate(() => window.__game.state);
  check(`[${SIDE}] pinch anywhere (not on a button) begins the game`, st === 'countdown' || st === 'play', 'state=' + st);
  await page.close();

  page = await session(browser);
  await aimPinch(page, await btn(page, 'hearts5'));
  const r = await page.evaluate(() => ({ st: window.__game.state, hearts: window.__game.sys.heartsPick }));
  check(`[${SIDE}] pinch on 5 HEARTS selects 5 and does NOT start`, r.st === 'title' && r.hearts === 5, JSON.stringify(r));
  await page.close();

  // ---- point only: no pinch, no poke ----
  page = await session(browser);
  await aimPinch(page, await btn(page, 'start'), false);
  st = await page.evaluate(() => window.__game.state);
  check(`[${SIDE}] POINT at START (no pinch) begins the game`, st === 'countdown' || st === 'play', 'state=' + st);
  await page.waitForFunction(() => window.__game.state === 'play', null, { timeout: 150000 });
  // freeze a lit target, sweep a dark bulb first (must be free), then point at the target
  await page.waitForFunction(() => { const s = window.__game.sys; if (!s.active.some((x) => x.kind !== 'decoy')) return false; s.active.forEach((q) => (s.board.bulbs[q.i].life = 600)); return true; }, null, { timeout: 90000 });
  const dark = await page.evaluate(() => { const s = window.__game.sys; const lit = new Set(s.active.map((x) => x.i)); const b = s.board.bulbs.find((x) => !lit.has(x.index) && x.mode === 'idle'); const v = s.board.bulbWorldPos(b.index, s.v.clone()); return { x: v.x, y: v.y, z: v.z }; });
  const h0 = await page.evaluate(() => ({ h: window.__game.hearts, sc: window.__game.score }));
  await aimPinch(page, dark, false);
  const h1 = await page.evaluate(() => ({ h: window.__game.hearts, sc: window.__game.score }));
  check(`[${SIDE}] pointing at a DARK bulb costs nothing and scores nothing`, h1.h === h0.h && h1.sc === h0.sc, JSON.stringify([h0, h1]));
  const tgt = await page.evaluate(() => { const s = window.__game.sys; const a = s.active.find((x) => x.kind !== 'decoy'); const v = s.board.bulbWorldPos(a.i, s.v.clone()); return { x: v.x, y: v.y, z: v.z }; });
  const s0 = await page.evaluate(() => window.__game.score);
  await aimPinch(page, tgt, false);
  const s1 = await page.evaluate(() => window.__game.score);
  check(`[${SIDE}] POINT at the lit bulb (no pinch) scores`, s1 > s0, `${s0} -> ${s1}`);
  await page.close();

  // ---- red X bulbs: pointing at one must cost a heart; high levels must have several at once ----
  page = await session(browser);
  await aimPinch(page, await btn(page, 'start'), false);
  await page.waitForFunction(() => window.__game.state === 'play', null, { timeout: 150000 });
  const many = await page.evaluate(() => {
    const s = window.__game.sys; let max = 0;
    s.level = 10;
    for (let k = 0; k < 40; k++) {
      s.clearLit(false);
      s.spawnWave(performance.now());
      max = Math.max(max, s.active.filter((a) => a.kind === 'decoy').length);
    }
    s.clearLit(false);
    return max;
  });
  check('level 10 puts several red X bulbs on the board at once', many >= 3, 'max decoys=' + many);
  const red = await page.evaluate(() => {
    const s = window.__game.sys;
    s.level = 1; s.tutorial = false; s.clearLit(false); s.spawnIn = 999;
    const b = s.board.bulbs.find((x) => x.mode === 'idle' && x.row === 1 && x.col === 4);
    s.board.light(b.index, 'decoy', 600, performance.now());
    s.active.push({ i: b.index, kind: 'decoy', pair: -1, surge: false });
    const v = s.board.bulbWorldPos(b.index, s.v.clone());
    return { x: v.x, y: v.y, z: v.z, hearts: window.__game.hearts };
  });
  await aimPinch(page, red, false);
  const hAfter = await page.evaluate(() => window.__game.hearts);
  check(`[${SIDE}] POINTING at a red X bulb costs a heart`, hAfter === red.hearts - 1, `${red.hearts} -> ${hAfter} (exactly one, not repeated)`);
  await page.close();

  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
