import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

// Pooled sparks, shock rings, lightning and floating score text. Everything is allocated up front; the
// frame loop only moves numbers around.

// A pool of glowing particles. Also used, with bigger particles, for the fireworks over the city.
export class Sparks {
  constructor(parent, glowTex, { count = 200, size = 0.022, gravity = 0.9, drag = 2.6, life = 1 } = {}) {
    this.n = count;
    this.gravity = gravity;
    this.dragRate = drag;
    this.lifeScale = life;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.base = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.head = 0;
    this.alive = 0;
    this.tmp = new Color();
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -500;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new BufferAttribute(this.col, 3));
    this.points = new Points(
      geo,
      new PointsMaterial({
        size,
        map: glowTex,
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    parent.add(this.points);
  }

  // A burst at a local position. (nx, nz) is the way "out" of the surface it comes off.
  burst(x, y, z, hex, count, speed, nx = 0, nz = 1) {
    this.tmp.setHex(hex);
    for (let n = 0; n < count; n++) {
      const i = this.head;
      this.head = (this.head + 1) % this.n;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.9);
      const out = 0.1 + Math.random() * 0.3;
      const k = i * 3;
      this.pos[k] = x;
      this.pos[k + 1] = y;
      this.pos[k + 2] = z;
      // Spread across the surface (its sideways axis is (nz, -nx)), plus a push out of it.
      this.vel[k] = Math.cos(a) * s * nz + nx * out;
      this.vel[k + 1] = Math.sin(a) * s + 0.12;
      this.vel[k + 2] = -Math.cos(a) * s * nx + nz * out;
      this.base[k] = this.tmp.r;
      this.base[k + 1] = this.tmp.g;
      this.base[k + 2] = this.tmp.b;
      this.maxLife[i] = this.life[i] = (0.45 + Math.random() * 0.45) * this.lifeScale;
    }
    this.alive = this.n;
  }

  update(dt) {
    if (this.alive <= 0) return;
    let any = 0;
    const drag = Math.exp(-this.dragRate * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.col[k] = this.col[k + 1] = this.col[k + 2] = 0;
        this.pos[k + 1] = -500;
        continue;
      }
      any++;
      this.vel[k] *= drag;
      this.vel[k + 1] = this.vel[k + 1] * drag - this.gravity * dt;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[k] = this.base[k] * f;
      this.col[k + 1] = this.base[k + 1] * f;
      this.col[k + 2] = this.base[k + 2] * f;
    }
    this.alive = any;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// Lightning between two bulbs: a jagged ribbon with a thin bright core and a wide soft edge. Only its
// shape changes, not its brightness, so it crackles without flashing.
const ARC_SEGS = 14;

class Lightning {
  constructor(parent, hex) {
    this.visible = false;
    this.t = 0;
    this.ax = this.ay = this.az = this.bx = this.by = this.bz = 0;
    this.offset = new Float32Array(ARC_SEGS + 1);
    this.strips = [
      { half: 0.0075, mesh: this.strip(parent, hex, 0.3) },
      { half: 0.0018, mesh: this.strip(parent, 0xffffff, 1) },
    ];
  }

  strip(parent, hex, opacity) {
    const geo = new BufferGeometry();
    const pos = new BufferAttribute(new Float32Array((ARC_SEGS + 1) * 6), 3);
    pos.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', pos);
    const index = [];
    for (let i = 0; i < ARC_SEGS; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(index);
    const mesh = new Mesh(
      geo,
      new MeshBasicMaterial({ color: hex, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    mesh.visible = false;
    parent.add(mesh);
    return mesh;
  }

  show(a, b) {
    // Pulled a little towards the player, so it passes in front of the bulbs between them.
    this.ax = a.x * 0.94; this.ay = a.y; this.az = a.z * 0.94;
    this.bx = b.x * 0.94; this.by = b.y; this.bz = b.z * 0.94;
    this.visible = true;
    this.t = 0;
    for (const s of this.strips) s.mesh.visible = true;
    this.shape();
  }

  hide() {
    this.visible = false;
    for (const s of this.strips) s.mesh.visible = false;
  }

  shape() {
    const dx = this.bx - this.ax;
    const dy = this.by - this.ay;
    const dz = this.bz - this.az;
    // Across the bolt, in the plane of the wall: cross(direction, way to the player).
    const mx = (this.ax + this.bx) / 2;
    const mz = (this.az + this.bz) / 2;
    const ml = Math.hypot(mx, mz) || 1;
    const rx = -mx / ml;
    const rz = -mz / ml;
    let cx = dy * rz;
    let cy = dz * rx - dx * rz;
    let cz = -dy * rx;
    const cl = Math.hypot(cx, cy, cz) || 1;
    cx /= cl; cy /= cl; cz /= cl;
    for (let i = 0; i <= ARC_SEGS; i++) {
      const u = i / ARC_SEGS;
      this.offset[i] = Math.sin(Math.PI * u) * 0.042 * (Math.random() * 2 - 1);
    }
    for (const s of this.strips) {
      const p = s.mesh.geometry.attributes.position;
      const arr = p.array;
      for (let i = 0; i <= ARC_SEGS; i++) {
        const u = i / ARC_SEGS;
        const o = this.offset[i];
        const x = this.ax + dx * u + cx * o;
        const y = this.ay + dy * u + cy * o;
        const z = this.az + dz * u + cz * o;
        const k = i * 6;
        arr[k] = x + cx * s.half;
        arr[k + 1] = y + cy * s.half;
        arr[k + 2] = z + cz * s.half;
        arr[k + 3] = x - cx * s.half;
        arr[k + 4] = y - cy * s.half;
        arr[k + 5] = z - cz * s.half;
      }
      p.needsUpdate = true;
    }
  }

  update(dt) {
    if (!this.visible) return;
    this.t += dt;
    if (this.t >= 0.07) {
      this.t = 0;
      this.shape();
    }
  }
}

export class Effects {
  constructor(rig, glowTex) {
    this.sparks = new Sparks(rig, glowTex, { count: 200 });
    this.arc = new Lightning(rig, 0x7ee8ff);

    // A ring that races outward from a hit bulb.
    this.rings = [];
    const ringGeo = new RingGeometry(0.86, 1, 40);
    for (let i = 0; i < 6; i++) {
      const mat = new MeshBasicMaterial({ transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
      const mesh = new Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 8;
      rig.add(mesh);
      this.rings.push({ mesh, mat, t: 0, size: 0.15 });
    }
    this.nextRing = 0;

    // Floating text: a ring of six canvases reused in turn.
    this.popups = [];
    for (let i = 0; i < 6; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 140;
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      const mat = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: DoubleSide, opacity: 0 });
      const mesh = new Mesh(new PlaneGeometry(0.2, 0.0875), mat);
      mesh.visible = false;
      mesh.renderOrder = 10;
      rig.add(mesh);
      this.popups.push({ canvas, g: canvas.getContext('2d'), texture, mesh, mat, t: 0, life: 0, y0: 0 });
    }
    this.nextPopup = 0;
  }

  // Sparks at a rig-local position on the wall, thrown back towards the player.
  burst(x, y, z, hex, count = 22, speed = 0.55) {
    const l = Math.hypot(x, z) || 1;
    this.sparks.burst(x, y, z, hex, count, speed, -x / l, -z / l);
  }

  ring(x, y, z, yaw, hex, size = 0.15) {
    const r = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    r.mesh.position.set(x * 0.95, y, z * 0.95);
    r.mesh.rotation.y = yaw;
    r.mat.color.setHex(hex);
    r.size = size;
    r.t = 0;
    r.mesh.visible = true;
  }

  // Floating text at a rig-local position, turned to face the player (yaw = the bulb's own yaw).
  popup(x, y, z, yaw, text, sub, color) {
    const p = this.popups[this.nextPopup];
    this.nextPopup = (this.nextPopup + 1) % this.popups.length;
    const { g, canvas } = p;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(4, 6, 20, 0.7)';
    g.lineWidth = 12;
    g.font = '900 78px system-ui, sans-serif';
    g.strokeText(text, canvas.width / 2, sub ? 52 : 70, canvas.width * 0.95);
    g.fillStyle = color;
    g.fillText(text, canvas.width / 2, sub ? 52 : 70, canvas.width * 0.95);
    if (sub) {
      g.font = '700 40px system-ui, sans-serif';
      g.lineWidth = 8;
      g.strokeText(sub, canvas.width / 2, 112, canvas.width * 0.95);
      g.fillStyle = '#e8eeff';
      g.fillText(sub, canvas.width / 2, 112, canvas.width * 0.95);
    }
    p.texture.needsUpdate = true;
    const l = Math.hypot(x, z) || 1;
    p.mesh.position.set(x - (x / l) * 0.06, y, z - (z / l) * 0.06); // in front of the bulb, whichever way it faces
    p.mesh.rotation.y = yaw;
    p.y0 = y;
    p.t = 0;
    p.life = 0.95;
    p.mesh.visible = true;
  }

  update(dt) {
    this.sparks.update(dt);
    this.arc.update(dt);
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const f = r.t / 0.32;
      if (f >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const eased = 1 - (1 - f) * (1 - f);
      r.mesh.scale.setScalar(0.02 + r.size * eased);
      r.mat.opacity = 0.85 * (1 - f);
    }
    for (const p of this.popups) {
      if (!p.mesh.visible) continue;
      p.t += dt;
      const f = p.t / p.life;
      if (f >= 1) {
        p.mesh.visible = false;
        continue;
      }
      p.mesh.position.y = p.y0 + 0.07 * (1 - Math.pow(1 - f, 2));
      p.mat.opacity = f < 0.65 ? 1 : 1 - (f - 0.65) / 0.35;
      const s = f < 0.12 ? 0.6 + (f / 0.12) * 0.55 : 1.15 - Math.min(0.15, (f - 0.12) * 0.4);
      p.mesh.scale.setScalar(s);
    }
  }
}
