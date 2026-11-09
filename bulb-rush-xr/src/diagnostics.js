// Optional developer diagnostics panel for WebXR Hand Tracking, Eye Gaze, and Performance.
// Activated only via ?debug=1 in URL or pressing 'D' key. Never interferes with normal gameplay.

export class DiagnosticsPanel {
  constructor(gameTitle = 'Bulb Rush XR') {
    this.title = gameTitle;
    const params = new URLSearchParams(globalThis.location?.search || '');
    this.enabled = params.get('debug') === '1' || params.get('diagnostics') === '1';

    this.frameTimes = [];
    this.maxSamples = 120;
    this.lastFrameTime = performance.now();
    this.fps = 60;
    this.avgFrameTimeMs = 16.6;
    this.p95FrameTimeMs = 16.6;
    this.worstFrameTimeMs = 16.6;

    this.lastEvent = 'None';
    this.lastEventTime = 0;
    this.lastContact = null;

    this.dom = null;
    if (typeof document !== 'undefined') {
      this.initDom();
      window.addEventListener('keydown', (e) => {
        if (e.key === 'd' || e.key === 'D') {
          this.toggle();
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.__diagnostics = this;
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.dom) {
      this.dom.style.display = this.enabled ? 'block' : 'none';
    }
  }

  recordEvent(name, details = {}) {
    this.lastEvent = name;
    this.lastEventTime = performance.now();
    this.lastContact = details;
  }

  initDom() {
    const el = document.createElement('div');
    el.id = 'dev-diagnostics-panel';
    el.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      width: 340px;
      background: rgba(10, 16, 28, 0.90);
      color: #00ffcc;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      line-height: 1.4;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid rgba(0, 255, 204, 0.4);
      box-shadow: 0 4px 20px rgba(0,0,0,0.6);
      z-index: 99999;
      pointer-events: none;
      display: ${this.enabled ? 'block' : 'none'};
      user-select: none;
    `;
    document.body.appendChild(el);
    this.dom = el;
  }

  update(state = {}) {
    const now = performance.now();
    const dt = now - this.lastFrameTime;
    this.lastFrameTime = now;

    if (dt > 0 && dt < 200) {
      this.frameTimes.push(dt);
      if (this.frameTimes.length > this.maxSamples) {
        this.frameTimes.shift();
      }
      const sum = this.frameTimes.reduce((a, b) => a + b, 0);
      this.avgFrameTimeMs = sum / this.frameTimes.length;
      this.fps = Math.round(1000 / this.avgFrameTimeMs);

      const sorted = [...this.frameTimes].sort((a, b) => a - b);
      const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      this.p95FrameTimeMs = sorted[p95Idx];
      this.worstFrameTimeMs = sorted[sorted.length - 1];
    }

    this.latestSnapshot = {
      timestamp: now,
      fps: this.fps,
      avgFrameTimeMs: +this.avgFrameTimeMs.toFixed(2),
      p95FrameTimeMs: +this.p95FrameTimeMs.toFixed(2),
      worstFrameTimeMs: +this.worstFrameTimeMs.toFixed(2),
      gameState: state.gameState || 'unknown',
      score: state.score || 0,
      hearts: state.hearts || 0,
      streak: state.streak || 0,
      level: state.level || 1,
      hands: state.hands || {},
      lastEvent: this.lastEvent,
      lastContact: this.lastContact,
    };

    if (!this.enabled || !this.dom) return;

    const left = state.hands?.left;
    const right = state.hands?.right;

    const fmtV = (v) => (v ? `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}` : 'n/a');

    this.dom.innerHTML = `
      <div style="font-weight:bold; color:#ffffff; border-bottom:1px solid #334; margin-bottom:6px; padding-bottom:3px;">
        ${this.title} | QA DIAGNOSTICS [D]
      </div>
      <div><b>FPS:</b> <span style="color:${this.fps >= 55 ? '#4ade80' : '#f87171'}">${this.fps}</span> | <b>Avg:</b> ${this.avgFrameTimeMs.toFixed(1)}ms</div>
      <div><b>P95:</b> ${this.p95FrameTimeMs.toFixed(1)}ms | <b>Worst:</b> ${this.worstFrameTimeMs.toFixed(1)}ms</div>
      <div style="margin-top:4px;"><b>State:</b> <span style="color:#facc15">${state.gameState || 'active'}</span> | <b>Lvl:</b> ${state.level || 1}</div>
      <div><b>Score:</b> ${state.score || 0} | <b>Streak:</b> ${state.streak || 0} | <b>Hearts:</b> ${state.hearts || 0}</div>
      
      <div style="margin-top:6px; border-top:1px solid #223; padding-top:4px; font-weight:bold; color:#38bdf8;">HAND TRACKING (POKE & PINCH)</div>
      <div><b>Left:</b> ${left?.tracked ? '<span style="color:#4ade80">TRACKED</span>' : '<span style="color:#94a3b8">OFF</span>'} ${left?.tracked ? `Tip: (${fmtV(left.indexTip)})` : ''}</div>
      <div><b>Right:</b> ${right?.tracked ? '<span style="color:#4ade80">TRACKED</span>' : '<span style="color:#94a3b8">OFF</span>'} ${right?.tracked ? `Tip: (${fmtV(right.indexTip)})` : ''}</div>

      <div style="margin-top:6px; border-top:1px solid #223; padding-top:4px; font-weight:bold; color:#fb923c;">INTERACTIONS</div>
      <div><b>Last:</b> ${this.lastEvent}</div>
      ${this.lastContact ? `<div style="font-size:10px; color:#cbd5e1;">&bull; ${JSON.stringify(this.lastContact).slice(0, 50)}</div>` : ''}
    `;
  }

  getSnapshot() {
    return this.latestSnapshot;
  }
}

