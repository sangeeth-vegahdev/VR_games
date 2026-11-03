import { Plane, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { CFG } from './config.js';

// Mouse control for visitors without a headset: the pointer moves the mitt on the plane where
// pitches arrive. It switches itself off as soon as an XR session starts.
const CATCH_PLANE_Z = CFG.arriveZ;

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

    const el = world.renderer.domElement;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.seen = true;
    };
    el.addEventListener('pointermove', onMove);
    this.dispose = () => el.removeEventListener('pointermove', onMove);
  }

  update() {
    if (this.world.session || !this.seen) {
      this.active = false;
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
