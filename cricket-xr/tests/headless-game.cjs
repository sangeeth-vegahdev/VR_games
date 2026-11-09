// Headless test of the whole game, using IWER's emulated headset and hands.
// Needs `npm run dev:runtime` running.
// Usage: node tests/headless-game.cjs             (8-ball rounds, default)
//        BALLS=50 node tests/headless-game.cjs    (full-length rounds)
// Set CHROME_PATH to use a specific Chromium binary. Set GAME_URL to test a built copy (npm run build, then npx vite preview).
//
// The software renderer here runs at a few fps, so real-time playback would take many minutes.
// The rounds are therefore stepped at a fixed 60 Hz inside the page, and the palm is placed
// directly on the ball's grip space. Session start and the hand-tracking path are real.
const { chromium } = require('playwright');

const BALLS = Number(process.env.BALLS || 8);
// Where the game is served: the dev server by default, or a built copy, e.g. GAME_URL=http://localhost:8082
const GAME_URL = process.env.GAME_URL || 'https://localhost:8081';
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

  await page.goto(GAME_URL + '/?balls=' + BALLS + '&tutorial=0');
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

  // The palm is read from the drawn hand's joints: pose both hands with IWER and check it faces the
  // way the hand does, and sits on the hand (within a few cm of its grip pose).
  const palmFacing = [];
  for (const palm of [[0, 0, -1], [0, 1, 0], [1, 0, 0]]) {
    await page.evaluate(async (palm) => {
      const d = window.IWER_DEVICE;
      for (const side of ['left', 'right']) {
        await d.remote.dispatch('set_transform', { device: 'hand-' + side, position: { x: side === 'left' ? -0.25 : 0.25, y: 1.2, z: -0.4 }, orientation: { fingers: palm[1] ? [0, 0, -1] : [0, 1, 0], palm }, anchor: 'grip' });
      }
    }, palm);
    await page.waitForTimeout(1500);
    palmFacing.push(await page.evaluate((palm) => {
      const s = window.__game.sys;
      s.readPalms();
      return ['left', 'right'].map((side) => {
        const n = s.palmNormal[side];
        const grip = s.player.gripSpaces[side].getWorldPosition(n.clone());
        return { side, ok: s.palmNormalOk[side], dot: n.x * palm[0] + n.y * palm[1] + n.z * palm[2], gap: s.palm[side].distanceTo(grip) };
      });
    }, palm));
  }

  const run = await page.evaluate(({ balls }) => {
    const sys = window.__game.sys;
    sys.palmFromJoints = false; // this test places the hands by their grip pose, stepping without frames
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
    // Closest distance from point q to the segment a-b.
    const segDist = (q, a, b) => {
      const ab = b.clone().sub(a);
      const t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
      return a.clone().addScaledVector(ab, t).distanceTo(q);
    };
    const step = (done, onFrame) => {
      for (let i = 0; i < 60 * 60 * 20 && !done(); i++) {
        onFrame();
        sys.update(DT);
      }
    };

    const lookAt = (p) => {
      const head = sys.player.head;
      const from = head.getWorldPosition(new V());
      const m = new head.matrix.constructor().lookAt(from, p, new V(0, 1, 0));
      head.quaternion.setFromRotationMatrix(m);
    };

    const rounds = [];
    const playRound = (catchAll, look = 'ball') => {
      const flown = [];
      let cur = null;
      if (!catchAll) park();
      window.__game.start();
      step(
        () => sys.state === 'over',
        () => {
          const p = sys.ball.position;
          if (look === 'ball') lookAt(sys.state === 'flying' ? p : new V(0, 1.4, -18));
          else lookAt(new V(0, 30, 2));

          if (sys.state !== 'flying') {
            if (sys.state === 'feedback' && cur && !cur.done) {
              cur.done = true;
              cur.focus = sys.lastFocus;
            }
            if (sys.state !== 'feedback') cur = null;
            return;
          }
          if (!cur) {
            cur = { kmh: sys.kmh, maxDev: 0, x0: sys.ball.position.x, z0: sys.ball.position.z, ring: false, eyeRing: false, gap: sys.contactGap, curved: sys.side !== 0 };
            flown.push(cur);
          }
          // Deviation of the ball's x from the straight line to where it was aimed.
          const a = sys.aim;
          if (cur.lastP) cur.aimMiss = Math.min(cur.aimMiss === undefined ? Infinity : cur.aimMiss, segDist(a, cur.lastP, p));
          cur.lastP = p.clone();
          const k = (p.z - cur.z0) / (a.z - cur.z0);
          const lineX = cur.x0 + (a.x - cur.x0) * k;
          cur.maxDev = Math.max(cur.maxDev, Math.abs(p.x - lineX));
          cur.ring = cur.ring || window.__game.aimRingVisible;
          cur.eyeRing = cur.eyeRing || window.__game.eyeTrackerVisible;
          if (catchAll) placeGrip('right', p);
        },
      );
      rounds.push({
        score: sys.score,
        misses: sys.misses,
        ballNo: sys.ballNo,
        bestStreak: sys.bestStreak,
        saved: Number(localStorage.getItem('cricket-catch-best-' + balls)) || 0,
        balls: flown.map((b) => ({
          kmh: b.kmh,
          maxDev: +b.maxDev.toFixed(2),
          ring: b.ring,
          eyeRing: b.eyeRing,
          focus: b.focus === null ? null : +b.focus.toFixed(2),
          gap: +b.gap.toFixed(3),
          curved: b.curved,
          aimMiss: b.aimMiss === undefined ? null : +b.aimMiss.toFixed(4),
        })),
      });
    };

    // Round A: every ball is caught.
    playRound(true, 'ball');

    // Restart: touch the green ball once the lockout has passed.
    step(() => sys.state !== 'over', () => { park(); placeGrip('right', sys.marker.position); lookAt(new V(0, 30, 2)); });
    park();
    const restartedState = sys.state;

    // Round B: nothing is caught.
    playRound(false, 'away');

    // ---- contact: what counts as touching the hand ----
    // Each scenario plays a whole round with a hand placed relative to the ball every frame.
    const force = { normal: null }; // force a palm facing (the grip pose has none)
    const read = sys.readPalms.bind(sys);
    sys.readPalms = () => {
      read();
      if (force.normal) for (const side of ['left', 'right']) {
        // A hand held up, fingers to the sky, thumb inwards, palm facing force.normal.
        sys.palmNormal[side].copy(force.normal);
        sys.palmFingers[side].set(0, 1, 0);
        sys.palmThumb[side].set(side === 'right' ? -1 : 1, 0, 0);
        sys.palmNormalOk[side] = true;
      }
    };
    const scenario = (place, normal) => {
      force.normal = normal || null;
      park();
      sys.lockout = 0;
      window.__game.start();
      const out = [];
      let cur = null;
      let frame = 0;
      step(() => sys.state === 'over', () => {
        frame++;
        if (sys.state === 'flying') {
          cur = cur || { held: [] };
          place(sys.ball.position, frame);
        } else if (sys.state === 'feedback' && cur && !cur.done) {
          if (cur.result === undefined) {
            cur.result = sys.lastResult;
            cur.nearest = sys.nearest;
            cur.msg = sys.hud.model.message;
            cur.two = sys.twoHanded;
            cur.deflectedVisible = sys.ball.visible;
          }
          if (sys.heldBy && sys.settle > 0) { // (restAt is set by the first frame of settling)
            cur.held.push(sys.ball.position.distanceTo(sys.restAt));
            if (cur.last) cur.maxStep = Math.max(cur.maxStep || 0, sys.ball.position.distanceTo(cur.last));
            cur.last = sys.ball.position.clone();
            cur.restToPalm = sys.restAt.distanceTo(sys.twoHanded ? sys.palm.left.clone().add(sys.palm.right).multiplyScalar(0.5) : sys.palm[sys.heldBy]);
          }
          if (cur.held.length >= 20 || !sys.heldBy) {
            cur.done = true;
            out.push(cur);
            cur = null;
          }
        }
      });
      force.normal = null;
      park();
      return out;
    };
    const at = (dx, dy = 0) => (p) => placeGrip('right', new V(p.x + dx, p.y + dy, p.z));
    // A hand held still beside the point the ball passes through (the aim point).
    const beside = (dx) => () => placeGrip('right', new V(sys.aim.x + dx, sys.aim.y, sys.aim.z));
    const contact = {
      near: scenario(beside(0.23)), // 23 cm to the side: the ball never touches the hand
      touching: scenario(beside(0.1)), // 10 cm: ball (8 cm radius) touches the fingers
      // The hand flicks 40 cm across the ball's path every frame (20 cm either side, out of reach):
      // so only a test that follows the hand between frames can see it meet the ball.
      sweep: scenario((p, f) => placeGrip('right', new V(sys.aim.x + (f % 2 ? 0.2 : -0.2), sys.aim.y, sys.aim.z))),
      back: scenario(at(0), new V(0, 0, 1)), // palm facing the player: the ball meets the back of the hand
      front: scenario(at(0), new V(0, 0, -1)), // palm facing the coach
      two: scenario((p) => {
        placeGrip('left', new V(p.x - 0.07, p.y, p.z));
        placeGrip('right', new V(p.x + 0.07, p.y, p.z));
      }),
    };

    return { rounds, restartedState, balls, contact };
  }, { balls: BALLS });

  await page.close();

  // Desktop visitors (no headset): the mouse is the hand. Play a whole round with it.
  const desk = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 700 } });
  desk.on('pageerror', (e) => errors.push('desktop: ' + e.message));
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await desk.goto(GAME_URL + '/?balls=6&tutorial=0');
      break;
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
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
  const C = run.contact;
  console.log('palm facing', JSON.stringify(palmFacing.map((p) => p.map((h) => `${h.side} ${h.dot.toFixed(2)} ${(h.gap * 100).toFixed(1)}cm`))));
  for (const [k, v] of Object.entries(C)) console.log('contact', k, JSON.stringify(v.map((b) => [b.result, +(b.nearest * 100).toFixed(1), b.msg, b.two, +(b.held[0] || 0).toFixed(3), +(b.maxStep || 0).toFixed(3), +(b.held[b.held.length - 1] || 0).toFixed(3), +(b.restToPalm || 0).toFixed(3)])));
  console.log(JSON.stringify(run));
  console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');

  // Speed and swing are read from round B, where the ball is never caught on its first frame.
  const log = B.balls;
  const speeds = log.map((r) => r.kmh);
  // Speed jitter starts at ball RAMP_BALLS + 1, so only the ramp itself must rise.
  const ramped = speeds.slice(0, Math.min(BALLS, RAMP_BALLS));
  const rising = ramped.every((v, i) => i === 0 || v >= ramped[i - 1]) && ramped[ramped.length - 1] > ramped[0];
  // Some deliveries are straight on purpose (see beginThrow); the swinging ones must bend.
  const curved = log.filter((r) => r.curved);
  const bends = log.length === BALLS && curved.length > 0 && curved.every((r) => r.maxDev > 0.05) && log.filter((r) => !r.curved).every((r) => r.maxDev < 0.05);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const k = Math.min(5, Math.floor(BALLS / 2));
  const checks = {
    ['A caught ' + BALLS + '/' + BALLS]: A.score === BALLS && A.misses === 0,
    'restart by hand': run.restartedState !== 'over',
    ['B missed ' + BALLS + '/' + BALLS]: B.score === 0 && B.misses === BALLS,
    'speed ramps up over the first balls': log.length === BALLS && rising,
    'speed stays at or under the cap': speeds.every((v) => v <= MAX_KMH),
    'every ball, swinging or not, arrives exactly at the aim ring (within 1 cm)': log.every((r) => r.aimMiss !== null && r.aimMiss < 0.01),
    'swinging balls bend in the air, straight ones do not': bends,
    'swing grows from first to last swinging balls': curved.length < 2 || mean(curved.slice(-Math.ceil(curved.length / 2)).map((r) => r.maxDev)) > mean(curved.slice(0, Math.floor(curved.length / 2)).map((r) => r.maxDev)),
    'coach tosses the ball and the bat meets it (gap under 5 cm)': log.length === BALLS && log.every((r) => r.gap < 0.05),
    'aim ring shows during every ball': log.length === BALLS && log.every((r) => r.ring),
    'eyes on the ball: high focus when watching': mean(A.balls.map((p) => p.focus)) > 0.85,
    'eyes off the ball: low focus when looking away': mean(B.balls.map((p) => p.focus)) < 0.1,
    'eye ring tracker: visible during flight': A.balls.every((b) => b.eyeRing),
    'streak counts consecutive catches': A.bestStreak === BALLS && B.bestStreak === 0,
    'best score is saved': A.saved === BALLS,
    'tracked hands drawn with the game\'s own hand models': handsDrawn,
    'palm read from the drawn hand faces the way the hand does (both hands, 3 poses)': palmFacing.every((pose) => pose.every((h) => h.ok && h.dot > 0.95)),
    'palm sits on the hand (within 5 cm of its grip pose)': palmFacing.every((pose) => pose.every((h) => h.gap < 0.05)),
    'contact: a ball 23 cm from the hand is not caught, and the miss says by how much': C.near.length === BALLS && C.near.every((b) => b.result === 'missed' && /Just missed: \d+ cm/.test(b.msg) && b.nearest > 0.03 && b.nearest < 0.12),
    'contact: a ball touching the fingers (10 cm off the palm) is caught': C.touching.length === BALLS && C.touching.every((b) => b.result === 'caught'),
    'contact: a hand flicking across the ball\'s path catches it (swept with the hand)': C.sweep.length === BALLS && C.sweep.every((b) => b.result === 'caught'),
    'contact: a ball meeting the back of the hand glances off, and is seen flying away': C.back.length === BALLS && C.back.every((b) => b.result === 'back' && b.deflectedVisible && /back of the hand/.test(b.msg)),
    'contact: the same ball into a palm facing the coach is caught': C.front.length === BALLS && C.front.every((b) => b.result === 'caught'),
    'contact: two hands together make a two-handed catch, ball cradled between them': C.two.length === BALLS && C.two.every((b) => b.result === 'caught' && b.two && b.held[b.held.length - 1] < 0.01),
    'catch: the ball settles into the palm from the point of contact (no snap, then within 1 cm)': [...C.touching, ...C.sweep].every((b) => b.held[0] > 0.03 && b.maxStep < 0.04 && b.held[b.held.length - 1] < 0.01),
    'catch: the resting spot is in the hand (within 8 cm of the palm centre, in its cup)': [...C.touching, ...C.front, ...C.two].every((b) => b.restToPalm < 0.08),
    'desktop: mouse hand starts the round and catches every ball': mouse.handShown && mouse.started && mouse.score === 6 && mouse.misses === 0,
    'no page errors': errors.length === 0,
  };
  for (const [name, ok] of Object.entries(checks)) console.log(ok ? 'PASS' : 'FAIL', name);
  await browser.close();
  process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
})();
