// Optional developer diagnostics panel for WebXR Hand Tracking, Eye Gaze, and Performance.
// Activated only via ?debug=1 in URL, 'D' key, or the dev button. Never interferes with normal gameplay.
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';

export class DiagnosticsPanel {
  constructor(gameTitle = 'VR Experience') {
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
    this.flashTimer = null;
    this.lastDomUpdate = 0;

    this.dom = null;
    this.debug3D = null;

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
      window.__toggleDebug = () => this.toggle();
    }
  }

  attachWorld(world) {
    if (!world || typeof document === 'undefined') return;
    this.world = world;
    this.debug3D = new Group();
    this.debug3D.visible = this.enabled;

    // Element C: Glove / hand catch collider wireframe spheres
    this.colliderMat = new MeshBasicMaterial({
      color: 0x00e5ff,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
    });

    this.leftSphere = new Mesh(new SphereGeometry(0.145, 16, 12), this.colliderMat.clone());
    this.leftSphere.visible = false;
    this.debug3D.add(this.leftSphere);

    this.rightSphere = new Mesh(new SphereGeometry(0.145, 16, 12), this.colliderMat.clone());
    this.rightSphere.visible = false;
    this.debug3D.add(this.rightSphere);

    this.leftFingersSphere = new Mesh(new SphereGeometry(0.125, 12, 8), this.colliderMat.clone());
    this.leftFingersSphere.visible = false;
    this.debug3D.add(this.leftFingersSphere);

    this.rightFingersSphere = new Mesh(new SphereGeometry(0.125, 12, 8), this.colliderMat.clone());
    this.rightFingersSphere.visible = false;
    this.debug3D.add(this.rightFingersSphere);

    this.gloveSphere = new Mesh(new SphereGeometry(0.16, 16, 12), this.colliderMat.clone());
    this.gloveSphere.visible = false;
    this.debug3D.add(this.gloveSphere);

    // Element B: Hand skeleton / palm point indicators
    const ptMat = new MeshBasicMaterial({ color: 0x38bdf8 });
    this.leftPalmPt = new Mesh(new SphereGeometry(0.02, 12, 8), ptMat);
    this.leftPalmPt.visible = false;
    this.debug3D.add(this.leftPalmPt);

    this.rightPalmPt = new Mesh(new SphereGeometry(0.02, 12, 8), ptMat);
    this.rightPalmPt.visible = false;
    this.debug3D.add(this.rightPalmPt);

    // Element A: Gaze Ray (line from head/eyes extending forward)
    this.gazeMat = new LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.85 });
    const gazeGeom = new BufferGeometry();
    gazeGeom.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    this.gazeLine = new Line(gazeGeom, this.gazeMat);
    this.gazeLine.visible = false;
    this.debug3D.add(this.gazeLine);

    // Element D: Ball Trajectory Line
    this.trajMat = new LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.8 });
    const maxTrajPoints = 50;
    const trajGeom = new BufferGeometry();
    trajGeom.setAttribute('position', new Float32BufferAttribute(new Float32Array(maxTrajPoints * 3), 3));
    this.trajLine = new Line(trajGeom, this.trajMat);
    this.trajLine.visible = false;
    this.debug3D.add(this.trajLine);

    world.createTransformEntity(this.debug3D);
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.dom) {
      this.dom.style.display = this.enabled ? 'block' : 'none';
    }
    if (this.debug3D) {
      this.debug3D.visible = this.enabled;
    }
    const btn = typeof document !== 'undefined' ? document.getElementById('dev-btn-debug') : null;
    if (btn) {
      btn.textContent = this.enabled ? '🔍 Colliders ON (D)' : '🔍 Colliders (D)';
      btn.style.background = this.enabled ? '#15803d' : '#854d0e';
      btn.style.borderColor = this.enabled ? '#4ade80' : '#eab308';
      btn.style.color = this.enabled ? '#ffffff' : '#fef08a';
    }
  }

  recordEvent(name, details = {}) {
    this.lastEvent = name;
    this.lastEventTime = performance.now();
    this.lastContact = details;

    if (name === 'caught') {
      this.flashColliders(0x22c55e); // Green on catch
    } else if (name === 'missed') {
      this.flashColliders(0xef4444); // Red on miss
    }
  }

  flashColliders(colorHex) {
    for (const sphere of [this.leftSphere, this.rightSphere, this.leftFingersSphere, this.rightFingersSphere, this.gloveSphere]) {
      if (sphere && sphere.material) {
        sphere.material.color.setHex(colorHex);
      }
    }
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      for (const sphere of [this.leftSphere, this.rightSphere, this.leftFingersSphere, this.rightFingersSphere, this.gloveSphere]) {
        if (sphere && sphere.material) {
          sphere.material.color.setHex(0x00e5ff); // Revert to cyan
        }
      }
    }, 1200);
  }

  initDom() {
    const el = document.createElement('div');
    el.id = 'dev-diagnostics-panel';
    el.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      width: 330px;
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
      hands: state.hands || {},
      glove: state.glove || {},
      gaze: state.gaze || {},
      lastEvent: this.lastEvent,
      lastContact: this.lastContact,
    };

    // Update 3D Debug Elements
    if (this.debug3D && this.enabled) {
      // 1. Hands & Catch Colliders
      const left = state.hands?.left;
      if (left && left.tracked && left.palm) {
        this.leftSphere.position.copy(left.palm);
        this.leftSphere.visible = true;
        this.leftPalmPt.position.copy(left.palm);
        this.leftPalmPt.visible = true;
        if (left.fingers) {
          this.leftFingersSphere.position.copy(left.fingers);
          this.leftFingersSphere.visible = true;
        }
      } else {
        this.leftSphere.visible = false;
        this.leftPalmPt.visible = false;
        this.leftFingersSphere.visible = false;
      }

      const right = state.hands?.right;
      if (right && right.tracked && right.palm) {
        this.rightSphere.position.copy(right.palm);
        this.rightSphere.visible = true;
        this.rightPalmPt.position.copy(right.palm);
        this.rightPalmPt.visible = true;
        if (right.fingers) {
          this.rightFingersSphere.position.copy(right.fingers);
          this.rightFingersSphere.visible = true;
        }
      } else {
        this.rightSphere.visible = false;
        this.rightPalmPt.visible = false;
        this.rightFingersSphere.visible = false;
      }

      // Baseball Mitt
      const glove = state.glove;
      if (glove && glove.ok && glove.pocket) {
        this.gloveSphere.position.copy(glove.pocket);
        this.gloveSphere.visible = true;
      } else {
        this.gloveSphere.visible = false;
      }

      // 2. Gaze Ray
      const gaze = state.gaze;
      if (gaze && gaze.origin && gaze.dir) {
        const pos = this.gazeLine.geometry.attributes.position;
        pos.setXYZ(0, gaze.origin.x, gaze.origin.y, gaze.origin.z);
        pos.setXYZ(1, gaze.origin.x + gaze.dir.x * 15, gaze.origin.y + gaze.dir.y * 15, gaze.origin.z + gaze.dir.z * 15);
        pos.needsUpdate = true;
        this.gazeMat.color.setHex(gaze.watching ? 0xfacc15 : 0x00ffff);
        this.gazeLine.visible = true;
      } else {
        this.gazeLine.visible = false;
      }

      // 3. Ball Trajectory
      const traj = state.ball?.trajectory;
      if (traj && traj.length > 1) {
        const count = Math.min(50, traj.length);
        const pos = this.trajLine.geometry.attributes.position;
        for (let i = 0; i < count; i++) {
          pos.setXYZ(i, traj[i].x, traj[i].y, traj[i].z);
        }
        this.trajLine.geometry.setDrawRange(0, count);
        pos.needsUpdate = true;
        this.trajLine.visible = true;
      } else {
        this.trajLine.visible = false;
      }
    }

    if (!this.enabled || !this.dom) return;
    if (now - this.lastDomUpdate < 100) return;
    this.lastDomUpdate = now;

    const left = state.hands?.left;
    const right = state.hands?.right;
    const glove = state.glove;
    const gaze = state.gaze;

    const fmtV = (v) => (v ? `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}` : 'n/a');

    this.dom.innerHTML = `
      <div style="font-weight:bold; color:#ffffff; border-bottom:1px solid #334; margin-bottom:6px; padding-bottom:3px;">
        ${this.title} | QA DIAGNOSTICS [D]
      </div>
      <div><b>FPS:</b> <span style="color:${this.fps >= 55 ? '#4ade80' : '#f87171'}">${this.fps}</span> | <b>Avg:</b> ${this.avgFrameTimeMs.toFixed(1)}ms</div>
      <div><b>P95:</b> ${this.p95FrameTimeMs.toFixed(1)}ms | <b>Worst:</b> ${this.worstFrameTimeMs.toFixed(1)}ms</div>
      <div style="margin-top:4px;"><b>State:</b> <span style="color:#facc15">${state.gameState || 'active'}</span></div>
      
      <div style="margin-top:6px; border-top:1px solid #223; padding-top:4px; font-weight:bold; color:#38bdf8;">HAND & GLOVE TRACKING</div>
      ${glove ? `<div><b>Mitt (${glove.side}):</b> ${glove.ok ? '<span style="color:#4ade80">ACTIVE</span>' : '<span style="color:#94a3b8">OFF</span>'} &bull; Pos: (${fmtV(glove.pocket)})</div>` : ''}
      <div><b>Left:</b> ${left?.tracked ? '<span style="color:#4ade80">TRACKED</span>' : '<span style="color:#94a3b8">OFF</span>'}</div>
      ${left?.tracked ? `<div> &bull; Palm: (${fmtV(left.palm)})</div><div> &bull; Norm: (${fmtV(left.normal)})</div>` : ''}
      <div><b>Right:</b> ${right?.tracked ? '<span style="color:#4ade80">TRACKED</span>' : '<span style="color:#94a3b8">OFF</span>'}</div>
      ${right?.tracked ? `<div> &bull; Palm: (${fmtV(right.palm)})</div><div> &bull; Norm: (${fmtV(right.normal)})</div>` : ''}

      <div style="margin-top:6px; border-top:1px solid #223; padding-top:4px; font-weight:bold; color:#a78bfa;">GAZE & EYE TRACKING</div>
      <div><b>Gaze:</b> <span style="color:${gaze?.source === 'eyes' ? '#4ade80' : gaze?.source === 'head' ? '#f59e0b' : gaze?.source === 'simulated-eyes' ? '#60a5fa' : '#94a3b8'}">${(gaze?.source || gaze?.mode || 'none').toUpperCase()}</span> ${gaze?.source === 'eyes' ? '(real eye tracking)' : gaze?.source === 'head' ? '(head direction: no eye data)' : gaze?.source === 'simulated-eyes' ? '(mouse stand-in, not real)' : gaze?.source === 'eyes-lost' ? '(eye data lost)' : ''} <b>Move:</b> ${gaze?.movement || '-'}</div>
      <div><b>Focus:</b> ${gaze?.focus != null ? (gaze.focus * 100).toFixed(0) + '%' : 'n/a'} | <b>Watching:</b> ${gaze?.watching ? '<span style="color:#4ade80">YES</span>' : '<span style="color:#94a3b8">NO</span>'}</div>

      <div style="margin-top:6px; border-top:1px solid #223; padding-top:4px; font-weight:bold; color:#fb923c;">INTERACTIONS</div>
      <div><b>Last:</b> ${this.lastEvent}</div>
      ${this.lastContact ? `<div style="font-size:10px; color:#cbd5e1;">&bull; Info: ${JSON.stringify(this.lastContact).slice(0, 50)}</div>` : ''}
    `;
  }

  getSnapshot() {
    return this.latestSnapshot;
  }
}
