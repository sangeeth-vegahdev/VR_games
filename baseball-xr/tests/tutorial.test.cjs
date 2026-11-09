// First-time practice, played the way a first-timer plays it (fresh browser, no URL options, the mouse as the mitt).
// Needs `npm run dev:runtime` running. Set GAME_URL to test a built copy.
const { chromium } = require('playwright');

const GAME_URL = process.env.GAME_URL || 'https://localhost:8082';
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
  // One context means one localStorage, like one visitor's browser.
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 700 } });
  const errors = [];
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

  await open('?pitches=6');
  await page.evaluate(() => localStorage.clear());
  await open('?pitches=6');
  check('a new visitor has not done the practice', await page.evaluate(() => window.__game.tutorialDone === false));

  await page.evaluate(() => {
    const sys = window.__game.sys;
    window.T = {
      sys,
      // Put the mouse mitt on a world point (the mitt's pocket sits at the pointer's plane point).
      mittAt: (p) => {
        const v = p.clone().project(sys.world.camera);
        sys.desktop.ndc.set(v.x, v.y);
        sys.desktop.seen = true;
      },
      mittAway: () => {
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

  await page.evaluate(() => window.__game.start());
  let s = await page.evaluate(() => ({ tut: window.__game.tutorial, stage: window.__game.tutorialStage }));
  check('the first round starts the practice, waiting for the mitt in the gold ring', s.tut && s.stage === 'raise', JSON.stringify(s));

  await page.evaluate(() => { T.mittAway(); T.step(() => false, null); });
  s = await page.evaluate(() => ({ stage: window.__game.tutorialStage, state: window.__game.state, pitchNo: window.__game.pitchNo }));
  check('with the mitt away from the ring nothing is thrown', s.stage === 'raise' && s.pitchNo === 0, JSON.stringify(s));

  // Mitt in the ring: the first pitch comes, at the ring, and it is slow.
  const first = await page.evaluate(() => {
    T.step(() => T.sys.state === 'windup' || T.sys.state === 'flying', () => T.mittAt(T.sys.zoneCenter));
    T.step(() => T.sys.state === 'flying', () => T.mittAt(T.sys.zoneCenter));
    return { mph: T.sys.mph, aimX: T.sys.aim.x, aimY: T.sys.aim.y, pitchNo: T.sys.pitchNo };
  });
  check('practice pitch 1 is slow', first.mph > 20 && first.mph < 30, 'mph ' + first.mph);
  check('practice pitch 1 is on the ring (no miss)', Math.abs(first.aimX) < 1e-6, JSON.stringify(first));

  const caught = await page.evaluate(() => {
    T.step(() => T.sys.state === 'feedback', () => T.mittAt(T.sys.aim));
    return { result: T.sys.lastResult, catches: T.sys.catches, pitchNo: T.sys.pitchNo, msg: T.sys.hud.model.message, done: window.__game.tutorialCaught };
  });
  check('the practice catch is celebrated and not counted', caught.result === 'caught' && caught.catches === 0 && caught.pitchNo === 0 && caught.done === 1, JSON.stringify(caught));

  // Two more catches: the practice ends.
  // Catch until the practice ends. Stop the moment it does, so the first real pitch is not part of this check.
  const end = await page.evaluate(() => {
    T.step(() => !T.sys.tut, () => {
      if (T.sys.state === 'flying') T.mittAt(T.sys.zoneCenter);
      else if (T.sys.state === 'feedback') T.mittAt(T.sys.aim);
      else T.mittAt(T.sys.zoneCenter);
    });
    return { tut: window.__game.tutorial, done: window.__game.tutorialDone, flag: localStorage.getItem('glove-up-tutorial-done'), catches: T.sys.catches, pitchNo: T.sys.pitchNo, state: T.sys.state };
  });
  check('three catches finish the practice, and it is remembered', end.tut === false && end.done === true && end.flag === '1', JSON.stringify(end));
  check('the practice left the score untouched', end.catches === 0 && end.pitchNo === 0, JSON.stringify(end));

  await open('?pitches=6');
  check('a returning player has done the practice', await page.evaluate(() => window.__game.tutorialDone === true));

  await page.evaluate(() => localStorage.clear());
  await open('?pitches=6&tutorial=0');
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
