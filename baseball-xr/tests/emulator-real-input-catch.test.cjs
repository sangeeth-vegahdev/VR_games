// Catches low, middle and high balls using ONLY the emulator's own input path: IWER `set_transform`
// moves the emulated hand / Touch controller (the same call the emulator UI makes when you drag a
// handle), the game reads it through the normal WebXR input pipeline, and the ball is caught or not.
// No grip space or palm is written directly.
//
// The game clock is stepped by the test (the headless renderer is too slow for real time) and held
// still while the emulated device moves and real XR frames deliver the new pose.
//
// Usage: GAME=baseball|cricket MODE=hand|controller node tests/emulator-real-input-catch.test.cjs
// (baseball dev server https://localhost:8082, cricket https://localhost:8081)
const { chromium } = require('playwright');

const GAME = process.env.GAME || (process.cwd().includes('cricket') ? 'cricket' : 'baseball');
const MODE = process.env.MODE || 'hand';
const URL = process.env.GAME_URL || (GAME === 'cricket' ? 'https://localhost:8081' : 'https://localhost:8082');
const N = Number(process.env.PITCHES || 24);
const CRICKET = GAME === 'cricket';

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${URL}/?${CRICKET ? 'balls' : 'pitches'}=${N}&tutorial=0`);
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
  await page.evaluate((mode) => {
    window.IWER_DEVICE.primaryInputMode = mode;
    window.__world.launchXR();
  }, MODE);
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 20000 });
  await page.waitForTimeout(2000);

  // Which emulated device is the catching hand?
  const side = await page.evaluate((cricket) => (cricket ? 'right' : window.__game.sys.glove.side), CRICKET);
  const other = side === 'left' ? 'right' : 'left';
  const dev = (s) => (MODE === 'hand' ? 'hand-' : 'controller-') + s;

  const move = (s, pos) =>
    page.evaluate(
      async ({ device, pos, hand }) => {
        const msg = { device, position: pos, anchor: 'grip' };
        if (hand) msg.orientation = { fingers: [0, 1, 0], palm: [0, 0, -1] }; // fingers up, palm to the pitcher
        await window.IWER_DEVICE.remote.dispatch('set_transform', msg);
      },
      { device: dev(s), pos, hand: MODE === 'hand' },
    );

  // The game clock: the real loop is silenced, the test steps it.
  await page.evaluate(() => {
    const sys = window.__game.sys;
    sys.__real = sys.update.bind(sys);
    sys.update = () => {};
    window.__DT = 1 / 60;
    window.__stepToFlying = () => {
      for (let i = 0; i < 60 * 60 * 20; i++) {
        if (sys.state === 'flying' && sys.ball.visible) {
          const first = !window.__seen || window.__seen !== sys.ball.position.z;
          window.__seen = sys.ball.position.z;
          if (first) break;
        }
        if (sys.state === 'over') return null;
        sys.__real(window.__DT);
      }
      return { aim: sys.aim.toArray(), low: !!sys.isLowCatch, high: !!sys.isHighCatch, head: sys.player.head.getWorldPosition(sys.aim.clone()).toArray() };
    };
    window.__stepToResolved = () => {
      const before = sys.score ?? sys.catches;
      for (let i = 0; i < 60 * 20 && sys.state === 'flying'; i++) sys.__real(window.__DT);
      return { caught: (sys.score ?? sys.catches) > before };
    };
  });
  // Where the game thinks the palm / pocket is.
  await page.evaluate((cricket) => {
    const sys = window.__game.sys;
    window.__handPoint = () => {
      sys.__real(0.0005);
      const p = cricket ? sys.palm.right : sys.glove.pocket;
      return p.toArray();
    };
  }, CRICKET);

  await move(other, { x: other === 'left' ? -0.9 : 0.9, y: 0.6, z: 0.1 }); // out of the ball's way
  await page.evaluate(() => {
    const sys = window.__game.sys;
    sys.lockout = 0;
    window.__game.start();
  });

  const results = [];
  for (let i = 0; i < N; i++) {
    const info = await page.evaluate(() => window.__stepToFlying());
    if (!info) break;
    const aim = { x: info.aim[0], y: info.aim[1], z: info.aim[2] };
    // Reach for the aim point with the emulated device, then correct for the palm / grip offset.
    const control = (i + 1) % 4 === 0; // negative control: hand 0.5 m off, must miss
    let target = { ...aim, x: aim.x + (control ? 0.5 : 0) };
    const want = control ? { ...aim, x: aim.x + 0.5 } : aim;
    let palm;
    for (let attempt = 0; attempt < 2; attempt++) {
      await move(side, target);
      await page.waitForTimeout(900); // real XR frames deliver the pose
      palm = await page.evaluate(() => window.__handPoint());
      target = { x: target.x + (want.x - palm[0]), y: target.y + (want.y - palm[1]), z: target.z + (want.z - palm[2]) };
    }
    const reachErr = Math.hypot(palm[0] - want.x, palm[1] - want.y, palm[2] - want.z);
    const res = await page.evaluate(() => window.__stepToResolved());
    results.push({ i: i + 1, y: +aim.y.toFixed(2), x: +aim.x.toFixed(2), flagLow: info.low, flagHigh: info.high, control, reachErr: +reachErr.toFixed(3), caught: res.caught });
  }

  const real = results.filter((r) => !r.control);
  const ctrl = results.filter((r) => r.control);
  const ys = real.map((r) => r.y).sort((a, b) => a - b);
  const lowCut = ys[Math.floor(ys.length / 3)];
  const highCut = ys[Math.floor((ys.length * 2) / 3)];
  const bucket = (r) => (r.y <= lowCut ? 'low' : r.y >= highCut ? 'high' : 'mid');
  const summary = {};
  for (const r of real) {
    const b = bucket(r);
    summary[b] = summary[b] || { n: 0, caught: 0, minY: 9, maxY: 0 };
    summary[b].n++;
    if (r.caught) summary[b].caught++;
    summary[b].minY = Math.min(summary[b].minY, r.y);
    summary[b].maxY = Math.max(summary[b].maxY, r.y);
  }
  console.log(`=== ${GAME.toUpperCase()} / ${MODE} / ${results.length} pitches ===`);
  console.table(results);
  console.log(JSON.stringify(summary));
  const total = real.filter((r) => r.caught).length;
  const ctrlMissed = ctrl.filter((r) => !r.caught).length;
  console.log(`REAL reach: caught ${total}/${real.length}; negative controls missed ${ctrlMissed}/${ctrl.length}; errors: ${errors.length}`);
  if (errors.length) console.log(errors.slice(0, 3));
  await browser.close();
  const ok = total === real.length && ctrlMissed === ctrl.length && real.length >= 8 && !errors.length;
  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exit(ok ? 0 : 1);
})();
