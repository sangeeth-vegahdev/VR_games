// Unit tests: plain Node, no browser, no headset. Run with `npm run test:unit`.
// They check the game's tuning, the eye-gaze logic, and the maths the flight and contact rely on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import { CFG } from '../src/config.js';
import {
  breakAccel, callOffset, callWords, choosePitch, clampToReach, commandMiss, drawnRps, flutterAt, flutterParams,
  FRAME, INCH, LEVELS, levelById, MPH, PITCHES, pitchSpeed, REACH, SPEED, spinAxis, STRIKE_ZONE, umpire,
} from '../src/pitches.js';
import { FocusTracker } from '../src/gaze.js';

const BALL_RADIUS = 0.048; // src/ball.js

// ---------- tuning ----------

const by = (n) => PITCHES.find((p) => p.name === n);
const seq = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

test('the whole arsenal: twelve pitches, unlocking in order from the four-seamer on pitch 1', () => {
  assert.deepEqual(PITCHES.map((p) => p.name), [
    'Four-seam fastball', 'Sinker', 'Changeup', 'Cutter', 'Curveball', 'Slider', 'Splitter', 'Sweeper',
    'Knuckle curve', 'Screwball', 'Knuckleball', 'Eephus',
  ]);
  assert.equal(PITCHES[0].from, 1);
  for (let i = 1; i < PITCHES.length; i++) assert.ok(PITCHES[i].from > PITCHES[i - 1].from);
  for (const p of PITCHES) assert.ok(p.from <= CFG.pitches, `${p.name} must unlock within a round`);
});

test('a full round calls every pitch in the arsenal, and the fastball most', () => {
  const rand = seq(7);
  const counts = {};
  for (let n = 1; n <= 25; n++) {
    const p = choosePitch(n, rand);
    assert.ok(p.from <= n, `${p.name} is not unlocked on pitch ${n}`);
    counts[p.name] = (counts[p.name] || 0) + 1;
  }
  for (const p of PITCHES) assert.ok(counts[p.name] >= 1, `${p.name} is thrown in a round`);
  // Over many pitches the usage follows a big-league mix: four-seamers most, the eephus rarely.
  const many = {};
  for (let i = 0; i < 20000; i++) { const p = choosePitch(25, rand); many[p.name] = (many[p.name] || 0) + 1; }
  assert.ok(many['Four-seam fastball'] > many.Slider && many.Slider > many.Eephus);
  // A shaken-off sign is never the pitch he then throws.
  for (let i = 0; i < 200; i++) assert.notEqual(choosePitch(25, rand, PITCHES[0]), PITCHES[0]);
});

test('speeds are Statcast speeds: 95 mph four-seamer in the majors, slower in pro and rookie', () => {
  const mph = (p, level, ramp = 1) => pitchSpeed(p, levelById(level), ramp, () => 0.5) * MPH;
  assert.ok(Math.abs(mph(PITCHES[0], 'majors') - 95) < 0.5, 'majors four-seamer');
  assert.ok(mph(PITCHES[0], 'pro') > 74 && mph(PITCHES[0], 'pro') < 82, 'pro four-seamer');
  assert.ok(mph(PITCHES[0], 'rookie') > 54 && mph(PITCHES[0], 'rookie') < 64, 'rookie four-seamer');
  assert.ok(mph(PITCHES[0], 'pro', 0) < mph(PITCHES[0], 'pro', 1) - 25, 'the round ramps up from an easy first pitch');
  // The order of speeds is a real pitcher's: four-seam > sinker > cutter > split/change/slider > curve > knuckler > eephus.
  const m = (n) => by(n).mph;
  assert.ok(m('Four-seam fastball') > m('Sinker') && m('Sinker') > m('Cutter') && m('Cutter') > m('Splitter'));
  assert.ok(m('Splitter') > m('Curveball') && m('Changeup') > m('Curveball') && m('Curveball') > m('Knuckleball'));
  assert.ok(m('Eephus') < 60 && m('Knuckleball') < 80);
  // Never over the cap, even when he reaches back.
  const rand = seq(3);
  for (let i = 0; i < 2000; i++) assert.ok(pitchSpeed(PITCHES[0], levelById('majors'), 1, rand) * MPH <= SPEED.capMph);
});

test('movement: each pitch moves its real inches, the right way, whatever the speed', () => {
  const move = (p, T) => { const a = breakAccel(p, T, 1, {}); return { x: (0.5 * a.x * T * T) / INCH, y: (0.5 * a.y * T * T) / INCH }; };
  for (const p of PITCHES) {
    for (const T of [0.42, 0.7]) {
      const d = move(p, T);
      assert.ok(Math.abs(d.y - p.ivb) < 1e-6 && Math.abs(d.x + p.hb) < 1e-6, `${p.name} over ${T}s`);
    }
  }
  // A right-hander's arm side is the catcher's left (-x): sinker and changeup run that way, the
  // sweeper and slider go glove side (+x), the four-seamer rides, the curveballs drop.
  assert.ok(move(by('Sinker'), 0.42).x < -10 && move(by('Changeup'), 0.42).x < -10 && move(by('Screwball'), 0.42).x < -10);
  assert.ok(move(by('Sweeper'), 0.42).x > 12 && move(by('Slider'), 0.42).x > 2 && move(by('Cutter'), 0.42).x > 1);
  assert.ok(by('Four-seam fastball').ivb > 14 && by('Curveball').ivb < -8 && by('Knuckle curve').ivb < -8);
  assert.ok(Math.abs(by('Sweeper').hb) > Math.abs(by('Slider').hb), 'a sweeper sweeps more than a gyro slider');
});

test('each pitch spins the way that makes it move (Magnus: spin x velocity), plus its bullet spin', () => {
  const v = new Vector3(0, 0, 1); // the pitch flies towards the catcher
  for (const p of PITCHES) {
    const axis = new Vector3().copy(spinAxis(p, {}));
    assert.ok(Math.abs(axis.length() - 1) < 1e-9, `${p.name} unit axis`);
    assert.ok(drawnRps(p) > 0, `${p.name} turns`);
    if (Math.hypot(p.hb, p.ivb) < 3) continue; // a knuckleball hardly moves from spin
    const f = axis.clone().cross(v).normalize(); // direction of the Magnus force
    const want = new Vector3(-p.hb, p.ivb, 0).normalize();
    assert.ok(f.dot(want) > 0.999, `${p.name}: spin pushes it the way it breaks`);
    assert.ok(Math.abs(axis.z - p.gyro) < 1e-9, `${p.name}: its share of bullet spin`);
  }
  assert.ok(spinAxis(by('Four-seam fastball'), {}).x < -0.85, 'four-seamer: mostly backspin');
  assert.ok(new Vector3().copy(spinAxis(by('Curveball'), {})).cross(v).y < -0.6, 'curveball: topspin dives');
  assert.ok(spinAxis(by('Slider'), {}).z > 0.6, 'slider: mostly bullet spin');
  assert.ok(drawnRps(by('Knuckleball')) < 3, 'a knuckleball barely turns');
});

test('a knuckleball flutters in flight and still crosses where it was aimed', () => {
  const f = flutterParams(by('Knuckleball'), seq(11), {});
  const T = 0.5;
  let most = 0;
  for (let t = 0; t <= T; t += 0.01) most = Math.max(most, Math.hypot(...Object.values(flutterAt(f, t, T, {}))));
  assert.ok(most > 0.03, 'it dances');
  const end = flutterAt(f, T, T, {});
  assert.ok(Math.hypot(end.x, end.y) < 1e-12 && Math.hypot(...Object.values(flutterAt(f, 0, T, {}))) < 1e-12);
});

test('the battery: called spots are in the zone; command misses stay catchable; a good target is tighter', () => {
  for (const p of PITCHES) for (const c of p.calls) {
    const o = callOffset(c, {});
    assert.ok(Math.abs(o.x) <= STRIKE_ZONE.halfWidth && Math.abs(o.y) <= STRIKE_ZONE.halfHeight, `${p.name} ${c}`);
    assert.ok(callWords(c).length > 1);
  }
  assert.ok(callOffset('down-away', {}).x > 0 && callOffset('down-away', {}).y < 0, 'away is the catcher\'s right, vs a right-handed hitter');
  const spread = (good) => {
    const rand = seq(5);
    let s = 0;
    for (let i = 0; i < 4000; i++) { const m = commandMiss(PITCHES[0], rand, good, {}); s += m.x * m.x + m.y * m.y; }
    return Math.sqrt(s / 4000);
  };
  assert.ok(spread(true) < spread(false) * 0.8, 'a good target tightens his command');
  const far = clampToReach({ x: 2, y: -2 });
  assert.ok(far.x === REACH.halfWidth && far.y === -REACH.halfHeight);
});

test('the umpire: strikes, balls, a framed strike and a stabbed ball', () => {
  assert.equal(umpire({ x: 0, y: 0 }, true, 0.2).strike, true);
  assert.equal(umpire({ x: 0.33, y: 0 }, true, 0.2).strike, false);
  const edge = STRIKE_ZONE.halfWidth;
  const framed = umpire({ x: edge + 0.03, y: 0 }, true, 0.3);
  assert.ok(framed.strike && framed.framed, 'just off the plate, caught quietly: framed');
  assert.ok(!umpire({ x: edge + 0.03, y: 0 }, true, 2).strike, 'caught with the mitt moving: a ball');
  assert.ok(!umpire({ x: edge + 0.03, y: 0 }, false, 0).strike, 'not caught: no framing');
  const stab = umpire({ x: edge - 0.02, y: 0 }, true, 3.5);
  assert.ok(!stab.strike && stab.stabbed, 'a stab at a corner strike loses it');
  assert.ok(FRAME.quiet < FRAME.stab);
});

test('the catch zone is bigger than the ball, and a near miss is a real near miss', () => {
  assert.ok(CFG.catchRadius > BALL_RADIUS, 'a catch needs the ball to reach the mitt');
  assert.ok(CFG.catchRadius < 0.3, 'the mitt is not a bucket');
  assert.ok(CFG.nearMiss > CFG.catchRadius, 'a near miss is outside the catch');
  assert.ok(CFG.bareHandRadius > BALL_RADIUS, 'the bare hand must be able to touch the ball');
  assert.ok(CFG.backOfMitt < 0 && CFG.backOfMitt > -1, 'back-of-mitt cut-off is an angle cosine');
});

test('levels and the round: the default is pro, and the ramp finishes inside the round', () => {
  assert.deepEqual(LEVELS.map((l) => l.id), ['rookie', 'pro', 'majors']);
  assert.equal(CFG.level, 'pro');
  assert.equal(levelById('nonsense').id, 'pro');
  assert.ok(CFG.rampPitches < CFG.pitches);
  assert.ok(CFG.signTime > 0.5 && CFG.shakeChance < 0.3);
});

test('focus cones: the eyes can be tighter than the head, which must be looser', () => {
  assert.ok(CFG.focusConeEyes > 0 && CFG.focusConeEyes < CFG.focusConeHead);
});

// ---------- the flight maths (the same solve the game uses) ----------

test('a solved pitch arrives exactly at its aim point, for every pitch type and level', () => {
  // The game solves: vel = (aim - from) / T - accel * T / 2, then pos(T) = from + vel T + accel T^2 / 2.
  const from = new Vector3(-0.6, 1.77, -17.9);
  const aim = new Vector3(-0.2, 0.95, -0.55);
  for (const p of PITCHES) {
    for (const level of LEVELS) {
      for (const ramp of [0, 1]) {
        const speed = pitchSpeed(p, level, ramp, () => 0.5);
        const T = from.distanceTo(aim) / speed;
        const b = breakAccel(p, T, 0.45 + 0.55 * ramp, {});
        const accel = new Vector3(b.x, b.y - CFG.gravity, 0);
        const vel = aim.clone().sub(from).divideScalar(T).addScaledVector(accel, -0.5 * T);
        const at = from.clone().addScaledVector(vel, T).addScaledVector(accel, 0.5 * T * T);
        assert.ok(at.distanceTo(aim) < 1e-9, `${p.name} ${level.id}`);
      }
    }
  }
});

// ---------- eye gaze ----------

// A fake player: a head and an eye ray, placed in the world.
function rig({ gazeTracked = false, eyeYaw = 0, headYaw = 0 } = {}) {
  const head = new Object3D();
  head.position.set(0, 1.2, 0);
  head.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), headYaw);
  head.updateMatrixWorld(true);
  const eye = new Object3D();
  eye.position.set(0, 1.2, 0);
  eye.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), eyeYaw);
  eye.updateMatrixWorld(true);
  return {
    head,
    eyeSpace: eye,
    gazeOrigin: gazeTracked ? 'tracked' : 'none',
  };
}
const camera = new Object3D();
camera.position.set(0, 1.2, 0);
camera.updateMatrixWorld(true);

test('no headset: focus is not measured (null), on a PC', () => {
  const f = new FocusTracker();
  f.sample(rig(), camera, false);
  f.resetPitch();
  f.track(new Vector3(0, 1.2, -5), 1 / 60, 5);
  assert.equal(f.mode, 'none');
  assert.equal(f.focus, null);
});

test('head direction: looking straight at the ball counts as watching it', () => {
  const f = new FocusTracker();
  const ball = new Vector3(0, 1.2, -5);
  f.sample(rig(), camera, true);
  assert.equal(f.mode, 'head');
  f.resetPitch();
  for (let i = 0; i < 60; i++) f.track(ball, 1 / 60, 5);
  assert.equal(f.focus, 1);
});

test('head direction: looking away from the ball does not count', () => {
  const f = new FocusTracker();
  f.sample(rig({ headYaw: Math.PI / 2 }), camera, true); // head turned 90 degrees, away from the ball
  f.resetPitch();
  const ball = new Vector3(0, 1.2, -5);
  for (let i = 0; i < 60; i++) f.track(ball, 1 / 60, 5);
  assert.equal(f.focus, 0);
});

test('focus is the share of the flight spent watching the ball', () => {
  const f = new FocusTracker();
  f.sample(rig(), camera, true);
  f.resetPitch();
  const on = new Vector3(0, 1.2, -5);
  const off = new Vector3(3, 1.2, -5); // about 31 degrees off the head's line: outside the head cone
  for (let i = 0; i < 30; i++) f.track(on, 1 / 60, 5);
  for (let i = 0; i < 30; i++) f.track(off, 1 / 60, 5);
  assert.ok(Math.abs(f.focus - 0.5) < 1e-9, `focus was ${f.focus}`);
});

test('eye tracking is only used once the gaze ray separates from the head', () => {
  const f = new FocusTracker();
  // Tracked, but the "gaze" ray is just the head's direction (a runtime that reports no real eyes).
  f.sample(rig({ gazeTracked: true, eyeYaw: 0 }), camera, true);
  assert.equal(f.mode, 'head');
  // Real eyes: the gaze ray is 10 degrees off the head.
  f.sample(rig({ gazeTracked: true, eyeYaw: (10 * Math.PI) / 180 }), camera, true);
  assert.equal(f.mode, 'eyes');
});

test('with real eyes, a glance 10 degrees off the ball is not watching', () => {
  const f = new FocusTracker();
  f.sample(rig({ gazeTracked: true, eyeYaw: (10 * Math.PI) / 180 }), camera, true); // eyes turned 10 degrees
  assert.equal(f.mode, 'eyes');
  f.resetPitch();
  // The ball is straight ahead. With eyes the cone is tight (7 degrees), so 10 degrees away is not watched.
  f.track(new Vector3(0, 1.2, -5), 1 / 60, 5);
  f.track(new Vector3(0, 1.2, -5), 1 / 60, 5);
  assert.equal(f.watching, false);
});

test('before any pitch is measured, focus is null', () => {
  const f = new FocusTracker();
  f.sample(rig(), camera, true);
  f.resetPitch();
  assert.equal(f.focus, null);
});
