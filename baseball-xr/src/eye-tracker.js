import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
} from '@iwsdk/core';

// Ring tracker that follows the player's eye movement:
//
// In VR, the player's eye gaze ray projects out toward the incoming ball.
// The tracker ring is positioned along the gaze ray at the ball's distance,
// so it shares the ball's exact depth in 3D space with zero vergence-accommodation
// conflict.
//
// When the player tracks the ball with their eyes:
// - The ring remains centered on the ball as it arcs from the mound to the plate.
// - The ring turns vibrant cyan-teal and pulses softly to indicate target lock.
//
// When the player's eyes wander or fall behind the ball's pace:
// - The ring drifts off the ball, giving immediate visual feedback.
// - The ring dims to a translucent neutral tint.

const COLOR_LOCKED = 0x5eead4; // vibrant cyan-teal when eyes are on the ball
const COLOR_IDLE = 0xffffff;   // crisp translucent white when off target
const BASE_ANGULAR_SCALE = 0.045; // reticle scale factor per metre of distance
const MIN_SCALE = 0.14;        // minimum world radius so it frames the ball cleanly near the mitt

export function projectGazePoint(origin, dir, targetPos, out = new Vector3()) {
  const dist = origin.distanceTo(targetPos);
  return out.copy(origin).addScaledVector(dir, dist);
}

export class EyeRingTracker {
  constructor(world) {
    this.world = world;
    this.group = new Group();
    this.group.renderOrder = 20; // draw cleanly over dust, turf, and stadium elements
    this.group.visible = false;

    // Outer reticle ring: frames the ball cleanly
    this.ringMaterial = new MeshBasicMaterial({
      color: COLOR_IDLE,
      transparent: true,
      opacity: 0.5,
      side: DoubleSide,
      depthWrite: false,
    });
    // Base geometry: 0.08 inner, 0.098 outer radius
    this.ringMesh = new Mesh(new RingGeometry(0.08, 0.098, 48), this.ringMaterial);
    this.group.add(this.ringMesh);

    // Subtle outer halo ring (matches the storyboard reticle)
    this.haloMaterial = new MeshBasicMaterial({
      color: COLOR_IDLE,
      transparent: true,
      opacity: 0.2,
      side: DoubleSide,
      depthWrite: false,
    });
    this.haloMesh = new Mesh(new RingGeometry(0.12, 0.126, 48), this.haloMaterial);
    this.group.add(this.haloMesh);

    // Center focus pip
    this.pipMaterial = new MeshBasicMaterial({
      color: COLOR_IDLE,
      transparent: true,
      opacity: 0.35,
      side: DoubleSide,
      depthWrite: false,
    });
    this.pipMesh = new Mesh(new RingGeometry(0, 0.014, 24), this.pipMaterial);
    this.group.add(this.pipMesh);

    world.createTransformEntity(this.group);

    this.targetPoint = new Vector3();
    this.tempOrigin = new Vector3();
    this.tempDir = new Vector3();
    this.visible = false;
    this.pulseTime = 0;
  }

  show() {
    this.visible = true;
    this.group.visible = true;
  }

  hide() {
    this.visible = false;
    this.group.visible = false;
  }

  // Update ring tracker position and styling based on live eye gaze.
  // focus: FocusTracker instance
  // ballPos: current Vector3 position of the baseball
  // isWatching: boolean, whether eyes are currently locked inside the focus cone
  // inHeadset: boolean, whether WebXR session is active
  // camera: PerspectiveCamera
  // desktop: DesktopPointer instance
  // dt: delta time in seconds
  update(focus, ballPos, isWatching, inHeadset, camera, desktop, dt = 1 / 60) {
    if (!this.visible) {
      this.group.visible = false;
      return;
    }

    let origin = focus.origin;
    let dir = focus.dir;

    // Desktop pointer fallback when outside VR headset
    if (!inHeadset && desktop && desktop.active) {
      camera.getWorldPosition(this.tempOrigin);
      origin = this.tempOrigin;
      dir = desktop.ray.ray.direction;
    }

    // Distance from the viewer's eye to the ball
    const dist = origin.distanceTo(ballPos);
    projectGazePoint(origin, dir, ballPos, this.targetPoint);

    // Position tracker at gaze projection point
    this.group.position.copy(this.targetPoint);

    // Always orient the tracker ring flat to the viewer
    this.group.lookAt(origin);

    // Scale with distance so angular size remains comfortable across 18m to 1m
    const baseScale = Math.max(MIN_SCALE, dist * BASE_ANGULAR_SCALE);
    if (isWatching) {
      this.pulseTime += dt;
      const pulse = 1.0 + 0.04 * Math.sin(this.pulseTime * 12);
      this.group.scale.setScalar(baseScale * pulse);

      this.ringMaterial.color.setHex(COLOR_LOCKED);
      this.ringMaterial.opacity = 0.92;
      this.haloMaterial.color.setHex(COLOR_LOCKED);
      this.haloMaterial.opacity = 0.35;
      this.pipMaterial.color.setHex(COLOR_LOCKED);
      this.pipMaterial.opacity = 0.85;
    } else {
      this.pulseTime = 0;
      this.group.scale.setScalar(baseScale);

      this.ringMaterial.color.setHex(COLOR_IDLE);
      this.ringMaterial.opacity = 0.45;
      this.haloMaterial.color.setHex(COLOR_IDLE);
      this.haloMaterial.opacity = 0.18;
      this.pipMaterial.color.setHex(COLOR_IDLE);
      this.pipMaterial.opacity = 0.28;
    }

    this.group.visible = true;
  }
}
