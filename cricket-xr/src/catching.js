import { Vector3 } from '@iwsdk/core';
import { CFG } from './config.js';

// Catching rules, free of any rendering: they take hand poses and a ball path, and decide what
// happened. The game calls these every frame, and the tests call exactly the same code.
//
// A hand is modelled as capsules (a line segment with a radius): the palm, three fingers, the
// thumb, and the forearm. The ball is swept through them as a moving sphere, in the hand's own
// moving frame, so a fast ball or a fast hand cannot pass through (no tunnelling at any frame rate).
// The first thing the ball touches decides the outcome:
//   palm or fingers, ball on the palm side, moving into the palm  -> a catch
//   back of the hand / back of the fingers                        -> deflection ('back')
//   wrist or forearm                                              -> deflection ('wrist')
//   edge-on to the palm, or a finger jam                          -> deflection ('edge')
//   a clenched fist (knuckles)                                    -> deflection ('fist')
// Two hands that are close and both face the ball make a cup: the ball only has to reach the pocket
// between them, and it counts as a two-handed catch.

// ---------- small allocation-free geometry helpers ----------
const _p = new Vector3();
const _q = new Vector3();
const _d1 = new Vector3();
const _d2 = new Vector3();
const _r = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _R0 = new Vector3();
const _R1 = new Vector3();
const _pt = new Vector3();
const _w = new Vector3();
const _v = new Vector3();

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// Closest points of segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9).
// Returns squared distance; sets seg.s (along 1) and seg.t (along 2).
const seg = { s: 0, t: 0 };
function segSegDist2(p1, q1, p2, q2) {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.lengthSq();
  const e = _d2.lengthSq();
  const f = _d2.dot(_r);
  let s;
  let t;
  const EPS = 1e-12;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = _d1.dot(_r);
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom > EPS ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  seg.s = s;
  seg.t = t;
  _p.copy(p1).addScaledVector(_d1, s);
  _q.copy(p2).addScaledVector(_d2, t);
  return _p.distanceToSquared(_q);
}

function pointSegDist(p, a, b) {
  _w.subVectors(b, a);
  const l2 = _w.lengthSq();
  const t = l2 > 1e-12 ? clamp(_v.subVectors(p, a).dot(_w) / l2, 0, 1) : 0;
  _v.copy(a).addScaledVector(_w, t);
  return _v.distanceTo(p);
}

// ---------- hand model ----------
const CAPS = ['forearm', 'palm', 'index', 'middle', 'pinky', 'thumb'];

export function createHand(side) {
  const cap = (kind) => ({ kind, a: new Vector3(), b: new Vector3(), r: 0.03 });
  return {
    side,
    valid: false, // is this hand tracked this frame at all?
    hasNormal: false, // is the palm direction known (joints or a posed hand)? controllers: false
    hasJoints: false,
    wrist: new Vector3(),
    palm: new Vector3(),
    normal: new Vector3(0, 0, -1), // out of the palm
    fingers: new Vector3(0, 1, 0), // wrist -> knuckles
    across: side === 'left' ? new Vector3(1, 0, 0) : new Vector3(-1, 0, 0), // towards the thumb side
    tips: { index: new Vector3(), middle: new Vector3(), pinky: new Vector3(), thumb: new Vector3() },
    knuckles: { index: new Vector3(), middle: new Vector3(), pinky: new Vector3(), thumb: new Vector3() },
    openness: 1, // 1 = flat open hand, 0 = clenched fist
    fist: false,
    vel: new Vector3(),
    prevPalm: new Vector3(),
    prevOk: false,
    caps: CAPS.map(cap),
    capCount: CAPS.length,
  };
}

// Finishes a hand after its joint positions are set: capsules, openness, fist.
function buildShape(h) {
  const { fingers, across, palm, wrist, tips, knuckles } = h;
  if (!h.hasNormal) {
    // A bare position (a controller or a plain point): one round volume, no facing information.
    h.capCount = 1;
    const c = h.caps[0];
    c.kind = 'palm';
    c.a.copy(palm);
    c.b.copy(palm);
    c.r = CFG.handMargin;
    h.openness = 1;
    h.fist = false;
    return;
  }
  h.capCount = CAPS.length;
  const fore = h.caps[0];
  fore.kind = 'forearm';
  fore.a.copy(wrist);
  fore.b.copy(wrist).addScaledVector(fingers, -0.22);
  fore.r = CFG.forearmRadius;
  const pm = h.caps[1];
  pm.kind = 'palm';
  pm.a.copy(palm).addScaledVector(fingers, -0.045);
  pm.b.copy(palm).addScaledVector(fingers, 0.03);
  pm.r = CFG.palmRadius;
  const fingerCaps = [
    ['index', 2],
    ['middle', 3],
    ['pinky', 4],
  ];
  for (const [name, i] of fingerCaps) {
    const c = h.caps[i];
    c.kind = 'finger';
    c.a.copy(knuckles[name]);
    c.b.copy(tips[name]);
    c.r = CFG.fingerRadius;
  }
  const th = h.caps[5];
  th.kind = 'thumb';
  th.a.copy(knuckles.thumb);
  th.b.copy(tips.thumb);
  th.r = CFG.thumbRadius;

  // How open is the hand? Mean fingertip distance from the palm: ~0.11 m flat, ~0.035 m clenched.
  const mean = (palm.distanceTo(tips.index) + palm.distanceTo(tips.middle) + palm.distanceTo(tips.pinky)) / 3;
  h.openness = clamp((mean - 0.035) / (0.11 - 0.035), 0, 1);
  h.fist = h.hasJoints && h.openness < CFG.fistOpenness;
}

// Builds the hand from tracked joint positions (world space). `J` holds Vector3s; the optional ones
// fall back to proportions of the hand. Returns false (leaving the hand invalid) if the joints
// are missing, non-finite, or collapsed.
export function setHandFromJoints(h, J) {
  const need = J && J.wrist && J.middleProx && J.indexMeta && J.pinkyMeta;
  if (!need) return false;
  for (const v of [J.wrist, J.middleProx, J.indexMeta, J.pinkyMeta]) {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return false;
  }
  h.wrist.copy(J.wrist);
  _a.subVectors(J.middleProx, J.wrist);
  if (_a.lengthSq() < 1e-6) return false; // collapsed hand (tracking glitch)
  h.fingers.copy(_a).normalize();
  _b.subVectors(J.indexMeta, J.pinkyMeta);
  _b.addScaledVector(h.fingers, -_b.dot(h.fingers));
  if (_b.lengthSq() < 1e-8) return false;
  h.across.copy(_b).normalize(); // index side: the thumb is that way
  // For a right hand, across x fingers points out of the palm; a left hand is its mirror image.
  h.normal.crossVectors(h.across, h.fingers).normalize();
  if (h.side === 'left') h.normal.negate();
  h.palm.copy(J.wrist).lerp(J.middleProx, 0.55).addScaledVector(h.normal, 0.012);
  const t = h.tips;
  const k = h.knuckles;
  k.middle.copy(J.middleProx);
  if (J.indexProx) k.index.copy(J.indexProx);
  else k.index.copy(J.middleProx).addScaledVector(h.across, 0.026);
  if (J.pinkyProx) k.pinky.copy(J.pinkyProx);
  else k.pinky.copy(J.middleProx).addScaledVector(h.across, -0.036);
  if (J.thumbProx) k.thumb.copy(J.thumbProx);
  else k.thumb.copy(h.palm).addScaledVector(h.across, 0.035).addScaledVector(h.fingers, -0.02);
  if (J.middleTip) t.middle.copy(J.middleTip);
  else t.middle.copy(k.middle).addScaledVector(h.fingers, 0.065);
  if (J.indexTip) t.index.copy(J.indexTip);
  else t.index.copy(k.index).addScaledVector(h.fingers, 0.06);
  if (J.pinkyTip) t.pinky.copy(J.pinkyTip);
  else t.pinky.copy(k.pinky).addScaledVector(h.fingers, 0.05);
  if (J.thumbTip) t.thumb.copy(J.thumbTip);
  else t.thumb.copy(k.thumb).addScaledVector(h.across, 0.03).addScaledVector(h.fingers, 0.04);
  h.hasNormal = true;
  h.hasJoints = !!(J.middleTip && J.indexTip && J.pinkyTip && J.thumbTip);
  h.valid = true;
  buildShape(h);
  return true;
}

// Builds a hand from a pose instead of joints (the desktop mouse hand, and the tests):
// where the palm is, the way it faces, where the fingers point, and how open it is.
export function setHandFromPose(h, palm, normal, fingers, openness = 0.7) {
  h.palm.copy(palm);
  h.normal.copy(normal).normalize();
  // Make fingers exactly perpendicular to the normal.
  h.fingers.copy(fingers).addScaledVector(h.normal, -fingers.dot(h.normal)).normalize();
  // across: towards the thumb. right hand: across x fingers = normal  =>  across = fingers x normal.
  h.across.crossVectors(h.fingers, h.normal);
  if (h.side === 'left') h.across.negate();
  h.wrist.copy(palm).addScaledVector(h.fingers, -0.055).addScaledVector(h.normal, -0.012);
  const o = clamp(openness, 0, 1);
  const u = 1 - o; // 0 = flat hand, 1 = fist
  // A finger is three bones that curl towards the palm: knuckle ~90 deg, middle ~100, tip ~70 when clenched.
  const fingerTip = (out, knuckle, l1, l2, l3) => {
    const a1 = u * 1.57;
    const a2 = a1 + u * 1.75;
    const a3 = a2 + u * 1.2;
    out.copy(knuckle);
    for (const [len, a] of [[l1, a1], [l2, a2], [l3, a3]]) {
      out.addScaledVector(h.fingers, Math.cos(a) * len).addScaledVector(h.normal, Math.sin(a) * len);
    }
  };
  const k = h.knuckles;
  const t = h.tips;
  k.middle.copy(palm).addScaledVector(h.fingers, 0.03);
  k.index.copy(k.middle).addScaledVector(h.across, 0.026);
  k.pinky.copy(k.middle).addScaledVector(h.across, -0.036);
  k.thumb.copy(palm).addScaledVector(h.across, 0.035).addScaledVector(h.fingers, -0.02);
  fingerTip(t.middle, k.middle, 0.047, 0.03, 0.02);
  fingerTip(t.index, k.index, 0.043, 0.027, 0.019);
  fingerTip(t.pinky, k.pinky, 0.033, 0.02, 0.017);
  // The thumb swings across the palm as the hand closes.
  t.thumb.copy(k.thumb)
    .addScaledVector(h.fingers, 0.04 * (0.4 + 0.6 * o))
    .addScaledVector(h.across, 0.032 * (0.3 + 0.7 * o) - 0.03 * u)
    .addScaledVector(h.normal, 0.03 * u);
  h.hasNormal = true;
  h.hasJoints = true; // the pose has full finger geometry, so contact uses all of it
  h.valid = true;
  buildShape(h);
}

// A bare tracked position with no orientation (a controller grip): round contact volume only.
export function setHandFromPoint(h, palm) {
  h.palm.copy(palm);
  h.wrist.copy(palm);
  h.hasNormal = false;
  h.hasJoints = false;
  h.valid = true;
  buildShape(h);
}

export function invalidateHand(h) {
  h.valid = false;
  h.prevOk = false;
  h.vel.set(0, 0, 0);
}

// Hand velocity from last frame's palm. Call after the pose is set, before the ball is tested.
export function updateHandMotion(h, dt) {
  if (h.valid && h.prevOk && dt > 1e-4 && h.prevPalm.distanceTo(h.palm) < 0.5) {
    _pt.subVectors(h.palm, h.prevPalm).divideScalar(dt);
    if (_pt.length() > 8) _pt.setLength(8); // a hand does not move faster than this; tracking noise does
    h.vel.lerp(_pt, 0.6);
  } else {
    h.vel.set(0, 0, 0);
  }
}

// Remember this frame's palm for next frame. Call after the ball has been tested.
export function commitHand(h) {
  h.prevPalm.copy(h.palm);
  h.prevOk = h.valid;
}

// ---------- contacts ----------
export function createContact() {
  return {
    hit: false,
    s: 1, // when in the frame, 0..1
    cap: -1,
    kind: null, // 'palm' | 'finger' | 'thumb' | 'forearm'
    dist: Infinity, // closest approach of the ball centre to the capsule axis
    gap: Infinity, // closest approach minus (ball + capsule radius): <= 0 is touching
    point: new Vector3(), // ball centre at first touch, hand-relative
    normal: new Vector3(), // from the hand surface to the ball
    result: null, // 'catch' | 'back' | 'wrist' | 'edge' | 'fist'
    facing: 0, // 1 = ball moving straight into the palm
    side: 0, // ball centre's height above the palm plane at contact
    relSpeed: 0,
    quality: 0,
  };
}

// Where was this hand last frame (for sweeping a moving hand)? Falls back to now if tracking jumped.
function handStart(h) {
  return h.prevOk && h.prevPalm.distanceTo(h.palm) < 0.5 ? h.prevPalm : h.palm;
}

const SAMPLES = 12;

// Sweeps the ball (prevBall -> nowBall, radius ballR) through the hand and classifies the first
// contact. `bonus` widens every reach (a cupped pair of hands is a more forgiving net).
// `ballVel` is the ball's velocity at the end of the frame.
export function evaluateHand(h, prevBall, nowBall, ballVel, ballR, bonus, out) {
  out.hit = false;
  out.result = null;
  out.cap = -1;
  out.kind = null;
  out.s = 1;
  out.dist = Infinity;
  out.gap = Infinity;
  if (!h.valid) return out;

  const p0 = handStart(h);
  _R0.subVectors(prevBall, p0);
  _R1.subVectors(nowBall, h.palm);

  let bestS = Infinity;
  let bestDist = Infinity;
  for (let i = 0; i < h.capCount; i++) {
    const c = h.caps[i];
    _a.subVectors(c.a, h.palm);
    _b.subVectors(c.b, h.palm);
    const d2 = segSegDist2(_R0, _R1, _a, _b);
    const d = Math.sqrt(d2);
    const reach = ballR + c.r + (c.kind === 'forearm' ? 0 : bonus);
    const gap = d - (ballR + c.r);
    if (gap < out.gap) out.gap = gap;
    if (d > reach) continue;
    // First touch: already touching at the start of the frame, else bisect up to the closest approach.
    let s = 0;
    if (pointSegDist(_R0, _a, _b) > reach) {
      let lo = 0;
      let hi = seg.s;
      // segSegDist2 above left seg.s for this capsule; pointSegDist does not touch it.
      for (let it = 0; it < 14; it++) {
        const mid = (lo + hi) * 0.5;
        _pt.copy(_R0).lerp(_R1, mid);
        if (pointSegDist(_pt, _a, _b) <= reach) hi = mid;
        else lo = mid;
      }
      s = hi;
    }
    if (s < bestS - 1e-9 || (Math.abs(s - bestS) <= 1e-9 && d < bestDist)) {
      bestS = s;
      bestDist = d;
      out.cap = i;
      out.kind = c.kind;
      out.dist = d;
    }
  }
  if (out.cap < 0) return out;

  out.hit = true;
  out.s = bestS;
  _pt.copy(_R0).lerp(_R1, bestS); // ball centre, relative to the palm, at first touch
  out.point.copy(_pt);
  const c = h.caps[out.cap];
  // Contact normal: from the nearest point on that capsule to the ball centre.
  _a.subVectors(c.a, h.palm);
  _b.subVectors(c.b, h.palm);
  _w.subVectors(_b, _a);
  const l2 = _w.lengthSq();
  const t = l2 > 1e-12 ? clamp(_v.subVectors(_pt, _a).dot(_w) / l2, 0, 1) : 0;
  out.normal.copy(_pt).sub(_a.addScaledVector(_w, t));
  if (out.normal.lengthSq() < 1e-10) out.normal.copy(h.normal);
  out.normal.normalize();

  // Ball velocity relative to the hand: how hard and from which way it is coming.
  _v.copy(ballVel).sub(h.vel);
  out.relSpeed = _v.length();
  out.facing = out.relSpeed > 1e-6 ? -_v.dot(h.normal) / out.relSpeed : 0;
  out.side = h.hasNormal ? _pt.dot(h.normal) : 0;

  if (!h.hasNormal) {
    out.result = 'catch'; // no orientation known (controller): any touch counts
    out.quality = 0.5;
    return out;
  }

  // Wrist / forearm: the forearm itself, or the heel of the hand right at the wrist.
  _w.subVectors(h.wrist, h.palm);
  const along = _a.subVectors(_pt, _w).dot(h.fingers);
  if (out.kind === 'forearm' || (out.kind === 'palm' && along < CFG.wristCutoff)) out.result = 'wrist';
  else if (out.side < -CFG.backSide) out.result = 'back';
  else if (h.fist) out.result = 'fist';
  else if (out.facing < (out.kind === 'palm' ? CFG.facingPalm : CFG.facingFinger)) out.result = 'edge';
  else out.result = 'catch';

  if (out.result === 'catch') {
    const centred = 1 - clamp(out.dist / (ballR + c.r), 0, 1);
    out.quality = clamp(0.55 * out.facing + 0.25 * centred + 0.2 * h.openness, 0, 1);
  } else {
    out.quality = 0;
  }
  return out;
}

// Two hands closing on the ball: is the ball in the pocket between the palms (in front of both)?
// Returns the time (0..1) it first is, or -1. Samples the frame; hands and ball move linearly.
const _bs = new Vector3();
const _pl = new Vector3();
const _pr = new Vector3();
const _rel = new Vector3();
export function pocketTime(L, R, prevBall, nowBall, ballR) {
  const l0 = handStart(L);
  const r0 = handStart(R);
  const reach = ballR + CFG.pocketSlack;
  // A sample every 2 cm of ball travel at least, so a fast ball cannot step over the pocket.
  const n = Math.min(240, Math.max(SAMPLES, Math.ceil(prevBall.distanceTo(nowBall) / 0.02)));
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    _bs.copy(prevBall).lerp(nowBall, s);
    _pl.copy(l0).lerp(L.palm, s);
    _pr.copy(r0).lerp(R.palm, s);
    if (pointSegDist(_bs, _pl, _pr) > reach) continue;
    // In front of both palms (not behind either hand), and over the palm rather than past the wrist or fingertips.
    let ok = true;
    for (const [h, p] of [[L, _pl], [R, _pr]]) {
      _rel.subVectors(_bs, p);
      if (_rel.dot(h.normal) < CFG.pocketFront) ok = false;
      const along = _rel.dot(h.fingers);
      if (along < -0.07 || along > 0.17) ok = false;
    }
    if (ok) return s;
  }
  return -1;
}

// ---------- the decision ----------
export function createDecision() {
  return {
    outcome: 'none', // 'none' | 'catch' | 'deflect'
    reason: null, // deflect: 'back' | 'wrist' | 'edge' | 'fist'
    side: null, // the hand that caught or was hit
    twoHand: false,
    technique: null,
    tags: [],
    s: 1,
    point: new Vector3(), // world position of the ball at first touch
    normal: new Vector3(), // deflection: from the hand surface to the ball
    handVel: new Vector3(),
    relSpeed: 0,
    give: 0,
    quality: 0,
    gap: Infinity, // closest the ball came to either hand this frame (<=0 touching)
    cupReady: false,
    gapBetween: Infinity,
  };
}

const cL = createContact();
const cR = createContact();
const _bv = new Vector3();
const _mid = new Vector3();

// Everything for one frame of the flight. L and R: hand objects. prevBall/nowBall: world positions.
// shoulders: optional { left, right, axis } for height and reach labels (can be null).
export function evaluateCatch(L, R, prevBall, nowBall, ballVel, ballR, shoulders, out) {
  out.outcome = 'none';
  out.reason = null;
  out.side = null;
  out.twoHand = false;
  out.technique = null;
  out.tags.length = 0;
  out.quality = 0;
  out.relSpeed = 0;
  out.give = 0;
  out.gap = Infinity;
  out.cupReady = false;
  out.gapBetween = Infinity;

  const both = L.valid && R.valid && L.hasNormal && R.hasNormal;
  if (both) {
    out.gapBetween = L.palm.distanceTo(R.palm);
    out.cupReady = out.gapBetween <= CFG.twoHandGap && !L.fist && !R.fist;
  }
  const bonus = out.cupReady ? CFG.cuppedBonus : 0;
  evaluateHand(L, prevBall, nowBall, ballVel, ballR, bonus, cL);
  evaluateHand(R, prevBall, nowBall, ballVel, ballR, bonus, cR);
  out.gap = Math.min(cL.gap, cR.gap);

  // Earliest deflection and earliest single-hand catch.
  let sDeflect = Infinity;
  let deflectHand = null;
  let sCatch = Infinity;
  let catchHand = null;
  for (const [h, c] of [[L, cL], [R, cR]]) {
    if (!c.hit) continue;
    // Two cupped hands with the ball dropping into the slot between them: it brushes the palms edge-on,
    // but that is how a cup works (the hands close on it), not a glance. Only when the ball is between them.
    if (c.result === 'edge' && out.cupReady && c.side >= CFG.pocketFront) {
      _bv.lerpVectors(prevBall, nowBall, c.s);
      if (pointSegDist(_bv, L.palm, R.palm) <= ballR + CFG.pocketSlack + 0.03) continue;
    }
    if (c.result === 'catch') {
      if (c.s < sCatch) {
        sCatch = c.s;
        catchHand = h;
      }
    } else if (c.s < sDeflect) {
      sDeflect = c.s;
      deflectHand = h;
    }
  }

  // The pocket between two hands.
  let sPocket = -1;
  if (out.cupReady) sPocket = pocketTime(L, R, prevBall, nowBall, ballR);
  const pocket = sPocket >= 0;
  const sGood = Math.min(sCatch, pocket ? sPocket : Infinity);

  if (deflectHand && sDeflect < sGood - 1e-6) {
    const c = deflectHand === L ? cL : cR;
    out.outcome = 'deflect';
    out.reason = c.result;
    out.side = deflectHand.side;
    out.s = c.s;
    out.point.lerpVectors(prevBall, nowBall, c.s);
    out.normal.copy(c.normal);
    out.handVel.copy(deflectHand.vel);
    out.relSpeed = c.relSpeed;
    return out;
  }
  if (sGood === Infinity) return out;

  out.outcome = 'catch';
  out.s = sGood;
  out.point.lerpVectors(prevBall, nowBall, sGood);
  // Which hand holds it: the nearer one.
  const dl = out.point.distanceTo(L.palm);
  const dr = out.point.distanceTo(R.palm);
  const single = catchHand || (dl <= dr ? L : R);
  const cs = single === L ? cL : cR;
  out.twoHand = pocket || (cL.result === 'catch' && cR.result === 'catch' && out.cupReady);
  out.side = out.twoHand ? (dl <= dr ? 'left' : 'right') : single.side;
  out.relSpeed = cs.hit ? cs.relSpeed : _bv.copy(ballVel).sub(single.vel).length();
  out.quality = cs.hit && cs.result === 'catch' ? cs.quality : 0.6;
  describeCatch(L, R, single, out, ballVel, shoulders);
  return out;
}

// Names the technique and collects tags: high/low (by where the palm is), fast, soft hands, moving, stretch.
// shoulders: { left, right, axis } - each shoulder's position and the player's sideways direction.
function describeCatch(L, R, single, out, ballVel, shoulders) {
  const tags = out.tags;
  const hands = out.twoHand ? [L, R] : [single];
  let fy = 0;
  let ny = 0;
  let py = 0;
  for (const h of hands) {
    fy += h.fingers.y / hands.length;
    ny += h.normal.y / hands.length;
    py += h.palm.y / hands.length;
  }
  // Where the catch is taken, relative to the shoulders: above the head, or down at the knees.
  let high = false;
  let low = false;
  if (shoulders) {
    const sy = (shoulders.left.y + shoulders.right.y) * 0.5;
    high = py > sy + CFG.highPalm;
    low = py < sy - CFG.lowPalm;
  } else {
    high = fy > 0.5;
    low = fy < -0.5;
  }
  if (high) tags.push('high');
  else if (low) tags.push('low');

  if (out.twoHand) {
    out.technique = cupTypeOf(L, R, fy);
  } else if (!single.hasNormal) {
    out.technique = 'one-hand';
  } else if (high && fy > 0.5) {
    out.technique = 'one-hand-high';
  } else if (low && fy < -0.5) {
    out.technique = 'one-hand-low';
  } else if (ny > 0.6) {
    out.technique = 'one-hand-scoop';
  } else {
    out.technique = 'one-hand';
  }

  if (out.relSpeed >= CFG.fastBall) tags.push('fast');
  // Soft hands: the catching hand is travelling the way the ball is, absorbing the pace.
  const hv = out.twoHand ? _mid.copy(L.vel).add(R.vel).multiplyScalar(0.5) : single.vel;
  const bl = ballVel.length();
  if (bl > 1e-6) out.give = hv.dot(ballVel) / bl;
  if (out.give >= CFG.giveSpeed) tags.push('soft');
  if (hv.length() >= CFG.movingHands) tags.push('moving');
  // Stretch: a hand reaching sideways well past its own shoulder (or across the body).
  if (shoulders && shoulders.axis) {
    let far = 0;
    for (const h of hands) {
      const sh = shoulders[h.side];
      if (sh) far = Math.max(far, Math.abs(_v.subVectors(h.palm, sh).dot(shoulders.axis)));
    }
    if (far > CFG.stretchReach) tags.push('stretch');
  }
}

// The two classic cricket cups. Fingers up, thumbs together (a "W"): the reverse cup for high balls.
// Fingers down, little fingers together: the orthodox cup for low balls.
function cupTypeOf(L, R, fy) {
  if (!(L.hasJoints && R.hasJoints)) return fy > 0.5 ? 'reverse-cup' : fy < -0.5 ? 'orthodox-cup' : 'two-handed';
  const thumbDist = L.tips.thumb.distanceTo(R.tips.thumb);
  const pinkyDist = L.tips.pinky.distanceTo(R.tips.pinky);
  if (L.fingers.y > -0.05 && R.fingers.y > -0.05 && thumbDist < pinkyDist && fy > 0.3) return 'reverse-cup';
  if (L.fingers.y < 0.15 && R.fingers.y < 0.15 && pinkyDist < thumbDist && fy < -0.3) return 'orthodox-cup';
  return 'two-handed';
}

// The ball's velocity after glancing off a hand: reflected about the contact normal with most pace
// lost, plus a share of the hand's own motion. Ball velocity is world-space.
export function deflectVelocity(ballVel, handVel, normal, out) {
  _v.copy(ballVel).sub(handVel); // relative to the hand
  const vn = _v.dot(normal);
  if (vn < 0) _v.addScaledVector(normal, -(1 + CFG.deflectRestitution) * vn);
  _v.multiplyScalar(0.7); // friction along the surface
  return out.copy(_v).add(handVel);
}
