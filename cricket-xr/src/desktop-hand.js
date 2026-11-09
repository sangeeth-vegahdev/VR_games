import { CFG } from './config.js';
import { skin, trackedHands } from './hands.js';
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
    const params = new URLSearchParams(globalThis.location?.search || '');
    this.handMode = params.get('hand') || 'right'; // 'right' | 'left' | 'both'

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

    const el = window; // the page can hold more than one canvas; accept the pointer over any of them
    this.gripSum = new Vector3();
    this.gripPrev = new Vector3();
    this.gripKnown = false;
    this.tmp = new Vector3();
    const onMove = (e) => {
      const cv = e.target;
      if (!cv || cv.tagName !== 'CANVAS') return; // ignore the emulator's panels and page UI
      const r = cv.getBoundingClientRect();
      if (document.pointerLockElement === cv) {
        // Emulator Play mode: the pointer is locked, so accumulate its movement.
        this.ndc.x = Math.max(-1, Math.min(1, this.ndc.x + (e.movementX / r.width) * 2));
        this.ndc.y = Math.max(-1, Math.min(1, this.ndc.y - (e.movementY / r.height) * 2));
      } else {
        this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      }
      this.seen = true;
      this.gripKnown = false;
    };
    const onKeyDown = (e) => {
      if (e.key === 'h' || e.key === 'H') {
        this.cycleHandMode();
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('keydown', onKeyDown);
    this.dispose = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('keydown', onKeyDown);
    };
  }

  cycleHandMode() {
    if (this.handMode === 'right') this.handMode = 'left';
    else if (this.handMode === 'left') this.handMode = 'both';
    else this.handMode = 'right';
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

  // A controller moved by hand (emulator handle) takes control back from the mouse.
  controllerMoved(player) {
    if (!player || !player.gripSpaces) return false;
    this.gripSum.set(0, 0, 0);
    for (const side of ['left', 'right']) {
      const g = player.gripSpaces[side];
      if (g && g.visible) this.gripSum.add(g.getWorldPosition(this.tmp));
    }
    const moved = this.gripKnown && this.gripSum.distanceTo(this.gripPrev) > 0.06;
    this.gripPrev.copy(this.gripSum);
    this.gripKnown = true;
    return moved;
  }

  update(player) {
    const inSession = !!this.world.session;
    // Check if live XR hands or controllers are actively providing input
    const liveHandsPresent = inSession && player && player.gripSpaces &&
      (player.gripSpaces.left?.visible || player.gripSpaces.right?.visible ||
       (trackedHands.left?.joints?.wrist && trackedHands.left?.mesh?.visible) ||
       (trackedHands.right?.joints?.wrist && trackedHands.right?.mesh?.visible));

    if (inSession && liveHandsPresent) {
      // In active WebXR session with live or emulated XR hands:
      // Real WebXR hand tracking takes full priority. Never let the mouse hijack or hide hands.
      this.active = false;
      this.seen = false;
      this.marker.visible = false;
      if (this.hand) this.hand.visible = false;
      if (trackedHands.left && trackedHands.left.mesh) trackedHands.left.mesh.visible = true;
      if (trackedHands.right && trackedHands.right.mesh) trackedHands.right.mesh.visible = true;
      return;
    }

    if (this.seen && inSession && this.controllerMoved(player)) {
      this.seen = false;
    }
    if (!this.seen) {
      this.active = false;
      this.marker.visible = false;
      if (this.hand) this.hand.visible = false;
      if (trackedHands.left && trackedHands.left.mesh) trackedHands.left.mesh.visible = true;
      if (trackedHands.right && trackedHands.right.mesh) trackedHands.right.mesh.visible = true;
      return;
    }
    if (inSession) {
      // Flat preview in emulator when no hands are connected:
      // Map pointer across comfortable catch zone: +-1.2m left/right and 0.25m up to 2.2m
      this.position.set(this.ndc.x * 1.2, 1.25 + this.ndc.y * 0.95, CATCH_PLANE_Z);
      if (this.hand) this.hand.scale.setScalar(1);
    } else {
      this.ray.setFromCamera(this.ndc, this.world.camera);
      if (this.ray.ray.intersectPlane(this.plane, this.hit)) {
        this.position.set(
          Math.min(1.5, Math.max(-1.5, this.hit.x)),
          Math.min(2.4, Math.max(0.25, this.hit.y)),
          CATCH_PLANE_Z,
        );
      }
      if (this.hand) this.hand.scale.setScalar(1.4);
    }
    this.active = true;
    this.marker.position.copy(this.position);
    this.marker.visible = true;
    if (this.hand) {
      this.hand.position.copy(this.position);
      this.hand.visible = true;
    }
    // Only in desktop mode when no XR session is active, hide stationary dummy hand models
    if (!inSession) {
      if (trackedHands.left && trackedHands.left.mesh) trackedHands.left.mesh.visible = false;
      if (trackedHands.right && trackedHands.right.mesh) trackedHands.right.mesh.visible = false;
    }
  }
}
