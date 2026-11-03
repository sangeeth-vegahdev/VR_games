import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';

// A baseball drawn in code: off-white cowhide with the figure-of-eight seam and its red double
// stitching. The seam is the true 3D curve of a baseball (two lobes that meet), and each stitch is
// placed in 3D on the sphere, then projected into the texture, so it reads correctly all round.

const TW = 1024;
const TH = 512;

// The seam: a closed curve on the unit sphere, r(t) = (a cos t + b cos 3t, a sin t - b sin 3t,
// 2 sqrt(ab) sin 2t) with a + b = 1. Mapped so its flattest axis is the sphere's vertical,
// which keeps it away from the texture's poles.
const A = 0.7;
const B = 0.3;
const C = 2 * Math.sqrt(A * B);
function seam(t, out) {
  const x = A * Math.cos(t) + B * Math.cos(3 * t);
  const z = A * Math.sin(t) - B * Math.sin(3 * t);
  const y = C * Math.sin(2 * t);
  return out.set(x, y, z).normalize();
}

// Unit-sphere point -> canvas pixel, matching three.js SphereGeometry's UVs.
function toPixel(p) {
  const phi = Math.atan2(p.z, -p.x);
  const u = (phi < 0 ? phi + Math.PI * 2 : phi) / (Math.PI * 2);
  const theta = Math.acos(Math.max(-1, Math.min(1, p.y)));
  return [u * TW, (theta / Math.PI) * TH];
}

function line(ctx, a, b) {
  const [x0, y0] = toPixel(a);
  const [x1, y1] = toPixel(b);
  if (Math.abs(x1 - x0) > TW / 2) return; // would wrap round the texture's edge
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function leatherTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = TW;
  canvas.height = TH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f2eee4';
  ctx.fillRect(0, 0, TW, TH);

  // Grain: faint flecks, from a fixed seed so every ball looks the same.
  let s = 11;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(120,100,70,0.07)' : 'rgba(255,255,255,0.25)';
    ctx.fillRect(rand() * TW, rand() * TH, 1 + rand() * 2, 1 + rand() * 2);
  }

  const p = new Vector3();
  const q = new Vector3();
  const tan = new Vector3();
  const side = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  const N = 900;

  // The seam groove: a soft darker line where the two hide pieces meet.
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(150,135,110,0.55)';
  ctx.lineWidth = 3;
  for (let i = 0; i < N; i++) {
    seam((i / N) * Math.PI * 2, p);
    seam(((i + 1) / N) * Math.PI * 2, q);
    line(ctx, p, q);
  }

  // 108 double stitches (a real ball has 108), slanted like a row of V's either side of the seam.
  ctx.strokeStyle = '#c4122b';
  ctx.lineWidth = 3.2;
  const STITCHES = 108;
  for (let i = 0; i < STITCHES; i++) {
    const t = (i / STITCHES) * Math.PI * 2;
    seam(t, p);
    seam(t + 0.004, q);
    tan.subVectors(q, p).normalize();
    side.crossVectors(tan, p).normalize();
    for (const sgn of [1, -1]) {
      a.copy(p).addScaledVector(side, sgn * 0.075).addScaledVector(tan, -0.022).normalize();
      b.copy(p).addScaledVector(side, sgn * 0.022).addScaledVector(tan, 0.022).normalize();
      line(ctx, a, b);
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// Drawn a little larger than a real ball (7.4 cm) so it is easier to read and catch in VR; the
// pitcher holds it at real size (see Pitcher.ballScale).
export const BALL_RADIUS = 0.048;

export function makeBall() {
  const ball = new Mesh(
    new SphereGeometry(BALL_RADIUS, 32, 20),
    new MeshStandardMaterial({ map: leatherTexture(), roughness: 0.55, metalness: 0, emissive: 0x202020 }),
  );
  ball.castShadow = true;
  // A soft glow, so the ball can be followed from the mound under the lights. It fades out as the
  // ball comes close, so the seams show. Its colour also tells the player whether their eyes are on
  // the ball (see setFocusGlow).
  const glow = new Mesh(
    new SphereGeometry(0.15, 16, 12),
    new MeshBasicMaterial({ color: 0xfff4c8, transparent: true, opacity: GLOW_FAR, depthWrite: false }),
  );
  ball.add(glow);
  ball.userData.glow = glow;
  return ball;
}

const GLOW_FAR = 0.5;
const GLOW_FULL_AT = 9; // metres away: full glow
const GLOW_GONE_AT = 2.2; // metres away: no glow

export function setGlowForDistance(ball, distance) {
  const t = Math.min(1, Math.max(0, (distance - GLOW_GONE_AT) / (GLOW_FULL_AT - GLOW_GONE_AT)));
  const glow = ball.userData.glow;
  glow.material.opacity = GLOW_FAR * t;
  glow.visible = t > 0;
}

// Warm white while the eyes are off the ball, green while they are on it.
const OFF = { r: 1, g: 0.957, b: 0.784 };
const ON = { r: 0.45, g: 1, b: 0.6 };
export function setFocusGlow(ball, watching) {
  const c = watching ? ON : OFF;
  ball.userData.glow.material.color.setRGB(c.r, c.g, c.b);
}
