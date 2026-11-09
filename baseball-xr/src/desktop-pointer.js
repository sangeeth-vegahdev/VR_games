import { Plane, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { CFG } from './config.js';

// Mouse control for visitors without a headset, and for the browser XR emulator (IWER).
// The pointer moves the mitt on the plane where pitches arrive.
//
// Outside an XR session the mouse ray is cast through the page camera. Inside a session (the
// emulator) the page camera is the headset, so the pointer is mapped straight to a reach area
// instead: left/right across +-1.2 m and low/high from 0.3 m to 2.2 m, so low and high catches can
// be made with the mouse alone. In Play mode (pointer locked) the mouse movement is accumulated.
//
// On a real headset no pointer events reach the canvas, so `seen` never turns on and the tracked
// hands or controllers are used. In the emulator, moving a controller by its handle hands control
// back to it until the mouse moves again.
const CATCH_PLANE_Z = CFG.arriveZ;
const SESSION_X = 1.2;
const SESSION_Y0 = 1.25;
const SESSION_Y = 0.95;

export class DesktopPointer {
  constructor(world) {
    this.world = world;
    this.position = new Vector3(0, 1.2, CATCH_PLANE_Z);
    this.active = false;
    this.seen = false; // has the pointer moved over the canvas yet?
    this.plane = new Plane(new Vector3(0, 0, 1), -CATCH_PLANE_Z); // the plane z = CATCH_PLANE_Z
    this.ray = new Raycaster();
    this.ndc = new Vector2();
    this.hit = new Vector3();
    this.gripSum = new Vector3(); // grips' summed position, to notice a controller being moved
    this.gripPrev = new Vector3();
    this.gripKnown = false;
    this.tmp = new Vector3();

    const el = window; // the page can hold more than one canvas; accept the pointer over any of them
    const onMove = (e) => {
      const cv = e.target;
      if (!cv || cv.tagName !== 'CANVAS') return; // ignore the emulator's panels and page UI
      if (document.pointerLockElement === cv) {
        const r = cv.getBoundingClientRect();
        this.ndc.x = Math.max(-1, Math.min(1, this.ndc.x + (e.movementX / r.width) * 2));
        this.ndc.y = Math.max(-1, Math.min(1, this.ndc.y - (e.movementY / r.height) * 2));
      } else {
        const r = cv.getBoundingClientRect();
        this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      }
      this.seen = true;
      this.gripKnown = false;
    };
    el.addEventListener('pointermove', onMove);
    this.dispose = () => el.removeEventListener('pointermove', onMove);
  }

  // A controller moved by hand (emulator handle) takes control back from the mouse.
  controllerMoved(player) {
    if (!player || !player.gripSpaces) return false;
    this.gripSum.set(0, 0, 0);
    for (const side of ['left', 'right']) {
      const g = player.gripSpaces[side];
      if (g && g.visible) this.gripSum.add(g.getWorldPosition(this.tmp));
    }
    const moved = this.gripKnown && this.gripSum.distanceTo(this.gripPrev) > 0.03;
    this.gripPrev.copy(this.gripSum);
    this.gripKnown = true;
    return moved;
  }

  update(player) {
    if (!this.seen) {
      this.active = false;
      return;
    }
    if (this.world.session) {
      if (this.controllerMoved(player)) {
        this.seen = false;
        this.active = false;
        return;
      }
      this.position.set(
        this.ndc.x * SESSION_X,
        SESSION_Y0 + this.ndc.y * SESSION_Y,
        CATCH_PLANE_Z,
      );
      this.active = true;
      return;
    }
    this.ray.setFromCamera(this.ndc, this.world.camera);
    if (this.ray.ray.intersectPlane(this.plane, this.hit)) {
      this.position.set(
        Math.min(1.4, Math.max(-1.4, this.hit.x)),
        Math.min(2.3, Math.max(0.3, this.hit.y)),
        CATCH_PLANE_Z,
      );
    }
    this.active = true;
  }
}
