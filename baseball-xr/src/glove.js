import {
  BackSide,
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CylinderGeometry,
  FrontSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
} from '@iwsdk/core';

// A catcher's mitt built in code: a deep padded pocket, a rolled leather rim laced all round, a
// hinged thumb that closes over the pocket, a laced web, and a wrist strap with a club patch.
//
// Local axes: +Y towards the fingertips, +Z out of the palm (the pocket opens this way), +X towards
// the thumb. The origin is the centre of the pocket: where a caught ball sits.

function leather(base, dark, seams) {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  // Grain: soft mottling and pores, from a fixed seed.
  let s = 3;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = 0; i < 260; i++) {
    const r = 8 + rand() * 26;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, rand() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,240,210,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(rand() * W, rand() * H);
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(rand() * W, rand() * H, 1, 1);
  }
  // Panel seams with stitching (they run from the heel to the fingertips on the sphere's UVs).
  if (seams) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = 3;
    for (const u of seams) {
      ctx.beginPath();
      ctx.moveTo(u * W, 0);
      ctx.lineTo(u * W, H);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,236,200,0.55)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 5]);
    for (const u of seams) {
      for (const off of [-6, 6]) {
        ctx.beginPath();
        ctx.moveTo(u * W + off, 0);
        ctx.lineTo(u * W + off, H);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function patch(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.ellipse(128, 64, 124, 60, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = fg;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.font = 'italic 700 64px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 68);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

const STYLES = {
  // The player's mitt: caramel leather, darker pocket, cream laces.
  catcher: { shell: '#b06a2c', pocket: '#7a4219', lace: 0x3a210f, roll: '#8a4f1f', patchBg: '#b0182a', patchFg: '#ffffff' },
  // The pitcher's glove: black leather with tan laces.
  pitcher: { shell: '#232021', pocket: '#141213', lace: 0xb4834f, roll: '#2c2829', patchBg: '#ffffff', patchFg: '#b0182a' },
};

const cache = {};
function materials(style) {
  if (cache[style]) return cache[style];
  const st = STYLES[style];
  const m = {
    shell: new MeshStandardMaterial({ map: leather(st.shell, 'rgba(0,0,0,0.35)', [0.18, 0.36, 0.64, 0.82]), roughness: 0.62, side: FrontSide }),
    pocket: new MeshStandardMaterial({ map: leather(st.pocket, 'rgba(0,0,0,0.3)', null), roughness: 0.75, side: BackSide }),
    roll: new MeshStandardMaterial({ map: leather(st.roll, 'rgba(0,0,0,0.3)', null), roughness: 0.6 }),
    lace: new MeshStandardMaterial({ color: st.lace, roughness: 0.7 }),
    patch: new MeshStandardMaterial({ map: patch('Aces', st.patchBg, st.patchFg), roughness: 0.5 }),
    strap: new MeshStandardMaterial({ color: st.roll, roughness: 0.65 }),
  };
  cache[style] = m;
  return m;
}

// Shared geometry (one set for every mitt; the pitcher's is the same mitt scaled down).
let G = null;
function geometry() {
  if (G) return G;
  // The bowl: a cap of a sphere, opening towards +Z. Scaled flat and wide in the mitt group.
  const cap = new SphereGeometry(1, 32, 14, 0, Math.PI * 2, 0, 1.25);
  cap.rotateX(-Math.PI / 2); // pole to -Z: the bowl's bottom is the back of the mitt
  G = {
    cap,
    roll: new TorusGeometry(1, 0.15, 10, 48),
    lace: new CylinderGeometry(0.0045, 0.0045, 0.05, 5),
    thumb: new CapsuleGeometry(0.034, 0.12, 6, 12),
    webBar: new BoxGeometry(0.012, 0.075, 0.01),
    strap: new BoxGeometry(0.15, 0.045, 0.03),
    patch: new CylinderGeometry(1, 1, 0.004, 24),
    heel: new SphereGeometry(1, 18, 10),
  };
  return G;
}

const RX = 0.145; // half width of the pocket rim
const RY = 0.165; // half height
const DEPTH = 0.085; // bowl depth from rim to back

export function makeMitt(style = 'catcher') {
  const g = geometry();
  const m = materials(style);
  const mitt = new Group();
  mitt.name = `mitt-${style}`;

  // The body (pocket and rim) squeezes narrower as the mitt closes.
  const body = new Group();
  mitt.add(body);
  const rimZ = 0.03;
  const outer = new Mesh(g.cap, m.shell);
  // The cap's rim sits at z = -cos(1.25) = -0.315 of its radius; put it at rimZ.
  outer.scale.set(RX / Math.sin(1.25), RY / Math.sin(1.25), DEPTH / (1 - Math.cos(1.25)));
  outer.position.z = rimZ + Math.cos(1.25) * outer.scale.z;
  const inner = new Mesh(g.cap, m.pocket);
  inner.scale.copy(outer.scale).multiplyScalar(0.96);
  inner.position.copy(outer.position);
  body.add(outer, inner);

  // Rolled rim, a laced binding all round it.
  const roll = new Mesh(g.roll, m.roll);
  roll.scale.set(RX, RY, 0.16);
  roll.position.z = rimZ;
  body.add(roll);
  // The laces round the rim: one instanced mesh (one draw call) per mitt.
  const LACES = 26;
  const laces = new InstancedMesh(g.lace, m.lace, LACES);
  const one = new Object3D();
  for (let i = 0; i < LACES; i++) {
    const a = (i / LACES) * Math.PI * 2;
    // Around the roll: tangent to it, wrapping over the top.
    one.position.set(Math.cos(a) * RX, Math.sin(a) * RY, rimZ + 0.012);
    one.rotation.set(Math.PI / 2, 0, a, 'ZYX');
    one.scale.set(1, 0.7, 1);
    one.updateMatrix();
    laces.setMatrixAt(i, one.matrix);
  }
  body.add(laces);

  // The heel pad at the bottom of the pocket, where the palm sits.
  const heel = new Mesh(g.heel, m.roll);
  heel.scale.set(0.11, 0.045, 0.05);
  heel.position.set(-0.005, -RY + 0.025, rimZ - 0.01);
  body.add(heel);

  // Thumb: hinged at the heel on the +X side so it can swing in over the pocket.
  const thumbHinge = new Group();
  thumbHinge.position.set(RX * 0.7, -RY * 0.55, rimZ - 0.01);
  mitt.add(thumbHinge);
  const thumb = new Mesh(g.thumb, m.shell);
  thumb.position.set(0.03, 0.085, 0.012);
  thumb.rotation.z = -0.32;
  thumbHinge.add(thumb);
  // The web: laced bars between the thumb's tip and the top of the mitt.
  const web = new Group();
  web.position.set(RX * 0.62, RY * 0.6, rimZ + 0.005);
  web.rotation.z = -0.7;
  for (const x of [-0.022, 0, 0.022]) {
    const bar = new Mesh(g.webBar, m.roll);
    bar.position.x = x;
    web.add(bar);
  }
  for (const y of [-0.02, 0.02]) {
    const cross = new Mesh(g.lace, m.lace);
    cross.rotation.z = Math.PI / 2;
    cross.scale.set(1, 1.4, 1);
    cross.position.set(0, y, 0.008);
    web.add(cross);
  }
  mitt.add(web);

  // Back: wrist strap with a club patch, and the opening for the hand.
  const strap = new Mesh(g.strap, m.strap);
  strap.position.set(-0.01, -RY + 0.02, rimZ - DEPTH + 0.01);
  mitt.add(strap);
  const badge = new Mesh(g.patch, m.patch);
  badge.scale.set(0.035, 1, 0.02);
  badge.rotation.x = -Math.PI / 2; // face -Z (out of the back of the mitt)
  badge.rotation.z = Math.PI; // upright when seen from behind
  badge.position.set(-0.01, -RY + 0.022, rimZ - DEPTH - 0.007);
  mitt.add(badge);

  mitt.traverse((o) => {
    if (o.isMesh) o.frustumCulled = true;
  });

  let closed = 0;
  return {
    object: mitt,
    // 0 open, 1 closed round a ball.
    setClose(v) {
      const k = Math.max(0, Math.min(1, v));
      if (Math.abs(k - closed) < 1e-3) return;
      closed = k;
      body.scale.x = 1 - 0.28 * k;
      thumbHinge.rotation.y = -1.05 * k;
      thumbHinge.position.x = RX * (0.7 - 0.18 * k);
      web.rotation.y = -0.6 * k;
      web.position.x = RX * (0.62 - 0.2 * k);
    },
    get closed() {
      return closed;
    },
  };
}

export const MITT_SIZE = { halfWidth: RX, halfHeight: RY, depth: DEPTH };
