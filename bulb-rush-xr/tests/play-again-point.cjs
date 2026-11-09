// Headset test: on the game-over card, pointing the hand ray at PLAY AGAIN (no pinch) starts a new round.
const { chromium } = require('playwright');
const GAME_URL = process.env.GAME_URL || 'https://localhost:8083';
(async () => {
  const browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'] });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.goto(GAME_URL + '/?hearts=3&tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
  await page.evaluate(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; window.__world.launchXR(); });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 20000 });
  await page.waitForFunction(() => { const s = window.__game.sys; s.readHead(); return s.anchorTimer <= 0 && Math.abs(s.board.rig.position.z - s.head.z) < 0.01; }, null, { timeout: 90000 });
  await page.evaluate(() => window.IWER_DEVICE.remote.dispatch('set_transform', { device: 'hand-left', position: { x: -0.5, y: 0.8, z: 0.2 }, orientation: { fingers: [0, 0, -1], palm: [0, -1, 0] }, anchor: 'grip' }));
  await page.evaluate(() => window.__game.sys.showOver());
  await page.waitForTimeout(1500);
  const aim = await page.evaluate(() => {
    const s = window.__game.sys;
    const v = s.board.buttons.start.node.getWorldPosition(s.v.clone());
    const o = { x: 0.25, y: 1.3, z: -0.05 };
    const dx = v.x - o.x, dy = v.y - o.y, dz = v.z - o.z;
    return { o, yaw: (Math.atan2(-dx, -dz) * 180) / Math.PI, pitch: (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI };
  });
  await page.evaluate(async (a) => {
    const quat = (pitch, yaw) => { const p = (pitch * Math.PI) / 360, y = (yaw * Math.PI) / 360; return { x: Math.cos(y) * Math.sin(p), y: Math.cos(p) * Math.sin(y), z: -Math.sin(y) * Math.sin(p), w: Math.cos(y) * Math.cos(p) }; };
    await window.IWER_DEVICE.remote.dispatch('set_transform', { device: 'hand-right', position: a.o, orientation: quat(a.pitch, a.yaw) });
  }, aim);
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => { const s = window.__game.sys; return { state: s.state, ptd: s.pointedAtStart(), dwell: s.playAgainDwell }; });
    console.log(JSON.stringify(r));
    if (r.state !== 'over') break;
  }
  const st = await page.evaluate(() => window.__game.state);
  console.log(st === 'countdown' || st === 'play' ? 'PASS' : 'FAIL', st);
  await browser.close();
})();
