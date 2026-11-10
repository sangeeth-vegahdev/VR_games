import { Quaternion, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { CFG } from './config.js';

// "Eyes on the ball": where is the player looking while the pitch is in the air?
//
// The game asks the headset for eye gaze (the `gaze-tracking` WebXR feature, see iwsdk.config.json).
// When the headset has eye tracking and the player allows it, the SDK reports a tracked gaze ray
// (`player.eyeSpace`, valid while `player.gazeOrigin === 'tracked'`), and that is used. Some
// runtimes report a "gaze" ray that is only the head's direction; that is detected (the ray never
// leaves the head's forward line) and labelled as head tracking. Without any gaze ray the head's
// direction is used. The cone that counts as "watching" is wider for the head, because the eyes can
// lead the head by several degrees.
//
// On desktop PC testing, moving the mouse aims the gaze ray across the view so tracking the ball
// can be tested and verified smoothly with instant visual lock-on.

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
    this.ray = new Raycaster();
    this.ndc = new Vector2();
    this.emuX = 0; // -1..1 across the view
    this.emuY = 0;
    this.emuMoved = false;
    this.simulated = false; // true while the mouse is standing in for the eyes
    this.cv = null;

    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('pointermove', (e) => {
        const cv = this.canvas();
        const r = cv ? cv.getBoundingClientRect() : null;
        const w = (r && r.width > 0) ? r.width : (window.innerWidth || 1);
        const h = (r && r.height > 0) ? r.height : (window.innerHeight || 1);
        const left = r ? r.left : 0;
        const top = r ? r.top : 0;
        this.ndc.x = Math.max(-1, Math.min(1, ((e.clientX - left) / w) * 2 - 1));
        this.ndc.y = Math.max(-1, Math.min(1, -(((e.clientY - top) / h) * 2 - 1)));
        this.emuX = this.ndc.x;
        this.emuY = this.ndc.y;
        this.emuMoved = true;
      });
    }
    this.resetPitch();
  }

  canvas() {
    if (!this.cv || !this.cv.isConnected) {
      this.cv = (typeof document !== 'undefined')
        ? (document.querySelector('#scene-container canvas') || document.querySelector('canvas'))
        : null;
    }
    return this.cv;
  }

  resetPitch() {
    this.watchTime = 0;
    this.flightTime = 0;
    this.lostAt = null; // how far from the player the ball was when the eyes last left it
    this.wasWatching = false;
  }

  // Reads this frame's gaze. inHeadset: an XR session is running.
  sample(player, camera, inHeadset) {
    this.simulated = false;

    // 1. Genuine hardware eye tracking (Meta Quest Pro)
    if (inHeadset && player) {
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
    }

    // 2. Desktop simulated gaze: active when testing on desktop outside XR,
    // or inside browser XR emulator when mouse is moved to aim gaze
    const isEmulator = typeof window !== 'undefined' && !!(window.IWER_DEVICE || window.__IWER__);
    if ((!inHeadset || isEmulator) && this.emuMoved && camera) {
      if (camera.isCamera) {
        this.ndc.set(this.emuX, this.emuY);
        this.ray.setFromCamera(this.ndc, camera);
        this.origin.copy(this.ray.ray.origin);
        this.dir.copy(this.ray.ray.direction).normalize();
      } else {
        camera.getWorldPosition(this.origin);
        this.dir.set(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(this.q));
      }
      this.mode = 'eyes';
      this.simulated = true;
      return;
    }

    // 3. Headset without eye tracking (Meta Quest 3 fallback on physical device)
    if (inHeadset && player && player.head) {
      this.dir.copy(this.headDir);
      this.mode = 'head';
      return;
    }

    // 4. Default outside headset before mouse moves
    if (camera) {
      camera.getWorldPosition(this.origin);
      this.dir.set(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(this.q));
    }
    this.mode = 'none';
  }

  // Called every frame the ball is in flight. distance: ball to player, for the "looked away" note.
  track(ballPos, dt, distance) {
    if (this.mode === 'none') {
      this.watching = false;
      return;
    }
    // Generous tracking cone for desktop mouse simulation (18 deg) so players on 2D screens
    // can follow high-speed pitches naturally and lock on easily
    const baseCone = this.mode === 'eyes' ? CFG.focusConeEyes : CFG.focusConeHead;
    const cone = this.simulated ? 18 : baseCone;
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
