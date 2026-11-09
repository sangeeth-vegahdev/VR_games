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
// - The ring remains centered on the ball as it arcs from the coach to the palms.
// - The ring turns vibrant cyan-teal and pulses softly to indicate target lock.
//
// When the player's eyes wander or fall behind the ball's pace:
// - The ring drifts off the ball, giving immediate visual feedback.
// - The ring dims to a translucent neutral tint.

const COLOR_LOCKED = 0x5eead4; // vibrant cyan-teal when eyes are on the ball
const COLOR_IDLE = 0xffffff;   // crisp translucent white when off target
const BASE_ANGULAR_SCALE = 0.32;  // ring is sized by visual angle: outer radius ~1.8 degrees at any distance (0.098 * 0.32 = tan(1.8 deg) * 1)
const MIN_SCALE = 0.05;        // floor so it never collapses right at the glove/hands

export function projectGazePoint(origin, dir, targetPos, out = new Vector3()) {
  const dist = origin.distanceTo(targetPos);
  return out.copy(origin).addScaledVector(dir, dist);
}

export class EyeRingTracker {
  constructor(world) {
    this.world = world;
    this.group = new Group();
    this.group.renderOrder = 20; // draw cleanly over pitch, turf, and stadium elements
    this.group.visible = false;

    // Outer reticle ring: frames the ball cleanly
    this.ringMaterial = new MeshBasicMaterial({
      color: COLOR_IDLE,
      transparent: true,
      opacity: 0.5,
      side: DoubleSide,
      depthWrite: false,
      depthTest: false, // never hidden behind the ball, dust or turf
    });
    // Base geometry: 0.08 inner, 0.098 outer radius
    this.ringMesh = new Mesh(new RingGeometry(0.07, 0.098, 48), this.ringMaterial);
    this.group.add(this.ringMesh);

    // Dark outline just outside the ring so it stays readable on bright sky, walls and chalk
    this.outlineMesh = new Mesh(
      new RingGeometry(0.098, 0.112, 48),
      new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, side: DoubleSide, depthWrite: false, depthTest: false }),
    );
    this.group.add(this.outlineMesh);

    // Subtle outer halo ring (matches the storyboard reticle)
    this.haloMaterial = new MeshBasicMaterial({
      color: COLOR_IDLE,
      transparent: true,
      opacity: 0.2,
      side: DoubleSide,
      depthWrite: false,
      depthTest: false, // never hidden behind the ball, dust or turf
    });
    this.haloMesh = new Mesh(new RingGeometry(0.115, 0.128, 48), this.haloMaterial);
    this.group.add(this.haloMesh);

    // Center focus pip
    this.pipMaterial = new MeshBasicMaterial({
      color: COLOR_IDLE,
      transparent: true,
      opacity: 0.35,
      side: DoubleSide,
      depthWrite: false,
      depthTest: false, // never hidden behind the ball, dust or turf
    });
    this.pipMesh = new Mesh(new RingGeometry(0, 0.014, 24), this.pipMaterial);
    this.group.add(this.pipMesh);

    world.createTransformEntity(this.group);

    this.targetPoint = new Vector3();
    this.tempOrigin = new Vector3();
    this.tempDir = new Vector3();
    this.visible = false;
    this.pulseTime = 0;
    this._firstFrame = true;
  }

  show() {
    this.visible = true;
    this.group.visible = true;
    this._firstFrame = true;
  }

  hide() {
    this.visible = false;
    this.group.visible = false;
  }

  // Update ring tracker position and styling based on live eye gaze.
  // focus: FocusTracker instance
  // ballPos: current Vector3 position of the cricket ball
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
      dir = desktop.ray ? desktop.ray.ray.direction : focus.dir;
    }

    // Distance from the viewer's eye to the ball
    const dist = origin.distanceTo(ballPos);
    projectGazePoint(origin, dir, ballPos, this.targetPoint);

    // Position tracker at gaze projection point. Snap on large gaze shifts (>0.8m) to track fast
    // eye saccades immediately; apply subtle exponential smoothing on fine tracking to eliminate micro-jitter.
    const gap = this.group.position.distanceTo(this.targetPoint);
    if (this._firstFrame || gap > 0.8) {
      this.group.position.copy(this.targetPoint);
      this._firstFrame = false;
    } else {
      const smoothFactor = Math.min(1, dt * 30);
      this.group.position.lerp(this.targetPoint, smoothFactor);
    }

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

