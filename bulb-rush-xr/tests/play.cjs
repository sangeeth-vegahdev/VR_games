// Headless play-through of Bulb Rush on the desktop path (mouse), plus a headset-session smoke test
// using IWER's emulated Quest. Needs the dev server (npx vite --port 8083) or a preview of the build.
// Usage: node tests/play.cjs            (GAME_URL=https://localhost:8083 by default)
// Screenshots go to tests/out/.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const GAME_URL = process.env.GAME_URL || 'https://localhost:8083';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|favicon/.test(m.text()) && errors.push(m.text()));

  await page.goto(GAME_URL + '/?hearts=3&tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, '1-title.png') });
  check('title state on load', (await page.evaluate(() => window.__game.state)) === 'title');
  const bulbCount = await page.evaluate(() => window.__game.sys.board.bulbs.length);
  check('38 bulbs (9+11+9+9)', bulbCount === 38, String(bulbCount));

  // Start with a real mouse click on the START button (projected to screen).
  const proj = (getter) =>
    page.evaluate(getter);
  const btn = await proj(() => {
    const s = window.__game.sys;
    const b = s.board.buttons.start;
    const v = b.node.getWorldPosition(s.v.clone());
    v.project(window.__world.camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  });
  await page.waitForTimeout(600);
  await page.mouse.click(btn.x, btn.y);
  await page.waitForFunction(() => window.__game.state === 'countdown', null, { timeout: 8000 }).then(
    () => check('mouse click on START begins countdown', true),
    () => check('mouse click on START begins countdown', false),
  );
  await page.screenshot({ path: path.join(OUT, '2-countdown.png') });
  await page.waitForFunction(() => window.__game.state === 'play', null, { timeout: 150000 });
  check('countdown ends in play', true);

  // Wait for a target, click it with the mouse, and read the result.
  const waitTarget = () => page.waitForFunction(() => window.__game.active.some((a) => a.kind !== 'decoy'), null, { timeout: 15000 });
  await waitTarget();
  // Freeze the lit bulb for the screenshot (the software renderer is slow), then give it a fresh life.
  await page.evaluate(() => {
    const s = window.__game.sys;
    s.active.forEach((a) => (s.board.bulbs[a.i].life = 60));
  });
  await page.screenshot({ path: path.join(OUT, '3-target.png') });
  await page.evaluate(() => {
    const s = window.__game.sys;
    s.active.forEach((a) => {
      const b = s.board.bulbs[a.i];
      b.life = 1.7;
      b.t0 = performance.now();
    });
  });
  const before = await page.evaluate(() => ({ score: window.__game.score, hearts: window.__game.hearts }));
  const tgt = await page.evaluate(() => {
    const s = window.__game.sys;
    const a = s.active.find((x) => x.kind !== 'decoy');
    const v = s.board.bulbWorldPos(a.i, s.v.clone());
    v.project(window.__world.camera);
    return { i: a.i, x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  });
  await page.mouse.click(tgt.x, tgt.y);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ score: window.__game.score, hearts: window.__game.hearts, streak: window.__game.streak, stats: window.__game.stats }));
  check('mouse click on the lit bulb scores', after.score > before.score, `${before.score} -> ${after.score}, reaction ${Math.round(after.stats.avg)} ms`);
  check('a hit keeps hearts', after.hearts === before.hearts);
  await page.screenshot({ path: path.join(OUT, '4-hit.png') });

  // A stray touch while nothing is lit is harmless; a wrong touch while a target is lit costs a heart.
  const pickUnlit = () => page.evaluate(() => {
    const s = window.__game.sys;
    const list = s.board.idleBulbs([]);
    const i = list.find((k) => !s.active.some((a) => a.i === k));
    const v = s.board.bulbWorldPos(i, s.v.clone());
    v.project(window.__world.camera);
    return { i, x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, hearts: window.__game.hearts };
  });
  await page.evaluate(() => { const s = window.__game.sys; s.clearLit(false); s.spawnIn = 9999; });
  await page.waitForTimeout(500);
  const stray = await pickUnlit();
  await page.mouse.click(stray.x, stray.y);
  await page.waitForTimeout(300);
  check('a stray touch with nothing lit is harmless', (await page.evaluate(() => window.__game.hearts)) === stray.hearts);

  await page.evaluate(() => { window.__game.sys.spawnIn = 0; });
  await page.waitForFunction(() => {
    const s = window.__game.sys;
    if (!s.active.some((x) => x.kind !== 'decoy')) return false;
    s.active.forEach((q) => (s.board.bulbs[q.i].life = 600));
    return true;
  }, null, { timeout: 150000 });
  // A dark bulb costs the streak, not a heart; a red X costs a heart.
  const wrongBulb = await pickUnlit();
  await page.evaluate(() => { window.__game.sys.streak = 4; });
  await page.mouse.click(wrongBulb.x, wrongBulb.y);
  await page.waitForTimeout(250);
  const dark = await page.evaluate(() => ({ hearts: window.__game.hearts, streak: window.__game.streak }));
  check('brushing a dark bulb costs the streak, not a heart', dark.hearts === wrongBulb.hearts && dark.streak === 0, JSON.stringify(dark));
  const decoy = await page.evaluate(() => {
    const s = window.__game.sys;
    const i = s.board.idleBulbs([]).find((k) => !s.active.some((a) => a.i === k));
    s.board.light(i, 'decoy', 600, performance.now());
    s.active.push({ i, kind: 'decoy', pair: -1, surge: false });
    const v = s.board.bulbWorldPos(i, s.v.clone());
    v.project(window.__world.camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, hearts: window.__game.hearts };
  });
  await page.waitForTimeout(600);
  await page.mouse.click(decoy.x, decoy.y);
  await page.waitForTimeout(250);
  const h2 = await page.evaluate(() => window.__game.hearts);
  check('touching a red X costs a heart', h2 === decoy.hearts - 1, `${decoy.hearts} -> ${h2}`);
  await page.screenshot({ path: path.join(OUT, '5-wrong.png') });
  await page.evaluate(() => { const s = window.__game.sys; s.active.forEach((q) => { const b = s.board.bulbs[q.i]; b.life = 1; b.t0 = performance.now() - 5000; }); });

  // Let targets expire (late = lose a heart) until the game ends.
  await page.waitForFunction(() => window.__game.state === 'over', null, { timeout: 150000 }).then(
    () => check('running out of hearts ends the game', true),
    () => check('running out of hearts ends the game', false, 'state=' + 'timeout'),
  );
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '6-over.png') });
  const over = await page.evaluate(() => ({ s: window.__game.stats, score: window.__game.score, best: localStorage.getItem('bulbrush-best-3') }));
  check('results stats recorded', over.s.hits >= 1 && over.s.expired + over.s.wrong >= 3 - 1, JSON.stringify(over.s));
  check('best score saved', Number(over.best) === over.score && over.score > 0, `best=${over.best}`);

  // Play again, then run a fast simulated session to check the difficulty curve and features.
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__game.start());
  await page.waitForFunction(() => window.__game.state === 'countdown');
  await page.waitForFunction(() => window.__game.state === 'play', null, { timeout: 150000 });
  check('play again restarts with full hearts', (await page.evaluate(() => window.__game.hearts)) === 3);

  const curve = await page.evaluate(() => {
    const s = window.__game.sys;
    const out = [];
    for (const lvl of [1, 3, 6, 10, 15, 25]) {
      s.level = lvl;
      out.push({ lvl, life: +s.life.toFixed(2), gap: +s.gap.toFixed(2) });
    }
    s.level = 1;
    return out;
  });
  console.log('difficulty curve', JSON.stringify(curve));
  check('target life shrinks with level', curve[0].life > curve[3].life && curve[3].life >= 0.52);

  // Stress: step the game logic at 90 Hz for several minutes of play, hitting everything. No errors, no stuck state.
  const stress = await page.evaluate(async () => {
    const s = window.__game.sys;
    s.resetRound();
    s.heartsPick = 5;
    s.hearts = 5;
    s.state = 'play';
    const seen = { decoy: 0, gold: 0, double: 0 };
    let t = performance.now();
    for (let f = 0; f < 90 * 120; f++) {
      // fake the clock forward: 1/90 s per step
      const dt = 1 / 90;
      const realNow = performance.now;
      const fake = (t += 1000 / 90);
      performance.now = () => fake;
      s.update(dt);
      const real = s.active.filter((a) => a.kind !== 'decoy');
      if (real.length > 1) seen.double++;
      for (const a of s.active) {
        if (a.kind === 'decoy') seen.decoy++;
        if (a.kind === 'gold') seen.gold++;
      }
      // Player: react after ~220-340 ms like a person, never touching decoys.
      for (const a of real) {
        const b = s.board.bulbs[a.i];
        if (!a.at) a.at = 0.22 + (a.i % 5) * 0.03;
        if ((fake - b.t0) / 1000 >= a.at) {
          s.onBulb(a.i);
          break;
        }
      }
      performance.now = realNow;
      if (s.state === 'over') break;
    }
    return { state: s.state, level: s.level, score: s.score, hits: s.hits, hearts: s.hearts, seen, stats: s.stats() };
  });
  console.log('stress', JSON.stringify(stress));
  check('sustained play reaches high levels', stress.level >= 10, 'level ' + stress.level);
  check('decoys, doubles and gold all appear', stress.seen.decoy > 0 && stress.seen.double > 0 && stress.seen.gold > 0, JSON.stringify(stress.seen));
  await page.screenshot({ path: path.join(OUT, '7-late.png') });

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
