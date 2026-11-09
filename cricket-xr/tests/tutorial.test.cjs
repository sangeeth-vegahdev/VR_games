// First-time practice, played the way a first-timer plays it (fresh browser, no URL options, the mouse as the hand).
// Needs `npm run dev:runtime` running. Set GAME_URL to test a built copy.
//
// The software renderer runs at a few fps, so the game is stepped at a fixed 60 Hz inside the page.
// What this checks: the practice only starts when needed, waits for a hand in the ring, uses slow gentle balls
// that never touch the score, repeats a missed ball, ends after three catches, is remembered, and can be skipped.
const { chromium } = require('playwright');

const GAME_URL = process.env.GAME_URL || 'https://localhost:8081';
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failures++;
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
  });
  const errors = [];
  // One browser context means one localStorage, like one visitor's browser. Each load gets a fresh page in it.
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 700 } });
  let page;
  const open = async (query) => {
    if (page) await page.close();
    page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await page.goto(GAME_URL + '/' + query, { timeout: 90000 });
    await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
    await page.waitForTimeout(800);
  };

  // A brand-new visitor: nothing saved.
  await open('?balls=6');
  await page.evaluate(() => localStorage.clear());
  await open('?balls=6');

  check('a new visitor has not done the practice', await page.evaluate(() => window.__game.tutorialDone === false));

  // The helpers live in the page: hand placement by screen position, and fixed-step playback.
  await page.evaluate(() => {
    const sys = window.__game.sys;
    window.T = {
      sys,
      // Put the mouse hand on a world point, or well away from everything.
      handAt: (p) => {
        const v = p.clone().project(sys.world.camera);
        sys.desktop.ndc.set(v.x, v.y);
        sys.desktop.seen = true;
      },
      handAway: () => {
        sys.desktop.ndc.set(0.95, -0.95);
        sys.desktop.seen = true;
      },
      step: (done, each) => {
        for (let i = 0; i < 60 * 40 && !done(); i++) {
          if (each) each();
          sys.update(1 / 60);
        }
        return done();
      },
    };
  });

  // ---- start: the title card is short, then a ring waits for a hand ----
  await page.evaluate(() => window.__game.start());
  let s = await page.evaluate(() => ({ tut: window.__game.tutorial, stage: window.__game.tutorialStage, ring: window.__game.aimRingVisible }));
  check('the first round starts the practice, waiting for a hand', s.tut && s.stage === 'raise', JSON.stringify(s));

  await page.evaluate(() => {
    T.handAway();
    T.step(() => false, null); // runs the full cap: 40 s with no hand
  });
  s = await page.evaluate(() => ({ stage: window.__game.tutorialStage, state: window.__game.state, ring: window.__game.aimRingVisible, ballNo: window.__game.ballNo }));
  check('with no hand in the ring it waits (no ball is thrown)', s.stage === 'raise' && s.state === 'ready' && s.ballNo === 0, JSON.stringify(s));
  check('the ring is shown so the player knows where to put a hand', s.ring === true);

  // ---- hand in the ring: the first ball comes, slow and straight ----
  const first = await page.evaluate(() => {
    T.handAt(T.sys.spot);
    T.step(() => T.sys.state === 'flying', () => T.handAt(T.sys.spot));
    const sys = T.sys;
    return { speed: sys.throwSpeed, side: sys.side, swing: sys.swingA, ring: window.__game.aimRingVisible, ballNo: sys.ballNo, aimX: sys.aim.x };
  });
  check('practice ball 1 is slow', first.speed === 8, 'speed ' + first.speed);
  check('practice ball 1 comes straight, to the ring', first.side === 0 && first.swing === 0 && first.aimX === 0, JSON.stringify(first));
  check('the ring shows for the whole flight', first.ring === true);

  const caught1 = await page.evaluate(() => {
    T.step(() => T.sys.state === 'feedback', () => T.handAt(T.sys.aim));
    const sys = T.sys;
    return { result: sys.lastResult, score: sys.score, ballNo: sys.ballNo, done: window.__game.tutorialCaught, msg: sys.hud.model.message };
  });
  check('catching it is celebrated', caught1.result === 'caught' && /again/i.test(caught1.msg), JSON.stringify(caught1));
  check('a practice catch does not touch the score or ball count', caught1.score === 0 && caught1.ballNo === 0 && caught1.done === 1);

  // ---- ball 2: miss it on purpose; the same practice repeats, nothing is counted ----
  const missed = await page.evaluate(() => {
    T.step(() => T.sys.state === 'flying', () => T.handAway());
    const swung = T.sys.side !== 0 && T.sys.throwSpeed === 9.5;
    T.step(() => T.sys.state === 'feedback', () => T.handAway());
    const sys = T.sys;
    return { swung, result: sys.lastResult, misses: sys.misses, done: window.__game.tutorialCaught, msg: sys.hud.model.message };
  });
  check('practice ball 2 swings a little and is a bit quicker', missed.swung);
  check('a missed practice ball is not counted and the player is told where to reach', missed.result === 'missed' && missed.misses === 0 && missed.done === 1 && /ring/i.test(missed.msg), JSON.stringify(missed));

  // ---- catch two more: the practice ends ----
  const end = await page.evaluate(() => {
    for (let k = 0; k < 2; k++) {
      T.step(() => T.sys.state === 'flying', () => T.handAt(T.sys.spot));
      T.step(() => T.sys.state === 'feedback', () => T.handAt(T.sys.aim));
      T.step(() => T.sys.state === 'ready' || T.sys.state === 'swinging', () => T.handAt(T.sys.spot));
    }
    return { tut: window.__game.tutorial, done: window.__game.tutorialDone, flag: localStorage.getItem('cricket-catch-tutorial-done'), score: T.sys.score, misses: T.sys.misses };
  });
  check('three catches finish the practice, and it is remembered', end.tut === false && end.done === true && end.flag === '1', JSON.stringify(end));
  check('the practice left the score untouched', end.score === 0 && end.misses === 0);

  // ---- then the real round runs as before, and counts ----
  const real = await page.evaluate(() => {
    T.step(() => T.sys.state === 'flying', () => T.handAt(T.sys.spot));
    const ballNo = T.sys.ballNo;
    T.step(() => T.sys.state === 'feedback', () => T.handAt(T.sys.aim));
    return { ballNo, state: T.sys.state, tut: window.__game.tutorial };
  });
  check('the first real ball is ball 1 and is not practice', real.ballNo === 1 && real.tut === false, JSON.stringify(real));

  // ---- remembered across a reload; a returning player gets the full title and no practice ----
  await open('?balls=6');
  check('a returning player has done the practice', await page.evaluate(() => window.__game.tutorialDone === true));
  await page.evaluate(() => window.__game.start());
  check('a returning player goes straight to the round', await page.evaluate(() => window.__game.tutorial === false && window.__game.state === 'ready'));

  // ---- ?tutorial=0 skips it for a brand-new visitor ----
  await page.evaluate(() => localStorage.clear());
  await open('?balls=6&tutorial=0');
  await page.evaluate(() => window.__game.start());
  check('?tutorial=0 skips the practice', await page.evaluate(() => window.__game.tutorial === false && window.__game.tutorialDone === true));

  check('no page or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
