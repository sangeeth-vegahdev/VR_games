// Headless test of the whole game, using IWER's emulated headset and hands.
// Needs `npm run dev:runtime` running.
// Usage: node tests/headless-game.cjs             (8-ball rounds, default)
//        BALLS=50 node tests/headless-game.cjs    (full-length rounds)
// Set CHROME_PATH to use a specific Chromium binary.
//
// The software renderer here runs at a few fps, so real-time playback would take many minutes.
// The rounds are therefore stepped at a fixed 60 Hz inside the page, and the palm is placed
// directly on the ball's grip space. Session start and the hand-tracking path are real.
const { chromium } = require('playwright');

const BALLS = Number(process.env.BALLS || 8);
const RAMP_BALLS = 25; // keep in sync with CFG.rampBalls
const MAX_KMH = Math.round((22 + 1.5) * 3.6); // top speed incl. jitter

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await page.goto('https://localhost:8081/?balls=' + BALLS);
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });
  await page.evaluate((n) => localStorage.removeItem('cricket-catch-best-' + n), BALLS);
  await page.evaluate(() => {
    window.IWER_DEVICE.primaryInputMode = 'hand';
    window.__world.launchXR();
  });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(1000); // a few real frames so the grip spaces are live

  // Tracked hands are drawn with the game's own hand models (loaded from public/models, not a CDN).
  const handsDrawn = await page
    .waitForFunction(() => {
      const h = window.__world.input.xr.visualAdapters.hand;
      return ['left', 'right'].every((k) => h[k].visual && h[k].visual.constructor.name === 'SkinHand' && h[k].visual.model.visible);
    }, null, { timeout: 15000 })
    .then(() => true, () => false);

  const run = await page.evaluate(({ balls }) => {
    const sys = window.__game.sys;
    const V = sys.ball.position.constructor;
    const DT = 1 / 60;

    // Put a grip space at a world point (grip spaces are children of the player rig).
    const placeGrip = (side, world) => {
      const g = sys.player.gripSpaces[side];
      g.position.copy(g.parent.worldToLocal(new V().copy(world)));
    };

    // Both hands out of the way of the ball's path.
    const park = () => {
      placeGrip('left', new V(-0.8, 0.7, -0.2));
      placeGrip('right', new V(0.8, 0.7, -0.2));
    };

    // Step the game at a fixed rate until `done()` is true.
    const step = (done, onFrame) => {
      for (let i = 0; i < 60 * 60 * 20 && !done(); i++) {
        onFrame();
        sys.update(DT);
      }
    };

    const rounds = [];
    const playRound = (catchAll) => {
      const flown = [];
      let cur = null;
      if (!catchAll) park();
      window.__game.start();
      step(
        () => sys.state === 'over',
        () => {
          if (sys.state !== 'flying') {
            cur = null;
            return;
          }
          if (!cur) {
            cur = { kmh: sys.kmh, maxDev: 0, x0: sys.ball.position.x, z0: sys.ball.position.z, ring: false };
            flown.push(cur);
          }
          // Deviation of the ball's x from the straight line to where it was aimed.
          const p = sys.ball.position, a = sys.aim;
          const k = (p.z - cur.z0) / (a.z - cur.z0);
          const lineX = cur.x0 + (a.x - cur.x0) * k;
          cur.maxDev = Math.max(cur.maxDev, Math.abs(p.x - lineX));
          cur.ring = cur.ring || window.__game.aimRingVisible;
          if (catchAll) placeGrip('right', p);
        },
      );
      rounds.push({
        score: sys.score,
        misses: sys.misses,
        ballNo: sys.ballNo,
        bestStreak: sys.bestStreak,
        saved: Number(localStorage.getItem('cricket-catch-best-' + balls)) || 0,
        balls: flown.map((b) => ({ kmh: b.kmh, maxDev: +b.maxDev.toFixed(2), ring: b.ring })),
      });
    };

    // Round A: every ball is caught.
    playRound(true);

    // Restart: touch the green ball once the lockout has passed.
    step(() => sys.state !== 'over', () => placeGrip('right', sys.marker.position));
    park();
    const restartedState = sys.state;

    // Round B: nothing is caught.
    playRound(false);

    return { rounds, restartedState, balls };
  }, { balls: BALLS });

  // Desktop visitors (no headset): the mouse is the hand. Play a whole round with it.
  const desk = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 700 } });
  desk.on('pageerror', (e) => errors.push('desktop: ' + e.message));
  await desk.goto('https://localhost:8081/?balls=6');
  await desk.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });
  await desk.waitForTimeout(1000);
  const mouse = await desk.evaluate(() => {
    const sys = window.__game.sys;
    const el = sys.world.renderer.domElement;
    const cam = sys.world.camera;
    const V = sys.aim.constructor;
    const move = (point) => {
      cam.updateMatrixWorld(true);
      const p = new V().copy(point).project(cam);
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + ((p.x + 1) / 2) * r.width, clientY: r.top + ((1 - p.y) / 2) * r.height }));
    };
    move(sys.marker.position); // mouse over the green ball
    sys.update(1 / 60);
    const handShown = sys.desktop.active;
    // Touch the green ball to start, as a player would.
    for (let i = 0; i < 600 && sys.state === 'idle'; i++) {
      sys.lockout = 0;
      move(sys.marker.position);
      sys.update(1 / 60);
    }
    const started = sys.state !== 'idle';
    for (let i = 0; i < 60 * 60 * 5 && sys.state !== 'over'; i++) {
      if (sys.state === 'swinging' || sys.state === 'flying') move(sys.aim);
      sys.update(1 / 60);
    }
    return { handShown, started, score: sys.score, misses: sys.misses, state: sys.state };
  });
  console.log('desktop', JSON.stringify(mouse));

  const [A, B] = run.rounds;
  console.log(JSON.stringify(run));
  console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');

  // Speed and swing are read from round B, where the ball is never caught on its first frame.
  const log = B.balls;
  const speeds = log.map((r) => r.kmh);
  // Speed jitter starts at ball RAMP_BALLS + 1, so only the ramp itself must rise.
  const ramped = speeds.slice(0, Math.min(BALLS, RAMP_BALLS));
  const rising = ramped.every((v, i) => i === 0 || v >= ramped[i - 1]) && ramped[ramped.length - 1] > ramped[0];
  const bends = log.length === BALLS && log.every((r) => r.maxDev > 0.05);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const k = Math.min(5, Math.floor(BALLS / 2));
  const checks = {
    ['A caught ' + BALLS + '/' + BALLS]: A.score === BALLS && A.misses === 0,
    'restart by hand': run.restartedState !== 'over',
    ['B missed ' + BALLS + '/' + BALLS]: B.score === 0 && B.misses === BALLS,
    'speed ramps up over the first balls': log.length === BALLS && rising,
    'speed stays at or under the cap': speeds.every((v) => v <= MAX_KMH),
    'ball swings in the air': bends,
    'swing grows from first to last balls': mean(log.slice(-k).map((r) => r.maxDev)) > mean(log.slice(0, k).map((r) => r.maxDev)),
    'aim ring shows during every ball': log.length === BALLS && log.every((r) => r.ring),
    'streak counts consecutive catches': A.bestStreak === BALLS && B.bestStreak === 0,
    'best score is saved': A.saved === BALLS,
    'tracked hands drawn with the game\'s own hand models': handsDrawn,
    'desktop: mouse hand starts the round and catches every ball': mouse.handShown && mouse.started && mouse.score === 6 && mouse.misses === 0,
    'no page errors': errors.length === 0,
  };
  for (const [name, ok] of Object.entries(checks)) console.log(ok ? 'PASS' : 'FAIL', name);
  await browser.close();
  process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
})();
