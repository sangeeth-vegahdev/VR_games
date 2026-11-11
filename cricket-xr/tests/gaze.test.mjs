// Eye tracking / focus, tested against the REAL module (src/gaze.js). The frames are fed exactly as the
// game feeds them. Head and eye poses are built separately, so "head moves, eyes stay put" and
// "eyes move, head stays put" are genuinely different inputs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, Quaternion, Vector3 } from '@iwsdk/core';
import { FocusTracker } from '../src/gaze.js';
import { CFG } from '../src/config.js';

const DT = 1 / 72;
const DEG = Math.PI / 180;
const HEAD = new Vector3(0, 1.6, 0);
const FWD = new Vector3(0, 0, -1);
const BALL = new Vector3(0, 1.6, -10);

const yaw = (deg) => new Quaternion().setFromEuler(new Euler(0, deg * DEG, 0, 'YXZ'));
const towards = (from, to) => new Quaternion().setFromUnitVectors(FWD, new Vector3().subVectors(to, from).normalize());
const dirOf = (q) => FWD.clone().applyQuaternion(q);
const angleDeg = (a, b) => a.angleTo(b) / DEG;
const ballAt = (deg, dist = 10) => new Vector3(-Math.sin(deg * DEG) * dist, 1.6, -Math.cos(deg * DEG) * dist);

// A tiny seeded noise source so tests are repeatable.
function rng(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

function tracker() {
  const t = new FocusTracker();
  t.resetPitch();
  return t;
}

// One frame: head orientation, optional eye world direction (null = no eye data), then the ball is tracked.
function frame(t, headQ, eyeDir, ball = BALL, dt = DT, trackBall = true) {
  const eye = eyeDir ? { quat: new Quaternion().setFromUnitVectors(FWD, eyeDir.clone().normalize()), pos: HEAD } : null;
  t.feed(dt, HEAD, headQ, eye);
  if (trackBall) t.track(ball, dt, 10);
}

// Feeds a few frames that move the eyes off the head's forward line so the tracker knows the eye data is real.
function prime(t, head, toBall) {
  const offset = new Vector3(0.1, 0, -1).normalize();
  for (let i = 0; i < 8; i++) frame(t, head, i % 2 ? toBall : offset, BALL, DT, false);
}

// ---------- is it really eye tracking? ----------

test('a "gaze" ray that is just the head direction is reported as head tracking, never as eye tracking', () => {
  const t = tracker();
  for (let i = 0; i < 120; i++) {
    const q = yaw(Math.sin(i / 10) * 25); // the head sweeps about
    t.feed(DT, HEAD, q, { quat: q.clone(), pos: HEAD }); // runtime reports the head's own direction as "gaze"
  }
  assert.equal(t.mode, 'head');
  assert.equal(t.realEyes, false);
  assert.equal(t.eyeSeen, false);
  assert.equal(t.source, 'head');
});

test('a gaze ray that moves independently of the head is reported as real eye tracking', () => {
  const t = tracker();
  const q = yaw(0);
  for (let i = 0; i < 20; i++) t.feed(DT, HEAD, q, { quat: yaw(i < 10 ? 0 : 8), pos: HEAD });
  assert.equal(t.mode, 'eyes');
  assert.equal(t.realEyes, true);
  assert.equal(t.simulated, false);
  assert.equal(t.source, 'eyes');
});

test('small eye drift that adds up is also recognised as independent eye data', () => {
  const t = tracker();
  const q = yaw(0);
  for (let i = 0; i < 60; i++) t.feed(DT, HEAD, q, { quat: yaw(Math.sin(i / 6) * 1.2), pos: HEAD });
  assert.equal(t.realEyes, true);
});

test('the emulator mouse stand-in is labelled simulated and is never real eye tracking', () => {
  const t = tracker();
  t.feed(DT, HEAD, yaw(0), { local: new Vector3(0.2, 0, -1) });
  assert.equal(t.mode, 'eyes');
  assert.equal(t.simulated, true);
  assert.equal(t.realEyes, false);
  assert.equal(t.source, 'simulated-eyes');
});

test('outside a headset focus is not measured at all', () => {
  const t = tracker();
  t.mode = 'none';
  t.track(BALL, DT, 10);
  assert.equal(t.watching, false);
  assert.equal(t.focus, null);
});

// ---------- eyes move, head still ----------

test('eyes move to the ball while the head stays still: the gaze follows the eyes', () => {
  const t = tracker();
  const head = yaw(0);
  const ball = ballAt(22); // well off to one side
  // Eyes start on the centre line, then make a saccade to the ball over ~5 frames.
  for (let i = 0; i < 20; i++) frame(t, head, FWD, ball);
  assert.equal(t.watching, false, 'eyes are not on the ball yet');
  const target = ball.clone().sub(HEAD).normalize();
  const saw = new Set();
  for (let i = 1; i <= 5; i++) {
    const d = FWD.clone().lerp(target, i / 5).normalize();
    frame(t, head, d, ball);
    saw.add(t.movement);
  }
  for (let i = 0; i < 12; i++) frame(t, head, target, ball);
  assert.equal(t.mode, 'eyes');
  assert.ok(angleDeg(t.dir, target) < 1.0, `gaze settles on the ball (${angleDeg(t.dir, target).toFixed(2)} deg off)`);
  assert.equal(t.watching, true);
  assert.ok(saw.has('saccade') || saw.has('pursuit'), `eye movement was recognised: ${[...saw]}`);
  assert.equal(t.headTravel < 0.01, true, 'the head did not move');
  assert.ok(t.eyeTravel > 15, `eyes moved ${t.eyeTravel.toFixed(1)} deg`);
});

test('a saccade is not smoothed into a slow drift: the gaze arrives within a few frames', () => {
  const t = tracker();
  const head = yaw(0);
  for (let i = 0; i < 30; i++) frame(t, head, FWD, BALL, DT, false);
  const target = ballAt(15).sub(HEAD).normalize();
  let frames = 0;
  for (; frames < 30; frames++) {
    const d = FWD.clone().lerp(target, Math.min(1, (frames + 1) / 4)).normalize(); // 15 deg in 4 frames
    frame(t, head, d, BALL, DT, false);
    if (angleDeg(t.dir, target) < 2) break;
  }
  assert.ok(frames <= 9, `settled in ${frames + 1} frames (${((frames + 1) * DT * 1000).toFixed(0)} ms)`);
});

// ---------- head moves, eyes stay on the ball ----------

test('head turns while the eyes stay locked on the ball: the gaze stays on the ball and is not eye movement', () => {
  const t = tracker();
  const ball = ballAt(10);
  const toBall = ball.clone().sub(HEAD).normalize();
  for (let i = 0; i < 20; i++) frame(t, yaw(0), toBall, ball);
  let worst = 0;
  const movements = new Set();
  for (let i = 1; i <= 50; i++) {
    frame(t, yaw(30 * (i / 50)), toBall, ball); // head turns 30 deg towards the ball, eyes never leave it
    worst = Math.max(worst, angleDeg(t.dir, toBall));
    movements.add(t.movement);
  }
  assert.ok(worst < 1.5, `gaze stayed within ${worst.toFixed(2)} deg of the ball`);
  assert.equal(t.watching, true);
  assert.ok(!movements.has('saccade') && !movements.has('pursuit'), `no eye movement reported: ${[...movements]}`);
  assert.ok(Math.abs(t.headTravel - 30) < 1.5, `head travelled ${t.headTravel.toFixed(1)} deg`);
  assert.ok(t.eyeTravel < 2, `eye travel ${t.eyeTravel.toFixed(1)} deg`);
  assert.equal(t.focus, 1);
});

test('head-only tracking (no eye data): head turning is reported as head movement, never as eye movement', () => {
  const t = tracker();
  const ball = ballAt(20);
  const seen = new Set();
  for (let i = 0; i <= 60; i++) {
    frame(t, yaw(20 * Math.min(1, i / 40)), null, ball);
    seen.add(t.movement);
  }
  assert.equal(t.mode, 'head');
  assert.ok(seen.has('head-turn'));
  assert.ok(!seen.has('saccade') && !seen.has('pursuit'));
  assert.equal(t.eyeTravel, 0, 'no eye movement can be claimed without eye data');
  assert.equal(t.watching, true, 'head pointing at the ball');
});

test('head mode uses the wider cone, eye mode the tighter one', () => {
  const off = (deg) => ballAt(deg);
  const h = tracker();
  for (let i = 0; i < 10; i++) frame(h, yaw(0), null, off(10));
  assert.equal(h.mode, 'head');
  assert.equal(h.watching, true, '10 deg off is inside the head cone');
  const e = tracker();
  for (let i = 0; i < 20; i++) frame(e, yaw(0), new Vector3(0.0, 0, -1).applyAxisAngle(new Vector3(0, 1, 0), 4 * DEG), off(14));
  assert.equal(e.mode, 'eyes');
  assert.equal(e.watching, false, '10 deg off the ball is outside the tighter eye cone');
  assert.ok(CFG.focusConeEyes < CFG.focusConeHead);
});

// ---------- looking away ----------

test('looking away from the ball is detected, remembered, and lowers the focus score', () => {
  const t = tracker();
  const head = yaw(0);
  const toBall = BALL.clone().sub(HEAD).normalize();
  const away = ballAt(40).sub(HEAD).normalize();
  for (let i = 0; i < 36; i++) frame(t, head, toBall);
  assert.equal(t.watching, true);
  assert.equal(t.lookedAway, false);
  for (let i = 0; i < 36; i++) t.feed(DT, HEAD, head, { quat: new Quaternion().setFromUnitVectors(FWD, away), pos: HEAD }), t.track(BALL, DT, 7.5);
  assert.equal(t.watching, false);
  assert.equal(t.lookedAway, true);
  assert.equal(t.lostAt, 7.5, 'remembers how far away the ball was when the eyes left it');
  assert.ok(t.longestAway >= 0.45);
  assert.ok(t.focus > 0.4 && t.focus < 0.6, `half the flight watched: ${t.focus}`);
});

test('returning the eyes to the ball ends the look-away', () => {
  const t = tracker();
  const head = yaw(0);
  const toBall = BALL.clone().sub(HEAD).normalize();
  const away = ballAt(40).sub(HEAD).normalize();
  for (let i = 0; i < 20; i++) frame(t, head, toBall);
  for (let i = 0; i < 20; i++) frame(t, head, away);
  assert.equal(t.watching, false);
  for (let i = 0; i < 20; i++) frame(t, head, toBall);
  assert.equal(t.watching, true);
  assert.equal(t.lostAt, null);
});

test('a one-frame flick off the ball does not count as looking away', () => {
  const t = tracker();
  const head = yaw(0);
  const toBall = BALL.clone().sub(HEAD).normalize();
  const away = ballAt(40).sub(HEAD).normalize();
  for (let i = 0; i < 20; i++) frame(t, head, toBall);
  frame(t, head, away);
  assert.equal(t.watching, true);
  for (let i = 0; i < 20; i++) frame(t, head, toBall);
  assert.equal(t.lookedAway, false);
  assert.equal(t.focus, 1);
});

// ---------- noise, jumps, missing data ----------

test('jitter while fixating is smoothed away without lagging the real gaze', () => {
  const noise = rng(7);
  const t = tracker();
  const head = yaw(0);
  const toBall = BALL.clone().sub(HEAD).normalize();
  let rawSq = 0;
  let outSq = 0;
  let n = 0;
  for (let i = 0; i < 300; i++) {
    const jittered = toBall.clone().add(new Vector3(noise() * 0.03, noise() * 0.03, 0)).normalize(); // ~ +/-0.9 deg
    frame(t, head, jittered);
    if (i > 30) {
      rawSq += angleDeg(jittered, toBall) ** 2;
      outSq += angleDeg(t.dir, toBall) ** 2;
      n++;
    }
  }
  const raw = Math.sqrt(rawSq / n);
  const out = Math.sqrt(outSq / n);
  assert.ok(out < raw * 0.6, `rms jitter ${raw.toFixed(2)} -> ${out.toFixed(2)} deg`);
  assert.equal(t.watching, true);
});

test('a single-frame sensor glitch (a 90 degree spike) is ignored', () => {
  const t = tracker();
  const head = yaw(0);
  const toBall = BALL.clone().sub(HEAD).normalize();
  prime(t, head, toBall);
  for (let i = 0; i < 30; i++) frame(t, head, toBall);
  assert.equal(t.realEyes, true);
  const before = t.dir.clone();
  frame(t, head, new Vector3(1, 0, 0));
  assert.ok(angleDeg(t.dir, before) < 3, `moved ${angleDeg(t.dir, before).toFixed(1)} deg`);
  assert.equal(t.watching, true);
  for (let i = 0; i < 5; i++) frame(t, head, toBall);
  assert.equal(t.watching, true);
});

test('a real, lasting jump is accepted after the glitch window', () => {
  const t = tracker();
  const head = yaw(0);
  const toBall = BALL.clone().sub(HEAD).normalize();
  const far = new Vector3(0.5, 0, -1).normalize();
  prime(t, head, toBall);
  for (let i = 0; i < 30; i++) frame(t, head, toBall);
  assert.equal(t.realEyes, true);
  for (let i = 0; i < 12; i++) frame(t, head, far);
  assert.ok(angleDeg(t.dir, far) < 2);
});

test('missing eye data: a blink is bridged, a long dropout is marked lost and is not scored', () => {
  const t = tracker();
  const head = yaw(0);
  const toBall = BALL.clone().sub(HEAD).normalize();
  const offset = new Vector3(0.05, 0, -1).normalize();
  for (let i = 0; i < 20; i++) frame(t, head, i % 2 ? toBall : offset); // confirms independent eye data
  assert.equal(t.realEyes, true);
  // 100 ms blink.
  for (let i = 0; i < 7; i++) frame(t, head, null);
  assert.equal(t.holding, true);
  assert.equal(t.valid, true);
  assert.equal(t.watching, true, 'a blink does not look like looking away');
  // Long dropout.
  const flightBefore = t.flightTime;
  for (let i = 0; i < 36; i++) frame(t, head, null);
  assert.equal(t.valid, false);
  assert.equal(t.source, 'eyes-lost');
  assert.ok(t.invalidTime > 0.3);
  assert.ok(t.flightTime - flightBefore < 0.2, 'lost time is not counted as flight time');
  // Back again.
  for (let i = 0; i < 10; i++) frame(t, head, toBall);
  assert.equal(t.valid, true);
  assert.equal(t.source, 'eyes');
});

test('a flight that is mostly missing eye data gets no focus score rather than a made-up one', () => {
  const t = tracker();
  const head = yaw(0);
  const toBall = BALL.clone().sub(HEAD).normalize();
  const offset = new Vector3(0.05, 0, -1).normalize();
  for (let i = 0; i < 10; i++) frame(t, head, i % 2 ? toBall : offset);
  t.resetPitch();
  for (let i = 0; i < 4; i++) frame(t, head, toBall);
  for (let i = 0; i < 72; i++) frame(t, head, null);
  assert.equal(t.focus, null);
});

test('NaN / infinite / zero eye rotations are treated as missing data and never poison the gaze', () => {
  const t = tracker();
  const head = yaw(0);
  const toBall = BALL.clone().sub(HEAD).normalize();
  for (let i = 0; i < 20; i++) frame(t, head, i % 2 ? toBall : new Vector3(0.05, 0, -1));
  for (const bad of [new Quaternion(NaN, 0, 0, 1), new Quaternion(Infinity, 0, 0, 1), new Quaternion(0, 0, 0, 0)]) {
    t.feed(DT, HEAD, head, { quat: bad, pos: HEAD });
    t.track(BALL, DT, 10);
    assert.ok(Number.isFinite(t.dir.x) && Number.isFinite(t.dir.y) && Number.isFinite(t.dir.z), 'direction stays finite');
    assert.ok(Math.abs(t.dir.length() - 1) < 1e-6);
  }
  const f = t.focus;
  assert.ok(f === null || (f >= 0 && f <= 1));
});

test('a NaN head pose is rejected: no throw, nothing scored', () => {
  const t = tracker();
  const good = yaw(0);
  frame(t, good, null);
  const flight = t.flightTime;
  t.feed(DT, new Vector3(NaN, 1.6, 0), good, null);
  assert.equal(t.valid, false);
  t.track(BALL, DT, 10);
  assert.equal(t.flightTime, flight);
  t.feed(DT, HEAD, new Quaternion(NaN, NaN, NaN, NaN), null);
  assert.equal(t.valid, false);
  frame(t, good, null);
  assert.equal(t.valid, true);
});

test('a NaN ball position is ignored by the tracker', () => {
  const t = tracker();
  frame(t, yaw(0), null);
  const flight = t.flightTime;
  t.track(new Vector3(NaN, 0, 0), DT, 10);
  assert.equal(t.flightTime, flight);
});

test('absurd frame times are clamped and cannot break the filter', () => {
  const t = tracker();
  const head = yaw(0);
  const toBall = BALL.clone().sub(HEAD).normalize();
  const other = new Vector3(0.1, 0, -1).normalize();
  for (const dt of [0, -1, NaN, 100, 1e-9]) {
    t.feed(dt, HEAD, head, { quat: new Quaternion().setFromUnitVectors(FWD, toBall), pos: HEAD });
    t.feed(dt, HEAD, head, { quat: new Quaternion().setFromUnitVectors(FWD, other), pos: HEAD });
    assert.ok(Number.isFinite(t.dir.x) && Number.isFinite(t.dir.y));
  }
});

// ---------- scoring ----------

test('hysteresis: gaze hovering right on the cone edge does not flicker watching on and off', () => {
  const noise = rng(3);
  const t = tracker();
  const head = yaw(0);
  const edge = CFG.focusConeEyes + Math.atan(0.08 / 10) / DEG; // exactly at the boundary, ball radius included
  let flips = 0;
  let last = null;
  for (let i = 0; i < 400; i++) {
    const a = (i < 20 ? 0 : edge + noise() * 1.5) * DEG;
    const d = new Vector3(-Math.sin(a), 0, -Math.cos(a));
    frame(t, head, d);
    if (i > 40) {
      if (last !== null && t.watching !== last) flips++;
      last = t.watching;
    }
  }
  assert.ok(flips <= 10, `${flips} flips in 360 frames`);
});

test('focus is always within 0..1 and watch time never exceeds flight time', () => {
  const noise = rng(11);
  const t = tracker();
  const head = yaw(0);
  for (let i = 0; i < 500; i++) frame(t, head, new Vector3(noise() * 0.6, noise() * 0.3, -1));
  assert.ok(t.watchTime <= t.flightTime + 1e-9);
  assert.ok(t.focus >= 0 && t.focus <= 1);
});

test('close ball: a big ball near the face is easier to keep on than the same angle far away', () => {
  const near = tracker();
  const far = tracker();
  const a = (CFG.focusConeHead + 3) * DEG; // just outside the head cone for a point-like ball
  const dir = new Vector3(-Math.sin(a), 0, -Math.cos(a));
  const at = (d) => HEAD.clone().addScaledVector(dir, d);
  for (let i = 0; i < 20; i++) {
    near.feed(DT, HEAD, yaw(0), null);
    far.feed(DT, HEAD, yaw(0), null);
    near.track(at(0.7), DT, 0.7); // 0.08 m ball subtends 6.5 deg here
    far.track(at(15), DT, 15); // ...and 0.3 deg here
  }
  assert.equal(near.watching, true);
  assert.equal(far.watching, false);
});
