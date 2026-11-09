// All sound is generated with the Web Audio API: no files to download, and nothing to decode, so a
// sound starts the instant it is asked for. Sounds that belong to a bulb are placed in 3D (HRTF) at
// that bulb, so the player can hear which side a target lit up on.

// The soundtrack is generated too: a little sequencer plays kick, bass, hats and an arpeggio, adding
// layers as the level climbs. Its clock also drives the game, so the wall pulses with the music. The
// tempo stays under 150 BPM, so the pulse stays under 3 per second.

// A pentatonic ladder: a streak climbs it, so a run of good hits sounds like a melody over the track.
const LADDER = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0];
const ROOTS = [55, 43.65, 65.41, 49]; // a four-bar loop: Am, F, C, G
const BASS_STEPS = [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
const ARP = [440, 523.25, 659.25, 880, 783.99, 659.25, 523.25, 587.33];
const PANNERS = 6;

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.panners = [];
    this.nextPanner = 0;

    // Music clock, in seconds of game time. "sched" looks ahead to place notes accurately on the audio
    // clock; "step" is what the player hears now. Both run with or without audio.
    this.bpm = 96;
    this.mood = 'menu';
    this.layer = 0;
    this.clock = 0;
    this.origin = null;
    this.schedStep = 0;
    this.schedAt = 0;
    this.schedDur = 60 / this.bpm / 4;
    this.step = 0;
    this.stepAt = 0;
    this.stepDur = this.schedDur;
    this.beat = false; // true for the one frame a beat lands
    this.eighth = false;
  }

  // Browsers only start audio after a gesture; call this from any press or session start.
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.85;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp).connect(this.ctx.destination);
        this.buildMusic();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (!this.primed) {
        // Run one silent note through the whole chain so the first real sound has no start-up cost.
        this.primed = true;
        this.tone(this.dest({ x: 0, y: 0, z: -1 }), 440, 440, 0.02, 'sine', 0.0001);
      }
    } catch (e) {
      this.ctx = null;
    }
  }

  // Keeps the 3D audio listener on the player's head. x,y,z = position; f* = forward; u* = up.
  listener(x, y, z, fx, fy, fz, ux, uy, uz) {
    if (!this.ctx) return;
    try {
      const l = this.ctx.listener;
      if (l.positionX) {
        const t = this.ctx.currentTime;
        l.positionX.setValueAtTime(x, t);
        l.positionY.setValueAtTime(y, t);
        l.positionZ.setValueAtTime(z, t);
        l.forwardX.setValueAtTime(fx, t);
        l.forwardY.setValueAtTime(fy, t);
        l.forwardZ.setValueAtTime(fz, t);
        l.upX.setValueAtTime(ux, t);
        l.upY.setValueAtTime(uy, t);
        l.upZ.setValueAtTime(uz, t);
      } else {
        l.setPosition(x, y, z);
        l.setOrientation(fx, fy, fz, ux, uy, uz);
      }
    } catch (e) {
      /* spatial audio is a bonus */
    }
  }

  // Where a sound goes: straight to the speakers, or through a 3D panner at a world position.
  dest(pos) {
    if (!this.ctx) return null;
    if (!pos) return this.master;
    try {
      // A small set of 3D panners reused in turn: building one per sound would cost time on every hit.
      if (this.panners.length < PANNERS) {
        const n = this.ctx.createPanner();
        n.panningModel = 'HRTF';
        n.distanceModel = 'inverse';
        n.refDistance = 0.6;
        n.rolloffFactor = 0.4;
        n.connect(this.master);
        this.panners.push(n);
      }
      const p = this.panners[this.nextPanner % this.panners.length];
      this.nextPanner++;
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
      return p;
    } catch (e) {
      return this.master;
    }
  }

  tone(dest, f0, f1, dur, type = 'sine', vol = 0.2, delay = 0) {
    if (!this.ctx || !dest) return;
    try {
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(dest);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch (e) {
      /* sound is optional */
    }
  }

  // ----- music -----
  buildMusic() {
    const c = this.ctx;
    this.music = c.createGain();
    this.music.gain.value = 0;
    this.music.connect(this.master);
    this.bassLP = c.createBiquadFilter();
    this.bassLP.type = 'lowpass';
    this.bassLP.frequency.value = 420;
    this.bassLP.connect(this.music);
    const noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.25), c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = noise;
    this.hatHP = c.createBiquadFilter();
    this.hatHP.type = 'highpass';
    this.hatHP.frequency.value = 7000;
    this.hatHP.connect(this.music);
    this.clapBP = c.createBiquadFilter();
    this.clapBP.type = 'bandpass';
    this.clapBP.frequency.value = 1800;
    this.clapBP.connect(this.music);
    this.setMood(this.mood, this.layer);
  }

  // mood: 'menu' (quiet arpeggio) | 'play' | 'surge' | 'off'. level: the game level (adds layers, tempo).
  setMood(mood, level = 0) {
    this.mood = mood;
    this.layer = level;
    if (mood === 'menu') this.bpm = 96;
    else this.bpm = 112 + Math.min(Math.max(level - 1, 0), 16) * 2;
    if (!this.music) return;
    const t = this.ctx.currentTime;
    const gain = mood === 'off' ? 0 : mood === 'menu' ? 0.3 : 0.6;
    this.music.gain.setTargetAtTime(gain, t, mood === 'off' ? 0.25 : 0.5);
    this.bassLP.frequency.setTargetAtTime(mood === 'surge' ? 2400 : 340 + Math.min(level, 14) * 45, t, 0.3);
  }

  hat(t, vol, dur = 0.05) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(g).connect(this.hatHP);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  clapNoise(t, vol) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    src.connect(g).connect(this.clapBP);
    src.start(t);
    src.stop(t + 0.13);
  }

  playStep(step, t) {
    const s = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const delay = Math.max(0, t - this.ctx.currentTime);
    const when = this.ctx.currentTime + delay;
    if (this.mood === 'menu') {
      if (s % 2 === 0) {
        const f = ARP[(step / 2) % ARP.length];
        this.tone(this.music, f, f, 0.32, 'sine', 0.05, delay);
      }
      if (s === 0) this.tone(this.bassLP, ROOTS[bar], ROOTS[bar], 1.1, 'triangle', 0.16, delay);
      return;
    }
    const L = this.layer;
    const surge = this.mood === 'surge';
    // Kick: on 1 and 3, on every beat from level 4 and in a surge.
    if (s === 0 || s === 8 || ((L >= 4 || surge) && s % 4 === 0)) this.tone(this.music, 150, 42, 0.16, 'sine', 0.6, delay);
    if (BASS_STEPS[s]) {
      const f = ROOTS[bar] * (s === 10 ? 2 : 1);
      this.tone(this.bassLP, f, f, 0.2, 'sawtooth', 0.17, delay);
    }
    if ((L >= 3 || surge) && s % 2 === 1) this.hat(when, surge ? 0.12 : 0.08);
    if ((L >= 8 || surge) && (s === 4 || s === 12)) this.clapNoise(when, 0.25);
    if (L >= 5 || surge) {
      const f = ARP[step % ARP.length] * (surge ? 2 : 1);
      this.tone(this.music, f, f, 0.12, 'triangle', surge ? 0.07 : 0.05, delay);
    }
  }

  // Once a frame. Sets beat / eighth for this frame, and queues the notes just ahead of now.
  update(dt) {
    this.beat = false;
    this.eighth = false;
    this.clock += dt;
    const audible = !!this.music && this.ctx.state === 'running' && this.mood !== 'off';
    if (audible) {
      const offset = this.ctx.currentTime - this.clock;
      if (this.origin === null || Math.abs(offset - this.origin) > 0.08) this.origin = offset;
    }
    while (this.schedAt < this.clock + 0.12) {
      if (this.schedStep % 16 === 0) this.schedDur = 60 / this.bpm / 4;
      if (audible) {
        try {
          this.playStep(this.schedStep, this.schedAt + this.origin);
        } catch (e) {
          /* music is optional */
        }
      }
      this.schedStep++;
      this.schedAt += this.schedDur;
    }
    while (this.stepAt <= this.clock) {
      if (this.step % 16 === 0) this.stepDur = 60 / this.bpm / 4;
      if (this.step % 2 === 0) this.eighth = true;
      if (this.step % 4 === 0) this.beat = true;
      this.step++;
      this.stepAt += this.stepDur;
    }
  }

  // ----- events -----
  ping(pos) {
    // A target just lit: a short, soft cue that comes from its side.
    const d = this.dest(pos);
    this.tone(d, 1320, 1760, 0.07, 'sine', 0.09);
  }

  hit(pos, streak) {
    const d = this.dest(pos);
    const f = LADDER[Math.min(streak, LADDER.length - 1)];
    this.tone(d, f, f * 1.01, 0.16, 'triangle', 0.24);
    this.tone(d, f * 2, f * 2, 0.09, 'sine', 0.1, 0.012);
  }

  gold(pos) {
    const d = this.dest(pos);
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => this.tone(d, f, f, 0.14, 'triangle', 0.2, i * 0.055));
  }

  wrong(pos) {
    const d = this.dest(pos);
    this.tone(d, 200, 70, 0.26, 'sawtooth', 0.18);
  }

  expire(pos) {
    const d = this.dest(pos);
    this.tone(d, 330, 110, 0.34, 'triangle', 0.22);
  }

  heartLost() {
    const d = this.dest(null);
    this.tone(d, 140, 45, 0.45, 'sine', 0.35);
  }

  heartGained() {
    const d = this.dest(null);
    [659, 880, 1175].forEach((f, i) => this.tone(d, f, f, 0.16, 'sine', 0.2, i * 0.07));
  }

  level() {
    const d = this.dest(null);
    [523, 659, 784, 1047].forEach((f, i) => this.tone(d, f, f, 0.2, 'square', 0.1, i * 0.07));
  }

  tick() {
    this.tone(this.dest(null), 660, 660, 0.09, 'sine', 0.2);
  }

  go() {
    this.tone(this.dest(null), 990, 1320, 0.28, 'triangle', 0.26);
  }

  over() {
    const d = this.dest(null);
    [392, 330, 262, 196].forEach((f, i) => this.tone(d, f, f * 0.98, 0.3, 'triangle', 0.22, i * 0.16));
  }

  record() {
    const d = this.dest(null);
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(d, f, f, 0.18, 'triangle', 0.2, 0.7 + i * 0.09));
  }

  // Two linked bulbs hit together: a crackle of lightning.
  zap(pos) {
    const d = this.dest(pos);
    this.tone(d, 2600, 500, 0.16, 'sawtooth', 0.14);
    this.tone(d, 1900, 3200, 0.1, 'square', 0.05, 0.03);
  }

  // The meter is full.
  surgeReady() {
    const d = this.dest(null);
    [880, 1109, 1319, 1760].forEach((f, i) => this.tone(d, f, f, 0.22, 'sine', 0.18, i * 0.06));
  }

  surge() {
    const d = this.dest(null);
    this.tone(d, 70, 1400, 0.55, 'sawtooth', 0.22);
    this.tone(d, 45, 35, 0.8, 'sine', 0.5);
    if (this.ctx && this.noise) {
      try {
        this.clapNoise(this.ctx.currentTime, 0.5);
      } catch (e) {
        /* sound is optional */
      }
    }
  }

  // The city going dark.
  powerDown() {
    const d = this.dest(null);
    this.tone(d, 240, 28, 1.4, 'sawtooth', 0.2);
  }

  ui() {
    this.tone(this.dest(null), 880, 1200, 0.07, 'sine', 0.16);
  }
}
