// Records a catcher's-eye gameplay clip as JPEG frames (then encode them with ffmpeg; see README).
// Needs `npm run dev:runtime` running. Uses IWER's emulated headset and hands: the head is seated
// at catcher height and follows the ball, the mitt hand reaches for each pitch, the bare hand rests.
// The 4th pitch is let through on purpose, to show a miss.
// Usage: node tests/record-gameplay.cjs <out dir> [pitches to record, default 5]
// Set CHROME_PATH to use a specific Chromium binary.
const fs = require('node:fs');
const { chromium } = require('playwright');

const OUT = process.argv[2] || 'gameplay-frames';
const COUNT = Number(process.argv[3] || 5);
const SKIP_TO = 12; // start a few pitches into a 25-pitch round, so the breaking balls are unlocked
const SIM = 4; // game steps (at 60 Hz) per captured frame: a 15 fps clip
const DT = 1 / 60;
const GAME_URL = process.env.GAME_URL || 'https://localhost:8082';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: Number(process.env.VW || 1280), height: Number(process.env.VH || 720) } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(GAME_URL + '/?tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
  await page.evaluate(() => {
    window.IWER_DEVICE.primaryInputMode = 'hand';
    window.__world.launchXR();
  });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 20000 });
  await page.evaluate(async () => {
    const d = window.IWER_DEVICE;
    // Hide the emulator's own panels, keep the rendered view.
    const fixed = [...document.body.children].find((e) => getComputedStyle(e).position === 'fixed' && e.querySelector('canvas'));
    if (fixed) for (const kid of fixed.children) { if (kid.tagName === 'CANVAS' && getComputedStyle(kid).zIndex !== '3') continue; kid.style.display = 'none'; }
    for (const side of ['left', 'right']) {
      d.hands[side].connected = true;
      await d.remote.dispatch('set_hand_pose', { device: 'hand-' + side, poseId: 'open' });
    }
    await d.remote.dispatch('set_transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0.05 } });
    await d.remote.dispatch('look_at', { device: 'headset', target: { x: 0, y: 1.3, z: -18 } });
    // Take over the game loop so each frame is stepped deterministically.
    const s = window.__game.sys;
    window.__upd = s.update.bind(s);
    s.update = () => {};
    let seed = 4242;
    Math.random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  });
  await page.waitForTimeout(1500);

  // Grab the rendered XR view straight from the canvas inside a frame (much faster than a page screenshot).
  const grab = async (i) => {
    const url = await page.evaluate(() => new Promise((res) => {
      window.__world.session.requestAnimationFrame(() => res(window.__world.renderer.domElement.toDataURL('image/jpeg', 0.92)));
    }));
    fs.writeFileSync(`${OUT}/f${String(i).padStart(4, '0')}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  };

  let n = 0;
  let done = false;
  // A short look at the title card first, hands in place.
  await page.evaluate(async () => {
    const d = window.IWER_DEVICE;
    await d.remote.dispatch('set_transform', { device: 'hand-left', position: { x: -0.36, y: 0.72, z: -0.34 }, orientation: { fingers: [0, 1, -0.3], palm: [0, 0, -1] }, anchor: 'grip' });
    await d.remote.dispatch('set_transform', { device: 'hand-right', position: { x: 0.3, y: 0.72, z: -0.28 }, orientation: { fingers: [0, -0.2, -1], palm: [-1, 0, 0] }, anchor: 'grip' });
  });
  for (let i = 0; i < 12; i++) {
    await page.evaluate(({ DT }) => window.__upd(DT), { DT });
    await grab(n++);
  }
  while (!done && n < 2000) {
    const st = await page.evaluate(({ SIM, DT, SKIP_TO, COUNT }) => {
      const s = window.__game.sys;
      const V = s.aim.constructor;
      if (s.state === 'idle') {
        window.__game.start();
        s.pitchNo = SKIP_TO;
        s.hud.set({ pitchNo: SKIP_TO });
      }
      // The mitt rests low and to the side (so the pitcher stays in view), and goes to the ball late,
      // the way a catcher receives a pitch.
      const rest = new V(-0.36, 0.72, -0.34);
      if (!window.__H) window.__H = { glove: rest.clone(), bare: new V(0.3, 0.72, -0.28), look: new V(0, 1.3, -18) };
      const H = window.__H;
      const n = s.pitchNo - SKIP_TO;
      const letGo = n === 4; // let the 4th one through
      for (let i = 0; i < SIM; i++) {
        const late = s.state === 'flying' && s.ball.position.z > -7;
        const target = late && !letGo ? s.aim : s.state === 'feedback' && s.held ? H.glove : rest;
        H.glove.lerp(target, late ? 0.16 : 0.05);
        const lookTarget = s.state === 'flying' || s.state === 'feedback' ? s.ball.position : s.state === 'windup' ? s.pitcher.ballPos : new V(0, 1.4, -18);
        H.look.lerp(lookTarget, s.state === 'flying' ? 0.5 : 0.15);
        window.__upd(DT);
        if (s.state === 'over') break;
      }
      const out = (v) => [v.x, v.y, v.z].map((x) => +x.toFixed(3));
      return { state: s.state, pitchNo: s.pitchNo, done: s.pitchNo - SKIP_TO >= COUNT && s.state === 'ready', side: s.glove.side, G: out(H.glove), B: out(H.bare), L: out(H.look), name: s.pitchType.name, res: s.lastResult };
    }, { SIM, DT, SKIP_TO, COUNT });
    await page.evaluate(async (st) => {
      const d = window.IWER_DEVICE;
      const other = st.side === 'left' ? 'right' : 'left';
      // Mitt hand held up, palm to the pitcher; the bare hand resting, palm in.
      await Promise.all([
        d.remote.dispatch('set_transform', { device: 'hand-' + st.side, position: { x: st.G[0], y: st.G[1], z: st.G[2] }, orientation: { fingers: [0, 1, -0.3], palm: [0, 0, -1] }, anchor: 'grip' }),
        d.remote.dispatch('set_transform', { device: 'hand-' + other, position: { x: st.B[0], y: st.B[1], z: st.B[2] }, orientation: { fingers: [0, -0.2, -1], palm: [st.side === 'left' ? -1 : 1, 0, 0] }, anchor: 'grip' }),
        d.remote.dispatch('look_at', { device: 'headset', target: { x: st.L[0], y: st.L[1], z: st.L[2] } }),
      ]);
    }, st);
    await grab(n);
    n++;
    if (st.done || st.state === 'over') done = true;
  }
  const final = await page.evaluate(() => ({ catches: window.__game.sys.catches, misses: window.__game.sys.misses, state: window.__game.sys.state }));
  console.log('frames', n, JSON.stringify(final), errs.length ? errs.slice(0, 3) : 'no errors');
  await browser.close();
})();
