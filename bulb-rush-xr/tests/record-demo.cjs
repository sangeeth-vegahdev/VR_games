// Records a ~60 s demo video of Bulb Rush (desktop path, scripted mouse player).
// Needs the dev server on port 8083 (npx vite --port 8083). Output: demo/bulb-rush-demo.webm
// Convert with: ffmpeg -i demo/bulb-rush-demo.webm -c:v libx264 ... (see demo/encode step in the run notes).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const GAME_URL = process.env.GAME_URL || 'https://localhost:8083';
const OUT = path.join(__dirname, '..', 'demo');
const RAW = path.join(OUT, 'raw');
const TOTAL_MS = Number(process.env.DEMO_MS || 60000);
fs.rmSync(RAW, { recursive: true, force: true });
fs.mkdirSync(RAW, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--ignore-certificate-errors', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--enable-webgl2', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: RAW, size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|favicon/.test(m.text()) && errors.push('console: ' + m.text()));

  await page.goto(GAME_URL + '/?hearts=5&tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
  // Hide the SDK's own "Enter XR" button so the recording shows only the game.
  await page.evaluate(() => {
    const hide = [...document.querySelectorAll('body *')].filter((e) => e.childElementCount === 0 && /Enter XR/.test(e.textContent));
    for (const e of hide) {
      let el = e;
      while (el.parentElement && el.parentElement !== document.body && getComputedStyle(el.parentElement).position !== 'fixed') el = el.parentElement;
      el.style.display = 'none';
    }
  });
  await page.waitForTimeout(3500); // title screen

  const startXY = () => page.evaluate(() => {
    const s = window.__game.sys;
    const v = s.board.buttons.start.node.getWorldPosition(s.v.clone());
    v.project(window.__world.camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  });
  await page.waitForTimeout(600);
  const b = await startXY();
  console.log("start button", JSON.stringify(b), "state", await page.evaluate(() => window.__game.state));
  for (let k = 0; k < 4 && (await page.evaluate(() => window.__game.state)) === 'title'; k++) {
    await page.mouse.move(b.x + k, b.y);
    await page.waitForTimeout(250);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
  await page.waitForFunction(() => window.__game.state === 'countdown', null, { timeout: 10000 }).catch(async (e) => { console.log('no countdown', await page.evaluate(() => window.__game.state)); throw e; });

  const t0 = Date.now();
  const reactMs = () => 300 + Math.round(Math.random() * 120);
  let clicks = 0;
  while (Date.now() - t0 < TOTAL_MS) {
    const st = await page.evaluate(() => {
      const s = window.__game.sys;
      const now = performance.now();
      const targets = s.active
        .filter((a) => a.kind !== 'decoy')
        .map((a) => {
          const bb = s.board.bulbs[a.i];
          const v = s.board.bulbWorldPos(a.i, s.v.clone());
          v.project(window.__world.camera);
          return { age: now - bb.t0, x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
        });
      return { state: s.state, targets };
    });
    if (st.state === 'over') break;
    if (st.state === 'play') {
      const ready = st.targets.filter((t) => t.age >= reactMs());
      for (const t of ready.slice(0, 3)) {
        await page.mouse.click(t.x, t.y);
        clicks++;
      }
    }
    await page.waitForTimeout(60);
  }
  // Hold the results screen for a few seconds.
  await page.waitForTimeout(5000);
  const final = await page.evaluate(() => ({ state: window.__game.state, score: window.__game.score, hearts: window.__game.hearts, best: window.__game.stats }));
  console.log('final', JSON.stringify(final), 'clicks', clicks, 'elapsed', Date.now() - t0);
  console.log('errors', errors.length ? errors.join('\n') : 'none');

  await ctx.close();
  await browser.close();
  const file = fs.readdirSync(RAW).find((f) => f.endsWith('.webm'));
  fs.renameSync(path.join(RAW, file), path.join(OUT, 'bulb-rush-demo.webm'));
  fs.rmSync(RAW, { recursive: true, force: true });
  console.log('saved', path.join(OUT, 'bulb-rush-demo.webm'));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
