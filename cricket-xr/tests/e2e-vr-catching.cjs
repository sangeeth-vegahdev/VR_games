// End-to-end: the REAL game in a browser, in IWER's emulated Quest 3 with hand tracking.
//
// What is real: the page, the WebXR session, the hand-tracking input path, the game's own per-frame
// code (readPalms -> evaluateCatch -> caught/missed -> feedback), the focus tracker, the HUD.
// What is posed by this script: the hand JOINT POSITIONS the game reads (the emulator's hand preset
// cannot make cupped hands or fingers-down), and the gaze `eyeSpace` (the emulator has no eye tracking).
// Time is stepped at a fixed rate inside the page so the slow software renderer does not matter.
//
// Needs the dev server:  npx vite --port 8081     Usage: node tests/e2e-vr-catching.cjs
const { chromium } = require('playwright');

const GAME_URL = process.env.GAME_URL || 'https://localhost:8081';
const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
  });

  await page.goto(GAME_URL + '/?balls=50&tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 40000 });
  await page.evaluate(() => {
    localStorage.clear();
    window.IWER_DEVICE.primaryInputMode = 'hand';
    window.__world.launchXR();
  });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 20000 });
  await page.waitForTimeout(1500);

  const ready = await page.evaluate(() => {
    const h = window.__game.trackedHands;
    return { left: !!(h.left && h.left.joints && h.left.joints.wrist), right: !!(h.right && h.right.joints && h.right.joints.wrist), inputs: window.__world.session.inputSources.length };
  });
  record('XR session with tracked hand skeletons', ready.left && ready.right, JSON.stringify(ready));

  // ---- everything below runs inside the page, stepping the game synchronously ----
  const run = await page.evaluate(async () => {
    const sys = window.__game.sys;
    const hands = window.__game.trackedHands;
    const THREE = sys.ball.position.constructor;
    const V = (x, y, z) => new THREE(x, y, z);
    const DT = 1 / 72;
    const cat = await import('/src/catching.js');

    // Joint positions the game will read, per side. getWorldPosition on the real joint objects is
    // replaced by a lookup, so the game's own joint-reading code runs unmodified.
    const pose = { left: null, right: null };
    const shapeHand = cat.createHand('right');
    const patched = new Set();
    function layout(side, palm, normal, fingers, openness) {
      const h = cat.createHand(side);
      cat.setHandFromPose(h, palm, normal, fingers, openness);
      const f = h.fingers;
      const across = h.across;
      const W = h.wrist;
      const map = {
        wrist: W.clone(),
        'middle-finger-phalanx-proximal': h.knuckles.middle.clone(),
        'index-finger-metacarpal': W.clone().addScaledVector(f, 0.04).addScaledVector(across, 0.03),
        'pinky-finger-metacarpal': W.clone().addScaledVector(f, 0.04).addScaledVector(across, -0.03),
        'index-finger-phalanx-proximal': h.knuckles.index.clone(),
        'pinky-finger-phalanx-proximal': h.knuckles.pinky.clone(),
        'thumb-phalanx-proximal': h.knuckles.thumb.clone(),
        'middle-finger-tip': h.tips.middle.clone(),
        'index-finger-tip': h.tips.index.clone(),
        'pinky-finger-tip': h.tips.pinky.clone(),
        'thumb-tip': h.tips.thumb.clone(),
      };
      return map;
    }
    function patchJoints() {
      for (const side of ['left', 'right']) {
        const j = hands[side].joints;
        for (const name of Object.keys(j)) {
          const o = j[name];
          if (!o || patched.has(o)) continue;
          patched.add(o);
          o.getWorldPosition = (v) => {
            const p = pose[side];
            if (p && p[name]) return v.copy(p[name]);
            return o.constructor.prototype.getWorldPosition.call(o, v);
          };
        }
      }
    }
    patchJoints();
    function setHand(side, spec) {
      pose[side] = spec ? layout(side, spec.palm, spec.normal || V(0, 0, -1), spec.fingers || V(0, 1, 0), spec.open ?? 0.75) : null;
      const g = sys.player.gripSpaces[side];
      // Keep the grip space itself near the palm: it must stay visible and tracked.
      if (spec) g.position.copy(g.parent.worldToLocal(spec.palm.clone()));
    }
    const park = () => {
      setHand('left', { palm: V(-0.9, 0.7, -0.1) });
      setHand('right', { palm: V(0.9, 0.7, -0.1) });
    };

    // Fake eye tracking: sys.player.gazeOrigin = 'tracked' with an eyeSpace object we aim.
    const eye = new THREE();
    const eyeSpace = new sys.player.head.constructor();
    eyeSpace.name = 'fake-eyes';
    const Q = eyeSpace.quaternion.constructor;
    const lookQ = (from, to) => new Q().setFromUnitVectors(V(0, 0, -1), to.clone().sub(from).normalize());
    const headQ = (to) => {
      const head = sys.player.head;
      const from = head.getWorldPosition(new THREE());
      const m = new head.matrix.constructor().lookAt(from, to, V(0, 1, 0));
      head.quaternion.setFromRotationMatrix(m);
    };

    // One delivery: returns the outcome. `place(aim)` positions the hands once the ball is in flight.
    function delivery({ ballNo = 1, place, each, gaze, type = 'normal', wideSide = 1 }) {
      park();
      if (sys.state === 'idle' || sys.state === 'over') window.__game.start();
      let guard = 0;
      while (sys.state !== 'ready' && guard++ < 72 * 30) sys.update(DT); // let any ball in progress finish
      sys.ballNo = ballNo - 1;
      sys.forceType = type;
      sys.forceWideSide = wideSide;
      guard = 0;
      while (sys.state !== 'flying' && guard++ < 72 * 60) {
        if (sys.state === 'over' || sys.state === 'idle') return { error: 'round ended early ' + sys.state };
        if (gaze) gaze(0);
        sys.update(DT);
      }
      if (sys.state !== 'flying') return { error: 'never flew' };
      const aim = sys.aim.clone();
      const speedAtLaunch = sys.launchVel.length();
      if (place) place(aim);
      let frames = 0;
      let maxFocus = null;
      let wasWatching = 0;
      while (sys.state === 'flying' && frames++ < 72 * 10) {
        if (each) each(aim, frames);
        if (gaze) gaze(frames);
        sys.update(DT);
        if (window.__game.focusStats.watching) wasWatching++;
      }
      const res = {
        state: sys.state,
        result: sys.lastResult,
        twoHanded: sys.twoHanded,
        cupType: sys.cupType,
        info: sys.catchInfo,
        isLow: !!sys.isLowCatch,
        side: sys.heldBy,
        kmh: sys.kmh,
        speedAtLaunch,
        aim: aim.toArray(),
        focus: sys.lastFocus,
        nearest: sys.nearest,
        msg: sys.hud.model.message,
        framesWatching: wasWatching,
        focusStats: window.__game.focusStats,
      };
      // Finish the feedback phase so the next delivery starts clean.
      let g2 = 0;
      while (sys.state === 'feedback' && g2++ < 72 * 6) sys.update(DT);
      return res;
    }
    // Hands are placed relative to the arrival point.
    const at = (aim, dx = 0, dy = 0, dz = 0) => V(aim.x + dx, aim.y + dy, aim.z + dz);
    const out = {};
    sys.palmFromJoints = true;
    // The player stands still with the head looking at the ball for hand tests.
    headQ(V(0, 1.4, -10));

    // 1. Slow ball, two hands.
    out.slowTwo = delivery({
      ballNo: 1,
      place: (a) => {
        setHand('left', { palm: at(a, -0.09, 0, 0.0) });
        setHand('right', { palm: at(a, 0.09, 0, 0.0) });
      },
    });
    // 2. Fast ball, two hands (late in the round the ball is 79 km/h).
    out.fastTwo = delivery({
      ballNo: 45,
      place: (a) => {
        setHand('left', { palm: at(a, -0.09) });
        setHand('right', { palm: at(a, 0.09) });
      },
    });
    // 3. High catch: fingers up, reverse cup, the ball arrives above the head.
    out.high = delivery({
      ballNo: 5,
      type: 'high',
      place: (a) => {
        setHand('left', { palm: at(a, -0.09) });
        setHand('right', { palm: at(a, 0.09) });
      },
    });
    // 4. A low ball is requested through the test hook: it must NOT be generated (low balls are removed).
    out.low = delivery({
      ballNo: 5,
      type: 'low',
      place: (a) => {
        const down = V(0, -1, 0);
        setHand('left', { palm: at(a, -0.09), fingers: down });
        setHand('right', { palm: at(a, 0.09), fingers: down });
      },
    });
    // 4b. Unforced random deliveries (the real generation roll): none may be low.
    out.rand = [];
    for (let i = 0; i < 40; i++) {
      const r = delivery({ ballNo: 3 + (i % 30), type: '' });
      out.rand.push({ low: !!r.isLow, y: r.aim ? r.aim[1] : null });
    }
    // 5/6. Left and right single-hand catches.
    out.left = delivery({ ballNo: 1, place: (a) => setHand('left', { palm: at(a) }) });
    out.right = delivery({ ballNo: 1, place: (a) => setHand('right', { palm: at(a) }) });
    // 6b. A wide ball, far outside what two hands can cover: one hand at full stretch.
    out.wide = delivery({
      ballNo: 10,
      type: 'wide',
      wideSide: 1,
      place: (a) => {
        setHand('right', { palm: at(a) });
        setHand('left', { palm: at(a, -0.3) });
      },
    });
    // 7. One hand held out wide of where the ball arrives is a miss; the right place catches.
    out.wideMiss = delivery({ ballNo: 1, place: (a) => setHand('right', { palm: at(a, 0.4) }) });
    // 8. Back of the hand.
    out.back = delivery({ ballNo: 1, place: (a) => setHand('right', { palm: at(a), normal: V(0, 0, 1) }) });
    // 9. Wrist: fingers pointing at the player, palm up.
    out.wrist = delivery({ ballNo: 1, place: (a) => setHand('right', { palm: at(a), normal: V(0, 1, 0), fingers: V(0, 0, 1) }) });
    // 10. Ball passing between two hands held wide apart.
    out.between = delivery({
      ballNo: 1,
      place: (a) => {
        setHand('left', { palm: at(a, -0.4) });
        setHand('right', { palm: at(a, 0.4) });
      },
    });
    // 11. Clenched fist.
    out.fist = delivery({ ballNo: 1, place: (a) => setHand('right', { palm: at(a), open: 0 }) });
    // 12. Edge-on hand.
    out.edge = delivery({ ballNo: 1, place: (a) => setHand('right', { palm: at(a), normal: V(1, 0, 0) }) });
    // 13. No hands at all.
    out.none = delivery({ ballNo: 1, place: () => park() });
    // 14. A pinch (select) in the headset must not catch a ball.
    out.pinch = (() => {
      park();
      let g = 0;
      while (sys.state !== 'ready' && g++ < 72 * 30) sys.update(DT);
      sys.ballNo = 0;
      sys.forceType = 'normal';
      g = 0;
      while (sys.state !== 'flying' && g++ < 72 * 30) sys.update(DT);
      setHand('right', { palm: sys.aim.clone().add(V(0.32, 0, 0)) }); // hand beside the ball's path
      for (let i = 0; i < 30; i++) sys.update(DT);
      const click = sys.tryClickCatch();
      let g3 = 0;
      while (sys.state === 'flying' && g3++ < 72 * 10) sys.update(DT);
      const r = { click, result: sys.lastResult };
      let g4 = 0;
      while (sys.state === 'feedback' && g4++ < 72 * 6) sys.update(DT);
      return r;
    })();

    // ---- eyes ----
    // a) Eye tracking present: eyes follow the ball, head fixed.
    sys.player.gazeOrigin = 'tracked';
    sys.player.eyeSpace = eyeSpace;
    const ballWorld = () => sys.ball.position;
    const eyeAt = (target, jitter = 0.0) => {
      const head = sys.player.head.getWorldPosition(new THREE());
      eyeSpace.position.copy(head);
      eyeSpace.quaternion.copy(lookQ(head, target));
    };
    // Prime: eyes visibly independent of the head.
    headQ(V(0, 1.4, -10));
    for (let i = 0; i < 30; i++) {
      eyeAt(V(i % 2 ? 1.5 : -1.5, 1.4, -10));
      sys.update(DT);
    }
    out.eyesOnly = delivery({
      ballNo: 1,
      place: (a) => setHand('right', { palm: at(a) }),
      gaze: () => {
        headQ(V(0, 1.4, -10)); // head stays still, facing the pitch
        eyeAt(ballWorld().distanceTo(V(0, 0, 0)) < 0.01 ? V(0, 1.4, -10) : ballWorld());
      },
    });
    out.eyesAway = delivery({
      ballNo: 1,
      place: (a) => setHand('right', { palm: at(a) }),
      gaze: () => {
        headQ(V(0, 1.4, -10));
        eyeAt(V(6, 3.5, -4)); // staring off to the side of the pitch
      },
    });
    out.headMoveEyesLocked = delivery({
      ballNo: 1,
      place: (a) => setHand('right', { palm: at(a) }),
      gaze: (frame) => {
        // The head sways side to side while the eyes keep the ball.
        headQ(V(Math.sin(frame / 12) * 6, 1.4, -10));
        eyeAt(ballWorld());
      },
    });
    // b) No eye data at all (what a Quest 3 gives): head direction stands in.
    sys.player.gazeOrigin = 'head';
    sys.player.eyeSpace = null;
    sys.focus.eyeSeen = false;
    out.headFollows = delivery({
      ballNo: 1,
      place: (a) => setHand('right', { palm: at(a) }),
      gaze: () => headQ(ballWorld()),
    });
    out.headAway = delivery({
      ballNo: 1,
      place: (a) => setHand('right', { palm: at(a) }),
      gaze: () => headQ(V(8, 1.4, -2)),
    });
    return out;
  });

  const R = run;
  const ok = (name, cond, detail) => record(name, !!cond, detail || '');
  const show = (r) => `result=${r.result} two=${r.twoHanded} tech=${r.info && r.info.technique} tags=${r.info && r.info.tags} kmh=${r.kmh}`;

  ok('slow ball, two hands: caught two-handed', R.slowTwo.result === 'caught' && R.slowTwo.twoHanded, show(R.slowTwo));
  ok('chest-level catches are not mislabelled high/low', ['slowTwo', 'left', 'right'].every((k) => !R[k].info.tags.some((t) => ['high', 'low'].includes(t))) && !R.slowTwo.info.tags.includes('stretch'),['slowTwo', 'left', 'right'].map((k) => R[k].info.tags.join('+') || '-').join(' / '));
  ok('fast ball (>=70 km/h), two hands: caught', R.fastTwo.result === 'caught' && R.fastTwo.twoHanded && R.fastTwo.kmh >= 60, show(R.fastTwo));
  ok('high catch: both hands, fingers up, reverse cup', R.high.result === 'caught' && R.high.twoHanded && R.high.cupType === 'reverse-cup', show(R.high) + ' aimY=' + R.high.aim[1].toFixed(2));
  ok('requested low ball is not generated (chest height instead)', R.low.isLow === false && R.low.aim[1] > 0.8, 'isLow=' + R.low.isLow + ' aimY=' + R.low.aim[1].toFixed(2));
  ok('40 random deliveries: none low, none below knee-to-waist height', R.rand.every((r) => !r.low && r.y > 0.8), 'low=' + R.rand.filter((r) => r.low).length + ' minY=' + Math.min(...R.rand.map((r) => r.y)).toFixed(2));
  ok('wide ball: caught one-handed at full stretch', R.wide.result === 'caught' && !R.wide.twoHanded && R.wide.info && R.wide.info.tags.includes('stretch'), show(R.wide) + ' aim=' + R.wide.aim.map((x) => x.toFixed(2)))
  ok('left hand catch', R.left.result === 'caught' && !R.left.twoHanded && R.left.side === 'left', show(R.left));
  ok('right hand catch', R.right.result === 'caught' && !R.right.twoHanded && R.right.side === 'right', show(R.right));
  ok('hand held 40 cm off the ball path misses', R.wideMiss.result === 'missed', show(R.wideMiss));
  ok('back of hand: deflection, not a catch', R.back.result === 'back', show(R.back) + ' msg=' + R.back.msg);
  ok('wrist/forearm: deflection, not a catch', R.wrist.result === 'wrist', show(R.wrist) + ' msg=' + R.wrist.msg);
  ok('ball between two wide hands: missed', R.between.result === 'missed', show(R.between));
  ok('clenched fist: no catch', R.fist.result === 'fist', show(R.fist));
  ok('edge-on hand: no catch (edge or back glance)', R.edge.result === 'edge' || R.edge.result === 'back', show(R.edge));
  ok('no hands: missed', R.none.result === 'missed', show(R.none));
  ok('a pinch/select in the headset does not catch', R.pinch.click === false && R.pinch.result === 'missed', JSON.stringify(R.pinch));

  ok('eyes only (head still): eye tracking recognised, focus high', R.eyesOnly.focusStats.realEyes && R.eyesOnly.focus > 0.8, `source=${R.eyesOnly.focusStats.source} focus=${R.eyesOnly.focus}`);
  ok('eyes staring away: focus low, look-away detected', R.eyesAway.focus !== null && R.eyesAway.focus < 0.3 && R.eyesAway.focusStats.lookedAway, `focus=${R.eyesAway.focus} lookedAway=${R.eyesAway.focusStats.lookedAway}`);
  ok('head sways, eyes locked on ball: focus stays high', R.headMoveEyesLocked.focus > 0.8, `focus=${R.headMoveEyesLocked.focus} headTravel=${R.headMoveEyesLocked.focusStats.headTravel.toFixed(1)} eyeTravel=${R.headMoveEyesLocked.focusStats.eyeTravel.toFixed(1)}`);
  ok('no eye data, head follows ball: reported as HEAD tracking, never eyes', R.headFollows.focusStats.source === 'head' && !R.headFollows.focusStats.realEyes && R.headFollows.focus > 0.7, `source=${R.headFollows.focusStats.source} focus=${R.headFollows.focus}`);
  ok('no eye data, head turned away: focus low', R.headAway.focus !== null && R.headAway.focus < 0.3, `focus=${R.headAway.focus}`);

  // ---- console errors during all of the above ----
  record('no console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
