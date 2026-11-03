// Headless test of the whole game, using IWER's emulated headset and hands.
// Needs `npm run dev:runtime` running.
// Usage: node tests/headless-game.cjs                (25-pitch rounds, default)
//        PITCHES=10 node tests/headless-game.cjs     (shorter rounds; fewer pitch types appear)
// Set CHROME_PATH to use a specific Chromium binary. Set GAME_URL to test another copy.
//
// The software renderer here runs at a few fps, so real-time playback would take many minutes.
// The rounds are therefore stepped at a fixed 60 Hz inside the page, with the mitt driven from the
// grip pose (placed directly), and the head pointed by setting its pose. Session start, the tracked
// hands, the hand-joint mitt and the gaze path are real.
const { chromium } = require('playwright');

const PITCHES = Number(process.env.PITCHES || 25);
const GAME_URL = process.env.GAME_URL || 'https://localhost:8082';
const MAX_MPH = Math.round((28 + 1.2) * 2.23694) + 1;

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await page.goto(`${GAME_URL}/?pitches=${PITCHES}`);
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
  await page.evaluate((n) => localStorage.removeItem('glove-up-best-' + n), PITCHES);
  await page.evaluate(() => {
    window.IWER_DEVICE.primaryInputMode = 'hand';
    window.__world.launchXR();
  });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 20000 });
  await page.waitForTimeout(1500); // a few real frames so the hands and grip spaces are live

  // Tracked hands are the game's own models; the hand in the mitt is hidden, and the mitt sits on
  // the tracked hand (from its joints).
  const hands = await page
    .waitForFunction(() => {
      const h = window.__world.input.xr.visualAdapters.hand;
      return ['left', 'right'].every((k) => h[k].visual && h[k].visual.constructor.name === 'SkinHand' && h[k].visual.model.visible);
    }, null, { timeout: 20000 })
    .then(
      () =>
        page.evaluate(() => {
          const g = window.__game;
          const p = window.__world.player;
          const grip = p.gripSpaces[g.gloveSide].getWorldPosition(g.pocket.clone());
          const h = window.__world.input.xr.visualAdapters.hand;
          return {
            drawn: true,
            gloveHandHidden: h[g.gloveSide].visual.model.getObjectByProperty('type', 'SkinnedMesh').visible === false,
            otherHandShown: h[g.gloveSide === 'left' ? 'right' : 'left'].visual.model.getObjectByProperty('type', 'SkinnedMesh').visible === true,
            mittShown: g.sys.glove.object.visible,
            mittToGrip: g.pocket.distanceTo(grip),
            focusMode: g.focusMode,
          };
        }),
      () => ({ drawn: false }),
    );

  const run = await page.evaluate(({ pitches }) => {
    const sys = window.__game.sys;
    const V = sys.ball.position.constructor;
    const DT = 1 / 60;
    sys.glove.useJoints = false; // drive the mitt from the grip pose, which this test places

    // A fixed random sequence, so every pitch type shows up in a 25-pitch round.
    let seed = 12345;
    Math.random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    const placeGrip = (side, world) => {
      const g = sys.player.gripSpaces[side];
      g.position.copy(g.parent.worldToLocal(new V().copy(world)));
      g.updateMatrixWorld(true);
    };
    const park = () => {
      placeGrip('left', new V(-0.9, 0.6, 0.1));
      placeGrip('right', new V(0.9, 0.6, 0.1));
    };
    // Point the head at a world point (or straight up at the sky).
    const head = sys.player.head;
    const lookAt = (p) => {
      head.updateMatrixWorld(true);
      const from = head.getWorldPosition(new V());
      const m = new head.matrix.constructor().lookAt(from, p, new V(0, 1, 0));
      head.quaternion.setFromRotationMatrix(m);
      head.updateMatrixWorld(true);
    };
    const step = (done, onFrame) => {
      for (let i = 0; i < 60 * 60 * 30 && !done(); i++) {
        onFrame();
        sys.update(DT);
      }
    };

    const rounds = [];
    // how: 'catch' (mitt to the ball), 'miss' (hands away), 'bare' (the bare hand to the ball)
    // look: 'ball' (head follows the ball) or 'away' (head turned to the sky)
    const playRound = (how, look) => {
      const flown = [];
      let cur = null;
      park();
      sys.lockout = 0; // skip the short pause after a round ends
      window.__game.start();
      step(
        () => sys.state === 'over',
        () => {
          const p = sys.ball.position;
          if (look === 'ball') lookAt(sys.state === 'flying' ? p : new V(0, 1.4, -18));
          else lookAt(new V(0, 30, 2));
          if (sys.state === 'windup') {
            const hand = sys.pitcher.handPosition(new V());
            if (cur === null || cur.done) {
              cur = { inHand: 0, frames: 0, ready: sys.pitcher.isPitching };
              flown.push(cur);
            }
            cur.frames++;
            cur.inHand = Math.max(cur.inHand, hand.distanceTo(p));
          }
          if (sys.state === 'flying') {
            if (!cur.release) {
              cur.release = p.toArray();
              cur.aim = sys.aim.toArray();
              cur.name = sys.pitchType.name;
              cur.mph = sys.mph;
              cur.maxDrop = 0;
              cur.maxSide = 0;
            }
            // Deviation from the straight line release -> aim.
            const r = cur.release, a = cur.aim;
            const k = (p.z - r[2]) / (a[2] - r[2]);
            const lineY = r[1] + (a[1] - r[1]) * k;
            const lineX = r[0] + (a[0] - r[0]) * k;
            cur.maxDrop = Math.max(cur.maxDrop, lineY - p.y);
            cur.maxSide = Math.max(cur.maxSide, Math.abs(p.x - lineX));
            if (how === 'catch') placeGrip(sys.glove.side, p);
            if (how === 'bare') placeGrip(sys.glove.side === 'left' ? 'right' : 'left', p);
          }
          if (sys.state === 'feedback' && cur && !cur.done) {
            cur.done = true;
            cur.result = sys.lastResult;
            cur.focus = sys.lastFocus;
          }
        },
      );
      rounds.push({
        how,
        look,
        catches: sys.catches,
        misses: sys.misses,
        pitchNo: sys.pitchNo,
        bestStreak: sys.bestStreak,
        saved: Number(localStorage.getItem('glove-up-best-' + pitches)) || 0,
        pitches: flown.map((b) => ({
          name: b.name, mph: b.mph, result: b.result, focus: b.focus === null ? null : +b.focus.toFixed(2),
          inHand: +b.inHand.toFixed(3), releaseY: b.release ? +b.release[1].toFixed(2) : null, releaseZ: b.release ? +b.release[2].toFixed(2) : null,
          drop: b.maxDrop !== undefined ? +b.maxDrop.toFixed(2) : null, side: b.maxSide !== undefined ? +b.maxSide.toFixed(2) : null,
        })),
      });
    };

    const restart = () => {
      step(() => sys.state !== 'over', () => placeGrip(sys.glove.side, sys.marker.position));
      park();
      return sys.state;
    };

    playRound('catch', 'ball'); // A: every pitch in the mitt, eyes on the ball
    const restarted = restart();
    // finish that round quickly, then play B
    step(() => sys.state === 'over', () => { park(); lookAt(new V(0, 30, 2)); });
    playRound('miss', 'away'); // B: nothing caught, eyes on the sky
    step(() => sys.state !== 'over', () => {});
    playRound('bare', 'ball'); // C: the bare hand goes to the ball

    // Swap the mitt to the other hand by touching the gold orb, then catch with it.
    const before = sys.glove.side;
    step(() => sys.state !== 'over', () => {});
    for (let i = 0; i < 120 && sys.glove.side === before; i++) {
      sys.swapLockout = 0;
      placeGrip(before === 'left' ? 'right' : 'left', sys.swapOrb.position);
      sys.update(DT);
    }
    const after = sys.glove.side;
    park();
    for (let i = 0; i < 100; i++) sys.update(DT); // out of reach of the orb
    playRound('catch', 'ball'); // D: catching with the swapped hand

    return { rounds, restarted, before, after };
  }, { pitches: PITCHES });

  // Desktop visitors (no headset): the mouse moves the mitt. Play a whole round with it.
  const desk = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 700 } });
  desk.on('pageerror', (e) => errors.push('desktop: ' + e.message));
  await desk.goto(`${GAME_URL}/?pitches=6`);
  await desk.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
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
    move(sys.marker.position);
    sys.update(1 / 60);
    const mittShown = sys.glove.object.visible;
    for (let i = 0; i < 600 && sys.state === 'idle'; i++) {
      sys.lockout = 0;
      move(sys.marker.position);
      sys.update(1 / 60);
    }
    const started = sys.state !== 'idle';
    for (let i = 0; i < 60 * 60 * 8 && sys.state !== 'over'; i++) {
      if (sys.state === 'flying') move(sys.ball.position);
      else move(sys.aim);
      sys.update(1 / 60);
    }
    return { mittShown, started, catches: sys.catches, misses: sys.misses, state: sys.state, focusMode: sys.focus.mode };
  });

  const [A, B, C, D] = run.rounds;
  console.log('hands', JSON.stringify(hands));
  console.log('desktop', JSON.stringify(mouse));
  for (const r of run.rounds) {
    const types = {};
    for (const p of r.pitches) types[p.name] = (types[p.name] || 0) + 1;
    console.log(`round ${r.how}/${r.look}: caught ${r.catches}, missed ${r.misses}, types ${JSON.stringify(types)}, mph ${r.pitches.map((p) => p.mph).join(' ')}`);
  }
  const avg = (name, key) => {
    const a = run.rounds[1].pitches.filter((p) => p.name === name).map((p) => p[key]);
    return a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null;
  };
  console.log('break vs straight line (m), drop / side:', ['Fastball', 'Changeup', 'Curveball', 'Slider'].map((n) => `${n} ${avg(n, 'drop')} / ${avg(n, 'side')}`).join(', '));
  console.log('swap', run.before, '->', run.after, 'restarted state', run.restarted);
  console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');

  const log = B.pitches;
  const names = new Set(log.map((p) => p.name));
  const byName = (n) => log.filter((p) => p.name === n);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const fastballs = byName('Fastball');
  const fastMph = fastballs.map((p) => p.mph);
  const firstFast = fastMph.slice(0, 3), lastFast = fastMph.slice(-3);
  const checks = {
    [`A: every pitch caught in the mitt (${PITCHES}/${PITCHES})`]: A.catches === PITCHES && A.misses === 0,
    'restart by touching the green ball': run.restarted !== 'over',
    [`B: hands away, every pitch missed (${PITCHES}/${PITCHES})`]: B.catches === 0 && B.misses === PITCHES,
    'C: the bare hand never catches ("use the mitt")': C.catches === 0 && C.pitches.every((p) => p.result === 'bare'),
    'all four pitch types are thrown': PITCHES < 14 || ['Fastball', 'Changeup', 'Curveball', 'Slider'].every((n) => names.has(n)),
    'curveball drops more than the fastball': PITCHES < 9 || mean(byName('Curveball').map((p) => p.drop)) > mean(fastballs.map((p) => p.drop)) + 0.1,
    'slider breaks sideways more than the fastball': PITCHES < 14 || mean(byName('Slider').map((p) => p.side)) > mean(fastballs.map((p) => p.side)) + 0.1,
    'fastball speed ramps up over the round': lastFast.length > 0 && mean(lastFast) > mean(firstFast) + 5,
    'speed stays at or under the cap': log.every((p) => p.mph <= MAX_MPH),
    'the ball is in the pitcher\'s fingers until release (under 1 cm)': log.every((p) => p.inHand < 0.01),
    'release point is out in front of the rubber at a pitcher\'s height': log.every((p) => p.releaseY > 1.5 && p.releaseY < 2.4 && p.releaseZ > -19.2 + 0.6 && p.releaseZ < -19.2 + 2.6),
    'eyes on the ball: high focus when watching': mean(A.pitches.map((p) => p.focus)) > 0.85,
    'eyes off the ball: low focus when looking away': mean(B.pitches.map((p) => p.focus)) < 0.1,
    'streak counts consecutive catches': A.bestStreak === PITCHES && B.bestStreak === 0,
    'best score is saved': A.saved === PITCHES,
    'gold orb swaps the mitt to the other hand': run.before !== run.after,
    'D: catching with the swapped hand works': D.catches === PITCHES,
    'tracked hands drawn with the game\'s own models': !!hands.drawn,
    'mitt replaces the hand it is on; the other hand shows': hands.gloveHandHidden && hands.otherHandShown && hands.mittShown,
    'mitt sits on the tracked hand (within 12 cm of its grip)': hands.mittToGrip < 0.12,
    'desktop: the mouse mitt starts the round and catches every pitch': mouse.mittShown && mouse.started && mouse.catches === 6 && mouse.misses === 0,
    'no page errors': errors.length === 0,
  };
  for (const [name, ok] of Object.entries(checks)) console.log(ok ? 'PASS' : 'FAIL', name);
  await browser.close();
  process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
})();
