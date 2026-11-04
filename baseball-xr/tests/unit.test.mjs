// Unit tests: plain Node, no browser, no headset. Run with `npm run test:unit`.
// They check the game's tuning, the eye-gaze logic, and the maths the flight and contact rely on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import { CFG, PITCHES } from '../src/config.js';
import { FocusTracker } from '../src/gaze.js';

const BALL_RADIUS = 0.048; // src/ball.js

// ---------- tuning ----------

test('the four pitches unlock in order, starting with the fastball on pitch 1', () => {
  assert.equal(PITCHES.length, 4);
  assert.deepEqual(PITCHES.map((p) => p.name), ['Fastball', 'Changeup', 'Curveball', 'Slider']);
  assert.equal(PITCHES[0].from, 1);
  for (let i = 1; i < PITCHES.length; i++) assert.ok(PITCHES[i].from > PITCHES[i - 1].from);
  for (const p of PITCHES) assert.ok(p.from <= CFG.pitches, `${p.name} must unlock within a round`);
});

test('pitch speeds and breaks are sensible', () => {
  for (const p of PITCHES) {
    assert.ok(p.speed > 0 && p.speed <= 1.1, `${p.name} speed factor`);
    assert.equal(p.break.length, 2);
    assert.ok(p.break.every(Number.isFinite));
  }
  const fast = PITCHES.find((p) => p.name === 'Fastball');
  const curve = PITCHES.find((p) => p.name === 'Curveball');
  const slider = PITCHES.find((p) => p.name === 'Slider');
  const change = PITCHES.find((p) => p.name === 'Changeup');
  // A curveball dives more than a fastball; a slider breaks further sideways (to the catcher's left).
  assert.ok(curve.break[1] < fast.break[1], 'curveball drops more than the fastball');
  assert.ok(slider.break[0] < fast.break[0], 'slider moves further sideways than the fastball');
  assert.ok(change.speed < fast.speed, 'changeup is slower than the fastball');
});

test('the catch zone is bigger than the ball, and a near miss is a real near miss', () => {
  assert.ok(CFG.catchRadius > BALL_RADIUS, 'a catch needs the ball to reach the mitt');
  assert.ok(CFG.catchRadius < 0.3, 'the mitt is not a bucket');
  assert.ok(CFG.nearMiss > CFG.catchRadius, 'a near miss is outside the catch');
  assert.ok(CFG.bareHandRadius > BALL_RADIUS, 'the bare hand must be able to touch the ball');
  assert.ok(CFG.backOfMitt < 0 && CFG.backOfMitt > -1, 'back-of-mitt cut-off is an angle cosine');
});

test('speeds ramp up and stay within the cap; the round is long enough to ramp', () => {
  assert.ok(CFG.startSpeed < CFG.maxSpeed);
  assert.ok(CFG.rampPitches < CFG.pitches, 'the ramp finishes inside the round');
  assert.ok(CFG.maxSpeed * 2.23694 < 75, 'top speed stays a readable 75 mph or less');
});

test('focus cones: the eyes can be tighter than the head, which must be looser', () => {
  assert.ok(CFG.focusConeEyes > 0 && CFG.focusConeEyes < CFG.focusConeHead);
});

test('the strike-zone hint is shown only for the first pitches', () => {
  assert.ok(CFG.zoneHint);
  assert.ok(CFG.zoneHintPitches > 0 && CFG.zoneHintPitches < CFG.pitches);
});

test('each pitch spins the way that makes it move (Magnus: spin x velocity)', () => {
  const v = new Vector3(0, 0, 1); // the pitch flies towards the catcher
  for (const p of PITCHES) {
    const f = new Vector3(...p.spin.axis).normalize().cross(v); // direction of the Magnus force
    assert.ok(p.spin.rps > 0, `${p.name} spins`);
    // Sideways, the spin pushes the way the pitch breaks.
    if (Math.abs(p.break[0]) > 0.5) assert.equal(Math.sign(f.x), Math.sign(p.break[0]), `${p.name} sideways`);
  }
  const by = (n) => PITCHES.find((p) => p.name === n);
  const lift = (n) => new Vector3(...by(n).spin.axis).normalize().cross(v).y;
  assert.ok(lift('Fastball') > 0.9, 'fastball backspin lifts');
  assert.ok(lift('Curveball') < -0.9, 'curveball topspin dives');
});

// ---------- the flight maths (the same solve the game uses) ----------

test('a solved pitch arrives exactly at its aim point, for every pitch type', () => {
  // The game solves: vel = (aim - from) / T - accel * T / 2, then pos(T) = from + vel T + accel T^2 / 2.
  const from = new Vector3(0.1, 1.77, -17.9);
  const aim = new Vector3(-0.2, 0.95, -0.55);
  for (const p of PITCHES) {
    for (const [speed, k] of [[15, 0.45], [28, 1]]) {
      const accel = new Vector3(p.break[0] * k, p.break[1] * k - CFG.gravity, 0);
      const T = from.distanceTo(aim) / (speed * p.speed);
      const vel = aim.clone().sub(from).divideScalar(T).addScaledVector(accel, -0.5 * T);
      const at = from.clone().addScaledVector(vel, T).addScaledVector(accel, 0.5 * T * T);
      assert.ok(at.distanceTo(aim) < 1e-9, `${p.name} at speed ${speed}`);
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
