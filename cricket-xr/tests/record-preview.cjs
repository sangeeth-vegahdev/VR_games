// Records a short player's-eye preview of a 3-ball round (catch, miss, catch) as PNG frames, using IWER's
// emulated headset and hands. Needs `npm run dev:runtime` running.
//   node tests/record-preview.cjs                  (frames go to ./preview-frames)
//   ffmpeg -framerate 12 -i preview-frames/f%04d.png -c:v libx264 -pix_fmt yuv420p preview.mp4
// Env: OUT=<frames dir>, CHROME_PATH=<chromium binary>. Palms are drawn as small stand-ins because a real
// headset draws its own hand models. On a software renderer this takes several minutes; with a GPU it is fast.
const fs = require('node:fs');
const OUT = process.env.OUT || 'preview-frames';
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const W = 800, H = 450;
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'] });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: W, height: H } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  await page.goto('https://localhost:8081/?balls=3');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 40000 });
  await page.evaluate(() => { localStorage.removeItem('cricket-catch-best-3'); window.IWER_DEVICE.primaryInputMode = 'hand'; window.__world.launchXR(); });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  await page.evaluate(async () => {
    // Hide the emulator's panels and its gizmo canvas (z-index 3) so only the player's view remains.
    const fixed = [...document.body.children].find((e) => getComputedStyle(e).position === 'fixed' && e.querySelector('canvas'));
    for (const kid of fixed.children) {
      if (kid.tagName === 'CANVAS' && getComputedStyle(kid).zIndex !== '3') continue;
      kid.style.display = 'none';
    }
    const d = window.IWER_DEVICE, s = window.__game.sys;
    // Freeze the page's own game loop: from here on, only the steps below advance game time.
    window.__real = s.constructor.prototype.update;
    s.update = () => {};
    // Tilt the head down ~15 degrees, as a player does to watch the catching area.
    await d.remote.dispatch('look_at', { device: 'headset', target: { x: 0, y: 0.85, z: -3.2 } });
    // Stand-in palms, because a headset draws its own hand models.
    const G = s.ball.geometry.constructor, M = s.ball.material.constructor, Mesh = s.ball.constructor;
    for (const side of ['left', 'right']) {
      const palm = new Mesh(new G(0.07, 16, 12), new M({ color: 0xffc9a0, roughness: 0.6 }));
      palm.scale.set(1, 0.4, 1.4);
      s.player.gripSpaces[side].add(palm);
      d.hands[side].connected = true;
      await d.remote.dispatch('set_hand_pose', { device: 'hand-' + side, poseId: 'open' });
    }
    const rest = { left: { x: -0.8, y: 0.85, z: -0.25 }, right: { x: 0.8, y: 0.85, z: -0.25 } };
    const cur = { left: { ...rest.left }, right: { ...rest.right } };
    window.__hands = { rest, cur, target: { left: { ...rest.left }, right: { ...rest.right } } };
    window.__moveHands = () => {
      for (const side of ['left', 'right']) {
        const c = cur[side], t = window.__hands.target[side];
        c.x += (t.x - c.x) * 0.5; c.y += (t.y - c.y) * 0.5; c.z += (t.z - c.z) * 0.5;
        d.remote.dispatch('set_transform', { device: 'hand-' + side, position: { ...c }, anchor: 'grip' });
      }
    };
    window.__frame = () => new Promise((r) => window.__world.session.requestAnimationFrame(() => r()));
  });
  await page.evaluate(() => window.__moveHands());
  await page.waitForTimeout(800);

  let n = 0;
  const shot = async () => { await page.evaluate(() => { window.__moveHands(); return window.__frame(); }); await page.screenshot({ path: `${OUT}/f${String(n++).padStart(4, '0')}.png` }); };

  for (let i = 0; i < 6; i++) await shot(); // title card

  await page.evaluate(() => { const s = window.__game.sys; s.lockout = 0; s.tryStart(); });
  const STEPS = 5; // 5 x 1/60 s per frame = 12 fps
  let guard = 0, last = {};
  while (guard++ < 700) {
    last = await page.evaluate((STEPS) => {
      const s = window.__game.sys, h = window.__hands;
      const catchThis = s.ballNo !== 2; // ball 2 is deliberately dropped
      for (let i = 0; i < STEPS; i++) window.__real.call(s, 1 / 60);
      const flying = s.state === 'swinging' || s.state === 'flying';
      const t = h.target.right;
      if (catchThis && flying) { t.x = s.aim.x; t.y = s.aim.y; t.z = s.aim.z + 0.05; }
      else { Object.assign(t, h.rest.right); }
      return { state: s.state, ballNo: s.ballNo, score: s.score, misses: s.misses };
    }, STEPS);
    await shot();
    if (last.state === 'over') { for (let i = 0; i < 10; i++) await shot(); break; }
  }
  console.log('frames', n, JSON.stringify(last), errs.length ? errs : 'no errors');
  await browser.close();
})();
