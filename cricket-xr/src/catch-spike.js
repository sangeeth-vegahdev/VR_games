import {
  createSystem,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';

// Spike: one ball flies at the player; a palm within CATCH_RADIUS catches it.
// State is mirrored on window.__catch so a headless test can read the result.
const START = new Vector3(0, 1.4, -16.5);
const TARGET = new Vector3(0, 1.2, -0.5);
const SPEED = 12;
const CATCH_RADIUS = 0.25;
const MISS_Z = 0.4;

export class CatchSpikeSystem extends createSystem({}) {
  init() {
    this.palm = new Vector3();
    this.velocity = new Vector3();
    this.ball = new Mesh(
      new SphereGeometry(0.08, 24, 16),
      new MeshStandardMaterial({ color: 0xcc1f1f }),
    );
    this.entity = this.world.createTransformEntity(this.ball);
    this.ball.visible = false;
    this.state = window.__catch = {
      phase: 'idle',
      catches: 0,
      misses: 0,
      launch: () => this.launch(),
    };
  }

  launch() {
    this.ball.position.copy(START);
    this.velocity.copy(TARGET).sub(START).normalize().multiplyScalar(SPEED);
    this.ball.visible = true;
    this.state.phase = 'flying';
  }

  update(delta) {
    if (this.state.phase !== 'flying') return;
    this.ball.position.addScaledVector(this.velocity, delta);

    for (const side of ['left', 'right']) {
      this.player.gripSpaces[side].getWorldPosition(this.palm);
      if (this.palm.distanceTo(this.ball.position) < CATCH_RADIUS) {
        this.state.phase = 'caught';
        this.state.catches++;
        this.state.side = side;
        this.ball.visible = false;
        return;
      }
    }
    if (this.ball.position.z > MISS_Z) {
      this.state.phase = 'missed';
      this.state.misses++;
      this.ball.visible = false;
    }
  }
}
