// The tile pictures: a ball on a dark surface, lit from the upper left. Drawn once at start-up from code, so the
// lobby ships no image files. Every picture uses a fixed seed and looks the same on each load.

const W = 800; // pixels for a one-column tile
const H = 452;

function mulberry(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth blotches, 0..1. `cells` is how many blotches fit across the picture.
function blotches(rand, cells, aspect) {
  const nx = cells + 2;
  const ny = Math.ceil(cells / aspect) + 2;
  const v = new Float32Array(nx * ny);
  for (let i = 0; i < v.length; i++) v[i] = rand();
  const fade = (t) => t * t * (3 - 2 * t);
  return (u, w) => {
    const x = u * cells;
    const y = (w * (ny - 2));
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const at = (i, j) => v[j * nx + i];
    const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
    const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

// Paints every pixel: tone(u, v) gives the colour, plus fine grain and scattered stones from `grain(v)`.
function paintSurface(ctx, seed, tone, grain, stones = 0) {
  const { width, height } = ctx.canvas;
  const rand = mulberry(seed);
  const img = ctx.createImageData(width, height);
  const px = img.data;
  const large = blotches(rand, 7, width / height);
  const small = blotches(rand, 40, width / height);
  let i = 0;
  for (let y = 0; y < height; y++) {
    const v = y / height;
    const amount = grain(v);
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const [r, g, b] = tone(u, v);
      let k = 0.86 + 0.16 * large(u, v) + 0.12 * small(u, v) * Math.min(1, amount / 18);
      let add = (rand() - 0.5) * amount;
      if (rand() < stones) add += 14 + rand() * amount * 1.4;
      else if (rand() < stones) k *= 0.62;
      px[i++] = r * k + add;
      px[i++] = g * k + add;
      px[i++] = b * k + add;
      px[i++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function softShadow(ctx, x, y, rx, ry, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, `rgba(0,0,0,${alpha})`);
  g.addColorStop(0.55, `rgba(0,0,0,${alpha * 0.55})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function vignette(ctx, strength, cx = 0.5, cy = 0.48) {
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.translate(width * cx, height * cy);
  ctx.scale(width, height);
  const g = ctx.createRadialGradient(0, 0, 0.3, 0, 0, 0.8);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

const LIGHT = norm([-0.38, 0.5, 0.78]);
const HALF = norm([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);

function norm([x, y, z]) {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function diffuseAt(n) {
  const d = Math.max(0, (dot(n, LIGHT) + 0.3) / 1.3);
  return (0.26 + 0.86 * Math.pow(d, 1.2)) * (0.7 + 0.3 * Math.max(0, n[2]));
}

// A lit sphere, shaded per pixel, with a pebbled surface.
function drawSphere(ctx, cx, cy, r, albedo, { spec, shininess, pebble, seed }) {
  const size = Math.ceil(r * 2 + 4);
  const c = size / 2;
  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const octx = off.getContext('2d');
  const img = octx.createImageData(size, size);
  const px = img.data;
  const rand = mulberry(seed);
  let i = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++, i += 4) {
      const nx = (x + 0.5 - c) / r;
      const ny = -(y + 0.5 - c) / r;
      const d2 = nx * nx + ny * ny;
      const edge = (1 - Math.sqrt(d2)) * r + 0.5;
      if (edge <= 0) continue;
      const nz = Math.sqrt(Math.max(0, 1 - d2));
      const bump = pebble * (rand() - 0.5);
      const n = norm([nx + bump, ny + pebble * (rand() - 0.5), nz + 0.001]);
      const shade = diffuseAt(n);
      const s = spec * Math.pow(Math.max(0, dot(n, HALF)), shininess);
      px[i] = albedo[0] * shade + s;
      px[i + 1] = albedo[1] * shade + s;
      px[i + 2] = albedo[2] * shade + s;
      px[i + 3] = Math.min(1, edge) * 255;
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.drawImage(off, cx - c, cy - c);
}

function rotator(rx, ry, rz) {
  const [sx, cx, sy, cy, sz, cz] = [Math.sin(rx), Math.cos(rx), Math.sin(ry), Math.cos(ry), Math.sin(rz), Math.cos(rz)];
  return ([x, y, z]) => {
    const y1 = y * cx - z * sx;
    const z1 = y * sx + z * cx;
    const x2 = x * cy + z1 * sy;
    const z2 = -x * sy + z1 * cy;
    return [x2 * cz - y1 * sz, x2 * sz + y1 * cz, z2];
  };
}

function strokeOnBall(ctx, cx, cy, r, a, b, rgb, width) {
  const mid = norm([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
  if (mid[2] < 0.04) return;
  const k = diffuseAt(mid);
  ctx.strokeStyle = `rgb(${rgb[0] * k | 0},${rgb[1] * k | 0},${rgb[2] * k | 0})`;
  ctx.lineWidth = width * (0.45 + 0.55 * mid[2]);
  ctx.beginPath();
  ctx.moveTo(cx + a[0] * r, cy - a[1] * r);
  ctx.lineTo(cx + b[0] * r, cy - b[1] * r);
  ctx.stroke();
}

function drawBaseball(ctx, cx, cy, r) {
  drawSphere(ctx, cx, cy, r, [238, 232, 218], { spec: 22, shininess: 16, pebble: 0.1, seed: 11 });

  // The seam of a real baseball is one closed curve (Thompson's formula). Red V stitches run along it.
  const A = 0.44;
  const turn = rotator(0.1, 0.06, -0.42); // looking between the two arcs of the seam
  const at = (t) => {
    const phi = Math.PI / 2 - (Math.PI / 2 - A) * Math.cos(t);
    const th = t / 2 + A * Math.sin(2 * t);
    return turn([Math.sin(phi) * Math.cos(th), Math.sin(phi) * Math.sin(th), Math.cos(phi)]);
  };
  const steps = 1400;
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(at((i / steps) * 4 * Math.PI));

  ctx.lineCap = 'round';
  for (let i = 0; i < steps; i++) strokeOnBall(ctx, cx, cy, r, pts[i], pts[i + 1], [150, 118, 104], r * 0.022);

  let run = 0;
  for (let i = 1; i < steps; i++) {
    run += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    if (run < 0.082) continue;
    run = 0;
    const p = pts[i];
    const t = norm([pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1], pts[i + 1][2] - pts[i - 1][2]]);
    const side = cross(p, t);
    const shift = (sw, tw) => norm([p[0] + side[0] * sw + t[0] * tw, p[1] + side[1] * sw + t[1] * tw, p[2] + side[2] * sw + t[2] * tw]);
    const red = [196, 34, 42];
    strokeOnBall(ctx, cx, cy, r, shift(0.075, -0.03), shift(0.012, 0.022), red, r * 0.023);
    strokeOnBall(ctx, cx, cy, r, shift(-0.075, -0.03), shift(-0.012, 0.022), red, r * 0.023);
  }
}

function drawCricketBall(ctx, cx, cy, r) {
  drawSphere(ctx, cx, cy, r, [172, 24, 40], { spec: 70, shininess: 30, pebble: 0.05, seed: 23 });

  // The seam is a great circle with rows of raised stitches either side of a groove.
  const turn = rotator(0, -0.34, -0.8);
  const axis = turn([1, 0, 0]);
  const u = turn([0, 1, 0]);
  const w = turn([0, 0, 1]);
  const ring = (a, off) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return norm([u[0] * c + w[0] * s + axis[0] * off, u[1] * c + w[1] * s + axis[1] * off, u[2] * c + w[2] * s + axis[2] * off]);
  };
  ctx.lineCap = 'round';
  const steps = 300;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const b = ((i + 1) / steps) * Math.PI * 2;
    strokeOnBall(ctx, cx, cy, r, ring(a, 0), ring(b, 0), [70, 8, 14], r * 0.03);
  }
  for (const off of [-0.066, -0.034, 0.034, 0.066]) {
    const rows = Math.abs(off) > 0.05 ? [220, 196, 170] : [246, 236, 216];
    for (let i = 0; i < 112; i++) {
      const a = (i / 112) * Math.PI * 2;
      strokeOnBall(ctx, cx, cy, r, ring(a, off), ring(a + 0.03, off), rows, r * 0.018);
    }
  }
}

function drawStump(ctx, x, top, bottom, width) {
  const g = ctx.createLinearGradient(x, 0, x + width, 0);
  g.addColorStop(0, '#d8b57f');
  g.addColorStop(0.32, '#c79f68');
  g.addColorStop(0.72, '#8f6c40');
  g.addColorStop(1, '#5a4427');
  ctx.fillStyle = g;
  ctx.fillRect(x, top, width, bottom - top - width * 0.12);
  ctx.beginPath();
  ctx.ellipse(x + width / 2, bottom - width * 0.12, width / 2, width * 0.16, 0, 0, Math.PI);
  ctx.fill();
  // Wood grain: faint streaks along the length.
  const rand = mulberry(Math.round(x));
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const gx = x + rand() * width;
    ctx.strokeStyle = `rgba(70,46,20,${0.06 + rand() * 0.14})`;
    ctx.beginPath();
    ctx.moveTo(gx, top + rand() * 60);
    ctx.lineTo(gx + (rand() - 0.5) * 2, bottom - rand() * 40);
    ctx.stroke();
  }
}

// A lamp with a pear-shaped glass and a screw base. x, y: centre of the glass. s: radius of the glass.
function drawBulb(ctx, x, y, s, lit) {
  const glass = () => {
    ctx.beginPath();
    ctx.moveTo(x - s * 0.34, y + s * 1.2);
    ctx.bezierCurveTo(x - s * 0.42, y + s * 0.78, x - s, y + s * 0.6, x - s, y - s * 0.02);
    ctx.bezierCurveTo(x - s, y - s * 0.62, x - s * 0.55, y - s, x, y - s);
    ctx.bezierCurveTo(x + s * 0.55, y - s, x + s, y - s * 0.62, x + s, y - s * 0.02);
    ctx.bezierCurveTo(x + s, y + s * 0.6, x + s * 0.42, y + s * 0.78, x + s * 0.34, y + s * 1.2);
    ctx.closePath();
  };

  if (lit) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(x, y, s * 0.2, x, y, s * 3.8);
    halo.addColorStop(0, 'rgba(150,240,235,0.62)');
    halo.addColorStop(0.3, 'rgba(50,190,190,0.2)');
    halo.addColorStop(1, 'rgba(0,120,120,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(x - s * 4, y - s * 4, s * 8, s * 8);
    ctx.restore();
  }

  const fill = ctx.createRadialGradient(x - s * 0.25, y - s * 0.3, s * 0.05, x, y, s * 1.15);
  if (lit) {
    fill.addColorStop(0, '#ffffff');
    fill.addColorStop(0.5, '#d6fbf6');
    fill.addColorStop(0.86, '#62dcd6');
    fill.addColorStop(1, '#2ea6a4');
  } else {
    fill.addColorStop(0, 'rgba(120,136,132,0.48)');
    fill.addColorStop(0.75, 'rgba(58,72,68,0.5)');
    fill.addColorStop(1, 'rgba(104,120,116,0.62)');
  }
  ctx.fillStyle = fill;
  glass();
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.022);
  ctx.strokeStyle = lit ? 'rgba(235,255,252,0.85)' : 'rgba(172,186,182,0.42)';
  ctx.stroke();

  // Filament.
  ctx.lineCap = 'round';
  ctx.lineWidth = s * 0.035;
  ctx.strokeStyle = lit ? '#fffbe8' : 'rgba(40,46,44,0.85)';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.17, y + s * 0.9);
  ctx.lineTo(x - s * 0.25, y + s * 0.08);
  for (let i = 0; i < 4; i++) ctx.arc(x - s * 0.19 + i * s * 0.125, y + s * 0.06, s * 0.062, Math.PI, 0);
  ctx.lineTo(x + s * 0.17, y + s * 0.9);
  ctx.stroke();

  if (!lit) {
    // Window reflection on the unlit glass.
    ctx.strokeStyle = 'rgba(232,240,238,0.3)';
    ctx.lineWidth = s * 0.05;
    ctx.beginPath();
    ctx.arc(x, y - s * 0.04, s * 0.74, Math.PI * 1.1, Math.PI * 1.42);
    ctx.stroke();
  }

  // Screw base.
  const baseW = s * 0.72;
  const baseTop = y + s * 1.17;
  const baseH = s * 0.56;
  const metal = ctx.createLinearGradient(x - baseW / 2, 0, x + baseW / 2, 0);
  metal.addColorStop(0, '#6d7270');
  metal.addColorStop(0.3, lit ? '#e8ece8' : '#a2a7a4');
  metal.addColorStop(1, '#2d3130');
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.roundRect(x - baseW / 2, baseTop, baseW, baseH, s * 0.05);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = s * 0.03;
  for (let i = 1; i < 4; i++) {
    const ty = baseTop + (baseH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x - baseW / 2, ty);
    ctx.lineTo(x + baseW / 2, ty - s * 0.03);
    ctx.stroke();
  }
  ctx.fillStyle = '#17191a';
  ctx.beginPath();
  ctx.moveTo(x - baseW * 0.32, baseTop + baseH);
  ctx.quadraticCurveTo(x, baseTop + baseH + s * 0.24, x + baseW * 0.32, baseTop + baseH);
  ctx.closePath();
  ctx.fill();
}

const PAINTERS = {
  baseball(ctx) {
    paintSurface(
      ctx,
      101,
      (u, v) => {
        const lit = 1.22 - 0.72 * Math.hypot(u - 0.42, (v - 0.42) * 0.8);
        return [64 * lit, 64 * lit, 67 * lit];
      },
      (v) => 16 + 26 * v,
      0.012,
    );
    const r = H * 0.4;
    const x = W * 0.5;
    const y = H * 0.48;
    softShadow(ctx, x + r * 0.2, y + r * 0.72, r * 1.3, r * 0.56, 0.74);
    drawBaseball(ctx, x, y, r);
    vignette(ctx, 0.5);
  },

  cricket(ctx) {
    paintSurface(
      ctx,
      202,
      (u, v) => {
        const far = Math.min(1, Math.max(0, (v - 0.04) / 0.34));
        const k = 0.62 + 0.3 * far - 0.16 * Math.max(0, v - 0.65);
        return [(70 + 88 * far) * k, (68 + 72 * far) * k, (62 + 50 * far) * k];
      },
      (v) => 2 + 34 * Math.min(1, Math.max(0, (v - 0.14) / 0.5)),
      0.01,
    );
    const stumpBottom = H * 0.8;
    for (const [sx, sw] of [[W * 0.545, W * 0.078], [W * 0.685, W * 0.08], [W * 0.815, W * 0.082]]) {
      softShadow(ctx, sx + sw * 0.75, stumpBottom, sw * 1.05, sw * 0.26, 0.72);
      drawStump(ctx, sx, -4, stumpBottom, sw);
    }
    const r = H * 0.29;
    const x = W * 0.33;
    const y = H * 0.54;
    softShadow(ctx, x + r * 0.26, y + r * 0.78, r * 1.34, r * 0.52, 0.76);
    drawCricketBall(ctx, x, y, r);
    vignette(ctx, 0.42);
  },

  bulb(ctx) {
    const { width, height } = ctx.canvas;
    const aspect = width / height;
    paintSurface(
      ctx,
      303,
      (u, v) => {
        const glow = Math.max(0, 1 - Math.hypot((u - 0.5) * aspect * 0.55, (v - 0.5) * 0.9));
        const k = 0.5 + 0.8 * glow;
        return [28 * k, 44 * k, 39 * k];
      },
      (v) => 6 + 20 * v,
      0.006,
    );
    const s = height * 0.25;
    const y = height * 0.39;
    const step = s * 2.95;
    for (const side of [-1, 1]) {
      for (let i = 2; i >= 1; i--) {
        const bx = width / 2 + side * i * step;
        softShadow(ctx, bx + s * 0.2, y + s * 1.78, s * 1.05, s * 0.2, 0.5);
        drawBulb(ctx, bx, y, s, false);
      }
    }
    softShadow(ctx, width / 2 + s * 0.15, y + s * 1.78, s * 1.05, s * 0.2, 0.5);
    drawBulb(ctx, width / 2, y, s, true);
    vignette(ctx, 0.55);
  },
};

// Where the ring sits on each picture (0..1 across and down), and which corner stays clear for the title.
export const ART_LAYOUT = {
  baseball: { ringX: 0.5, ringY: 0.48, labelSide: 'left' },
  cricket: { ringX: 0.33, ringY: 0.54, labelSide: 'right' },
  bulb: { ringX: 0.5, ringY: 0.5, labelSide: 'left' },
};

export function paintTile(art, widthOverHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(H * widthOverHeight);
  canvas.height = H;
  PAINTERS[art](canvas.getContext('2d'));
  return canvas;
}
