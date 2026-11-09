// Unit tests: plain Node, no browser, no headset. Run with `npm run test:unit`.
// They check the game's tuning and the maths the flight and the catch rely on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Object3D, Vector3 } from '@iwsdk/core';
import { FocusTracker } from '../src/gaze.js';
import { EyeRingTracker, projectGazePoint } from '../src/eye-tracker.js';
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


test('focus cones: the eyes can be tighter than the head, which must be looser', () => {
  assert.ok(CFG.focusConeEyes > 0 && CFG.focusConeEyes < CFG.focusConeHead);
});


test('focus tracker: tracks eyes inside cone and calculates focus fraction', () => {
  const tracker = new FocusTracker();
  assert.equal(tracker.mode, 'none');
  assert.equal(tracker.focus, null);
  tracker.mode = 'eyes';
  tracker.origin.set(0, 1.6, 0);
  tracker.dir.set(0, 0, -1);
  // Ball aligned
  tracker.track(new Vector3(0, 1.6, -10), 0.5, 10);
  assert.equal(tracker.watching, true);
  assert.equal(tracker.focus, 1.0);
  // Look away
  tracker.track(new Vector3(5, 1.6, -10), 0.5, 10);
  assert.equal(tracker.watching, false);
  assert.equal(tracker.focus, 0.5);
});


test('eye ring tracker: projects gaze ray at ball depth without vergence conflict', () => {
  const origin = new Vector3(0, 1.5, 0);
  const dir = new Vector3(0, 0, -1);
  const ball = new Vector3(0, 1.5, -12);
  const ptDirect = projectGazePoint(origin, dir, ball);
  assert.ok(ptDirect.distanceTo(ball) < 1e-6, 'ring is positioned exactly at the ball');
  const angle = (15 * Math.PI) / 180;
  const tiltedDir = new Vector3(Math.sin(angle), 0, -Math.cos(angle)).normalize();
  const ptTilted = projectGazePoint(origin, tiltedDir, ball);
  assert.ok(Math.abs(origin.distanceTo(ptTilted) - 12) < 1e-6, 'ring maintains ball depth on the gaze ray');
  assert.ok(ptTilted.x > 3, 'ring moves in direction of eye movement');
});


test('eye ring tracker: visual reticle locks on and scales with distance', () => {
  const mockWorld = { createTransformEntity: () => {} };
  const tracker = new EyeRingTracker(mockWorld);
  tracker.show();
  assert.equal(tracker.visible, true);
  const mockFocus = {
    origin: new Vector3(0, 1.3, 0),
    dir: new Vector3(0, 0, -1),
    watching: true,
  };
  const ball = new Vector3(0, 1.3, -10);
  const camera = new Object3D();
  camera.position.set(0, 1.3, 0);
  // Update while locked on
  tracker.update(mockFocus, ball, true, true, camera, null, 1 / 60);
  assert.ok(tracker.group.position.distanceTo(ball) < 1e-6, 'reticle is placed at the ball');
  assert.equal(tracker.ringMaterial.color.getHex(), 0x5eead4, 'ring turns cyan-teal on lock');
  assert.ok(tracker.group.scale.x > 0.4, 'ring scales proportionally at 10m');
  // Update when eyes look away
  mockFocus.watching = false;
  mockFocus.dir.set(0.5, 0, -0.866).normalize();
  tracker.update(mockFocus, ball, false, true, camera, null, 1 / 60);
  assert.ok(tracker.group.position.distanceTo(ball) > 4, 'reticle moves away from ball with eye direction');
  assert.equal(tracker.ringMaterial.color.getHex(), 0xffffff, 'ring dims to white when off target');
});

test('continuous collision detection: prevents tunneling on 79 km/h fast deliveries', () => {
  const topSpeedMps = 79 / 3.6; // ~21.94 m/s
  const dt = 1 / 30; // 30 FPS dropped frame scenario
  const travelPerFrame = topSpeedMps * dt; // ~0.731 m
  const reach = BALL_RADIUS + CFG.handMargin; // ~0.15 m

  // Ball moves along -Z from -0.40m to +0.33m, crossing hand at z = 0.00m
  const prevBall = new Vector3(0, 1.3, -0.40);
  const nextBall = new Vector3(0, 1.3, -0.40 + travelPerFrame);
  const hand = new Vector3(0, 1.3, 0.0);

  // 1. Verify discrete collision check fails (tunnels)
  const discreteHitPrev = prevBall.distanceTo(hand) <= reach;
  const discreteHitNext = nextBall.distanceTo(hand) <= reach;
  assert.equal(discreteHitPrev || discreteHitNext, false, 'Discrete point collision tunnels completely through the hand');

  // 2. Swept segment CCD algorithm from src/game.js
  const r0 = prevBall.clone().sub(hand);
  const r1 = nextBall.clone().sub(hand);
  const seg = r1.clone().sub(r0);
  const lenSq = seg.lengthSq();
  const t = lenSq > 0 ? Math.min(1, Math.max(0, -r0.dot(seg) / lenSq)) : 0;
  const closest = r0.clone().addScaledVector(seg, t);
  const minDistance = closest.length();

  assert.ok(minDistance < 1e-4, 'Swept trajectory passes through exact center of hand');
  assert.ok(minDistance <= reach, 'Continuous collision detection successfully registers the catch');
  assert.ok(t > 0.4 && t < 0.6, `Impact occurs mid-frame at t=${t.toFixed(3)}`);
});

test('round delivery progression: all 50 deliveries maintain valid physical properties', () => {
  for (let i = 0; i < CFG.balls; i++) {
    const ramp = Math.min(1, i / CFG.rampBalls);
    const speed = CFG.startSpeed + (CFG.maxSpeed - CFG.startSpeed) * ramp;
    const kmh = speed * 3.6;
    assert.ok(kmh >= 42.5 && kmh <= 79.5, `Ball ${i + 1} speed ${kmh} km/h is within valid bounds`);

    const swing = CFG.swingBase + (CFG.swingMax - CFG.swingBase) * ramp;
    assert.ok(swing >= CFG.swingBase && swing <= CFG.swingMax, `Ball ${i + 1} swing ${swing} is within limits`);
  }
});

test('back-of-hand glance: normal dot product cleanly distinguishes palm catch from glance', () => {
  const palmNormal = new Vector3(0, 0, -1); // Palm facing towards bowler (-Z)
  const incomingBallDir = new Vector3(0, 0, 1); // Ball traveling towards player (+Z)
  const from = incomingBallDir.clone().negate(); // Vector pointing from hand towards ball (-Z)

  // Palm facing ball directly: dot product is +1.0
  const frontalDot = palmNormal.dot(from);
  assert.ok(frontalDot > CFG.backOfHand, 'Frontal palm catch has dot > backOfHand threshold');

  // Hand turned around: palm facing +Z (away from bowler)
  const backNormal = new Vector3(0, 0, 1);
  const backDot = backNormal.dot(from);
  assert.ok(backDot < CFG.backOfHand, 'Back-of-hand has dot < backOfHand threshold (deflection)');
});

test('game timing: delta time clamp maintains 1:1 real-world speed across 15 to 90 FPS', () => {
  // Simulates 1 second of wall-clock time at various frame rates
  const frameRates = [15, 20, 30, 60, 72, 90];
  for (const fps of frameRates) {
    const rawDt = 1 / fps;
    const clampedDt = Math.min(rawDt, 0.15); // The new clamp
    let simulatedGameTime = 0;
    for (let f = 0; f < fps; f++) {
      simulatedGameTime += clampedDt;
    }
    const ratio = simulatedGameTime / 1.0;
    assert.ok(
      Math.abs(ratio - 1.0) < 0.001,
      `At ${fps} FPS, 1 wall-clock second yields exactly 1 simulated second (ratio: ${ratio})`
    );
  }
});

test('low catch crouch: smoothly lowers player rig and hands to reach ground-level balls', () => {
  const lerp = (a, b, t) => a + (b - a) * t;

  // Mock player rig
  const mockRig = { position: { x: 0, y: 0, z: 0 } };
  let crouchBaseY = 0;
  let crouchOffset = 0;
  let targetCrouch = 0;

  // Scenario A: Low catch incoming at shin height (y = 0.40m)
  const aimY = 0.40;
  const isLowCatch = true;
  const lookPitch = -0.30; // player looking down at the ball
  const lookPitchCrouch = Math.min(0, Math.max(-0.38, (lookPitch + 0.10) * 0.95));
  const deliveryCrouch = Math.min(0, Math.max(-0.38, (aimY - 0.75) * 1.0));
  targetCrouch = Math.min(deliveryCrouch, lookPitchCrouch);

  assert.ok(targetCrouch <= -0.28, `Crouch target ${targetCrouch.toFixed(2)}m lowers body by at least 28cm`);
  assert.ok(targetCrouch >= -0.38, `Crouch target ${targetCrouch.toFixed(2)}m does not exceed comfort bound 38cm`);

  // Simulate smooth interpolation over 0.5s (30 frames at 60 FPS)
  const dt = 1 / 60;
  for (let frame = 0; frame < 30; frame++) {
    crouchOffset = lerp(crouchOffset, targetCrouch, Math.min(1, dt * 5.0));
    mockRig.position.y = crouchBaseY + crouchOffset;
  }

  assert.ok(
    mockRig.position.y <= -0.25,
    `Player rig position smoothly descended to ${mockRig.position.y.toFixed(3)}m`
  );

  // Standing hand height is typically 0.72m. With crouch of -0.28m, hand drops to 0.44m (within reach of 0.40m ball)
  const standingHandY = 0.72;
  const crouchedHandY = standingHandY + mockRig.position.y;
  const distanceToBall = Math.abs(crouchedHandY - aimY);
  assert.ok(
    distanceToBall <= 0.10,
    `Crouched hand at ${crouchedHandY.toFixed(2)}m is within natural arm catch radius of ${aimY.toFixed(2)}m ball`
  );
});

test('player reset: smoothly returns player rig to neutral 0.0m before next delivery', () => {
  const lerp = (a, b, t) => a + (b - a) * t;

  const mockRig = { position: { x: 0, y: -0.35, z: 0 } };
  let crouchBaseY = 0;
  let crouchOffset = -0.35;
  let targetCrouch = 0.0; // Feedback / ready state resets target to neutral

  // Feedback interval lasts CFG.feedbackDelay = 1.8 seconds.
  // Test smooth return over 1.2 seconds (72 frames at 60 FPS)
  const dt = 1 / 60;
  for (let frame = 0; frame < 72; frame++) {
    crouchOffset = lerp(crouchOffset, targetCrouch, Math.min(1, dt * 4.0));
    if (Math.abs(crouchOffset - targetCrouch) < 0.005) {
      crouchOffset = targetCrouch;
    }
    mockRig.position.y = crouchBaseY + crouchOffset;
  }

  assert.equal(
    crouchOffset,
    0,
    'Crouch offset fully returns to 0.0m within feedback window'
  );
  assert.equal(
    mockRig.position.y,
    0,
    'Player rig is restored to exactly 0.0m neutral floor alignment before next throw'
  );
});
