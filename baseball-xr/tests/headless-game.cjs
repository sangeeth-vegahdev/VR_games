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
    // Closest distance from point q to the segment a-b.
    const segDist = (q, a, b) => {
      const ab = b.clone().sub(a);
      const t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
      return a.clone().addScaledVector(ab, t).distanceTo(q);
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
      seed = 12345; // every round gets the same pitch sequence, whatever else used random numbers
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
            // The ball's own spin between two frames: its axis should be the pitch's spin axis.
            const q = sys.ball.quaternion;
            if (cur.lastQ) {
              const dq = q.clone().multiply(cur.lastQ.clone().invert());
              const sn = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
              if (sn > 1e-4) {
                const ax = new V(dq.x / sn, dq.y / sn, dq.z / sn).multiplyScalar(Math.sign(dq.w) || 1);
                const want = new V(...sys.pitchType.spin.axis).normalize();
                cur.spinDot = Math.min(cur.spinDot === undefined ? 1 : cur.spinDot, ax.dot(want));
              }
            }
            cur.lastQ = q.clone();
            // Deviation from the straight line release -> aim.
            if (cur.lastP) cur.aimMiss = Math.min(cur.aimMiss === undefined ? Infinity : cur.aimMiss, segDist(sys.aim, cur.lastP, p));
            cur.lastP = p.clone();
            const r = cur.release, a = cur.aim;
            const k = (p.z - r[2]) / (a[2] - r[2]);
            const lineY = r[1] + (a[1] - r[1]) * k;
            const lineX = r[0] + (a[0] - r[0]) * k;
            cur.maxDrop = Math.max(cur.maxDrop, lineY - p.y);
            cur.maxSide = Math.max(cur.maxSide, Math.abs(p.x - lineX));
            // The hand waits where the pitch is going (as a catcher does), not on the ball itself.
            if (how === 'catch') placeGrip(sys.glove.side, sys.aim);
            if (how === 'bare') placeGrip(sys.glove.side === 'left' ? 'right' : 'left', sys.aim);
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
          aimMiss: b.aimMiss === undefined ? null : +b.aimMiss.toFixed(4),
          spinDot: b.spinDot === undefined ? null : +b.spinDot.toFixed(3),
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
    park(); // hands away from the green start ball, so the round stays over
    step(() => sys.state === 'over', () => park());
    for (let i = 0; i < 120 && sys.glove.side === before; i++) {
      sys.swapLockout = 0;
      placeGrip(before === 'left' ? 'right' : 'left', sys.swapOrb.position);
      sys.update(DT);
    }
    const after = sys.glove.side;
    park();
    for (let i = 0; i < 100; i++) sys.update(DT); // out of reach of the orb
    playRound('catch', 'ball'); // D: catching with the swapped hand

    // ---- contact: what counts as a catch in the mitt ----
    // Each scenario plays a round (the first `n` pitches) with the mitt placed every frame.
    const force = { normal: null }; // force the pocket's facing
    const upd = sys.glove.update.bind(sys.glove);
    sys.glove.update = (...a) => {
      upd(...a);
      if (force.normal) sys.glove.normal.copy(force.normal);
    };
    const scenario = (place, normal, n = 8) => {
      force.normal = normal || null;
      park();
      lookAt(new V(0, 1.4, -18));
      sys.lockout = 0;
      window.__game.start();
      const out = [];
      let cur = null;
      let frame = 0;
      step(() => sys.state === 'over' || out.length >= n, () => {
        frame++;
        const side = sys.glove.side;
        if (sys.state === 'flying') {
          cur = cur || { held: [], kick: [], closed: [] };
          place(side, frame);
        } else if (sys.state === 'feedback' && cur && !cur.done) {
          if (cur.result === undefined) {
            cur.result = sys.lastResult;
            cur.nearest = sys.nearest;
            cur.msg = sys.hud.model.message;
            cur.ballDir = sys.vel.clone().normalize();
            cur.spot = sys.spot;
            if (sys.held) {
              const m = sys.glove.object;
              m.updateMatrixWorld(true);
              cur.hitLocal = m.worldToLocal(sys.ball.position.clone()).toArray();
              cur.restLocal = sys.restLocal.toArray();
            }
          }
          if (sys.held && sys.settle > 0) {
            cur.held.push(sys.ball.position.distanceTo(sys.restAt));
            if (cur.last) cur.maxStep = Math.max(cur.maxStep || 0, sys.ball.position.distanceTo(cur.last));
            cur.last = sys.ball.position.clone();
            const kick = sys.glove.object.position.clone().sub(sys.glove.pocket);
            cur.kick.push(kick.length());
            cur.closed.push(sys.glove.closed);
          }
          if (cur.held.length >= 40 || !sys.held) {
            cur.done = true;
            out.push(cur);
            cur = null;
          }
        }
      });
      force.normal = null;
      // finish the round
      step(() => sys.state === 'over', () => park());
      park();
      return out;
    };
    // The mitt held still beside the point the pitch crosses (the aim point).
    const beside = (dx) => (side) => placeGrip(side, new V(sys.aim.x + dx, sys.aim.y, sys.aim.z));
    const contact = {
      near: scenario(beside(0.27)), // 27 cm to the side: past the mitt's edge
      edge: scenario(beside(0.13)), // 13 cm: into the edge of the pocket
      // The mitt flicks 40 cm across the pitch's line every frame (20 cm either side, out of reach).
      sweep: scenario((side, f) => placeGrip(side, new V(sys.aim.x + (f % 2 ? 0.2 : -0.2), sys.aim.y, sys.aim.z))),
      back: scenario(beside(0), new V(0, 0, 1)), // pocket turned to the catcher: the pitch hits the back
      pocket: scenario(beside(0)), // dead centre
      // Into the web: the upper thumb side of the mitt. The offset is worked out in the mitt's own
      // space, so it is right whichever hand it is on.
      web: scenario((side) => {
        const m = sys.glove.object;
        m.updateMatrixWorld(true);
        const o = m.localToWorld(new V(0, 0, 0));
        const w = m.localToWorld(new V(0.06, 0.075, 0)).sub(o);
        placeGrip(side, new V(sys.aim.x - w.x, sys.aim.y - w.y, sys.aim.z));
      }),
    };
    // The mitt itself: real size, and closing folds the thumb side in over the pocket.
    const mitt = sys.glove.mitt;
    const box = (k) => {
      mitt.setClose(k);
      const g = mitt.object.children[0].geometry;
      g.computeBoundingBox();
      return g.boundingBox.clone();
    };
    const open = box(0);
    const shut = box(1);
    const posAt = (k) => {
      mitt.setClose(k);
      const a = mitt.object.children[0].geometry.attributes.position;
      let best = -Infinity, z = 0; // the thumb-side extreme
      for (let i = 0; i < a.count; i++) if (a.getX(i) > best) { best = a.getX(i); z = a.getZ(i); }
      return { x: best, z };
    };
    const thumbOpen = posAt(0), thumbShut = posAt(1);
    mitt.setClose(0);
    const mittShape = {
      width: open.max.x - open.min.x, height: open.max.y - open.min.y, depth: open.max.z - open.min.z,
      shutWidth: shut.max.x - shut.min.x, thumbIn: thumbOpen.x - thumbShut.x, thumbForward: thumbShut.z - thumbOpen.z,
      verts: mitt.object.children[0].geometry.attributes.position.count,
    };

    return { rounds, restarted, before, after, contact, mittShape };
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
      move(sys.aim); // the mitt waits where the pitch is going
      sys.update(1 / 60);
    }
    return { mittShown, started, catches: sys.catches, misses: sys.misses, state: sys.state, focusMode: sys.focus.mode };
  });

  const [A, B, C, D] = run.rounds;
  const K = run.contact;
  const M = run.mittShape;
  console.log('mitt', JSON.stringify(Object.fromEntries(Object.entries(M).map(([k, v]) => [k, +v.toFixed(3)]))));
  for (const [k, v] of Object.entries(K)) console.log('contact', k, JSON.stringify(v.map((b) => [b.result, +(b.nearest * 100).toFixed(1), b.msg, +(b.held[0] || 0).toFixed(3), +(b.maxStep || 0).toFixed(3), +(Math.max(0, ...b.kick) * 100).toFixed(1), +((b.kick[b.kick.length - 1] || 0) * 1000).toFixed(1), +(b.closed[12] || 0).toFixed(2), b.spot])));
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
    'every pitch, breaking or not, crosses exactly where it was aimed (within 1 cm)': log.every((p) => p.aimMiss !== null && p.aimMiss < 0.01),
    'the ball is in the pitcher\'s fingers until release (under 1 cm)': log.every((p) => p.inHand < 0.01),
    'release point is out in front of the rubber at a pitcher\'s height': log.every((p) => p.releaseY > 1.5 && p.releaseY < 2.4 && p.releaseZ > -19.2 + 0.6 && p.releaseZ < -19.2 + 2.6),
    'eyes on the ball: high focus when watching': mean(A.pitches.map((p) => p.focus)) > 0.85,
    'eyes off the ball: low focus when looking away': mean(B.pitches.map((p) => p.focus)) < 0.1,
    'streak counts consecutive catches': A.bestStreak === PITCHES && B.bestStreak === 0,
    'best score is saved': A.saved === PITCHES,
    'gold orb swaps the mitt to the other hand': run.before !== run.after,
    'D: catching with the swapped hand works': D.catches === PITCHES,
    'contact: a pitch 27 cm from the pocket is missed, and the miss says by how much': K.near.length === 8 && K.near.every((b) => b.result === 'missed' && /Just missed: \d+ cm/.test(b.msg) && b.nearest > 0.05 && b.nearest < 0.2),
    'contact: a pitch into the edge of the mitt (13 cm off centre) is caught': K.edge.length === 8 && K.edge.every((b) => b.result === 'caught'),
    'contact: a mitt flicking across the pitch\'s line catches it (swept with the mitt)': K.sweep.length === 8 && K.sweep.every((b) => b.result === 'caught'),
    'contact: a pitch into the back of the mitt glances off': K.back.length === 8 && K.back.every((b) => b.result === 'back' && /back of the mitt/.test(b.msg)),
    'catch: the ball settles into the pocket from the point of contact (no snap)': K.edge.every((b) => b.held[0] > 0.03 && b.maxStep < 0.07 && b.held[b.held.length - 1] < 0.005),
    'catch: the mitt is knocked back by the ball, then springs back': K.edge.every((b) => Math.max(...b.kick) > 0.015 && b.kick[b.kick.length - 1] < 0.004),
    'catch: the mitt snaps shut round the ball': K.edge.every((b) => b.closed[12] > 0.8),
    'catch: a pitch dead centre is called right in the pocket, and rests there': K.pocket.length === 8 && K.pocket.every((b) => b.result === 'caught' && b.spot === 'pocket' && /pocket|POP/.test(b.msg) && Math.hypot(b.restLocal[0], b.restLocal[1]) < 0.03),
    'catch: a pitch into the upper thumb side is called in the web, and rests in the web': K.web.length === 8 && K.web.every((b) => b.result === 'caught' && b.spot === 'web' && b.restLocal[0] > 0.02 && b.restLocal[1] > 0.02),
    'catch: an edge catch rests on the side it hit, inside the pocket': K.edge.filter((b) => b.result === 'caught').every((b) => Math.sign(b.restLocal[0]) === Math.sign(b.hitLocal[0]) && Math.hypot(b.restLocal[0], b.restLocal[1]) <= 0.0701),
    'pitches: each pitch spins about its own axis (backspin, topspin, side spin)': log.every((p) => p.spinDot !== null && p.spinDot > 0.999),
    'mitt: real catcher\'s mitt size (28-32 cm wide, 30-36 cm tall, 11-16 cm deep)': M.width > 0.28 && M.width < 0.32 && M.height > 0.3 && M.height < 0.36 && M.depth > 0.11 && M.depth < 0.16,
    'mitt: closing folds the thumb side in and forward over the pocket': M.thumbIn > 0.03 && M.thumbForward > 0.04 && M.shutWidth < M.width - 0.03,
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
