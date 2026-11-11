// Hand pose + finger animation for the synthetic (mouse) hand, against the real module (src/hand-anim.js).
// A tracked headset hand is never animated by this code: its fingers come from the real joints.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Group, Quaternion, Vector3 } from '@iwsdk/core';
import { applyCurl, basisQuaternion, buildCurlRig, desiredHandPose, easePose, proximityOf } from '../src/hand-anim.js';

const V = (x, y, z) => new Vector3(x, y, z);
const newPose = () => ({ normal: V(0, 0, -1), fingers: V(0, 1, 0), openness: 0.8, gap: 0.3, proximity: 0 });
const HEAD = V(0, 1.6, 0);

function ask(over) {
  const out = newPose();
  desiredHandPose(
    { palm: V(0, 1.2, -0.65), head: HEAD, ballPos: V(0, 1.2, -10), ballVel: V(0, 0, 12), ballActive: true, holding: false, side: 'right', pair: false, ...over },
    out,
  );
  return out;
}

test('basis quaternion: the resting frame maps to itself, other frames map fingers and palm correctly', () => {
  for (const side of ['left', 'right']) {
    const q = basisQuaternion(V(0, 1, 0), V(0, 0, -1), side, new Quaternion());
    assert.ok(Math.abs(Math.abs(q.w) - 1) < 1e-9, `${side}: resting frame is identity`);
    // Fingers pointing at the player, palm up.
    const fingers = V(0, 0, 1);
    const normal = V(0, 1, 0);
    basisQuaternion(fingers, normal, side, q);
    assert.ok(V(0, 1, 0).applyQuaternion(q).distanceTo(fingers) < 1e-9, `${side}: model fingers axis -> fingers`);
    assert.ok(V(0, 0, -1).applyQuaternion(q).distanceTo(normal) < 1e-9, `${side}: model palm axis -> normal`);
    const thumb = V(side === 'left' ? 1 : -1, 0, 0).applyQuaternion(q);
    assert.ok(Math.abs(thumb.dot(fingers)) < 1e-9 && Math.abs(thumb.dot(normal)) < 1e-9, 'thumb stays across the hand');
  }
});

test('a faster ball starts preparing the hands sooner', () => {
  const slow = proximityOf(3, 8);
  const fast = proximityOf(3, 22);
  assert.ok(fast > slow);
  assert.equal(proximityOf(30, 22), 0);
  assert.equal(proximityOf(0, 8), 1);
});

test('hand relaxes open while the ball is far, and cups as it closes in', () => {
  const far = ask({ ballPos: V(0, 1.2, -17) });
  const mid = ask({ ballPos: V(0, 1.2, -3) });
  const near = ask({ ballPos: V(0, 1.2, -0.9) });
  assert.ok(far.openness > mid.openness && mid.openness > near.openness, `${far.openness} > ${mid.openness} > ${near.openness}`);
  assert.ok(near.openness >= 0.35, 'never clenched before the catch');
});

test('a fast ball wants the hand ready (more open) while it is still away', () => {
  const slow = ask({ ballPos: V(0, 1.2, -17), ballVel: V(0, 0, 8) });
  const fast = ask({ ballPos: V(0, 1.2, -17), ballVel: V(0, 0, 22) });
  assert.ok(fast.openness > slow.openness);
});

test('the palm turns to face the ball, within a comfortable limit', () => {
  const palm = V(0, 1.2, -0.65);
  const ball = V(0.25, 1.6, -2.6); // up and to the right
  const p = ask({ ballPos: ball });
  const toBall = ball.clone().sub(palm).normalize();
  assert.ok(p.normal.dot(toBall) > 0.99, 'faces the ball');
  const side = ask({ ballPos: V(3, 1.2, 0.6) }); // a ball behind-and-beside the palm: cannot turn that far
  assert.ok(side.normal.angleTo(V(0, 0, -1)) <= (70.5 * Math.PI) / 180);
});

test('closing in, two hands lean towards each other into a cup', () => {
  const l = ask({ side: 'left', pair: true, ballPos: V(0, 1.2, -1.0) });
  const r = ask({ side: 'right', pair: true, ballPos: V(0, 1.2, -1.0) });
  assert.ok(l.normal.x > 0.1, 'left palm leans right');
  assert.ok(r.normal.x < -0.1, 'right palm leans left');
  const single = ask({ side: 'right', pair: false, ballPos: V(0, 1.2, -1.0) });
  assert.ok(Math.abs(single.normal.x) < 1e-6);
});

test('the pair closes up as the ball nears, tighter still once it is held', () => {
  const far = ask({ pair: true, ballPos: V(0, 1.2, -15) });
  const near = ask({ pair: true, ballPos: V(0, 1.2, -0.9) });
  const held = ask({ pair: true, holding: true });
  assert.ok(far.gap > near.gap && near.gap > held.gap, `${far.gap} ${near.gap} ${held.gap}`);
});

test('fingers point up for a high or chest ball, and down for a low one', () => {
  const high = ask({ palm: V(0, 1.9, -0.65) });
  const chest = ask({ palm: V(0, 1.25, -0.65) });
  const low = ask({ palm: V(0, 0.45, -0.65) });
  assert.ok(high.fingers.y > 0.95);
  assert.ok(chest.fingers.y > 0.8);
  assert.ok(low.fingers.y < -0.9, `low fingers y ${low.fingers.y}`);
  for (const p of [high, chest, low]) assert.ok(Math.abs(p.fingers.dot(p.normal)) < 1e-6, 'fingers stay across the palm normal');
});

test('once the ball is caught the hand closes around it', () => {
  const held = ask({ holding: true });
  assert.ok(held.openness < 0.25);
});

test('pose easing is smooth and keeps the frame orthonormal', () => {
  const cur = newPose();
  const target = ask({ palm: V(0, 0.45, -0.65), ballPos: V(0.3, 0.5, -1.5) });
  let last = cur.normal.clone();
  for (let i = 0; i < 90; i++) {
    easePose(cur, target, 1 / 60, false);
    assert.ok(cur.normal.angleTo(last) < 0.2, 'no jumps');
    assert.ok(Math.abs(cur.normal.length() - 1) < 1e-9 && Math.abs(cur.fingers.length() - 1) < 1e-9);
    assert.ok(Math.abs(cur.fingers.dot(cur.normal)) < 1e-9);
    last = cur.normal.clone();
  }
  assert.ok(cur.normal.angleTo(target.normal) < 0.02);
});

// ---------- finger bones ----------

function finger(parentRot) {
  const root = new Group();
  root.rotation.set(...parentRot);
  const names = ['index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'];
  const lens = [0, 0.045, 0.028, 0.02];
  let parent = root;
  const objs = names.map((n, i) => {
    const o = new Group();
    o.name = n;
    o.position.set(0, lens[i], 0);
    parent.add(o);
    parent = o;
    return o;
  });
  root.updateMatrixWorld(true);
  return { root, objs };
}

for (const rot of [[0, 0, 0], [0.4, 0.9, -0.3], [Math.PI / 2, 0, 0.5]]) {
  test(`fingers bend towards the palm, and only as far as the openness says (parent rotated ${rot.map((x) => x.toFixed(1))})`, () => {
    const { root, objs } = finger(rot);
    const q = new Quaternion().setFromEuler(root.rotation);
    const palmOut = V(0, 0, 1).applyQuaternion(q); // the palm side
    const rig = buildCurlRig(root, palmOut);
    assert.equal(rig.bones.length, 3);
    const base = objs[0].getWorldPosition(V(0, 0, 0));
    const tipOf = () => {
      root.updateMatrixWorld(true);
      return objs[3].getWorldPosition(V(0, 0, 0));
    };
    applyCurl(rig, 1);
    const flat = tipOf();
    applyCurl(rig, 0.6);
    const half = tipOf();
    applyCurl(rig, 0);
    const fist = tipOf();
    assert.ok(half.clone().sub(flat).dot(palmOut) > 0.01, 'bends towards the palm');
    assert.ok(half.distanceTo(base) < flat.distanceTo(base), 'half closed is shorter in reach than flat');
    assert.ok(fist.distanceTo(base) < half.distanceTo(base) - 0.01, 'closes further as openness drops');
    assert.ok(fist.clone().sub(base).dot(palmOut) > 0, 'a closed finger is on the palm side');
    applyCurl(rig, 1);
    assert.ok(tipOf().distanceTo(flat) < 1e-9, 'fully open returns to the bind pose exactly');
  });
}

test('a rig with no matching bones, or applying no rig, does nothing and never throws', () => {
  const rig = buildCurlRig(new Group(), V(0, 0, 1));
  assert.equal(rig.bones.length, 0);
  applyCurl(rig, 0.3);
  applyCurl(null, 0.3);
});
