import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import { CFG } from './config.js';
import { Sparks } from './fx.js';

// The world around the board: you sit on a rooftop at night, above a sleeping city, and your score is
// what powers it. Windows come on as you play, a ring of light runs across the roof from each hit, the
// city browns out when you lose a heart and goes dark when you lose, and fireworks go up for a new best.
//
// The world stays still when the board re-centres on the player, so nothing here can make anyone feel
// they are moving. It is cheap: the sky, the moon, one instanced mesh for the buildings and one Points
// object for every window, all unlit and drawn once.

const WINDOWS_MAX = 3200;
const ROOF = 7; // radius of the rooftop, in metres
const BASE_LIGHTS = 0.14; // even at no power a few windows stay on, so the city never looks dead

// The same city every time: a small seeded random, so the skyline is part of the game's identity.
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function texture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// Night sky: deep blue overhead, a dusky band at the horizon, thin clouds. A little noise stops the
// slow gradient breaking into visible bands.
function skyTexture(rnd) {
  return texture(1024, 512, (g, W, H) => {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#02030a');
    grad.addColorStop(0.3, '#060a20');
    grad.addColorStop(0.43, '#141a40');
    grad.addColorStop(0.485, '#3a2c58');
    grad.addColorStop(0.5, '#5d3d58');
    grad.addColorStop(0.53, '#14121f');
    grad.addColorStop(1, '#040408');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // Long thin clouds above the horizon, lit faintly from below.
    for (let i = 0; i < 46; i++) {
      const x = rnd() * W;
      const y = H * (0.3 + rnd() * 0.17);
      const rx = 40 + rnd() * 130;
      const ry = 2 + rnd() * 6;
      const c = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      c.addColorStop(0, `rgba(150,120,170,${0.05 + rnd() * 0.08})`);
      c.addColorStop(1, 'rgba(150,120,170,0)');
      g.save();
      g.translate(x, y);
      g.scale(rx, ry);
      g.fillStyle = c;
      g.fillRect(-1, -1, 2, 2);
      g.restore();
    }
    const img = g.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 3;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  });
}

function moonTexture(rnd) {
  return texture(256, 256, (g, W) => {
    const c = W / 2;
    const halo = g.createRadialGradient(c, c, W * 0.12, c, c, c);
    halo.addColorStop(0, 'rgba(190,205,255,0.5)');
    halo.addColorStop(0.35, 'rgba(150,170,255,0.1)');
    halo.addColorStop(1, 'rgba(150,170,255,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, W, W);
    const disc = g.createRadialGradient(c - 10, c - 10, 4, c, c, W * 0.15);
    disc.addColorStop(0, '#fbfaf0');
    disc.addColorStop(0.85, '#d7d8d8');
    disc.addColorStop(1, '#b4b6c0');
    g.fillStyle = disc;
    g.beginPath();
    g.arc(c, c, W * 0.15, 0, Math.PI * 2);
    g.fill();
    // Maria: soft dark patches.
    g.save();
    g.beginPath();
    g.arc(c, c, W * 0.15, 0, Math.PI * 2);
    g.clip();
    for (let i = 0; i < 9; i++) {
      g.fillStyle = `rgba(125,130,150,${0.12 + rnd() * 0.16})`;
      g.beginPath();
      g.arc(c + (rnd() - 0.5) * W * 0.24, c + (rnd() - 0.5) * W * 0.24, 4 + rnd() * 11, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  });
}

// Weathered concrete tiles for the roof.
function roofTexture(rnd) {
  const t = texture(512, 512, (g, W) => {
    g.fillStyle = '#10121a';
    g.fillRect(0, 0, W, W);
    for (let i = 0; i < 2600; i++) {
      const a = rnd() * 0.05;
      g.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 2})`;
      const s = 1 + rnd() * 3;
      g.fillRect(rnd() * W, rnd() * W, s, s);
    }
    g.strokeStyle = 'rgba(0,0,0,0.65)';
    g.lineWidth = 3;
    g.strokeRect(0, 0, W, W);
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(12, 12);
  t.anisotropy = 8;
  return t;
}

export class Stage {
  // rig: the board's group (the glow behind the bulbs moves with it). parent: fixed to the world.
  constructor(rig, glowTex, parent) {
    const R = CFG.boardRadius;
    const rnd = seeded(20261118);
    this.base = new Color(0x2a2f8f);
    this.target = new Color(0x2a2f8f);
    this.kick = 0;
    this.power = 0;
    this.powerGoal = 0;
    this.dim = 0;
    this.fireT = 0;
    this.fireNext = 0;

    // A soft glow behind the board, tinted by the game: it shows as a rim around the wall of bulbs.
    this.glowMat = new MeshBasicMaterial({
      map: glowTex,
      color: 0x2a2f8f,
      transparent: true,
      opacity: 0.2,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.glow = new Mesh(new PlaneGeometry(2.3, 1.3), this.glowMat);
    this.glow.position.set(0, 0.02, -R - 0.3);
    this.glow.renderOrder = -3;
    rig.add(this.glow);

    this.floor = new Group();
    parent.add(this.floor);

    // Sky and moon.
    const sky = new Mesh(new SphereGeometry(400, 32, 16), new MeshBasicMaterial({ map: skyTexture(rnd), side: BackSide, depthWrite: false }));
    sky.renderOrder = -10;
    this.floor.add(sky);
    const moon = new Mesh(new PlaneGeometry(90, 90), new MeshBasicMaterial({ map: moonTexture(rnd), transparent: true, blending: AdditiveBlending, depthWrite: false }));
    moon.position.set(-150, 190, -270);
    moon.lookAt(0, 0, 0);
    moon.renderOrder = -9;
    this.floor.add(moon);

    this.buildStars(rnd);
    this.buildCity(rnd);
    this.buildRoof(rnd);

    this.fireworks = new Sparks(this.floor, glowTex, { count: 260, size: 3.4, gravity: 9, drag: 1.1, life: 2.1 });
  }

  buildStars(rnd) {
    const count = 520;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const e = 0.2 + Math.acos(1 - rnd()) * 0.85; // thin out towards the top of the sky
      const d = 340;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * d;
      pos[i * 3 + 1] = Math.sin(e) * d;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * d;
      const b = 0.25 + rnd() * rnd() * 0.75;
      const tint = rnd();
      col[i * 3] = (0.75 + 0.25 * tint) * b;
      col[i * 3 + 1] = (0.82 + 0.15 * tint) * b;
      col[i * 3 + 2] = b;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    this.stars = new Points(geo, new PointsMaterial({ size: 1.5, vertexColors: true, transparent: true, sizeAttenuation: true, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    this.floor.add(this.stars);
  }

  buildCity(rnd) {
    const buildings = 170;
    const geo = new BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const blocks = new InstancedMesh(geo, new MeshBasicMaterial({ color: 0xffffff }), buildings);
    blocks.frustumCulled = false;
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const p = new Vector3();
    const s = new Vector3();
    const c = new Color();
    const wins = [];
    const beacons = [];
    const BASE = -30; // well below the parapet, out of sight
    for (let i = 0; i < buildings; i++) {
      const a = rnd() * Math.PI * 2;
      const far = rnd();
      const dist = 26 + far * far * 200;
      // Nearby roofs stay below eye level, so the view opens out; the further away, the taller.
      const ahead = 0.5 + 0.5 * Math.cos(a + Math.PI / 2); // 1 straight ahead of where the player starts
      const reach = Math.min(1, (dist - 26) / 120);
      const top = -3 + rnd() * 4 + reach * (5 + rnd() * rnd() * 34 + ahead * ahead * 26 * rnd());
      const w = 7 + rnd() * 9 + reach * 8;
      const h = top - BASE;
      p.set(Math.cos(a) * dist, BASE, Math.sin(a) * dist);
      s.set(w, h, w);
      q.setFromAxisAngle(up, -a + Math.PI / 2);
      m.compose(p, q, s);
      blocks.setMatrixAt(i, m);
      // Almost black up close, fading into the night haze with distance.
      const haze = Math.min(1, dist / 230);
      const shade = 0.0035 + haze * haze * 0.022;
      c.setRGB(shade * 0.85, shade * 0.9, shade * 1.7);
      blocks.setColorAt(i, c);

      // Windows on the face towards the player, in neat rows and columns.
      const cols = Math.max(3, Math.floor(w / 2.6));
      const rows = Math.floor((top + 8) / 3);
      const d = dist - w / 2 - 0.2;
      for (let r = 0; r < rows; r++) {
        const y = top - 1.5 - r * 3;
        for (let k = 0; k < cols; k++) {
          if (rnd() < 0.25) continue;
          const u = ((k + 0.5) / cols - 0.5) * w * 0.92;
          wins.push(Math.cos(a) * d - Math.sin(a) * u, y, Math.sin(a) * d + Math.cos(a) * u);
        }
      }
      if (top > 22) beacons.push(p.x, top + 1.2, p.z);
    }
    blocks.instanceMatrix.needsUpdate = true;
    this.floor.add(blocks);

    // Shuffled, so lighting "the first N" comes on all over the city rather than building by building.
    const found = wins.length / 3;
    const total = Math.min(WINDOWS_MAX, found);
    const order = [];
    for (let i = 0; i < found; i++) order.push(i);
    for (let i = found - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    const pos = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    for (let i = 0; i < total; i++) {
      const o = order[i] * 3;
      pos[i * 3] = wins[o];
      pos[i * 3 + 1] = wins[o + 1];
      pos[i * 3 + 2] = wins[o + 2];
      const kind = rnd();
      const b = 0.45 + rnd() * 0.55;
      if (kind < 0.76) c.setRGB(1 * b, 0.68 * b, 0.32 * b); // warm rooms
      else if (kind < 0.92) c.setRGB(0.62 * b, 0.82 * b, 1 * b); // screens
      else c.setRGB(1 * b, 0.96 * b, 0.86 * b);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const geoW = new BufferGeometry();
    geoW.setAttribute('position', new BufferAttribute(pos, 3));
    geoW.setAttribute('color', new BufferAttribute(col, 3));
    this.windows = new Points(geoW, new PointsMaterial({ size: 0.85, vertexColors: true, sizeAttenuation: true }));
    this.windows.frustumCulled = false;
    this.windowCount = total;
    this.floor.add(this.windows);

    // Red aircraft lights on the tallest towers, blinking slowly.
    const beaconGeo = new BufferGeometry();
    beaconGeo.setAttribute('position', new BufferAttribute(new Float32Array(beacons), 3));
    this.beaconMat = new PointsMaterial({ size: 1.6, color: 0xff3030, transparent: true, sizeAttenuation: true, depthWrite: false });
    const beaconPoints = new Points(beaconGeo, this.beaconMat);
    beaconPoints.frustumCulled = false;
    this.floor.add(beaconPoints);

    // The city's own light on the haze: brighter the more of it is lit.
    const tex = texture(4, 128, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 4, 128);
    });
    this.skyMat = new MeshBasicMaterial({ map: tex, color: 0xff8a3c, transparent: true, opacity: 0.04, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    this.haze = new Mesh(new CylinderGeometry(300, 300, 70, 40, 1, true), this.skyMat);
    this.haze.position.y = 34;
    this.haze.renderOrder = -8;
    this.floor.add(this.haze);
  }

  buildRoof(rnd) {
    const roof = new Mesh(new CircleGeometry(ROOF, 64), new MeshBasicMaterial({ map: roofTexture(rnd) }));
    roof.rotation.x = -Math.PI / 2;
    this.floor.add(roof);

    // A low wall round the edge, with a thin LED strip on top. It hides the drop, so the height is calm.
    const wall = new Mesh(new CylinderGeometry(ROOF, ROOF, 0.6, 64, 1, true), new MeshBasicMaterial({ color: 0x0b0d15, side: DoubleSide }));
    wall.position.y = 0.3;
    this.floor.add(wall);
    this.ledMat = new MeshBasicMaterial({ color: 0x35f2ff, transparent: true, opacity: 0.5 });
    const led = new Mesh(new TorusGeometry(ROOF - 0.02, 0.014, 6, 128), this.ledMat);
    led.rotation.x = Math.PI / 2;
    led.position.y = 0.6;
    this.floor.add(led);

    // A pair of faint rings on the roof around the player.
    this.rings = [];
    [1.5, 3.2].forEach((r, i) => {
      const mesh = new Mesh(
        new RingGeometry(r, r + 0.018, 96),
        new MeshBasicMaterial({ color: i === 1 ? 0xb04dff : 0x35f2ff, transparent: true, opacity: 0.2, side: DoubleSide, depthWrite: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.004 * (i + 1);
      mesh.renderOrder = -4;
      this.floor.add(mesh);
      this.rings.push(mesh);
    });

    // A faint ring runs out across the roof from each hit, like power heading into the city.
    this.waves = [];
    const waveGeo = new RingGeometry(0.97, 1, 72);
    for (let i = 0; i < 4; i++) {
      const mat = new MeshBasicMaterial({ transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
      const mesh = new Mesh(waveGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.012;
      mesh.visible = false;
      mesh.renderOrder = -3;
      this.floor.add(mesh);
      this.waves.push({ mesh, mat, t: 0 });
    }
    this.nextWave = 0;
  }

  // Briefly tint the glow (a hit, a miss, a level up).
  pulse(hex, amount = 0.6) {
    this.target.setHex(hex);
    this.kick = amount;
  }

  wave(hex) {
    const w = this.waves[this.nextWave];
    this.nextWave = (this.nextWave + 1) % this.waves.length;
    w.mat.color.setHex(hex);
    w.t = 0;
    w.mesh.visible = true;
  }

  // How much of the city is lit, 0..1. It eases there, so lights come on one after another.
  setPower(f) {
    this.powerGoal = f;
  }

  // A heart lost: the city browns out for a moment.
  brownout() {
    this.dim = 1;
  }

  celebrate(seconds) {
    this.fireT = seconds;
    this.fireNext = 0;
  }

  update(dt, now, energy, beat = 0, surge = false) {
    this.kick = Math.max(0, this.kick - dt * 2.2);
    // Calm purple-blue; a pulse pulls it towards the pulse colour, and it brightens as the level climbs.
    const w = this.kick;
    this.glowMat.color.copy(this.base).lerp(this.target, Math.min(1, w * 1.4));
    this.glowMat.opacity = 0.2 + 0.04 * Math.sin(now * 0.8) + 0.3 * w + 0.08 * energy + 0.06 * beat * energy;
    this.rings[0].material.opacity = 0.16 + 0.05 * Math.sin(now * 1.3) + 0.1 * beat;
    this.rings[1].material.opacity = 0.12 + 0.05 * Math.sin(now * 1.3 + 2) + 0.1 * beat;
    this.ledMat.opacity = 0.4 + 0.25 * beat;
    this.ledMat.color.setHex(surge ? 0xff4dff : 0x35f2ff);
    this.beaconMat.opacity = 0.25 + 0.75 * Math.max(0, Math.sin(now * 2.2));

    for (const wv of this.waves) {
      if (!wv.mesh.visible) continue;
      wv.t += dt;
      const f = wv.t / 0.8;
      if (f >= 1) {
        wv.mesh.visible = false;
        continue;
      }
      wv.mesh.scale.setScalar(0.4 + (ROOF - 0.5) * f);
      wv.mat.opacity = 0.3 * (1 - f);
    }

    // City power. Coming on it eases; going out it is quicker, and a brown-out takes a chunk for a moment.
    const rate = this.powerGoal > this.power ? 1.2 : 2.2;
    this.power += (this.powerGoal - this.power) * Math.min(1, dt * rate);
    this.dim = Math.max(0, this.dim - dt * 1.4);
    const lit = (BASE_LIGHTS + (1 - BASE_LIGHTS) * this.power) * (1 - 0.65 * this.dim);
    this.windows.geometry.setDrawRange(0, Math.round(lit * this.windowCount));
    this.skyMat.opacity = 0.03 + 0.26 * lit + 0.02 * beat;
    this.skyMat.color.setHex(surge ? 0xff4dff : 0xff8a3c);

    // Fireworks: one shell every half second while celebrating.
    this.fireworks.update(dt);
    if (this.fireT > 0) {
      this.fireT -= dt;
      this.fireNext -= dt;
      if (this.fireNext <= 0) {
        this.fireNext = 0.5;
        const hex = [0xffd23c, 0x35f2ff, 0xff4dff, 0x5cf2a8][Math.floor(Math.random() * 4)];
        this.fireworks.burst((Math.random() - 0.5) * 140, 45 + Math.random() * 45, -150 - Math.random() * 50, hex, 50, 34);
      }
    }
  }
}
