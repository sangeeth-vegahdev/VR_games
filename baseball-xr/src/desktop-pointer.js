import { Plane, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { CFG } from './config.js';

// The mouse as the mitt, for visitors without a headset and as a fallback in the browser XR
// emulator.
//
// Where the pointer is: the pointer's ray is cast through the world camera (`world.camera`) onto
// the catch plane. In a browser that is the desktop camera. In an XR session the renderer keeps
// `world.camera` on the headset's pose and projection, so the mitt appears exactly where the
// pointer is on what the player sees, for any head position and rotation. Nothing is hardcoded in
// world space.
//
// The resting point: the desktop camera is tilted (iwsdk.config.json, render.camera.lookAt) so the
// screen centre's ray meets the called zone (CFG.targetBelowHead below the camera). The mouse
// mapping stays a pure camera ray, so the mitt always sits under the pointer.
//
// Motion: the target moves at once with the pointer, and the mitt eases towards it with a
// frame-rate-independent blend (no jumps, no shaking, about 40 ms to two-thirds of the way).
//
// Who drives the mitt in an XR session (highest priority first):
// 1. Tracked hands. While a hand is live the mouse never moves the mitt. In the emulator's hand
//    mode the mouse drags the virtual hands, so that drag must not steer the mitt.
// 2. Tracked controllers. A controller moved by hand more than TAKEOVER_M from where it was when the
//    mouse last moved takes control back, until the mouse moves again.
// 3. The mouse, when nothing else is tracked or the controllers are still.

const CATCH_PLANE_Z = CFG.arriveZ;
// The limits cover the whole view at the desktop camera's distance (about +-3 m wide at 2.5 m), so the
// mitt follows the pointer across the screen. They only stop it going through the floor or above the
// top of the screen; the ball's path is central, so distance from the body does not limit a catch.
const REACH_X = 3.5; // m, either side of the body
const REACH_Y0 = 0.05; // m, above the floor
const REACH_Y1 = 3.0; // m, the top of the view
const TAKEOVER_M = 0.05; // a controller moved this far (m) from its anchor hands control back
const FOLLOW_RATE = 48; // 1/s: responsive follow rate so glove snaps tightly to cursor
const SNAP_M = 0.4; // a target this far from the mitt (a view or tracking jump) is taken at once

export class DesktopPointer {
  constructor(world) {
    this.world = world;
    this.target = new Vector3(0, 0.85, CATCH_PLANE_Z); // centered in strike zone target square
    this.position = new Vector3().copy(this.target); // where the mitt is: eased towards the target
    this.active = false; // does the mouse drive the mitt this frame?
    this.clamped = false; // is the pointer past the mitt's reach (the mitt is held at its edge)?
    this.seen = false; // has the mouse moved since the last takeover?
    this.plane = new Plane(new Vector3(0, 0, 1), -CATCH_PLANE_Z); // the plane z = CATCH_PLANE_Z
    this.ray = new Raycaster();
    this.ndc = new Vector2();
    this.bottomNdc = new Vector2(0, -1); // the bottom edge of the view, straight down the middle
    this.hit = new Vector3();
    this.tmp = new Vector3();
    this.grip = new Vector3();
    this.anchor = new Vector3(); // controllers' centre when the mouse last moved
    this.anchored = false;
    this.handAnchor = new Vector3();
    this.handAnchored = false;
    this.wasActive = false; // was the mouse driving the mitt last frame?
    this.cv = null;

    // Any pointer move counts, including over the emulator's bottom bar: low catches happen down
    // there, so the mitt keeps following the mouse over it. Positions are measured against the game
    // canvas and clamped to its edges.
    const onMove = (e) => {
      const cv = this.canvas();
      if (!cv) return;
      const r = cv.getBoundingClientRect();
      if (document.pointerLockElement === cv) {
        this.ndc.x = Math.max(-1, Math.min(1, this.ndc.x + (e.movementX / r.width) * 2));
        this.ndc.y = Math.max(-1.1, Math.min(1, this.ndc.y - (e.movementY / r.height) * 2));
      } else {
        const x = ((e.clientX - r.left) / r.width) * 2 - 1;
        const y = -((e.clientY - r.top) / r.height) * 2 + 1;
        this.ndc.set(Math.max(-1, Math.min(1, x)), Math.max(-1.1, Math.min(1, y)));
      }
      this.seen = true;
      this.anchored = false; // re-anchor the controllers at the next frame
      this.handAnchored = false;
    };
    window.addEventListener('pointermove', onMove);
    this.dispose = () => window.removeEventListener('pointermove', onMove);
  }

  // The game's canvas (the page can hold other canvases, such as the emulator's).
  canvas() {
    if (!this.cv || !this.cv.isConnected) {
      this.cv = document.querySelector('#scene-container canvas') || document.querySelector('canvas');
    }
    return this.cv;
  }

  // Centre of the tracked hands' grips, or null when none is tracked.
  handCentre(player) {
    if (!player || !player.gripSpaces) return null;
    const session = this.world.session;
    if (!session || !session.inputSources) return null;
    let n = 0;
    this.tmp.set(0, 0, 0);
    for (const source of session.inputSources) {
      if (!source.hand) continue;
      const grip = player.gripSpaces[source.handedness];
      if (grip && grip.visible) {
        this.tmp.add(grip.getWorldPosition(this.grip));
        n++;
      }
    }
    return n ? this.tmp.divideScalar(n) : null;
  }

  // Has a hand been moved in physical space or emulator drag since the mouse last moved?
  handsMoved(player) {
    const c = this.handCentre(player);
    if (!c) {
      this.handAnchored = false;
      return false;
    }
    if (!this.handAnchored) {
      this.handAnchor.copy(c);
      this.handAnchored = true;
      return false;
    }
    return c.distanceTo(this.handAnchor) > TAKEOVER_M;
  }

  // Centre of the tracked controllers' grips, or null when none is tracked.
  controllerCentre(player) {
    if (!player || !player.gripSpaces) return null;
    let n = 0;
    this.tmp.set(0, 0, 0);
    for (const side of ['left', 'right']) {
      const g = player.gripSpaces[side];
      if (g && g.visible) {
        this.tmp.add(g.getWorldPosition(this.grip));
        n++;
      }
    }
    return n ? this.tmp.divideScalar(n) : null;
  }

  // Has a controller been moved by hand since the mouse last moved?
  controllersMoved(player) {
    const c = this.controllerCentre(player);
    if (!c) {
      this.anchored = false; // no controller: re-anchor when one appears
      return false;
    }
    if (!this.anchored) {
      this.anchor.copy(c);
      this.anchored = true;
      return false;
    }
    return c.distanceTo(this.anchor) > TAKEOVER_M;
  }

  // Get active rig offset in WebXR to align camera ray origin with real eye level
  rigOffset() {
    if (!this.world?.session) return null;
    const rig = this.world?.player || (this.world?.scene?.getObjectByName && this.world.scene.getObjectByName('player'));
    return rig?.position || null;
  }

  // The lowest height the mouse can put the mitt at (the bottom edge of the view meets the catch plane).
  // Used to tell the player when a low ball needs a head tilt. -Infinity if the edge misses the plane.
  lowestReach() {
    this.ray.setFromCamera(this.bottomNdc, this.world.camera);
    const ro = this.rigOffset();
    if (ro) this.ray.ray.origin.add(ro);
    return this.ray.ray.intersectPlane(this.plane, this.tmp) ? this.tmp.y : -Infinity;
  }

  // Where the pointer's ray meets the catch plane, through the world camera. Returns false when the
  // ray does not meet the plane (the camera is looking away from it).
  projectToPlane(out) {
    this.ray.setFromCamera(this.ndc, this.world.camera);
    const ro = this.rigOffset();
    if (ro) this.ray.ray.origin.add(ro);
    if (!this.ray.ray.intersectPlane(this.plane, out)) return false;

    // Optical ray matches the cursor across the visible view:
    // When the camera ray meets the catch plane at or above lowestReach (normal visible screen area),
    // out.y remains the true optical intersection point so the mitt sits exactly under the mouse cursor.
    // As the mouse approaches the bottom edge (ndc.y < -0.85) and past it, smoothly extend reach down to REACH_Y0
    // so pitches that cross below the camera frustum (e.g. low balls in the dirt) are easily scooped.
    const lowest = this.lowestReach();
    if (lowest > REACH_Y0 && this.ndc.y < -0.85) {
      const shortfall = lowest - REACH_Y0;
      const t = Math.min(1, (-this.ndc.y - 0.85) / 0.15);
      const k = t * t * (3 - 2 * t);
      out.y -= shortfall * k;
    }
    return true;
  }

  // Ease the mitt towards the target. Frame-rate independent: the blend is 1 - e^(-rate dt).
  ease(dt) {
    if (!this.wasActive || this.position.distanceTo(this.target) > SNAP_M) {
      this.position.copy(this.target);
    } else {
      this.position.lerp(this.target, 1 - Math.exp(-FOLLOW_RATE * dt));
    }
  }

  release() {
    this.seen = false;
    this.active = false;
    this.wasActive = false;
  }

  update(player, dt = 1 / 60) {
    const session = this.world.session;
    if (session && this.seen && this.handsMoved(player)) {
      this.release(); // a hand moved in real space takes control
      return;
    }
    if (session && this.seen && this.controllersMoved(player)) {
      this.release(); // a controller moved by hand takes control back
      return;
    }
    if (!this.seen) {
      this.active = false;
      this.wasActive = false;
      return;
    }
    if (this.projectToPlane(this.hit)) {
      const { x, y } = this.hit;
      // Past the reach the mitt stops at its edge, so the pointer and the mitt part there.
      this.clamped = Math.abs(x) > REACH_X || y < REACH_Y0 || y > REACH_Y1;
      this.target.set(Math.max(-REACH_X, Math.min(REACH_X, x)), Math.max(REACH_Y0, Math.min(REACH_Y1, y)), CATCH_PLANE_Z);
    }
    this.ease(dt);
    this.active = true;
    this.wasActive = true;
  }
}
