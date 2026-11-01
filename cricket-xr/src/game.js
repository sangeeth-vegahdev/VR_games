import {
  createSystem,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { CFG, CONTACT_T, RELEASE, RESTART_POS, RESTART_RADIUS } from './config.js';
import { Coach } from './coach.js';
import { Effects, Sound } from './fx.js';
import { COLORS, Hud } from './hud.js';
import { buildStadium } from './stadium.js';

const lerp = (a, b, t) => a + (b - a) * t;

// Round flow: idle -> ready -> swinging -> flying -> feedback -> (ready ... | over) -> ready ...
export class GameSystem extends createSystem({}) {
  init() {
    this.sound = new Sound();
    this.fx = new Effects(this.world);
    buildStadium(this.world);
    this.coach = new Coach(this.world);
    this.hud = new Hud(this.world, CFG.balls);

    this.ball = new Mesh(
      new SphereGeometry(0.08, 24, 16),
      new MeshStandardMaterial({ color: 0xcc1f1f, roughness: 0.4, emissive: 0x330404 }),
    );
    this.ball.visible = false;
    this.world.createTransformEntity(this.ball);

    this.marker = new Mesh(
      new SphereGeometry(RESTART_RADIUS * 0.6, 24, 16),
      new MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x1d8f4e, emissiveIntensity: 1.2 }),
    );
    this.marker.position.set(RESTART_POS.x, RESTART_POS.y, RESTART_POS.z);
    this.world.createTransformEntity(this.marker);

    this.palm = { left: new Vector3(), right: new Vector3() };
    this.palmOk = { left: false, right: false };
    this.prev = new Vector3();
    this.vel = new Vector3();
    this.tmp = new Vector3();
    this.seg = new Vector3();
    this.aim = new Vector3();
    this.head = new Vector3();

    this.state = 'idle';
    this.timer = 0;
    this.lockout = 0;
    this.messageTimer = 0;
    this.swingT = null;
    this.ballNo = 0;
    this.score = 0;
    this.misses = 0;
    this.kmh = 0;
    this.side = 1;
    this.swingA = 0;
    this.life = 0;
    this.heldBy = null;
    this.throwSpeed = 0;

    this.hud.showCard('Cricket Catch', [{ text: `Catch ${CFG.balls} balls with your hands` }], 'Touch the green ball to start');

    const onKey = (e) => {
      this.sound.unlock();
      if (e.code === 'Space' || e.code === 'Enter') this.tryStart();
    };
    const onPointer = () => this.sound.unlock();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    });
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe(() => this.sound.unlock()),
    );

    // Read-only view for the headless test.
    window.__game = {
      get state() { return this.sys.state; },
      get ballNo() { return this.sys.ballNo; },
      get score() { return this.sys.score; },
      get misses() { return this.sys.misses; },
      get kmh() { return this.sys.kmh; },
      get aim() { return this.sys.aim; },
      get ballPos() { return this.sys.ball.position; },
      get ballVisible() { return this.sys.ball.visible; },
      sys: this,
      start: () => this.tryStart(),
    };
  }

  // ---------- flow ----------
  tryStart() {
    if ((this.state === 'idle' || this.state === 'over') && this.lockout <= 0) this.startRound();
  }

  startRound() {
    this.ballNo = 0;
    this.score = 0;
    this.misses = 0;
    this.kmh = 0;
    this.heldBy = null;
    this.ball.visible = false;
    this.marker.visible = false;
    this.fx.clearTrail();
    this.hud.hideCard();
    this.hud.set({ score: 0, misses: 0, ballNo: 0, kmh: 0 });
    this.sound.start();
    this.state = 'ready';
    this.timer = CFG.readyDelay;
    this.message('Get ready', COLORS.ink, CFG.readyDelay);
  }

  beginThrow() {
    this.ballNo++;
    const ramp = Math.min(1, (this.ballNo - 1) / CFG.rampBalls);
    let speed = lerp(CFG.startSpeed, CFG.maxSpeed, ramp);
    if (ramp >= 1) speed += (Math.random() * 2 - 1) * CFG.speedJitter;
    this.throwSpeed = speed;
    this.kmh = Math.round(speed * 3.6);
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.swingA = lerp(CFG.swingBase, CFG.swingMax, ramp);

    // Arrival point: around chest height, wherever the headset currently is.
    this.player.head.getWorldPosition(this.head);
    this.aim.set(
      (Math.random() * 2 - 1) * CFG.targetSpreadX,
      this.head.y - CFG.chestBelowHead + (Math.random() * 2 - 1) * CFG.targetSpreadY,
      -0.5,
    );

    this.swingT = 0;
    this.coach.swing();
    this.state = 'swinging';
    this.hud.set({ ballNo: this.ballNo, kmh: this.kmh, message: '' });
  }

  // Contact: the ball leaves the bat. The path is solved so that swing and gravity
  // curve it INTO the arrival point, so it visibly bends but stays catchable.
  launchBall() {
    const dz = this.aim.z - RELEASE.z;
    const len = Math.hypot(this.aim.x - RELEASE.x, this.aim.y - RELEASE.y, dz);
    const flight = len / this.throwSpeed;
    this.vel.set(
      (this.aim.x - RELEASE.x) / flight - 0.5 * this.side * this.swingA * flight,
      (this.aim.y - RELEASE.y) / flight + 0.5 * CFG.gravity * flight,
      dz / flight,
    );
    this.swingT = null;
    this.ball.position.set(RELEASE.x, RELEASE.y, RELEASE.z);
    this.ball.visible = true;
    this.life = 0;
    this.fx.clearTrail();
    this.sound.crack();
    this.state = 'flying';
  }

  caught(side) {
    this.state = 'feedback';
    this.timer = CFG.feedbackDelay;
    this.heldBy = side;
    this.score++;
    this.fx.burst(this.palm[side]);
    this.sound.caught();
    this.coach.cheer();
    this.hud.set({ score: this.score });
    this.message('CAUGHT!', COLORS.good, CFG.feedbackDelay);
  }

  missed() {
    this.state = 'feedback';
    this.timer = CFG.feedbackDelay;
    this.heldBy = null;
    this.ball.visible = false;
    this.misses++;
    this.sound.missed();
    this.coach.shrug();
    this.hud.set({ misses: this.misses });
    this.message('MISSED', COLORS.bad, CFG.feedbackDelay);
  }

  afterFeedback() {
    this.heldBy = null;
    this.ball.visible = false;
    if (this.ballNo >= CFG.balls) {
      this.finishRound();
      return;
    }
    this.state = 'ready';
    this.timer = CFG.readyDelay;
    this.message('Get ready', COLORS.ink, CFG.readyDelay);
  }

  finishRound() {
    this.state = 'over';
    this.lockout = CFG.restartLockout;
    this.marker.visible = true;
    const ratio = this.score / CFG.balls;
    const rating =
      ratio >= 0.95 ? 'Legendary hands!' : ratio >= 0.8 ? 'Safe hands!' : ratio >= 0.5 ? 'Good catching' : 'Keep practising';
    this.hud.set({ message: '' });
    this.hud.showCard(
      'Round over',
      [
        { text: `Final score  ${this.score} / ${CFG.balls}`, color: COLORS.good },
        { text: rating, color: COLORS.ink },
      ],
      'Touch the green ball to play again',
    );
    this.sound.over();
  }

  message(text, color, duration) {
    this.messageTimer = duration;
    this.hud.set({ message: text, color });
  }

  // ---------- helpers ----------
  readPalms() {
    for (const side of ['left', 'right']) {
      const space = this.player.gripSpaces[side];
      space.getWorldPosition(this.palm[side]);
      this.palmOk[side] = space.visible;
    }
  }

  // Distance from point p to the segment a->b, using this.seg as scratch.
  distToSegment(p, a, b) {
    this.seg.copy(b).sub(a);
    const lenSq = this.seg.lengthSq();
    let t = 0;
    if (lenSq > 0) {
      t = this.tmp.copy(p).sub(a).dot(this.seg) / lenSq;
      t = Math.min(1, Math.max(0, t));
    }
    this.tmp.copy(a).addScaledVector(this.seg, t);
    return this.tmp.distanceTo(p);
  }

  // ---------- frame ----------
  update(dt) {
    dt = Math.min(dt, 0.05);
    this.readPalms();
    this.fx.update(dt);
    if (this.lockout > 0) this.lockout -= dt;

    this.coach.update(dt);
    if (this.swingT !== null) this.swingT += dt;

    switch (this.state) {
      case 'idle':
      case 'over':
        this.updateRestart(dt);
        break;
      case 'ready':
        this.timer -= dt;
        if (this.timer <= 0) this.beginThrow();
        break;
      case 'swinging':
        if (this.swingT >= CONTACT_T) this.launchBall();
        break;
      case 'flying':
        this.updateFlight(dt);
        break;
      case 'feedback':
        this.updateFeedback(dt);
        break;
      default:
        break;
    }

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0 && this.state !== 'over') this.hud.set({ message: '' });
    }
    this.marker.rotation.y += dt;
  }

  updateRestart() {
    if (this.lockout > 0) return;
    for (const side of ['left', 'right']) {
      if (this.palmOk[side] && this.palm[side].distanceTo(this.marker.position) < RESTART_RADIUS) {
        this.startRound();
        return;
      }
    }
  }

  updateFlight(dt) {
    this.prev.copy(this.ball.position);
    this.vel.y -= CFG.gravity * dt;
    this.vel.x += this.side * this.swingA * dt; // the swing: sideways force in the air
    this.ball.position.addScaledVector(this.vel, dt);
    this.ball.rotation.x += 14 * dt;
    this.life += dt;
    this.fx.trailPoint(this.ball.position, dt);

    // Swept test so a fast ball cannot skip past a hand between two frames.
    for (const side of ['left', 'right']) {
      if (this.palmOk[side] && this.distToSegment(this.palm[side], this.prev, this.ball.position) <= CFG.catchRadius) {
        this.caught(side);
        return;
      }
    }
    if (this.ball.position.z >= CFG.missZ || this.life > CFG.maxLife) this.missed();
  }

  updateFeedback(dt) {
    if (this.heldBy) this.ball.position.copy(this.palm[this.heldBy]);
    this.timer -= dt;
    if (this.timer <= 0) this.afterFeedback();
  }
}
