// Headless spike test: needs 'npm run dev:runtime' running and Playwright's Chromium available.
// Usage: node tests/headless-catch.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 700 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto('https://localhost:8081/');
  await page.waitForFunction(() => window.__catch && window.__world, null, { timeout: 30000 });

  await page.evaluate(() => {
    window.IWER_DEVICE.primaryInputMode = 'hand';
    window.__world.launchXR();
  });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 }).catch(() => {});
  const sess = await page.evaluate(() => ({ session: !!window.__world.session, mode: window.IWER_DEVICE.primaryInputMode }));
  console.log('session', JSON.stringify(sess));

  const run = async (label, handPos) => {
    await page.evaluate(async (p) => {
      const d = window.IWER_DEVICE;
      for (const side of ['left', 'right']) {
        d.hands[side].connected = true;
        await d.remote.dispatch('set_hand_pose', { device: 'hand-' + side, poseId: 'open' });
        await d.remote.dispatch('set_transform', { device: 'hand-' + side, position: { x: p[side][0], y: p[side][1], z: p[side][2] }, anchor: 'grip' });
      }
    }, handPos);
    await page.waitForTimeout(1200);
    console.log(label, 'grips', JSON.stringify(await page.evaluate(() => {
      const p = window.__world.player, T = p.head.position.constructor, t = new T();
      const f = (o) => { o.getWorldPosition(t); return [t.x, t.y, t.z].map((n) => +n.toFixed(2)); };
      return { left: f(p.gripSpaces.left), right: f(p.gripSpaces.right) };
    })));
    await page.evaluate(() => window.__catch.launch());
    await page.waitForFunction(() => window.__catch.phase !== 'flying', null, { timeout: 8000 }).catch(() => {});
    const r = await page.evaluate(() => ({ phase: window.__catch.phase, side: window.__catch.side, catches: window.__catch.catches, misses: window.__catch.misses }));
    console.log(label, JSON.stringify(r));
    return r;
  };

  const a = await run('hand in path ', { right: [0, 1.2, -0.5], left: [-0.6, 0.9, -0.3] });
  const b = await run('hands away   ', { right: [0.7, 0.8, -0.3], left: [-0.7, 0.8, -0.3] });
  await page.screenshot({ path: '/tmp/catch.png' });
  console.log('errors:', errs.length ? errs.slice(0, 5) : 'none');
  console.log(a.phase === 'caught' && b.phase === 'missed' ? 'PASS' : 'FAIL');
  await browser.close();
})();
