import {
  AnimationMixer,
  AssetManager,
  Box3,
  CylinderGeometry,
  Group,
  LoopRepeat,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { MOUND_HEIGHT, MOUND_Z, PITCHER_HEIGHT } from './config.js';
import { makeMitt } from './glove.js';

// The pitcher: a realistic CC0 human (Quaternius Universal Base Characters, in a painted "Aces"
// uniform) breathing through a CC0 idle clip. On top of that, the whole body is posed every frame
// from key poses written below: two-bone IK for both arms and both legs, hips and shoulders turned
// separately (the hip-shoulder separation that powers a real pitch), a forward lean of the spine,
// and a head that keeps looking in at the catcher. He wears a glove on his left hand and throws
// right-handed; the ball leaves his fingers at the release frame.
//
// Key poses are in "mound space": metres, origin on the front edge of the rubber, +Z towards home
// plate, +X to the pitcher's left when he faces the plate.
//   yaw   whole-body turn (radians; 0 faces the plate, -PI/2 is side-on with his left shoulder in)
//   twist extra turn of the shoulders over the hips
//   lean  forward bend of the spine
//   pos   where the body (its rest-pose origin) is moved to: the stride carries him forward
//   rh/lh hand targets, lf/rf ankle targets (left/right foot)

const SET = {
  yaw: -1.42, twist: 0, lean: 0.06, pos: [0, -0.03, 0.04],
  rh: [-0.3, 1.2, 0.08], lh: [-0.31, 1.23, 0.12],
  lf: [0.02, 0.085, 0.36], rf: [-0.05, 0.085, -0.12],
};

const FIELD = {
  yaw: 0, twist: 0, lean: 0.32, pos: [0, -0.17, 1.0],
  rh: [-0.2, 0.98, 1.42], lh: [0.12, 1.06, 1.48],
  lf: [0.26, 0.05, 1.16], rf: [-0.3, 0.055, 0.98],
};

// The delivery, from the set position: leg kick, stride, arm cocked, release, follow-through, and
// into a fielding stance facing the plate.
const DELIVERY = {
  duration: 2.0,
  release: 1.24, // the ball leaves his hand
  keys: [
    { t: 0, ...SET },
    { t: 0.22, ...SET, pos: [0, 0.0, 0.0], rh: [-0.27, 1.28, 0.06], lh: [-0.28, 1.3, 0.1] },
    // Leg kick: the left knee comes up to the belt, the body coils away from the plate.
    { t: 0.55, yaw: -1.78, twist: -0.08, lean: 0.0, pos: [0, 0.05, -0.04], rh: [-0.25, 1.33, -0.02], lh: [-0.26, 1.35, 0.02], lf: [-0.28, 0.5, 0.1], rf: [-0.05, 0.085, -0.12] },
    // Hands break, the stride begins: ball hand swings down and back, glove reaches for the plate.
    { t: 0.86, yaw: -1.62, twist: -0.05, lean: 0.08, pos: [0, -0.07, 0.28], rh: [-0.12, 1.02, -0.5], lh: [-0.1, 1.36, 0.62], lf: [-0.06, 0.3, 0.8], rf: [-0.05, 0.09, -0.1] },
    // Foot strike: front foot down, hips opening, shoulders still closed, arm cocked high behind the head.
    { t: 1.08, yaw: -0.95, twist: -0.5, lean: 0.14, pos: [0, -0.16, 0.66], rh: [0.02, 1.78, 0.05], lh: [0.12, 1.34, 1.12], lf: [0.06, 0.05, 1.26], rf: [-0.04, 0.09, -0.06] },
    // Release: chest square to the plate, arm extended out in front at three-quarters.
    { t: 1.24, yaw: -0.12, twist: 0.2, lean: 0.38, pos: [-0.04, -0.2, 0.86], rh: [-0.34, 1.66, 1.5], lh: [0.26, 1.15, 0.92], lf: [0.06, 0.05, 1.26], rf: [-0.08, 0.13, 0.12] },
    // Follow-through: the arm finishes across the body, the back leg swings through.
    { t: 1.5, yaw: 0.32, twist: 0.12, lean: 0.72, pos: [0, -0.24, 1.0], rh: [0.36, 0.68, 1.42], lh: [0.3, 0.98, 0.86], lf: [0.06, 0.05, 1.26], rf: [-0.22, 0.36, 0.72] },
    { t: 1.75, yaw: 0.1, twist: 0.02, lean: 0.45, pos: [0, -0.16, 1.0], rh: [-0.05, 0.95, 1.45], lh: [0.16, 1.02, 1.42], lf: [0.2, 0.05, 1.2], rf: [-0.28, 0.12, 1.0] },
    { t: 2.0, ...FIELD },
  ],
};

// Walking back up onto the rubber for the next pitch: two steps.
const RECOVER = {
  duration: 1.3,
  keys: [
    { t: 0, ...FIELD },
    { t: 0.35, yaw: -0.45, twist: 0, lean: 0.12, pos: [0, -0.04, 0.72], rh: [-0.22, 0.98, 0.82], lh: [0.1, 1.05, 0.86], lf: [0.22, 0.085, 1.14], rf: [-0.18, 0.2, 0.55] },
    { t: 0.7, yaw: -0.95, twist: 0, lean: 0.08, pos: [0, -0.02, 0.38], rh: [-0.28, 1.05, 0.42], lh: [-0.05, 1.12, 0.48], lf: [0.12, 0.24, 0.68], rf: [-0.1, 0.085, 0.2] },
    { t: 1.0, yaw: -1.3, twist: 0, lean: 0.06, pos: [0, -0.03, 0.12], rh: [-0.3, 1.15, 0.14], lh: [-0.3, 1.18, 0.18], lf: [0.03, 0.12, 0.4], rf: [-0.06, 0.085, -0.08] },
    { t: 1.3, ...SET },
  ],
};

// After a catch: a fist pump, "nice catch".
const CHEER = {
  duration: 1.0,
  keys: [
    { t: 0, ...FIELD },
    { t: 0.3, ...FIELD, lean: 0.12, pos: [0, -0.06, 1.0], rh: [-0.22, 1.78, 1.12] },
    { t: 0.5, ...FIELD, lean: 0.1, pos: [0, -0.05, 1.0], rh: [-0.24, 1.55, 1.18] },
    { t: 0.7, ...FIELD, lean: 0.12, pos: [0, -0.06, 1.0], rh: [-0.22, 1.8, 1.12] },
    { t: 1.0, ...FIELD },
  ],
};

// After a miss: hands on hips, a shake of the head.
const SHRUG = {
  duration: 1.0,
  shake: true,
  keys: [
    { t: 0, ...FIELD },
    { t: 0.3, ...FIELD, lean: 0.05, pos: [0, -0.04, 1.0], rh: [-0.26, 1.02, 0.98], lh: [0.26, 1.02, 0.98] },
    { t: 0.75, ...FIELD, lean: 0.05, pos: [0, -0.04, 1.0], rh: [-0.26, 1.02, 0.98], lh: [0.26, 1.02, 0.98] },
    { t: 1.0, ...FIELD },
  ],
};

const SCALARS = ['yaw', 'twist', 'lean'];
const VECTORS = ['pos', 'rh', 'lh', 'lf', 'rf'];
const SPINE_SHARE = [0.3, 0.35, 0.35];
const BALL_IN_HAND_SCALE = 0.78; // the game's ball is drawn a little large; real size in his hand

// Catmull-Rom through four values.
function cr(p0, p1, p2, p3, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

// Samples every channel of a move at time t into `pose`.
function sample(keys, t, pose) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const k1 = keys[i];
  const k2 = keys[Math.min(i + 1, keys.length - 1)];
  const k0 = keys[Math.max(i - 1, 0)];
  const k3 = keys[Math.min(i + 2, keys.length - 1)];
  const span = k2.t - k1.t;
  const u = span > 0 ? Math.min(1, Math.max(0, (t - k1.t) / span)) : 0;
  for (const name of SCALARS) pose[name] = cr(k0[name], k1[name], k2[name], k3[name], u);
  for (const name of VECTORS) {
    const a = k0[name], b = k1[name], c = k2[name], d = k3[name];
    pose[name].set(cr(a[0], b[0], c[0], d[0], u), cr(a[1], b[1], c[1], d[1], u), cr(a[2], b[2], c[2], d[2], u));
  }
}

function poseFrom(key, pose) {
  for (const name of SCALARS) pose[name] = key[name];
  for (const name of VECTORS) pose[name].set(...key[name]);
}

export class Pitcher {
  constructor(world) {
    const gltf = AssetManager.getGLTF('pitcher');
    this.model = gltf.scene;
    const box = new Box3().setFromObject(this.model);
    this.scale = PITCHER_HEIGHT / (box.max.y - box.min.y);
    this.model.position.y = -box.min.y;
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false; // skinned: the bind-pose bounds do not follow the motion
      }
    });

    // mound: fixed frame on the rubber. body: the character, moved and turned by the key poses.
    this.mound = new Group();
    this.mound.position.set(0, MOUND_HEIGHT, MOUND_Z);
    // Not rotated: mound space +Z is world +Z, which points from the rubber at home plate.
    this.body = new Group();
    this.body.add(this.model);
    this.body.scale.setScalar(this.scale);
    this.mound.add(this.body);
    world.createTransformEntity(this.mound);

    // Inside his glove the left hand's fingers are straight (the idle clip curls them into a fist,
    // which would poke out through the pocket): keep their rest pose every frame.
    this.gloveFingers = [];
    this.model.traverse((o) => {
      if (/^(index|middle|ring|pinky|thumb)_0[123]_l$/.test(o.name)) this.gloveFingers.push({ bone: o, rest: o.quaternion.clone() });
    });

    this.mixer = new AnimationMixer(this.model);
    const idle = gltf.animations.find((c) => c.name === 'Idle_Loop');
    this.mixer.clipAction(idle).setLoop(LoopRepeat, Infinity).play();

    const bone = (name) => this.model.getObjectByName(name);
    this.bones = {
      spine: [bone('spine_01'), bone('spine_02'), bone('spine_03')],
      neck: bone('neck_01'),
      head: bone('Head'),
      right: { upper: bone('upperarm_r'), lower: bone('lowerarm_r'), hand: bone('hand_r'), mid: bone('middle_01_r'), index: bone('index_01_r'), pinky: bone('pinky_01_r') },
      left: { upper: bone('upperarm_l'), lower: bone('lowerarm_l'), hand: bone('hand_l'), mid: bone('middle_01_l'), index: bone('index_01_l'), pinky: bone('pinky_01_l') },
      legL: { upper: bone('thigh_l'), lower: bone('calf_l'), foot: bone('foot_l') },
      legR: { upper: bone('thigh_r'), lower: bone('calf_r'), foot: bone('foot_r') },
    };

    // Scratch objects: nothing is allocated per frame.
    this.v = Array.from({ length: 14 }, () => new Vector3());
    this.q = [new Quaternion(), new Quaternion(), new Quaternion(), new Quaternion()];
    this.m = [new Matrix4(), new Matrix4()];
    this.pose = { yaw: 0, twist: 0, lean: 0, pos: new Vector3(), rh: new Vector3(), lh: new Vector3(), lf: new Vector3(), rf: new Vector3() };
    this.target = new Vector3(); // world-space scratch for IK targets
    this.lookAt = new Vector3(0, 1.1, 0); // the catcher's eyes, updated by the game
    this.ballPos = new Vector3();
    this.ballScale = BALL_IN_HAND_SCALE;
    this.releaseVel = new Vector3(); // the hand's velocity at release (for a natural first frame)
    this.lastHand = new Vector3();

    // Feet keep their rest orientation relative to the body (so they stay flat on the ground).
    this.mixer.update(0);
    this.mound.updateMatrixWorld(true);
    const bodyInv = this.body.getWorldQuaternion(new Quaternion()).invert();
    this.footRest = {
      legL: bodyInv.clone().multiply(this.bones.legL.foot.getWorldQuaternion(new Quaternion())),
      legR: bodyInv.clone().multiply(this.bones.legR.foot.getWorldQuaternion(new Quaternion())),
    };

    this.straightenGloveHand();
    this.mound.updateMatrixWorld(true);
    this.addGlove();
    this.addCap();

    this.move = null;
    this.time = 0;
    this.held = 'none'; // none | hand
    this.shake = 0;
    this.atSet = true;
    poseFrom(SET, this.pose);
    this.apply(0);
  }

  // A navy baseball cap with a scarlet button, on the head bone.
  addCap() {
    const navy = new MeshStandardMaterial({ color: 0x1a2448, roughness: 0.85 });
    const red = new MeshStandardMaterial({ color: 0xb0182a, roughness: 0.6 });
    const cap = new Group();
    const crown = new Mesh(new SphereGeometry(0.118, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), navy);
    crown.scale.set(1, 0.92, 1.1);
    const bill = new Mesh(new CylinderGeometry(0.1, 0.1, 0.008, 24, 1, false, -Math.PI / 2, Math.PI), navy);
    bill.scale.set(1.05, 1, 1.05);
    bill.position.set(0, 0.004, 0.11);
    bill.rotation.x = 0.12;
    const button = new Mesh(new SphereGeometry(0.011, 8, 6), red);
    button.position.y = 0.108;
    // The "A" on the front, a small scarlet badge.
    const badge = new Mesh(new CylinderGeometry(0.026, 0.026, 0.004, 16), red);
    badge.rotation.x = Math.PI / 2 - 0.5;
    badge.position.set(0, 0.06, 0.112);
    cap.add(crown, bill, button, badge);
    cap.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    const head = this.bones.head;
    const p = head.getWorldPosition(new Vector3());
    this.body.worldToLocal(p);
    cap.position.set(p.x, p.y + 0.122, p.z + 0.004);
    cap.rotation.x = -0.1;
    this.body.add(cap);
    cap.updateMatrixWorld(true);
    head.attach(cap);
  }

  // A black fielder's glove on the left hand, pocket on the palm.
  addGlove() {
    const mitt = makeMitt('pitcher');
    const glove = mitt.object;
    mitt.setClose(0.35);
    const L = this.bones.left;
    const wrist = L.hand.getWorldPosition(new Vector3());
    const knuckle = L.mid.getWorldPosition(new Vector3());
    const fingers = knuckle.clone().sub(wrist).normalize();
    const across = L.index.getWorldPosition(new Vector3()).sub(L.pinky.getWorldPosition(new Vector3()));
    across.addScaledVector(fingers, -across.dot(fingers)).normalize();
    // Palm normal: of the two perpendiculars, the one facing the body (the idle hand hangs at +X).
    const normal = new Vector3().crossVectors(across, fingers);
    if (normal.x > 0) normal.negate();
    const x = new Vector3().crossVectors(fingers, normal);
    glove.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, fingers, normal));
    if (x.dot(across) < 0) glove.scale.x = -1; // the glove's thumb goes on the index-finger side
    const size = 0.86 / this.scale; // a fielder's glove is a little smaller than the catcher's mitt
    glove.scale.multiplyScalar(size);
    // The hand goes inside the mitt, behind the pocket (in its padding), not in front of it.
    glove.position.copy(wrist).lerp(knuckle, 0.78).addScaledVector(normal, 0.072 * this.scale);
    glove.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    // Place it in world space, then hang it on the hand bone so it follows.
    this.mound.add(glove);
    this.mound.updateMatrixWorld(true);
    glove.position.copy(this.mound.worldToLocal(glove.position.clone()));
    glove.scale.multiplyScalar(this.scale);
    glove.updateMatrixWorld(true);
    L.hand.attach(glove);
    this.glove = glove;
  }

  // ---------- moves ----------
  pitch() {
    this.start(DELIVERY);
    this.held = 'hand';
    this.ballScale = BALL_IN_HAND_SCALE;
    this.fingers(this.bones.right, this.ballPos); // the ball starts in his hand, this very frame
    this.lastHand.copy(this.ballPos);
  }

  recover() {
    this.start(RECOVER);
  }

  cheer() {
    this.start(CHEER);
  }

  shrug() {
    this.start(SHRUG);
  }

  start(move) {
    this.move = move;
    this.time = 0;
  }

  get isPitching() {
    return this.move === DELIVERY;
  }

  // True from the release frame of the current delivery.
  get hasReleased() {
    return this.move === DELIVERY && this.time >= DELIVERY.release;
  }

  // True once he is back on the rubber and still.
  get isSet() {
    return !this.move && this.atSet;
  }

  releaseBall() {
    this.held = 'none';
  }

  straightenGloveHand() {
    for (const f of this.gloveFingers) {
      f.bone.quaternion.copy(f.rest);
      // The thumb's rest pose points forward, out through the pocket; inside the glove it is tucked
      // away (its outer joints folded to nothing, hidden by the leather).
      if (f.bone.name === 'thumb_01_l') f.bone.scale.setScalar(0.05);
    }
  }

  update(dt) {
    this.mixer.update(dt);
    this.straightenGloveHand();
    if (this.move) {
      this.time += dt;
      sample(this.move.keys, Math.min(this.time, this.move.duration), this.pose);
      if (this.time >= this.move.duration) {
        this.atSet = this.move === RECOVER;
        this.move = null;
      } else {
        this.atSet = false;
      }
    }
    this.shake = this.move && this.move.shake ? Math.sin(this.time * 18) * 0.3 * Math.sin(Math.PI * Math.min(1, this.time)) : 0;
    this.apply(dt);
  }

  // ---------- posing ----------
  apply(dt) {
    const P = this.pose;
    this.body.position.copy(P.pos);
    this.body.rotation.y = P.yaw;
    this.mound.updateMatrixWorld(true);

    // Spine: shoulders turn over the hips, then bend forward.
    const up = this.v[12].set(0, 1, 0);
    const side = this.v[13].set(1, 0, 0).applyQuaternion(this.body.getWorldQuaternion(this.q[3]));
    for (let i = 0; i < 3; i++) {
      const b = this.bones.spine[i];
      this.rotateWorld(b, up, P.twist * SPINE_SHARE[i]);
      this.rotateWorld(b, side, P.lean * SPINE_SHARE[i]);
    }
    this.lookHead();

    // Arms, then legs (two-bone IK to targets in mound space).
    const T = this.target;
    this.solve(this.bones.right, this.mound.localToWorld(T.copy(P.rh)), this.elbowPole(-1, this.v[11]));
    this.solve(this.bones.left, this.mound.localToWorld(T.copy(P.lh)), this.elbowPole(1, this.v[11]));
    this.solveLeg(this.bones.legL, this.mound.localToWorld(T.copy(P.lf)), 'legL');
    this.solveLeg(this.bones.legR, this.mound.localToWorld(T.copy(P.rf)), 'legR');

    this.updateBall(dt);
  }

  // Rotates a bone by `angle` about a world axis.
  rotateWorld(bone, axis, angle) {
    if (angle === 0) return;
    bone.parent.getWorldQuaternion(this.q[0]);
    const local = this.v[0].copy(axis).applyQuaternion(this.q[0].invert());
    this.q[1].setFromAxisAngle(local, angle);
    bone.quaternion.premultiply(this.q[1]);
    bone.updateMatrixWorld(true);
  }

  // The head turns (within a natural range) to look in at the catcher, and shakes after a miss.
  lookHead() {
    const head = this.bones.head;
    const p = head.getWorldPosition(this.v[0]);
    const to = this.v[1].subVectors(this.lookAt, p);
    // Where the chest faces: the body's turn plus the shoulders' twist.
    const facing = this.pose.yaw + this.pose.twist;
    const fwd = this.v[2].set(Math.sin(facing), 0, Math.cos(facing));
    to.y = 0;
    if (fwd.lengthSq() < 1e-6 || to.lengthSq() < 1e-6) return;
    fwd.normalize();
    to.normalize();
    let yaw = Math.atan2(fwd.x * to.z - fwd.z * to.x, fwd.x * to.x + fwd.z * to.z);
    yaw = -yaw; // rotation about +Y that takes fwd to `to`
    yaw = Math.max(-1.45, Math.min(1.45, yaw)) + this.shake;
    const up = this.v[3].set(0, 1, 0);
    this.rotateWorld(this.bones.neck, up, yaw * 0.45);
    this.rotateWorld(head, up, yaw * 0.55);
  }

  // Elbows bend out to the side and down: -1 right arm, +1 left.
  elbowPole(side, out) {
    out.set(side * 0.5, -0.6, -0.4).applyQuaternion(this.body.getWorldQuaternion(this.q[3]));
    return out;
  }

  // Two-bone IK: upper/lower/end bones reach for `target`, the middle joint bends towards `pole`.
  solve(chain, target, pole) {
    const end = chain.hand || chain.foot;
    const S = chain.upper.getWorldPosition(this.v[3]);
    const E = chain.lower.getWorldPosition(this.v[4]);
    const H = end.getWorldPosition(this.v[5]);
    const a = S.distanceTo(E);
    const b = E.distanceTo(H);
    const dir = this.v[6].subVectors(target, S);
    const d = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, dir.length()));
    dir.normalize();
    const bend = this.v[7].copy(pole);
    bend.addScaledVector(dir, -bend.dot(dir));
    if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0); // straight at the pole: any bend will do
    bend.normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    this.v[8].copy(S).addScaledVector(dir, a * cosA).addScaledVector(bend, a * sinA); // middle joint
    this.v[9].copy(S).addScaledVector(dir, d); // end joint
    this.aim(chain.upper, E, this.v[8]);
    this.aim(chain.lower, end.getWorldPosition(this.v[5]), this.v[9]);
  }

  // Knees bend forward (the body's facing), feet stay flat on the ground.
  solveLeg(leg, target, key) {
    const pole = this.v[10].set(0, 0.15, 1).applyQuaternion(this.body.getWorldQuaternion(this.q[3]));
    this.solve(leg, target, pole);
    // Foot orientation: rest orientation relative to the body.
    const want = this.q[1].copy(this.q[3]).multiply(this.footRest[key]);
    leg.foot.parent.getWorldQuaternion(this.q[2]);
    leg.foot.quaternion.copy(this.q[2].invert().multiply(want));
    leg.foot.updateMatrixWorld(true);
  }

  // Turns `bone` so the direction from it to `childPos` points at `target` (all world space).
  aim(bone, childPos, target) {
    const p = bone.getWorldPosition(this.v[0]);
    const from = this.v[1].subVectors(childPos, p).normalize();
    const to = this.v[2].subVectors(target, p).normalize();
    this.q[0].setFromUnitVectors(from, to);
    bone.getWorldQuaternion(this.q[1]);
    this.q[1].premultiply(this.q[0]);
    bone.parent.getWorldQuaternion(this.q[2]);
    bone.quaternion.copy(this.q[2].invert().multiply(this.q[1]));
    bone.updateMatrixWorld(true);
  }

  // A point in the closed fingers: most of the way from the wrist to the knuckles.
  fingers(arm, out) {
    const h = arm.hand.getWorldPosition(this.v[0]);
    return out.copy(arm.mid.getWorldPosition(this.v[1])).sub(h).multiplyScalar(0.85).add(h);
  }

  updateBall(dt) {
    if (this.held !== 'hand') return;
    this.lastHand.copy(this.ballPos);
    this.fingers(this.bones.right, this.ballPos);
    if (dt > 0) this.releaseVel.subVectors(this.ballPos, this.lastHand).divideScalar(dt);
  }

  // Where the right hand is now, in world space (used by tests).
  handPosition(out) {
    return this.fingers(this.bones.right, out);
  }
}
