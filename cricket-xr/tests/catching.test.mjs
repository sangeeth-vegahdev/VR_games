// Catching rules, tested against the REAL module (src/catching.js) the game runs, not a copy.
// Each test flies a ball at posed hands frame by frame, exactly as the game does, and checks the outcome.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from '@iwsdk/core';
import {
  commitHand,
  createDecision,
  createHand,
  deflectVelocity,
  evaluateCatch,
  setHandFromJoints,
  setHandFromPose,
  setHandFromPoint,
  updateHandMotion,
} from '../src/catching.js';
import { CFG } from '../src/config.js';

const BALL_R = 0.08;
const V = (a) => new Vector3(a[0], a[1], a[2]);
const FWD = [0, 0, -1];
const UP = [0, 1, 0];

const SHOULDERS = { left: new Vector3(-0.18, 1.38, 0), right: new Vector3(0.18, 1.38, 0), axis: new Vector3(1, 0, 0) };

// spec: { palm, normal, fingers, open, vel } (palm = where it is when the ball arrives; vel = hand velocity m/s)
// ball: { x, y, speed, from (z), accel: [ax, ay, az] }
function run({ left = null, right = null, ball, fps = 60, tags = true }) {
  const hands = { left: createHand('left'), right: createHand('right') };
  const specs = { left, right };
  const dec = createDecision();
  const dt = 1 / fps;
  const b = { x: ball.x ?? 0, y: ball.y ?? 1.2, z: ball.from ?? -6 };
  const vel = new Vector3(ball.vx ?? 0, ball.vy ?? 0, ball.speed);
  const acc = V(ball.accel ?? [0, 0, 0]);
  const arrive = (-0.65 - b.z) / ball.speed; // when the ball reaches the catching plane
  const prev = new Vector3();
  const pos = new Vector3(b.x, b.y, b.z);
  let nearest = Infinity;
  for (let i = 0; i < 2000; i++) {
    const t = i * dt;
    for (const side of ['left', 'right']) {
      const sp = specs[side];
      const h = hands[side];
      if (!sp) {
        h.valid = false;
        h.prevOk = false;
        continue;
      }
      const v = sp.vel ? V(sp.vel) : new Vector3();
      const palm = V(sp.palm).addScaledVector(v, t - arrive);
      if (sp.point) setHandFromPoint(h, palm);
      else setHandFromPose(h, palm, V(sp.normal ?? FWD), V(sp.fingers ?? UP), sp.open ?? 0.75);
      updateHandMotion(h, dt);
    }
    prev.copy(pos);
    pos.x = b.x + vel.x * (t + dt) + 0.5 * acc.x * (t + dt) ** 2;
    pos.y = b.y + vel.y * (t + dt) + 0.5 * acc.y * (t + dt) ** 2;
    pos.z = b.z + vel.z * (t + dt) + 0.5 * acc.z * (t + dt) ** 2;
    const bv = new Vector3(vel.x + acc.x * (t + dt), vel.y + acc.y * (t + dt), vel.z + acc.z * (t + dt));
    evaluateCatch(hands.left, hands.right, prev, pos, bv, BALL_R, SHOULDERS, dec);
    nearest = Math.min(nearest, dec.gap);
    commitHand(hands.left);
    commitHand(hands.right);
    if (dec.outcome !== 'none') return { ...dec, tags: dec.tags.slice(), point: dec.point.clone(), hands, nearest, frames: i };
    if (pos.z > 0.2) return { outcome: 'miss', tags: [], hands, nearest, frames: i };
  }
  throw new Error('ball never resolved');
}

const chest = (x, extra = {}) => ({ palm: [x, 1.2, -0.65], ...extra });

// ---------- two-handed ----------

test('slow ball, two hands close together: a two-handed catch', () => {
  const r = run({ left: chest(-0.09), right: chest(0.09), ball: { speed: 8 } });
  assert.equal(r.outcome, 'catch');
  assert.equal(r.twoHand, true);
});

test('fast ball (79 km/h), two hands: caught, not passed through', () => {
  for (const fps of [90, 72, 60, 30, 15]) {
    const r = run({ left: chest(-0.09), right: chest(0.09), ball: { speed: 22 }, fps });
    assert.equal(r.outcome, 'catch', `at ${fps} fps`);
    assert.equal(r.twoHand, true, `at ${fps} fps`);
    assert.ok(r.tags.includes('fast'), 'a fast catch is named as one');
  }
});

test('hands cupped face to face with the ball dropping into the slot between them: a catch, not a glance', () => {
  const r = run({
    left: chest(-0.11, { normal: [1, 0, 0] }),
    right: chest(0.11, { normal: [-1, 0, 0] }),
    ball: { speed: 10 },
  });
  assert.equal(r.outcome, 'catch');
  assert.equal(r.twoHand, true);
});

test('ball passing between two hands held wide apart is a miss', () => {
  const r = run({ left: chest(-0.38), right: chest(0.38), ball: { speed: 10 } });
  assert.equal(r.outcome, 'miss');
});

test('hands too wide for a cup do not get the cup bonus', () => {
  // gap 0.34 > twoHandGap: the ball in the exact middle is 0.17 from each palm, beyond palm + ball.
  assert.ok(0.44 > CFG.twoHandGap);
  const r = run({ left: chest(-0.22), right: chest(0.22), ball: { speed: 10 } });
  assert.equal(r.outcome, 'miss');
});

test('the left hand alone can still make contact while the right is parked: not forced into a pair', () => {
  const r = run({ left: chest(0.0), right: chest(0.6), ball: { speed: 10 } });
  assert.equal(r.outcome, 'catch');
  assert.equal(r.twoHand, false);
  assert.equal(r.side, 'left');
});

// ---------- cups: high and low ----------

test('high catch: fingers up, thumbs together = reverse cup', () => {
  const y = 1.95;
  const r = run({ left: { palm: [-0.09, y, -0.65] }, right: { palm: [0.09, y, -0.65] }, ball: { speed: 9, y } });
  assert.equal(r.outcome, 'catch');
  assert.equal(r.twoHand, true);
  assert.equal(r.technique, 'reverse-cup');
  assert.ok(r.tags.includes('high'));
});

test('low catch: fingers down, little fingers together = orthodox cup', () => {
  const y = 0.45;
  const down = { fingers: [0, -1, 0] };
  const r = run({ left: { palm: [-0.09, y, -0.65], ...down }, right: { palm: [0.09, y, -0.65], ...down }, ball: { speed: 9, y } });
  assert.equal(r.outcome, 'catch');
  assert.equal(r.twoHand, true);
  assert.equal(r.technique, 'orthodox-cup');
  assert.ok(r.tags.includes('low'));
});

test('fingers up is not an orthodox cup, and fingers down is not a reverse cup', () => {
  const up = run({ left: chest(-0.09), right: chest(0.09), ball: { speed: 8 } });
  assert.notEqual(up.technique, 'orthodox-cup');
  const down = { fingers: [0, -1, 0] };
  const dn = run({ left: chest(-0.09, down), right: chest(0.09, down), ball: { speed: 8 } });
  assert.notEqual(dn.technique, 'reverse-cup');
});

// ---------- one hand ----------

test('right hand catch', () => {
  const r = run({ right: chest(0.0), ball: { speed: 10 } });
  assert.equal(r.outcome, 'catch');
  assert.equal(r.side, 'right');
  assert.equal(r.twoHand, false);
});

test('left hand catch', () => {
  const r = run({ left: chest(0.0), ball: { speed: 10 } });
  assert.equal(r.outcome, 'catch');
  assert.equal(r.side, 'left');
  assert.equal(r.twoHand, false);
});

test('one-hand high catch: fingers up, named as a high one-hander', () => {
  const y = 1.95;
  const r = run({ right: { palm: [0, y, -0.65] }, ball: { speed: 9, y } });
  assert.equal(r.outcome, 'catch');
  assert.equal(r.technique, 'one-hand-high');
});

test('one-hand low catch: fingers down', () => {
  const y = 0.45;
  const r = run({ left: { palm: [0, y, -0.65], fingers: [0, -1, 0] }, ball: { speed: 9, y } });
  assert.equal(r.outcome, 'catch');
  assert.equal(r.technique, 'one-hand-low');
});

test('palm-up scoop: fingers forward, palm up, ball dropping on to it', () => {
  // A ball falling onto an upturned palm.
  const r = run({
    right: { palm: [0, 0.9, -0.65], normal: [0, 1, 0], fingers: [0, 0, -1] },
    ball: { x: 0, y: 1.6, from: -0.65, speed: 0.0001, vy: -4, accel: [0, 0, 0] },
    fps: 60,
  });
  assert.equal(r.outcome, 'catch');
  assert.equal(r.technique, 'one-hand-scoop');
});

test('wide ball outside two-hand reach: caught one-handed at full stretch', () => {
  const x = 0.76;
  const r = run({ right: { palm: [x, 1.2, -0.65] }, left: chest(-0.3), ball: { x, speed: 11 } });
  assert.equal(r.outcome, 'catch');
  assert.equal(r.twoHand, false);
  assert.equal(r.side, 'right');
  assert.ok(r.tags.includes('stretch'), `tags: ${r.tags}`);
});

test('a ball that swings late is still caught by a hand placed where it ends up', () => {
  const r = run({ right: { palm: [0.3, 1.2, -0.65] }, ball: { x: 0.1, speed: 14, accel: [1.6, 0, 0] } });
  assert.equal(r.outcome, 'catch');
});

// ---------- moving hands ----------

test('catching on the move: hand travelling with the ball gives soft hands', () => {
  // The hand retreats (+z, the way the ball is going) at 2 m/s as it takes the ball.
  const r = run({ right: { palm: [0, 1.2, -0.65], vel: [0, 0, 2] }, ball: { speed: 14 } });
  assert.equal(r.outcome, 'catch');
  assert.ok(r.tags.includes('soft'), `tags: ${r.tags}`);
  assert.ok(r.tags.includes('moving'), `tags: ${r.tags}`);
  assert.ok(r.relSpeed < 14, 'the hand moving with the ball takes pace off it');
});

test('a hand sweeping sideways through the ball path still catches', () => {
  const r = run({ right: { palm: [0.0, 1.2, -0.65], vel: [1.5, 0, 0] }, ball: { speed: 12 } });
  assert.equal(r.outcome, 'catch');
  assert.ok(r.tags.includes('moving'));
});

// ---------- things that must NOT be catches ----------

test('back of the hand: a deflection, never a catch', () => {
  const r = run({ right: chest(0.0, { normal: [0, 0, 1] }), ball: { speed: 10 } });
  assert.equal(r.outcome, 'deflect');
  assert.equal(r.reason, 'back');
});

test('back of the hand at 79 km/h and low frame rate: still a deflection', () => {
  for (const fps of [72, 30, 15]) {
    const r = run({ right: chest(0.0, { normal: [0, 0, 1] }), ball: { speed: 22 }, fps });
    assert.equal(r.outcome, 'deflect', `fps ${fps}`);
    assert.equal(r.reason, 'back', `fps ${fps}`);
  }
});

test('the wrist and forearm do not catch: ball hits them first when the fingers point at the player', () => {
  const r = run({ right: { palm: [0, 1.2, -0.65], normal: [0, 1, 0], fingers: [0, 0, 1] }, ball: { speed: 10 } });
  assert.equal(r.outcome, 'deflect');
  assert.equal(r.reason, 'wrist');
});

test('edge-on hand (palm turned to the side) is forgiving: fingers still close on the ball', () => {
  const r = run({ right: chest(0.0, { normal: [1, 0, 0] }), ball: { speed: 10 } });
  assert.equal(r.outcome, 'catch');
});

test('a clenched fist cannot catch', () => {
  const r = run({ right: chest(0.0, { open: 0 }), ball: { speed: 10 } });
  assert.equal(r.outcome, 'deflect');
  assert.equal(r.reason, 'fist');
});

test('a ball that only grazes past well clear of the hand is a miss, not a catch', () => {
  const r = run({ right: chest(0.0), ball: { x: 0.34, speed: 10 } });
  assert.equal(r.outcome, 'miss');
  assert.ok(r.nearest > 0, 'it never touched the hand');
});

test('a hand held far from the ball path is a miss', () => {
  const r = run({ right: chest(0.0, {}), ball: { x: -0.7, speed: 10 } });
  assert.equal(r.outcome, 'miss');
});

test('with no hands tracked nothing is ever caught', () => {
  const r = run({ ball: { speed: 10 } });
  assert.equal(r.outcome, 'miss');
});

test('controller grip (position only, no palm direction) falls back to a round contact volume', () => {
  const r = run({ right: { palm: [0, 1.2, -0.65], point: true }, ball: { speed: 10 } });
  assert.equal(r.outcome, 'catch');
  assert.equal(r.twoHand, false);
});

test('a ball hitting the back of one hand is not rescued by the other hand being nearby', () => {
  // Right hand turned back-to-ball, left hand beside it open to the ball but out of the ball's path.
  const r = run({ right: chest(0.0, { normal: [0, 0, 1] }), left: chest(-0.3), ball: { speed: 10 } });
  assert.equal(r.outcome, 'deflect');
  assert.equal(r.reason, 'back');
});

// ---------- no tunnelling ----------

test('no tunnelling: the ball is caught at every frame rate and speed across the whole round', () => {
  for (const fps of [90, 72, 60, 45, 30, 20, 15]) {
    for (const speed of [8, 12, 17, 22, 24]) {
      for (const x of [-0.3, -0.1, 0, 0.2]) {
        const r = run({ right: chest(x), ball: { x, speed }, fps });
        assert.equal(r.outcome, 'catch', `fps ${fps}, ${speed} m/s, x ${x}`);
      }
    }
  }
});

test('no tunnelling for a fast hand either: a swatting hand at 6 m/s through a ball catches or deflects, never passes', () => {
  const r = run({ right: { palm: [0, 1.2, -0.65], vel: [0, 0, -6] }, ball: { speed: 20 }, fps: 15 });
  assert.notEqual(r.outcome, 'miss');
});

// ---------- hand reading ----------

function joints(side, mirror = 1, up = true) {
  // A right-hand layout: fingers +y, index side towards -x, so the palm faces -z. Left is the mirror image.
  const m = side === 'left' ? -1 : 1;
  const p = (x, y, z) => new Vector3(x * m * mirror, y, z);
  return {
    wrist: p(0, 1.15, -0.4),
    middleProx: p(0, 1.25, -0.4),
    indexMeta: p(-0.03, 1.2, -0.4),
    pinkyMeta: p(0.03, 1.19, -0.4),
    middleTip: p(0, 1.37, -0.4),
    indexTip: p(-0.03, 1.35, -0.4),
    pinkyTip: p(0.04, 1.32, -0.4),
    thumbTip: p(-0.08, 1.27, -0.4),
  };
}

test('palm direction is read correctly for both hands: both palms face away from the player (-z)', () => {
  for (const side of ['left', 'right']) {
    const h = createHand(side);
    assert.ok(setHandFromJoints(h, joints(side)));
    assert.ok(h.normal.dot(new Vector3(0, 0, -1)) > 0.99, `${side} normal ${h.normal.toArray()}`);
    assert.ok(h.fingers.y > 0.99);
    assert.equal(h.hasNormal, true);
    assert.equal(h.valid, true);
  }
});

test('the thumb side is on opposite sides for the two hands', () => {
  const l = createHand('left');
  const r = createHand('right');
  setHandFromJoints(l, joints('left'));
  setHandFromJoints(r, joints('right'));
  assert.ok(l.across.x > 0.9 && r.across.x < -0.9, `${l.across.x} ${r.across.x}`);
});

test('invalid, collapsed or non-finite joints are rejected safely, leaving the hand untracked', () => {
  const h = createHand('right');
  const bad = joints('right');
  bad.middleProx.copy(bad.wrist); // collapsed hand
  assert.equal(setHandFromJoints(h, bad), false);
  assert.equal(h.valid, false);
  const nan = joints('right');
  nan.wrist.x = NaN;
  assert.equal(setHandFromJoints(h, nan), false);
  assert.equal(h.valid, false);
  assert.equal(setHandFromJoints(h, { wrist: new Vector3() }), false);
  assert.equal(setHandFromJoints(h, null), false);
});

test('missing optional joints (no tips) still gives a usable palm and shape', () => {
  const h = createHand('right');
  const j = joints('right');
  delete j.middleTip;
  delete j.indexTip;
  delete j.pinkyTip;
  delete j.thumbTip;
  assert.ok(setHandFromJoints(h, j));
  assert.equal(h.hasNormal, true);
  assert.equal(h.hasJoints, false);
  assert.equal(h.fist, false, 'without tip joints the hand is never called a fist');
});

test('a tracked hand dropping out mid-flight is never a catch while untracked, and catches again on return', () => {
  const hands = { left: createHand('left'), right: createHand('right') };
  const dec = createDecision();
  const dt = 1 / 72;
  const pos = new Vector3(0.6, 1.2, -9);
  const prev = new Vector3();
  const vel = new Vector3(0, 0, 10);
  let outcomeDuringDropout = 'none';
  let final = 'none';
  for (let i = 0; i < 400 && pos.z < 0; i++) {
    prev.copy(pos);
    pos.addScaledVector(vel, dt);
    // Tracked far from the ball, lost for frames 10-20, then back under the ball's path (a 0.9 m jump).
    const tracked = i < 10 || i > 20;
    if (tracked) {
      setHandFromPose(hands.right, new Vector3(i > 20 ? 0.6 : -0.3, 1.2, -0.65), new Vector3(0, 0, -1), new Vector3(0, 1, 0), 0.75);
      updateHandMotion(hands.right, dt);
    } else {
      hands.right.valid = false;
      hands.right.prevOk = false;
    }
    evaluateCatch(hands.left, hands.right, prev, pos, vel, BALL_R, SHOULDERS, dec);
    commitHand(hands.right);
    if (i >= 10 && i <= 20) outcomeDuringDropout = dec.outcome;
    if (i === 21) assert.ok(hands.right.vel.length() < 1e-9, 'the jump on return is not turned into a hand velocity');
    if (dec.outcome !== 'none') {
      final = dec.outcome;
      break;
    }
  }
  assert.equal(outcomeDuringDropout, 'none');
  assert.equal(final, 'catch');
});

// ---------- deflection physics ----------

test('deflected ball bounces away from the hand and loses most of its pace', () => {
  const v = new Vector3(0, 0, 20);
  const out = new Vector3();
  deflectVelocity(v, new Vector3(), new Vector3(0, 0, 1), out); // normal back towards the bowler... ball hit a surface facing +z
  // ball travelling +z into a surface whose outward normal is -z: reflect
  deflectVelocity(v, new Vector3(), new Vector3(0, 0, -1), out);
  assert.ok(out.z < 0, 'comes back towards the bowler');
  assert.ok(out.length() < 0.5 * v.length(), 'most of the pace is lost');
});

test('a ball already moving away from the surface is not pushed back into it', () => {
  const v = new Vector3(0, 0, -5);
  const out = new Vector3();
  deflectVelocity(v, new Vector3(), new Vector3(0, 0, -1), out);
  assert.ok(out.z <= 0);
});

test('catch decision quality: a square, centred catch scores higher than a glancing finger catch', () => {
  const centred = run({ right: chest(0.0), ball: { speed: 10 } });
  const fingers = run({ right: chest(0.0, { fingers: [0, 1, 0] }), ball: { x: 0, y: 1.2 + 0.2, speed: 10 } });
  assert.equal(centred.outcome, 'catch');
  assert.ok(centred.quality > 0.5);
  if (fingers.outcome === 'catch') assert.ok(fingers.quality <= centred.quality + 1e-9);
});

test('a plain chest-level catch is not labelled high, low or stretch', () => {
  const two = run({ left: chest(-0.09), right: chest(0.09), ball: { speed: 10 } });
  assert.deepEqual(two.tags.filter((t) => ['high', 'low', 'stretch'].includes(t)), []);
  const one = run({ right: chest(0.12), ball: { x: 0.12, speed: 10 } });
  assert.deepEqual(one.tags.filter((t) => ['high', 'low', 'stretch'].includes(t)), []);
});

test('reaching across the body with the wrong hand is a stretch; the same spot with the near hand is not', () => {
  const across = run({ left: chest(0.35), ball: { x: 0.35, speed: 10 } });
  assert.ok(across.tags.includes('stretch'), `tags ${across.tags}`);
  const near = run({ right: chest(0.35), ball: { x: 0.35, speed: 10 } });
  assert.ok(!near.tags.includes('stretch'), `tags ${near.tags}`);
});
