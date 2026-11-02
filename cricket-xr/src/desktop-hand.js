import { CFG } from './config.js';
import { skin } from './hands.js';
import {
  AssetManager,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Raycaster,
  RingGeometry,
  Vector2,
  Vector3,
} from '@iwsdk/core';

// Mouse-controlled hand for visitors without a headset: the pointer moves a hand on the plane
// where balls arrive. It switches itself off as soon as an XR session starts.
// The hand is the same rigged model the headset uses, held up with the palm facing the coach.
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

    this.marker = new Group();
    // The ring shows the catch reach around the hand; it draws over the hand so it never hides.
    const material = new MeshBasicMaterial({ color: 0x7fe6ff, transparent: true, opacity: 0.55, side: DoubleSide, depthTest: false });
    this.marker.add(new Mesh(new RingGeometry(0.2, 0.225, 48), material));
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    world.createTransformEntity(this.marker);

    this.hand = this.buildHand();
    if (this.hand) {
      this.hand.visible = false;
      world.createTransformEntity(this.hand);
    }

    const el = world.renderer.domElement;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.seen = true;
    };
    el.addEventListener('pointermove', onMove);
    this.dispose = () => el.removeEventListener('pointermove', onMove);
  }

  // Stands the model's right hand upright, palm towards the coach, with the palm centre at the
  // group's origin. The model's own bind pose is not upright, so the turn is worked out from its joints.
  buildHand() {
    let gltf;
    try {
      gltf = AssetManager.getGLTF('hand-right');
    } catch (e) {
      return null; // the ring alone still works
    }
    if (!gltf) return null;
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const at = (name) => model.getObjectByName(name).getWorldPosition(new Vector3());
    const wrist = at('wrist');
    const knuckle = at('middle-finger-phalanx-proximal');
    const fingers = at('middle-finger-tip').sub(wrist).normalize();
    const across = at('index-finger-metacarpal').sub(at('pinky-finger-metacarpal'));
    across.addScaledVector(fingers, -across.dot(fingers)).normalize();
    const out = new Vector3().crossVectors(across, fingers);
    // Model axes (index side, fingers, out) -> world (-x, +y, -z): fingers up, palm facing the coach.
    const from = new Matrix4().makeBasis(across, fingers, out);
    const to = new Matrix4().makeBasis(new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, -1));
    const turn = to.multiply(from.transpose());

    model.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.material = skin;
        o.frustumCulled = false;
      }
    });
    const inner = new Group();
    inner.add(model);
    inner.quaternion.setFromRotationMatrix(turn);
    const palm = wrist.clone().lerp(knuckle, 0.55).applyMatrix4(turn);
    inner.position.copy(palm).negate();
    const hand = new Group();
    hand.add(inner);
    hand.scale.setScalar(1.4); // the desktop camera sits further back than a player's eyes, so it reads larger
    return hand;
  }

  update() {
    if (this.world.session || !this.seen) {
      this.active = false;
      this.marker.visible = false;
      if (this.hand) this.hand.visible = false;
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
    if (this.hand) {
      this.hand.position.copy(this.position);
      this.hand.visible = true;
    }
  }
}
