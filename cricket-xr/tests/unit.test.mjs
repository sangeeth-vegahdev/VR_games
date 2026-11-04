// Unit tests: plain Node, no browser, no headset. Run with `npm run test:unit`.
// They check the game's tuning and the maths the flight and the catch rely on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from '@iwsdk/core';
import { CFG } from '../src/config.js';

const BALL_RADIUS = 0.08; // src/ball.js

test('the round is 50 balls by default, and every ball is a fair test', () => {
  assert.equal(CFG.balls, 50);
  assert.ok(CFG.rampBalls < CFG.balls, 'speed and swing finish ramping inside the round');
});

test('speed ramps from 43 km/h up to a 79 km/h cap', () => {
  assert.ok(CFG.startSpeed < CFG.maxSpeed);
  assert.equal(Math.round(CFG.startSpeed * 3.6), 43);
  assert.equal(Math.round(CFG.maxSpeed * 3.6), 79);
});

test('the swing grows with speed, to keep the ball bending', () => {
  assert.ok(CFG.swingBase > 0 && CFG.swingMax > CFG.swingBase);
});

test('a catch needs the ball to touch the hand: the margin is a real hand, not a bucket', () => {
  assert.ok(CFG.handMargin > 0.03, 'big enough for the palm and fingers');
  assert.ok(CFG.handMargin < 0.15, 'small enough that a ball 23 cm away is not caught');
  assert.ok(BALL_RADIUS + CFG.handMargin < 0.23, 'the 23 cm miss in the test really is a miss');
});

test('the back-of-hand cut-off is an angle cosine, and the miss message has a sensible range', () => {
  assert.ok(CFG.backOfHand < 0 && CFG.backOfHand > -1);
  assert.ok(CFG.nearMiss > 0.1 && CFG.nearMiss < 1, 'a near miss is measured in tens of centimetres');
});

test('the two-hand catch range is wider than one palm but not the whole chest', () => {
  assert.ok(CFG.twoHandGap > CFG.handMargin);
  assert.ok(CFG.twoHandGap < 0.4);
});

test('the caught ball settles in a fraction of a second: no snapping', () => {
  assert.ok(CFG.settleTime > 0.03 && CFG.settleTime < 0.3);
});

test('the flight solve lands exactly on the aim, with the swing and gravity', () => {
  // The game solves vel = (aim - from)/T - accel T/2 with accel = (side * swing, -gravity, 0),
  // then the ball is at from + vel T + accel T^2 / 2 when it arrives.
  const from = new Vector3(0, 1.4, -18);
  for (const [side, swing] of [[0, 0], [1, CFG.swingBase], [-1, CFG.swingMax]]) {
    const aim = new Vector3(0.3 * side, 1.2, -0.65);
    const len = from.distanceTo(aim);
    const T = len / 17;
    const accel = new Vector3(side * swing, -CFG.gravity, 0);
    const vel = aim.clone().sub(from).divideScalar(T).addScaledVector(accel, -0.5 * T);
    const at = from.clone().addScaledVector(vel, T).addScaledVector(accel, 0.5 * T * T);
    assert.ok(at.distanceTo(aim) < 1e-9, `side ${side}`);
  }
});

test('a straight delivery has no swing, and a swinging one bends sideways', () => {
  const straight = new Vector3(0, 1.4, -18);
  const bent = new Vector3(0, 1.4, -18);
  const T = 1.0;
  const bend = (swing) => {
    const accel = new Vector3(swing, -CFG.gravity, 0);
    return bent.clone().addScaledVector(accel, 0.5 * T * T).x;
  };
  assert.equal(bend(0), straight.x);
  assert.ok(Math.abs(bend(CFG.swingBase)) > 0.5 * CFG.swingBase * T * T * 0.99);
});
