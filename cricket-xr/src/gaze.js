import { Quaternion, Vector3 } from '@iwsdk/core';
import { CFG } from './config.js';

// "Eyes on the ball": where is the player looking while the delivery is in the air?
//
// The game asks the headset for eye gaze (the `gaze-tracking` WebXR feature, see iwsdk.config.json).
// When the headset has eye tracking and the player allows it, the SDK reports a tracked gaze ray
// (`player.eyeSpace`, valid while `player.gazeOrigin === 'tracked'`), and that is used. Some
// runtimes report a "gaze" ray that is only the head's direction; that is detected (the ray never
// leaves the head's forward line) and labelled as head tracking. Without any gaze ray the head's
// direction is used. The cone that counts as "watching" is wider for the head, because the eyes can
// lead the head by several degrees.
//
// On a PC there is no head to track, so focus is not measured.

const SEPARATION_DEG = 2.5; // a gaze ray this far off the head's forward line is real eye tracking

export class FocusTracker {
  constructor() {
    this.mode = 'none'; // 'eyes' | 'head' | 'none'
    this.eyeSeen = false; // has the gaze ray ever separated from the head direction?
    this.origin = new Vector3();
    this.dir = new Vector3(0, 0, -1);
    this.watching = false;
    this.v = new Vector3();
    this.headDir = new Vector3();
    this.q = new Quaternion();
    this.resetPitch();
  }

  resetPitch() {
    this.watchTime = 0;
    this.flightTime = 0;
    this.lostAt = null; // how far from the player the ball was when the eyes last left it
    this.wasWatching = false;
  }

  // Reads this frame's gaze. inHeadset: an XR session is running.
  sample(player, camera, inHeadset) {
    if (!inHeadset) {
      this.mode = 'none';
      camera.getWorldPosition(this.origin);
      camera.getWorldDirection(this.dir);
      return;
    }
    player.head.getWorldPosition(this.origin);
    this.headDir.set(0, 0, -1).applyQuaternion(player.head.getWorldQuaternion(this.q));
    if (player.gazeOrigin === 'tracked' && player.eyeSpace) {
      player.eyeSpace.getWorldPosition(this.v);
      this.dir.set(0, 0, -1).applyQuaternion(player.eyeSpace.getWorldQuaternion(this.q));
      if (!this.eyeSeen && this.dir.angleTo(this.headDir) > (SEPARATION_DEG * Math.PI) / 180) this.eyeSeen = true;
      if (this.eyeSeen) {
        this.origin.copy(this.v);
        this.mode = 'eyes';
        return;
      }
    }
    this.dir.copy(this.headDir);
    this.mode = 'head';
  }

  // Called every frame the ball is in flight. distance: ball to player, for the "looked away" note.
  track(ballPos, dt, distance) {
    if (this.mode === 'none') {
      this.watching = false;
      return;
    }
    const cone = this.mode === 'eyes' ? CFG.focusConeEyes : CFG.focusConeHead;
    const to = this.v.subVectors(ballPos, this.origin);
    this.watching = to.lengthSq() > 1e-6 && this.dir.angleTo(to) < (cone * Math.PI) / 180;
    this.flightTime += dt;
    if (this.watching) this.watchTime += dt;
    if (this.wasWatching && !this.watching) this.lostAt = distance;
    if (this.watching) this.lostAt = null;
    this.wasWatching = this.watching;
  }

  // 0..1 share of the flight the eyes were on the ball, or null when not measured.
  get focus() {
    if (this.mode === 'none' || this.flightTime <= 0) return null;
    return this.watchTime / this.flightTime;
  }
}

