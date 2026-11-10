// In an IWER XR session, the real mouse must move the hand through low and high positions,
// and moving a controller by its handle must hand control back to the controller.
// Usage: GAME_URL=https://localhost:8082 node tests/emulator-mouse-hand.test.cjs   (cricket: 8081)
const { chromium } = require('playwright');

const GAME_URL = process.env.GAME_URL || 'https://localhost:8082';
const CRICKET = GAME_URL.includes('8081');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(GAME_URL + '/?tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });
  await page.evaluate(() => window.__world.launchXR());
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(1500);

  const read = () =>
    page.evaluate(() => {
      const s = window.__game.sys;
      const p = s.desktop.position;
      return { active: s.desktop.active, x: p.x, y: p.y, z: p.z };
    });

  const results = {};
  await page.mouse.move(640, 360);
  await page.mouse.move(650, 365);
  await page.waitForTimeout(300);
  results.center = await read();
  await page.mouse.move(650, 700);
  await page.waitForTimeout(300);
  results.low = await read();
  await page.mouse.move(650, 80);
  await page.waitForTimeout(300);
  results.high = await read();
  await page.mouse.move(1270, 360);
  await page.waitForTimeout(300);
  results.right = await read();

  // The mitt (baseball) follows the mouse hand.
  if (!CRICKET) {
    results.mittFollows = await page.evaluate(() => {
      const s = window.__game.sys;
      return { ok: s.glove.ok, dy: Math.abs(s.glove.pocket.y - s.desktop.position.y) };
    });
  }

  // Move a controller via the emulator: control returns to the controller.
  await page.evaluate(async () => {
    const d = window.IWER_DEVICE;
    d.primaryInputMode = 'controller';
    await d.remote.dispatch('set_transform', { device: 'controller-right', position: { x: 0.4, y: 0.9, z: -0.5 }, anchor: 'grip' });
  });
  await page.waitForTimeout(400);
  await page.evaluate(async () => {
    await window.IWER_DEVICE.remote.dispatch('set_transform', { device: 'controller-right', position: { x: 0.2, y: 1.4, z: -0.5 }, anchor: 'grip' });
  });
  await page.waitForTimeout(400);
  results.afterController = await read();

  console.log(JSON.stringify(results, null, 2));
  const checks = {
    'mouse hand active in session': results.center.active,
    // The mitt follows the view (see pointer-alignment.test.cjs for the exact check): low is below the
    // centre of the view, high is above it.
    'low is below the centre of the view': results.low.y < results.center.y - 0.1,
    'high is above the centre of the view': results.high.y > results.center.y + 0.1,
    'moves sideways': results.right.x > 0.9,
    'controller takes over': results.afterController.active === false,
    'no page errors': errors.length === 0,
  };
  if (!CRICKET) checks['mitt follows mouse hand'] = results.mittFollows.ok && results.mittFollows.dy < 0.3;
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) {
    console.log((v ? 'PASS ' : 'FAIL ') + k);
    if (!v) bad++;
  }
  if (errors.length) console.log(errors);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
