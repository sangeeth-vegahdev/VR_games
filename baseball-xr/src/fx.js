import {
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';

// Sound (Kenney CC0 effects plus sounds generated in code) and pooled particles and a ball trail.
// Everything is allocated up front, nothing in the frame loop.

// Kenney sound effects (CC0), decoded on first use. Until a file is ready, the generated
// tone for the same event plays instead, so the game is never silent. The mitt's pop, the pitch's
// whoosh and the crowd are generated.
const FILES = { coin: 'coin', hurt: 'hurt', level: 'level_up', ui: 'ui' };

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
      if (first) {
        this.preload();
        this.crowd();
      }
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

  // A buffer of white noise, made once and reused by every generated sound.
  noiseBuffer() {
    if (!this.noise) {
      const n = Math.floor(this.ctx.sampleRate * 2);
      this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  // Filtered noise with a gain envelope. Returns the gain node (so the crowd can be kept running).
  noiseShot(type, freq, q, volume, attack, decay, loop = false) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = loop;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + attack);
    if (!loop) gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t);
    if (!loop) src.stop(t + attack + decay + 0.05);
    return { src, gain, filter };
  }

  // The ball smacking into the mitt: a short leather pop with a low thump under it. Right in the
  // pocket it is the full, deep pop; in the web or off the heel it is lighter and higher.
  pop(weight = 1) {
    if (!this.ctx) return;
    try {
      this.noiseShot('lowpass', 1500 + 900 * (1 - weight), 0.7, 0.5 + 0.45 * weight, 0.002, 0.07 + 0.04 * weight);
      this.tone(120 + 70 * (1 - weight), 60, 0.12, 'sine', 0.2 + 0.35 * weight);
    } catch (e) {
      /* sound is optional */
    }
  }

  // The pitch leaving the hand: a quick rising swish.
  whoosh() {
    if (!this.ctx) return;
    try {
      const shot = this.noiseShot('bandpass', 900, 1.4, 0.12, 0.05, 0.25);
      shot.filter.frequency.exponentialRampToValueAtTime(2600, this.ctx.currentTime + 0.25);
    } catch (e) {
      /* sound is optional */
    }
  }

  // A low ballpark murmur that runs all the time once sound is unlocked, swelling on a catch.
  crowd() {
    if (!this.ctx || this.crowdBed) return;
    try {
      this.crowdBed = this.noiseShot('bandpass', 520, 0.6, 0.05, 1.5, 0, true);
    } catch (e) {
      this.crowdBed = null;
    }
  }

  cheer(strength = 1) {
    if (!this.ctx) return;
    try {
      this.noiseShot('bandpass', 700, 0.5, 0.16 * strength, 0.25, 1.4);
    } catch (e) {
      /* sound is optional */
    }
  }

  groan() {
    if (!this.ctx) return;
    try {
      const shot = this.noiseShot('bandpass', 420, 0.8, 0.09, 0.15, 0.9);
      shot.filter.frequency.exponentialRampToValueAtTime(260, this.ctx.currentTime + 1.0);
    } catch (e) {
      /* sound is optional */
    }
  }

  caught(streak = 1, weight = 1) {
    this.pop(weight);
    if (!this.file('coin', 0.35)) this.tone(880, 1320, 0.18, 'triangle', 0.08);
    this.cheer(Math.min(1.6, 0.6 + streak * 0.15));
  }

  missed() {
    if (!this.file('hurt', 0.4)) this.tone(220, 110, 0.35, 'sawtooth');
    this.groan();
  }

  over() {
    if (!this.file('level', 0.7)) this.tone(392, 784, 0.5, 'triangle');
  }

  start() {
    if (!this.file('ui', 0.6)) this.tone(520, 780, 0.12, 'triangle', 0.15);
  }
}

const BURST_COUNT = 28;
const BURST_LIFE = 0.45;
const DUST_COUNT = 14;
const DUST_LIFE = 0.75;
const TRAIL_COUNT = 9;

export class Effects {
  constructor(world) {
    const geo = new SphereGeometry(0.012, 8, 6);
    this.bits = [];
    for (let i = 0; i < BURST_COUNT; i++) {
      const mesh = new Mesh(geo, new MeshBasicMaterial({ color: 0xfff0b0, transparent: true }));
      mesh.visible = false;
      world.createTransformEntity(mesh);
      this.bits.push({ mesh, vel: new Vector3(), life: 0 });
    }

    const trailGeo = new SphereGeometry(0.04, 10, 8);
    this.trail = [];
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const mesh = new Mesh(trailGeo, new MeshBasicMaterial({ color: 0xfff4c8, transparent: true }));
      mesh.visible = false;
      world.createTransformEntity(mesh);
      this.trail.push(mesh);
    }
    this.trailHead = 0;
    this.trailTimer = 0;

    // A puff of dust knocked off the leather when the ball smacks into the mitt: soft, growing,
    // fading clouds drifting back out of the pocket.
    const puffGeo = new SphereGeometry(0.03, 10, 8);
    this.puffs = [];
    for (let i = 0; i < DUST_COUNT; i++) {
      const mesh = new Mesh(puffGeo, new MeshBasicMaterial({ color: 0xc9a77c, transparent: true, depthWrite: false }));
      mesh.visible = false;
      world.createTransformEntity(mesh);
      this.puffs.push({ mesh, vel: new Vector3(), life: 0, size: 1 });
    }
  }

  // position: where the ball hit. out: the way out of the pocket (unit). strength 0..1.
  dust(position, out, strength = 1) {
    for (const p of this.puffs) {
      p.mesh.position.copy(position);
      const a = Math.random() * Math.PI * 2;
      const r = 0.25 + Math.random() * 0.45;
      p.vel.set(Math.cos(a) * r, Math.sin(a) * r * 0.7 + 0.15, Math.cos(a * 1.7) * r * 0.5).addScaledVector(out, 0.35 + Math.random() * 0.4);
      p.vel.multiplyScalar(0.6 + 0.6 * strength);
      p.life = DUST_LIFE * (0.7 + Math.random() * 0.5);
      p.size = 0.6 + Math.random() * 0.8;
      p.mesh.visible = true;
      p.mesh.scale.setScalar(p.size * 0.4);
      p.mesh.material.opacity = 0.32 * strength;
      p.strength = strength;
    }
  }

  burst(position) {
    for (const bit of this.bits) {
      bit.mesh.position.copy(position);
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 0.7;
      bit.vel.set(Math.cos(angle) * speed, Math.sin(angle) * speed + 0.35, (Math.random() - 0.75) * 0.3);
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
    for (const p of this.puffs) {
      if (!p.mesh.visible) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.vel.multiplyScalar(Math.max(0, 1 - 3.5 * dt)); // air drag: a puff slows quickly
      p.vel.y += 0.08 * dt; // and drifts up a little
      p.mesh.position.addScaledVector(p.vel, dt);
      const k = p.life / DUST_LIFE;
      p.mesh.scale.setScalar(p.size * (0.4 + (1 - k) * 1.4));
      p.mesh.material.opacity = 0.32 * p.strength * k;
    }
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
