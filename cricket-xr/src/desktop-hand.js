import { CFG } from './config.js';
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Raycaster,
  RingGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
} from '@iwsdk/core';

// Mouse-controlled hand for visitors without a headset: the pointer moves a hand on the plane
// where balls arrive. It switches itself off as soon as an XR session starts.
const CATCH_PLANE_Z = CFG.arriveZ;

export class DesktopHand {
  constructor(world) {
    this.world = world;
    this.position = new Vector3(0, 1.2, CATCH_PLANE_Z);
    this.active = false;
    this.seen = false; // has the pointer moved over the canvas yet?

    this.plane = new Plane(new Vector3(0, 0, 1), -CATCH_PLANE_Z); // the plane z = CATCH_PLANE_Z
    this.ray = new Raycaster();
    this.ndc = new Vector2();
    this.hit = new Vector3();

    // A soft ring with a dot in the middle, so the player can see where their hand is.
    this.marker = new Group();
    const material = new MeshBasicMaterial({ color: 0x7fe6ff, transparent: true, opacity: 0.8, side: DoubleSide, depthTest: false });
    this.marker.add(new Mesh(new RingGeometry(0.17, 0.2, 40), material), new Mesh(new SphereGeometry(0.025, 12, 8), material));
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    world.createTransformEntity(this.marker);

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
      this.marker.visible = false;
      return;
    }
    this.ray.setFromCamera(this.ndc, this.world.camera);
    if (this.ray.ray.intersectPlane(this.plane, this.hit)) {
      this.position.set(
        Math.min(1.5, Math.max(-1.5, this.hit.x)),
        Math.min(2.4, Math.max(0.3, this.hit.y)),
        CATCH_PLANE_Z,
      );
    }
    this.active = true;
    this.marker.position.copy(this.position);
    this.marker.visible = true;
  }
}
