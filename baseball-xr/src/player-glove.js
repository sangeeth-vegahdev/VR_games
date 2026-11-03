import { Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import { makeMitt } from './glove.js';
import { trackedHands } from './hands.js';

// The player's catcher's mitt. It is worn on one hand (left by default; it can be swapped) and
// follows that hand every frame:
// - with hand tracking, from the hand's joints: the palm's position and facing, and how far the
//   fingers are closed (pinch thumb and fingers together and the mitt closes);
// - with a hand whose joints are not available, from its grip pose, held up facing the pitcher;
// - on a PC, from the mouse.
// The hand inside the mitt is hidden, so only the mitt is seen.

const POCKET_OUT = 0.05; // the pocket's centre sits this far in front of the palm
const OPEN_AT = 0.11; // thumb-tip to middle-tip distance (m): fully open...
const CLOSED_AT = 0.04; // ...and fully closed

export class PlayerGlove {
  constructor(world, side) {
    this.side = side;
    this.mitt = makeMitt('catcher');
    this.object = this.mitt.object;
    this.object.visible = false;
    world.createTransformEntity(this.object);

    this.pocket = new Vector3(); // world position of the pocket centre
    this.normal = new Vector3(0, 0, -1); // which way the pocket opens
    this.ok = false; // is the mitt being tracked this frame?
    this.squeeze = 0; // 0..1 from the player's fingers
    this.hold = 0; // forced closed while holding a caught ball

    this.v = Array.from({ length: 8 }, () => new Vector3());
    this.m = new Matrix4();
    this.q = new Quaternion();
    this.useJoints = true; // the headless test turns this off to drive the mitt from the grip pose
  }

  setSide(side) {
    this.side = side;
  }

  update(player, desktop, inHeadset) {
    if (!inHeadset) {
      this.updateDesktop(desktop);
    } else {
      this.updateTracked(player);
    }
    // Only the hand that is not in the mitt is drawn.
    for (const s of ['left', 'right']) {
      const h = trackedHands[s];
      if (h && h.mesh) h.mesh.visible = s !== this.side;
    }
    const close = Math.max(this.squeeze, this.hold);
    this.mitt.setClose(close);
    this.object.visible = this.ok;
  }

  updateDesktop(desktop) {
    this.ok = desktop.active;
    if (!this.ok) return;
    // Held up in front, pocket to the pitcher, fingers up, leaning a little like a real target.
    this.setPose(desktop.position, this.v[0].set(0, 0.97, 0.24), this.v[1].set(0, 0, -1), this.side === 'left' ? 1 : -1);
    this.squeeze = 0.1;
  }

  updateTracked(player) {
    const grip = player.gripSpaces[this.side];
    this.ok = grip.visible;
    if (!this.ok) return;
    const hand = trackedHands[this.side];
    const j = hand && hand.joints;
    if (this.useJoints && j && j.wrist && j['middle-finger-phalanx-proximal'] && j['index-finger-metacarpal'] && j['pinky-finger-metacarpal'] && hand.model.visible) {
      const wrist = j.wrist.getWorldPosition(this.v[2]);
      const knuckle = j['middle-finger-phalanx-proximal'].getWorldPosition(this.v[3]);
      const fingers = this.v[0].subVectors(knuckle, wrist).normalize();
      const across = j['index-finger-metacarpal'].getWorldPosition(this.v[4]).sub(j['pinky-finger-metacarpal'].getWorldPosition(this.v[5]));
      across.addScaledVector(fingers, -across.dot(fingers)).normalize();
      // Palm normal. For a right hand, across x fingers points out of the palm; a left hand is mirrored.
      const normal = this.v[1].crossVectors(across, fingers);
      if (this.side === 'left') normal.negate();
      const palm = this.v[6].copy(wrist).lerp(knuckle, 0.5);
      // The thumb is on the index-finger side.
      const x = this.v[7].crossVectors(fingers, normal);
      this.setPose(palm.addScaledVector(normal, POCKET_OUT), fingers, normal, x.dot(across) >= 0 ? 1 : -1, true);
      if (j['thumb-tip'] && j['middle-finger-tip']) {
        const d = j['thumb-tip'].getWorldPosition(this.v[2]).distanceTo(j['middle-finger-tip'].getWorldPosition(this.v[3]));
        this.squeeze = Math.max(0, Math.min(1, (OPEN_AT - d) / (OPEN_AT - CLOSED_AT)));
      }
      return;
    }
    // No joints: use the grip position, mitt held up facing the pitcher.
    const p = grip.getWorldPosition(this.v[6]);
    this.setPose(p, this.v[0].set(0, 0.97, 0.24), this.v[1].set(0, 0, -1), this.side === 'left' ? 1 : -1);
    this.squeeze = 0;
  }

  // pocketPos: world position of the pocket centre. up: fingertip direction. normal: pocket opening.
  // thumb: +1 if the thumb is on the right of the pocket as seen from inside it, -1 if mirrored.
  setPose(pocketPos, up, normal, thumb, exact = false) {
    const y = up.normalize();
    const z = normal.addScaledVector(y, -normal.dot(y)).normalize();
    const x = this.v[5].crossVectors(y, z);
    this.m.makeBasis(x, y, z);
    this.object.quaternion.setFromRotationMatrix(this.m);
    // Mirror the mitt so its thumb sits on the hand's thumb side.
    const flip = exact ? thumb : this.side === 'left' ? -1 : 1;
    this.object.scale.set(flip, 1, 1);
    this.object.position.copy(pocketPos);
    this.pocket.copy(pocketPos);
    this.normal.copy(z);
  }
}

// Position of the bare hand (the one without the mitt), for "use the glove" misses.
export function bareHand(player, gloveSide, out) {
  const side = gloveSide === 'left' ? 'right' : 'left';
  const grip = player.gripSpaces[side];
  if (!grip.visible) return null;
  return grip.getWorldPosition(out);
}
