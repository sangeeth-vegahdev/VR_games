import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

// A cricket ball drawn in code: red leather, a raised seam round the middle with two rows of
// white stitching, and the faint quarter seam. No texture file to download.

function leatherTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Leather: deep red with a slight top-to-bottom shading.
  const base = ctx.createLinearGradient(0, 0, 0, 256);
  base.addColorStop(0, '#b3161c');
  base.addColorStop(0.5, '#a11218');
  base.addColorStop(1, '#8a0f14');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 256);

  // Grain: small darker and lighter flecks, from a fixed seed so every ball looks the same.
  let s = 7;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = 0; i < 2600; i++) {
    const light = rand() < 0.35;
    ctx.fillStyle = light ? 'rgba(255,120,110,0.10)' : 'rgba(40,0,0,0.16)';
    ctx.fillRect(rand() * 512, rand() * 256, 1 + rand() * 2, 1 + rand() * 2);
  }

  // Quarter seam: a faint line across the two halves (UV x = a quarter and three quarters round).
  ctx.strokeStyle = 'rgba(60,0,0,0.45)';
  ctx.lineWidth = 2;
  for (const x of [128, 384]) {
    ctx.beginPath();
    ctx.moveTo(x, 20);
    ctx.lineTo(x, 236);
    ctx.stroke();
  }

  // Main seam round the equator (UV y = 128): a raised darker band...
  const mid = 128;
  ctx.fillStyle = 'rgba(70,0,4,0.55)';
  ctx.fillRect(0, mid - 7, 512, 14);
  ctx.fillStyle = 'rgba(255,190,170,0.18)';
  ctx.fillRect(0, mid - 1, 512, 2);

  // ...and two rows of slanted stitches either side of it.
  ctx.strokeStyle = '#f4ecd8';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  for (const [y, lean] of [
    [mid - 11, 1],
    [mid + 11, -1],
  ]) {
    for (let x = 0; x < 512; x += 9) {
      ctx.beginPath();
      ctx.moveTo(x, y - 3 * lean);
      ctx.lineTo(x + 4, y + 3 * lean);
      ctx.stroke();
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export const BALL_RADIUS = 0.08;

// Returns the ball mesh. Its seam sits on the sphere's equator, so rotation.y spins the ball about
// the axis through the seam (the way a bowled ball spins), and rotation.z tilts the seam.
export function makeBall() {
  const ball = new Mesh(
    new SphereGeometry(BALL_RADIUS, 32, 20),
    new MeshStandardMaterial({ map: leatherTexture(), roughness: 0.45, metalness: 0, emissive: 0x2a0303 }),
  );
  ball.rotation.order = 'ZYX'; // spin (y) is applied first, then the seam tilt (z)
  // A soft glow, so the ball can be followed from 18 m away where it is only a dot.
  // It fades out as the ball comes close (see setGlowForDistance), so the leather and seam show.
  const glow = new Mesh(
    new SphereGeometry(0.17, 16, 12),
    new MeshBasicMaterial({ color: 0xff6a5a, transparent: true, opacity: GLOW_FAR, depthWrite: false }),
  );
  ball.add(glow);
  ball.userData.glow = glow;
  return ball;
}

const GLOW_FAR = 0.3;
const GLOW_FULL_AT = 9; // metres away: full glow
const GLOW_GONE_AT = 2.5; // metres away: no glow

export function setGlowForDistance(ball, distance) {
  const t = Math.min(1, Math.max(0, (distance - GLOW_GONE_AT) / (GLOW_FULL_AT - GLOW_GONE_AT)));
  const glow = ball.userData.glow;
  glow.material.opacity = GLOW_FAR * t;
  glow.visible = t > 0;
}
