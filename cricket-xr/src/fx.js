import {
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';

// Generated sound (no audio files) plus pooled particles and a ball trail.
// Everything is allocated up front, nothing in the frame loop.

// Kenney sound effects (CC0), decoded on first use. Until a file is ready, the generated
// tone for the same event plays instead, so the game is never silent.
const FILES = { hit: 'hit', coin: 'coin', hurt: 'hurt', level: 'level_up', ui: 'ui' };

export class Sound {
  constructor() {
    this.ctx = null;
    this.noise = null;
    this.buffers = {};
  }

  unlock() {
    try {
      const first = !this.ctx;
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (first) this.preload();
    } catch (e) {
      this.ctx = null;
    }
  }

  preload() {
    const base = import.meta.env.BASE_URL;
    for (const [name, file] of Object.entries(FILES)) {
      fetch(`${base}audio/${file}.ogg`)
        .then((r) => r.arrayBuffer())
        .then((data) => this.ctx.decodeAudioData(data))
        .then((buffer) => {
          this.buffers[name] = buffer;
        })
        .catch(() => {
          /* keep the generated fallback */
        });
    }
  }

  // Plays a decoded file; returns false when it is not ready so the caller can fall back.
  file(name, volume = 0.7) {
    const buffer = this.buffers[name];
    if (!this.ctx || !buffer) return false;
    try {
      const src = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      src.buffer = buffer;
      gain.gain.value = volume;
      src.connect(gain).connect(this.ctx.destination);
      src.start();
      return true;
    } catch (e) {
      return false;
    }
  }

  tone(f0, f1, dur, type = 'triangle', volume = 0.2) {
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
    } catch (e) {
      /* sound is optional */
    }
  }

  // Short noise burst: the bat hitting the ball (fallback for hit.ogg).
  noiseCrack() {
    if (!this.ctx) return;
    try {
      if (!this.noise) {
        const n = Math.floor(this.ctx.sampleRate * 0.08);
        this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
      }
      const src = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      src.buffer = this.noise;
      gain.gain.value = 0.5;
      src.connect(gain).connect(this.ctx.destination);
      src.start();
    } catch (e) {
      /* sound is optional */
    }
  }

  crack() {
    if (!this.file('hit', 0.9)) this.noiseCrack();
  }

  caught() {
    this.tone(660, 990, 0.22, 'triangle', 0.12);
    if (!this.file('coin', 0.6)) this.tone(880, 1320, 0.18, 'triangle', 0.12);
  }

  missed() {
    if (!this.file('hurt', 0.5)) this.tone(220, 110, 0.35, 'sawtooth');
  }

  over() {
    if (!this.file('level', 0.7)) this.tone(392, 784, 0.5, 'triangle');
  }

  start() {
    if (!this.file('ui', 0.6)) this.tone(520, 780, 0.12, 'triangle', 0.15);
  }
}

const BURST_COUNT = 36;
const BURST_LIFE = 0.7;
const TRAIL_COUNT = 9;

export class Effects {
  constructor(world) {
    const geo = new SphereGeometry(0.025, 8, 6);
    this.bits = [];
    for (let i = 0; i < BURST_COUNT; i++) {
      const mesh = new Mesh(geo, new MeshBasicMaterial({ color: 0xffd23f, transparent: true }));
      mesh.visible = false;
      world.createTransformEntity(mesh);
      this.bits.push({ mesh, vel: new Vector3(), life: 0 });
    }

    const trailGeo = new SphereGeometry(0.07, 10, 8);
    this.trail = [];
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const mesh = new Mesh(trailGeo, new MeshBasicMaterial({ color: 0xff6a5a, transparent: true }));
      mesh.visible = false;
      world.createTransformEntity(mesh);
      this.trail.push(mesh);
    }
    this.trailHead = 0;
    this.trailTimer = 0;
  }

  burst(position) {
    for (const bit of this.bits) {
      bit.mesh.position.copy(position);
      bit.vel.set(Math.random() * 2 - 1, Math.random() * 1.5 + 0.3, Math.random() * 2 - 1).multiplyScalar(1.6);
      bit.life = BURST_LIFE;
      bit.mesh.visible = true;
      bit.mesh.scale.setScalar(1);
      bit.mesh.material.opacity = 1;
    }
  }

  // Drops a fading ghost of the ball every few frames.
  trailPoint(position, dt) {
    this.trailTimer += dt;
    if (this.trailTimer < 0.025) return;
    this.trailTimer = 0;
    const ghost = this.trail[this.trailHead];
    this.trailHead = (this.trailHead + 1) % TRAIL_COUNT;
    ghost.position.copy(position);
    ghost.userData.life = 1;
    ghost.visible = true;
  }

  clearTrail() {
    for (const ghost of this.trail) {
      ghost.visible = false;
      ghost.userData.life = 0;
    }
  }

  update(dt) {
    for (const bit of this.bits) {
      if (!bit.mesh.visible) continue;
      bit.life -= dt;
      if (bit.life <= 0) {
        bit.mesh.visible = false;
        continue;
      }
      bit.vel.y -= 3 * dt;
      bit.mesh.position.addScaledVector(bit.vel, dt);
      const k = bit.life / BURST_LIFE;
      bit.mesh.scale.setScalar(k);
      bit.mesh.material.opacity = k;
    }
    for (const ghost of this.trail) {
      if (!ghost.visible) continue;
      ghost.userData.life -= dt * 4;
      if (ghost.userData.life <= 0) {
        ghost.visible = false;
        continue;
      }
      ghost.scale.setScalar(ghost.userData.life);
      ghost.material.opacity = ghost.userData.life * 0.5;
    }
  }
}
