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
import { BAT, makeBat } from './bat.js';
import { COACH_HEIGHT, COACH_Z } from './config.js';

// The coach: a realistic CC0 human (Quaternius Universal Base Characters, in a painted training
// kit) breathing through a CC0 idle clip. On top of that, the arms are posed with two-bone IK from
// key poses written below, so the swing, the toss, the bat-raise and the shrug are all authored
// here and the bat is placed exactly in the fist every frame.
//
// Key poses are in the coach's own space: metres, origin between the feet, +Z towards the player,
// the coach's right-hand side at -X. rh/lh: right/left hand targets; bd: bat direction (handle to
// toe); bf: which way the bat's flat face points; yaw: torso turn in radians (+ turns the right
// shoulder towards the player).

const READY = { rh: [-0.3, 1.0, 0.08], bd: [-0.25, -0.9, 0.35], bf: [0, 0.3, 1] };

// The swing: the coach lifts the ball in his left hand, tosses it up in front of his right
// shoulder, takes the bat back, and strikes it on the way down. CONTACT is when bat meets ball.
const SWING = {
  duration: 1.5,
  fadeIn: 0.12,
  fadeOut: 0.3,
  release: 0.32, // the ball leaves the left hand
  contact: 0.7, // the bat strikes it
  keys: [
    { t: 0, ...READY, lh: [0.0, 1.06, 0.32], yaw: 0 },
    { t: 0.18, rh: [-0.36, 1.12, -0.06], bd: [-0.3, -0.35, -0.9], bf: [-0.9, 0.2, 0.1], lh: [0.0, 0.98, 0.35], yaw: -0.18 },
    { t: 0.32, rh: [-0.4, 1.3, -0.22], bd: [-0.2, 0.25, -1], bf: [-1, 0, 0], lh: [-0.16, 1.4, 0.4], yaw: -0.38 },
    { t: 0.5, rh: [-0.42, 1.38, -0.28], bd: [-0.15, 0.45, -1], bf: [-0.9, -0.3, 0.1], lh: [-0.06, 1.34, 0.42], yaw: -0.5 },
    { t: 0.7, rh: [-0.12, 1.12, 0.32], bd: [-1, 0.08, 0.22], bf: [0.2, 0, 1], lh: [0.1, 1.24, 0.35], yaw: 0.15 },
    { t: 0.9, rh: [0.12, 1.32, 0.3], bd: [0.5, 0.6, 0.6], bf: [-0.6, 0.1, 0.75], lh: [0.25, 1.12, 0.2], yaw: 0.5 },
    { t: 1.2, ...READY, lh: [0.3, 1.0, 0.1], yaw: 0.05 },
    { t: 1.5, ...READY, lh: [0.33, 0.97, 0.02], yaw: 0 },
  ],
};

// A catch: the coach raises his bat, as a batter does for a milestone.
const CHEER = {
  duration: 1.0,
  fadeIn: 0.2,
  fadeOut: 0.3,
  keys: [
    { t: 0, rh: [-0.3, 1.82, 0.06], bd: [-0.15, 0.95, 0.15], bf: [0, 0, 1], lh: [0.3, 1.25, 0.25], yaw: 0 },
    { t: 0.5, rh: [-0.3, 1.87, 0.1], bd: [-0.1, 0.97, 0.2], bf: [0, 0, 1], lh: [0.28, 1.3, 0.28], yaw: 0.05 },
    { t: 1.0, rh: [-0.3, 1.82, 0.06], bd: [-0.15, 0.95, 0.15], bf: [0, 0, 1], lh: [0.3, 1.25, 0.25], yaw: 0 },
  ],
};

// A miss: arms out, palms up, bat hanging.
const SHRUG = {
  duration: 1.0,
  fadeIn: 0.2,
  fadeOut: 0.35,
  keys: [
    { t: 0, rh: [-0.42, 1.02, 0.22], bd: [-0.35, -0.85, 0.4], bf: [0, 0.3, 1], lh: [0.42, 1.04, 0.22], yaw: 0 },
    { t: 1.0, rh: [-0.44, 1.05, 0.24], bd: [-0.35, -0.85, 0.4], bf: [0, 0.3, 1], lh: [0.44, 1.07, 0.24], yaw: 0 },
  ],
};

const GRAVITY = 9.81;
const BALL_IN_HAND_SCALE = 0.5; // the game's ball is drawn oversized for catching; real size in hand

const smooth = (x) => x * x * (3 - 2 * x);
const SPINE_SHARE = [0.4, 0.3, 0.3]; // how the torso turn is spread over the three spine bones

// Catmull-Rom spline value at u for four control values.
function cr(p0, p1, p2, p3, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

// Catmull-Rom through the keys' values for one channel, at time t.
function sample(keys, name, t, out) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const k1 = keys[i];
  const k2 = keys[Math.min(i + 1, keys.length - 1)];
  const k0 = keys[Math.max(i - 1, 0)];
  const k3 = keys[Math.min(i + 2, keys.length - 1)];
  const span = k2.t - k1.t;
  const u = span > 0 ? Math.min(1, Math.max(0, (t - k1.t) / span)) : 0;
  if (name === 'yaw') return cr(k0.yaw, k1.yaw, k2.yaw, k3.yaw, u);
  const a = k0[name], b = k1[name], c = k2[name], d = k3[name];
  return out.set(cr(a[0], b[0], c[0], d[0], u), cr(a[1], b[1], c[1], d[1], u), cr(a[2], b[2], c[2], d[2], u));
}

export class Coach {
  constructor(world) {
    const gltf = AssetManager.getGLTF('coach');
    this.model = gltf.scene;

    const box = new Box3().setFromObject(this.model);
    this.scale = COACH_HEIGHT / (box.max.y - box.min.y);
    this.model.position.set(0, -box.min.y, 0);
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false; // skinned: the bind-pose bounds do not follow the swing
      }
    });

    this.root = new Group();
    this.root.add(this.model);
    this.root.scale.setScalar(this.scale);
    this.root.position.set(0, 0, COACH_Z);
    world.createTransformEntity(this.root);

    this.mixer = new AnimationMixer(this.model);
    const idle = gltf.animations.find((c) => c.name === 'Idle_Loop');
    this.mixer.clipAction(idle).setLoop(LoopRepeat, Infinity).play();

    const bone = (name) => this.model.getObjectByName(name);
    this.bones = {
      spine: [bone('spine_01'), bone('spine_02'), bone('spine_03')],
      head: bone('Head'),
      right: { upper: bone('upperarm_r'), lower: bone('lowerarm_r'), hand: bone('hand_r'), mid: bone('middle_01_r'), index: bone('index_01_r'), pinky: bone('pinky_01_r') },
      left: { upper: bone('upperarm_l'), lower: bone('lowerarm_l'), hand: bone('hand_l'), mid: bone('middle_01_l'), index: bone('index_01_l'), pinky: bone('pinky_01_l') },
    };

    // Scratch objects: nothing is allocated per frame.
    this.v = Array.from({ length: 12 }, () => new Vector3());
    this.q = [new Quaternion(), new Quaternion(), new Quaternion()];
    this.m = [new Matrix4(), new Matrix4()];
    this.target = { rh: new Vector3(), lh: new Vector3(), bd: new Vector3(), bf: new Vector3() };
    this.batDir = new Vector3();
    this.batFace = new Vector3();
    this.grip = new Vector3();
    this.sweetSpot = new Vector3();
    this.ballPos = new Vector3();
    this.tossFrom = new Vector3();
    this.tossVel = new Vector3();
    this.tossStart = 0;
    this.ballScale = BALL_IN_HAND_SCALE;

    this.bat = makeBat();
    this.bat.scale.setScalar(this.scale);
    world.createTransformEntity(this.bat);

    this.addCap();

    this.move = null;
    this.time = 0;
    this.ball = 'none'; // none | held | tossed

    // Where the bat's sweet spot is at the moment of contact, in the coach's space: the toss is
    // aimed there, so the bat meets the ball exactly.
    this.contactLocal = new Vector3();
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    this.pose(SWING, SWING.contact, 1);
    this.contactLocal.copy(this.root.worldToLocal(this.v[11].copy(this.sweetSpot)));
    this.mixer.update(0);
    this.pose(null, 0, 0);
  }

  // A cricket cap in the kit's navy, on the head bone.
  addCap() {
    const navy = new MeshStandardMaterial({ color: 0x1b2b52, roughness: 0.9 });
    const cap = new Group();
    const crown = new Mesh(new SphereGeometry(0.118, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), navy);
    crown.scale.set(1, 0.9, 1.1);
    const peak = new Mesh(new CylinderGeometry(0.095, 0.095, 0.008, 24, 1, false, -Math.PI / 2, Math.PI), navy);
    peak.scale.set(1.1, 1, 0.95);
    peak.position.set(0, 0.006, 0.105);
    peak.rotation.x = 0.18;
    const button = new Mesh(new SphereGeometry(0.009, 8, 6), navy);
    button.position.y = 0.106;
    cap.add(crown, peak, button);
    cap.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });

    // Place it in the coach's space above the head bone, then attach so it follows the head.
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const head = this.bones.head;
    const p = head.getWorldPosition(new Vector3());
    this.root.worldToLocal(p);
    cap.position.set(p.x, p.y + 0.125, p.z + 0.0);
    cap.rotation.x = -0.12;
    this.root.add(cap);
    cap.updateMatrixWorld(true);
    head.attach(cap);
  }

  swing() {
    this.start(SWING);
    this.ball = 'held';
    this.ballScale = BALL_IN_HAND_SCALE;
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

  // True once the bat has reached the ball this swing.
  get hasStruck() {
    return this.move === SWING && this.time >= SWING.contact;
  }

  // Weight of the current move: eases in, holds, eases out.
  weight() {
    const m = this.move;
    if (!m) return 0;
    const t = this.time;
    if (t < m.fadeIn) return smooth(t / m.fadeIn);
    if (t > m.duration - m.fadeOut) return smooth(Math.max(0, (m.duration - t) / m.fadeOut));
    return 1;
  }

  update(dt) {
    this.mixer.update(dt);
    if (this.move) {
      this.time += dt;
      if (this.time >= this.move.duration) this.move = null;
    }
    this.root.updateMatrixWorld(true);
    this.pose(this.move, this.time, this.weight());
    this.updateBall();
  }

  // Poses spine, arms, hands and bat for `move` at time t, blended over the idle by w.
  pose(move, t, w) {
    const T = this.target;
    const [, , , , , , , , , , readyDir, scratch] = this.v;

    // Torso turn.
    const yaw = move ? sample(move.keys, 'yaw', Math.min(t, move.duration), null) * w : 0;
    if (yaw !== 0) for (let i = 0; i < 3; i++) this.turn(this.bones.spine[i], yaw * SPINE_SHARE[i]);

    // Hand targets: from the idle pose towards the key pose.
    const R = this.bones.right;
    const L = this.bones.left;
    const idleR = R.hand.getWorldPosition(this.v[8]);
    const idleL = L.hand.getWorldPosition(this.v[9]);
    if (move) {
      sample(move.keys, 'rh', t, T.rh);
      sample(move.keys, 'lh', t, T.lh);
      sample(move.keys, 'bd', t, T.bd);
      sample(move.keys, 'bf', t, T.bf);
    } else {
      T.rh.set(...READY.rh);
      T.bd.set(...READY.bd);
      T.bf.set(...READY.bf);
    }
    this.root.localToWorld(T.rh);
    this.root.localToWorld(T.lh);
    // Without a move, the right hand still holds the bat at the ready, a little blended with idle.
    const wr = move ? w : 0.85;
    T.rh.lerpVectors(idleR, T.rh, wr);
    T.lh.lerpVectors(idleL, T.lh, w);

    readyDir.set(...READY.bd).normalize();
    T.bd.normalize().lerp(readyDir, 1 - (move ? w : 1)).normalize();
    scratch.set(...READY.bf);
    T.bf.lerp(scratch, 1 - (move ? w : 1));
    // The coach is never rotated, so these directions are already in world space.

    this.solveArm(R, T.rh, -1);
    this.solveArm(L, T.lh, 1);

    // Bat: along bd, face towards bf (made perpendicular), held in the right fist.
    this.batDir.copy(T.bd);
    this.batFace.copy(T.bf).addScaledVector(this.batDir, -T.bf.dot(this.batDir)).normalize();
    this.gripHand(R, this.batDir);
    this.fistCentre(R, this.grip);
    const x = this.v[10].crossVectors(this.batDir, this.batFace);
    this.m[0].makeBasis(x, this.batDir, this.batFace);
    this.bat.quaternion.setFromRotationMatrix(this.m[0]);
    this.bat.position.copy(this.grip).addScaledVector(this.batDir, -BAT.grip * this.scale);
    this.bat.updateMatrixWorld(true);
    this.sweetSpot
      .copy(this.bat.position)
      .addScaledVector(this.batDir, BAT.sweetSpot * this.scale)
      .addScaledVector(this.batFace, 0.045);
  }

  // Rotates a bone about the world vertical by `angle`, in its parent's space.
  turn(bone, angle) {
    const up = this.v[0].set(0, 1, 0);
    bone.parent.getWorldQuaternion(this.q[0]);
    up.applyQuaternion(this.q[0].invert());
    this.q[1].setFromAxisAngle(up, angle);
    bone.quaternion.premultiply(this.q[1]);
    bone.updateMatrixWorld(true);
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

  // Two-bone IK. The elbow bends towards where it already is (from the idle), pushed out to the
  // side (`side` -1 right, +1 left) and down, which keeps elbows natural through the swing.
  solveArm(arm, target, side) {
    const S = arm.upper.getWorldPosition(this.v[3]);
    const E = arm.lower.getWorldPosition(this.v[4]);
    const H = arm.hand.getWorldPosition(this.v[5]);
    const a = S.distanceTo(E);
    const b = E.distanceTo(H);
    const dir = this.v[6].subVectors(target, S);
    const d = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, dir.length()));
    dir.normalize();
    const pole = this.v[7].subVectors(E, S);
    pole.x += side * 0.15 * this.scale;
    pole.y -= 0.15 * this.scale;
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const elbow = this.v[2].copy(S).addScaledVector(dir, a * cosA).addScaledVector(pole, a * sinA);
    const wrist = this.v[1].copy(S).addScaledVector(dir, d);
    // aim() reuses v[0..2], so keep the targets elsewhere.
    this.v[8].copy(elbow);
    this.v[9].copy(wrist);
    this.aim(arm.upper, E, this.v[8]);
    this.aim(arm.lower, arm.hand.getWorldPosition(this.v[5]), this.v[9]);
  }

  // Rolls the hand so the knuckle line (little finger to index) runs along the bat: a hammer grip.
  gripHand(arm, batDir) {
    const h = arm.hand.getWorldPosition(this.v[0]);
    const A = arm.mid.getWorldPosition(this.v[1]).sub(h).normalize();
    const T = arm.index.getWorldPosition(this.v[2]).sub(arm.pinky.getWorldPosition(this.v[3]));
    T.addScaledVector(A, -T.dot(A)).normalize();
    const A2 = this.v[4].copy(A).addScaledVector(batDir, -A.dot(batDir)).normalize();
    this.m[0].makeBasis(A, T, this.v[5].crossVectors(A, T));
    this.m[1].makeBasis(A2, batDir, this.v[6].crossVectors(A2, batDir));
    this.m[1].multiply(this.m[0].transpose());
    this.q[0].setFromRotationMatrix(this.m[1]);
    arm.hand.getWorldQuaternion(this.q[1]).premultiply(this.q[0]);
    arm.hand.parent.getWorldQuaternion(this.q[2]);
    arm.hand.quaternion.copy(this.q[2].invert().multiply(this.q[1]));
    arm.hand.updateMatrixWorld(true);
  }

  // A point inside the closed fist: most of the way from the wrist to the knuckles.
  fistCentre(arm, out) {
    const h = arm.hand.getWorldPosition(this.v[0]);
    return out.copy(arm.mid.getWorldPosition(this.v[1])).sub(h).multiplyScalar(0.7).add(h);
  }

  // The ball during a swing: in the left hand, then tossed so it meets the bat at contact.
  updateBall() {
    if (this.ball === 'none') return;
    if (this.ball === 'held') {
      this.fistCentre(this.bones.left, this.ballPos);
      if (this.move === SWING && this.time >= SWING.release) {
        // Launch the toss on a gravity arc that lands on the sweet spot at the moment of contact.
        const flight = SWING.contact - this.time;
        const to = this.root.localToWorld(this.v[11].copy(this.contactLocal));
        this.tossFrom.copy(this.ballPos);
        this.tossVel.subVectors(to, this.tossFrom).divideScalar(flight);
        this.tossVel.y += 0.5 * GRAVITY * flight;
        this.tossStart = this.time;
        this.ball = 'tossed';
      }
      return;
    }
    const s = this.time - this.tossStart;
    this.ballPos.copy(this.tossFrom).addScaledVector(this.tossVel, s);
    this.ballPos.y -= 0.5 * GRAVITY * s * s;
  }

  // Called when the ball leaves the bat.
  releaseBall() {
    this.ball = 'none';
  }
}
