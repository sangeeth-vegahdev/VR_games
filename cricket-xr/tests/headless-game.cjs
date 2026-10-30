// End-to-end headless test using IWER's emulated hands.
// Needs `npm run dev:runtime` running and Playwright's Chromium available.
// Usage: node tests/headless-game.cjs   (set CHROME_PATH to use a specific Chromium binary)
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await page.goto('https://localhost:8081/');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });
  await page.evaluate(() => {
    window.IWER_DEVICE.primaryInputMode = 'hand';
    window.__world.launchXR();
  });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });

  // Helpers that run inside the page.
  await page.evaluate(() => {
    const d = window.IWER_DEVICE;
    window.__place = async (side, x, y, z) => {
      d.hands[side].connected = true;
      await d.remote.dispatch('set_hand_pose', { device: 'hand-' + side, poseId: 'open' });
      await d.remote.dispatch('set_transform', { device: 'hand-' + side, position: { x, y, z }, anchor: 'grip' });
    };
    window.__park = async () => {
      await window.__place('left', -0.8, 0.7, -0.2);
      await window.__place('right', 0.8, 0.7, -0.2);
    };
    // Per-ball log: speed shown, and how far the path bends away from a straight line.
    window.__log = [];
    window.__follow = false;
    setInterval(() => {
      const g = window.__game;
      if (g.state === 'flying') {
        const log = window.__log;
        let rec = log[g.ballNo - 1];
        if (!rec) rec = log[g.ballNo - 1] = { kmh: g.kmh, maxDev: 0, startX: null };
        const p = g.ballPos, a = g.aim;
        if (rec.startX === null) { rec.startX = p.x; rec.z0 = p.z; }
        const k = (p.z - rec.z0) / (a.z - rec.z0);
        const lineX = rec.startX + (a.x - rec.startX) * k;
        rec.maxDev = Math.max(rec.maxDev, Math.abs(p.x - lineX));
      }
      if (window.__follow && (g.state === 'swinging' || g.state === 'flying')) {
        window.__place('right', g.aim.x, g.aim.y, g.aim.z);
      }
    }, 20);
  });

  const waitFor = (fn, timeout) => page.waitForFunction(fn, null, { timeout });
  const snap = () => page.evaluate(() => ({ state: window.__game.state, score: window.__game.score, misses: window.__game.misses, ballNo: window.__game.ballNo }));
  const results = {};

  // Round A: a hand always meets the ball.
  await page.evaluate(() => window.__park());
  await page.evaluate(() => { window.__follow = true; });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__game.start());
  await waitFor(() => window.__game.state === 'over', 150000);
  results.A = await snap();
  results.log = await page.evaluate(() => window.__log.map((r) => ({ kmh: r.kmh, maxDev: +r.maxDev.toFixed(2) })));

  // Restart by touching the green ball.
  await page.evaluate(() => { window.__follow = false; });
  await page.waitForTimeout(1300); // restart lockout
  await page.evaluate(() => window.__place('right', 0, 1.25, -0.65));
  await waitFor(() => window.__game.state !== 'over', 8000);
  results.restartedState = (await snap()).state;

  // Round B: hands stay out of the way.
  await page.evaluate(() => window.__park());
  await waitFor(() => window.__game.state === 'over', 150000);
  results.B = await snap();
  await page.screenshot({ path: '/tmp/game-over.png' });

  console.log(JSON.stringify(results));
  console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');

  const speeds = results.log.map((r) => r.kmh);
  const rising = speeds.length === 6 && speeds.every((v, i) => i === 0 || v > speeds[i - 1]);
  const bends = results.log.length === 6 && results.log.every((r) => r.maxDev > 0.05);
  const checks = {
    'A caught 6/6': results.A.score === 6 && results.A.misses === 0,
    'restart by hand': results.restartedState !== 'over',
    'B missed 6/6': results.B.score === 0 && results.B.misses === 6,
    'speed rises every ball': rising,
    'ball swings in the air': bends,
    'swing grows with each ball': results.log.length === 6 && results.log[5].maxDev > results.log[0].maxDev,
    'no page errors': errors.length === 0,
  };
  for (const [name, ok] of Object.entries(checks)) console.log(ok ? 'PASS' : 'FAIL', name);
  await browser.close();
  process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
})();
