import { Matrix4, Quaternion, Vector3 } from '@iwsdk/core';

// Pose and finger animation for the SYNTHETIC hand (the mouse hand on a PC). A tracked headset hand
// is never touched by this: its fingers always come from the real joints. Here the hand has no
// player behind it, so it reacts to the ball the way a fielder's hands do: palms turn to face the
// ball, the fingers curl into a cup as it nears (sooner for a fast ball), the thumb swings across,
// and the hand closes around the ball once it is caught.

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const UP = new Vector3(0, 1, 0);
const FWD = new Vector3(0, 0, -1);
const _t = new Vector3();
const _u = new Vector3();
const _m = new Matrix4();
const _m0 = new Matrix4();
const _x = new Vector3();

// 0..1: how close the ball is to arriving. A faster ball starts the hands' preparation earlier.
export function proximityOf(dist, speed) {
  const window = 2.5 + 0.18 * speed;
  return clamp(1 - dist / window, 0, 1);
}

// The pose a fielder's hand wants right now. `out`: { normal, fingers, openness, gap, proximity }.
// ctx: { palm, head, ballPos, ballVel, ballActive, holding, side, pair }
//   side: 'left' | 'right'; pair: both hands are in use (they close towards each other as one cup).
export function desiredHandPose(ctx, out) {
  const { palm, head, ballPos, ballVel, ballActive, holding, side, pair } = ctx;
  out.normal.copy(FWD);
  out.proximity = 0;
  let speed = 0;
  if (ballActive && ballPos) {
    _t.subVectors(ballPos, palm);
    const dist = _t.length();
    speed = ballVel ? ballVel.length() : 0;
    out.proximity = proximityOf(dist, speed);
    if (dist > 1e-3) {
      _t.divideScalar(dist);
      // Face the ball, but never turn the palm further than a hand can comfortably go.
      const ang = Math.acos(clamp(_t.dot(FWD), -1, 1));
      const maxAng = (70 * Math.PI) / 180;
      if (ang > maxAng) {
        _u.crossVectors(FWD, _t).normalize();
        out.normal.copy(FWD).applyAxisAngle(_u, maxAng);
      } else {
        out.normal.copy(_t);
      }
    }
  }
  // Two hands make one cup: each palm leans in towards the other.
  if (pair) out.normal.x += (side === 'left' ? 1 : -1) * 0.5 * out.proximity;
  out.normal.normalize();

  // Fingers: up for a high or chest ball, sweeping round to point down for a low one.
  const rel = palm.y - head.y;
  const t = smoothstep(-0.25, -0.9, rel);
  _u.copy(UP).addScaledVector(out.normal, -UP.dot(out.normal));
  if (_u.lengthSq() < 1e-6) _u.set(0, 0, 1);
  _u.normalize();
  out.fingers.copy(_u).applyAxisAngle(out.normal, (side === 'right' ? -1 : 1) * Math.PI * t);

  // Open and relaxed while waiting; cupped as the ball closes in; a fast ball wants the hand ready sooner.
  const ready = clamp(speed / 20, 0, 1) * 0.1;
  out.openness = holding ? 0.18 : clamp(0.8 - 0.3 * out.proximity + ready * (1 - out.proximity), 0.35, 0.9);
  out.gap = holding ? 0.09 : 0.32 - 0.2 * out.proximity;
  return out;
}

// Eases a pose towards its target. Pose: { normal, fingers, openness, gap }.
export function easePose(cur, target, dt, closing) {
  const k = 1 - Math.exp(-dt * 12);
  cur.normal.lerp(target.normal, k).normalize();
  cur.fingers.lerp(target.fingers, k);
  cur.fingers.addScaledVector(cur.normal, -cur.fingers.dot(cur.normal));
  if (cur.fingers.lengthSq() < 1e-8) cur.fingers.copy(target.fingers);
  cur.fingers.normalize();
  const ko = 1 - Math.exp(-dt * (closing ? 22 : 10));
  cur.openness += (target.openness - cur.openness) * ko;
  cur.gap += (target.gap - cur.gap) * (1 - Math.exp(-dt * 8));
  return cur;
}

// Quaternion taking the model's resting frame (fingers up, palm facing the coach, thumb to -x for a
// right hand, +x for a left hand) to the frame described by (fingers, normal).
export function basisQuaternion(fingers, normal, side, out) {
  // across (towards the thumb) = fingers x normal for a right hand, mirrored for a left hand.
  _x.crossVectors(fingers, normal);
  if (side === 'left') _x.negate();
  const across0 = side === 'left' ? 1 : -1;
  _m0.makeBasis(_t.set(across0, 0, 0), UP, FWD);
  _m.makeBasis(_x, fingers, normal);
  // Both bases are orthonormal (same handedness), so R = B1 * B0^T is a rotation.
  _m.multiply(_m0.transpose());
  return out.setFromRotationMatrix(_m);
}

// ---------- finger bones ----------
const FINGERS = {
  index: { bones: ['index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal'], w: [0.85, 1.0, 0.6] },
  middle: { bones: ['middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal'], w: [0.9, 1.05, 0.65] },
  ring: { bones: ['ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal'], w: [0.95, 1.1, 0.65] },
  pinky: { bones: ['pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal'], w: [1.0, 1.15, 0.7] },
  thumb: { bones: ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal'], w: [0.3, 0.55, 0.5] },
};
const MAX_CURL = 1.55; // radians per unit weight when the hand is fully closed

const _pq = new Quaternion();
const _wp = new Vector3();
const _cp = new Vector3();

// Reads the model's bind pose and, for each finger bone, the rotation axis (in its parent's frame)
// that bends it towards the palm. `palmOut` is the palm's outward direction in the model's world frame.
// The model must be at its bind pose with up-to-date world matrices.
export function buildCurlRig(root, palmOut) {
  const bones = [];
  for (const name of Object.keys(FINGERS)) {
    const f = FINGERS[name];
    f.bones.forEach((boneName, i) => {
      const obj = root.getObjectByName(boneName);
      if (!obj) return;
      // Direction the bone points: towards its child joint (or the same as its parent if it is the last).
      const child = obj.children.find((c) => c.isBone || c.name) || null;
      obj.getWorldPosition(_wp);
      if (child) child.getWorldPosition(_cp);
      else _cp.copy(_wp);
      const dir = _cp.sub(_wp);
      if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0);
      dir.normalize();
      const axis = new Vector3().crossVectors(dir, palmOut);
      if (axis.lengthSq() < 1e-8) return;
      axis.normalize();
      // Into the parent's frame.
      if (obj.parent) {
        obj.parent.getWorldQuaternion(_pq);
        axis.applyQuaternion(_pq.invert());
      }
      bones.push({ obj, bind: obj.quaternion.clone(), axis, weight: f.w[i], thumb: name === 'thumb' });
    });
  }
  return { bones, q: new Quaternion() };
}

// Bends the finger bones for an openness of 1 (flat) down to 0 (clenched around the ball).
export function applyCurl(rig, openness) {
  if (!rig) return;
  const c = (1 - clamp(openness, 0, 1)) * MAX_CURL;
  for (const b of rig.bones) {
    rig.q.setFromAxisAngle(b.axis, c * b.weight);
    b.obj.quaternion.copy(rig.q).multiply(b.bind);
  }
}
