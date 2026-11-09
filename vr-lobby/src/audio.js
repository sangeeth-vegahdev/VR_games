// Dynamic Web Audio synthesizer for VR Lobby sound effects.
// Zero network dependencies, instant sound in headsets and desktop browsers.

export class LobbyAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.lastHoverTime = 0;
  }

  init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.45;
    this.master.connect(this.ctx.destination);
  }

  unlock() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  playHover() {
    const now = Date.now();
    if (now - this.lastHoverTime < 140) return;
    this.lastHoverTime = now;
    this.unlock();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(540, t);
    osc.frequency.exponentialRampToValueAtTime(720, t + 0.08);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.08, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);

    osc.connect(gain);
    gain.connect(this.master);

    osc.start(t);
    osc.stop(t + 0.1);
  }

  playPoke() {
    this.unlock();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    // Low tactile bump
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(140, t);
    osc1.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    gain1.gain.setValueAtTime(0.3, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc1.connect(gain1);
    gain1.connect(this.master);
    osc1.start(t);
    osc1.stop(t + 0.13);

    // High affirmative ping
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, t);
    osc2.frequency.exponentialRampToValueAtTime(1180, t + 0.15);
    gain2.gain.setValueAtTime(0.18, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc2.connect(gain2);
    gain2.connect(this.master);
    osc2.start(t);
    osc2.stop(t + 0.16);
  }

  playPinch() {
    this.unlock();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const freqs = [660, 990, 1320];
    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + idx * 0.02);
      gain.gain.setValueAtTime(0.001, t + idx * 0.02);
      gain.gain.linearRampToValueAtTime(0.12, t + idx * 0.02 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t + idx * 0.02);
      osc.stop(t + 0.25);
    });
  }

  playWarpLaunch() {
    this.unlock();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    // Ascending power sweep
    const sweep = this.ctx.createOscillator();
    const sweepGain = this.ctx.createGain();
    sweep.type = 'sawtooth';
    sweep.frequency.setValueAtTime(160, t);
    sweep.frequency.exponentialRampToValueAtTime(960, t + 0.7);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(3800, t + 0.7);

    sweepGain.gain.setValueAtTime(0.01, t);
    sweepGain.gain.linearRampToValueAtTime(0.35, t + 0.35);
    sweepGain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);

    sweep.connect(filter);
    filter.connect(sweepGain);
    sweepGain.connect(this.master);

    sweep.start(t);
    sweep.stop(t + 0.88);

    // Resonant chord burst
    const chord = [261.63, 329.63, 392.0, 523.25];
    chord.forEach((freq) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + 0.2);
      gain.gain.setValueAtTime(0.001, t + 0.2);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.95);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t + 0.2);
      osc.stop(t + 1.0);
    });
  }
}

