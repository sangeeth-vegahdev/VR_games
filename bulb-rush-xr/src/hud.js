import { CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { CFG, COLORS } from './config.js';

// World-space panels drawn on canvas textures (a headset has no screen-space UI). A panel is redrawn
// only when what it shows changes, so the frame loop does no 2D work while play is steady.

// A flat grid bent to follow the wall of bulbs, so a panel stays in front of every bulb and an even
// distance from the eyes.
function curvedPlane(w, h, R) {
  const geo = new PlaneGeometry(w, h, 24, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = p.getX(i) / R;
    p.setXYZ(i, Math.sin(a) * R, p.getY(i), -Math.cos(a) * R);
  }
  geo.computeBoundingSphere();
  return geo;
}

class Panel {
  // width/height in metres on a curve of radius R. W/H are drawing units; the canvas holds `sharp` pixels
  // for each, so text stays crisp in a headset.
  constructor(rig, width, height, W, H, sharp, y, R) {
    this.W = W;
    this.H = H;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(W * sharp);
    this.canvas.height = Math.round(H * sharp);
    this.g = this.canvas.getContext('2d');
    this.g.scale(sharp, sharp);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.mesh = new Mesh(
      curvedPlane(width, height, R),
      new MeshBasicMaterial({ map: this.texture, transparent: true, side: DoubleSide, depthWrite: false }),
    );
    this.mesh.renderOrder = 9;
    this.group = new Group();
    this.group.position.y = y;
    this.group.add(this.mesh);
    rig.add(this.group);
  }

  card(accent) {
    const { g, W, H } = this;
    g.clearRect(0, 0, W, H);
    const r = 30;
    g.beginPath();
    g.roundRect(7, 7, W - 14, H - 14, r);
    const fill = g.createLinearGradient(0, 0, 0, H);
    fill.addColorStop(0, '#0d1230');
    fill.addColorStop(1, '#070a1c');
    g.fillStyle = fill; // solid, so the bulbs behind never show through the text
    g.fill();
    // A soft glow made from a wide faint stroke under a sharp one (shadowBlur is too slow to redraw per hit).
    g.lineWidth = 10;
    g.strokeStyle = accent;
    g.globalAlpha = 0.22;
    g.stroke();
    g.globalAlpha = 1;
    g.lineWidth = 3;
    g.stroke();
  }

  text(value, x, y, size, color = '#fff', weight = 800, align = 'center', maxWidth = 0) {
    const { g } = this;
    g.font = `${weight} ${size}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = 'middle';
    if (maxWidth) g.fillText(value, x, y, maxWidth);
    else g.fillText(value, x, y);
  }

  heart(x, y, s, fill, color) {
    const { g } = this;
    g.beginPath();
    g.moveTo(x, y + s * 0.85);
    g.bezierCurveTo(x - s * 1.3, y - s * 0.1, x - s * 0.7, y - s * 1.0, x, y - s * 0.35);
    g.bezierCurveTo(x + s * 0.7, y - s * 1.0, x + s * 1.3, y - s * 0.1, x, y + s * 0.85);
    g.closePath();
    if (fill) {
      g.fillStyle = color;
      g.fill();
    } else {
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,255,255,0.28)';
      g.stroke();
    }
  }

  commit() {
    this.texture.needsUpdate = true;
  }
}

const fmt = (n) => n.toLocaleString('en-US');

export class Hud {
  constructor(rig) {
    const R = CFG.boardRadius - 0.045; // in front of the glass
    const b = CFG.cardBottom;
    const t = CFG.cardTop;
    // The menu / countdown / results card covers the bulbs in the middle; the outer columns stay visible
    // at its sides and keep rippling.
    this.card = new Panel(rig, CFG.cardWidth, t - b, 800, Math.round((800 * (t - b)) / CFG.cardWidth), 2, (t + b) / 2, R);
    // The score panel sits just above the wall. Its top edge stays inside the short upward view of Meta VR Glasses.
    this.bar = new Panel(rig, 0.5, 0.125, 960, 240, 1.5, t + 0.008 + 0.0625, R);
    this.m = { hearts: 3, maxHearts: 3, score: 0, best: 0, streak: 0, mult: 1, level: 1, sub: '', subColor: COLORS.dim, lost: 0, charge: 0, surge: false };
    this.dirty = true;
    this.showBar(false);
    this.showCard(false);
  }

  showBar(v) {
    this.bar.group.visible = v;
  }

  showCard(v) {
    this.card.group.visible = v;
  }

  set(partial) {
    for (const k in partial) {
      if (this.m[k] !== partial[k]) {
        this.m[k] = partial[k];
        this.dirty = true;
      }
    }
  }

  // A lost heart pulses red for a moment.
  heartLost() {
    this.m.lost = 0.55;
    this.dirty = true;
  }

  update(dt) {
    if (this.m.lost > 0) {
      this.m.lost = Math.max(0, this.m.lost - dt);
      this.dirty = true;
    }
    if (this.dirty && this.bar.group.visible) this.drawBar();
  }

  drawBar() {
    this.dirty = false;
    const p = this.bar;
    const m = this.m;
    const { W, H, g } = p;
    p.card(m.surge ? COLORS.surgeCss : 'rgba(53, 242, 255, 0.6)');
    // Three columns: lives, score, multiplier.
    const left = 170;
    const right = W - 170;
    p.text('LIVES', left, 44, 30, COLORS.dim, 700);
    const total = m.maxHearts;
    const gap = total > 3 ? 46 : 54;
    const x0 = left - ((total - 1) * gap) / 2;
    for (let i = 0; i < total; i++) {
      const alive = i < m.hearts;
      const flash = m.lost > 0 && i === m.hearts; // the one just lost
      p.heart(x0 + i * gap, 104, flash ? 21 + m.lost * 12 : 21, alive || flash, flash ? '#ffffff' : '#ff4f78');
    }
    p.text(m.best ? `BEST ${fmt(m.best)}` : '', left, 168, 30, COLORS.dim, 700, 'center', 290);

    p.text(fmt(m.score), W / 2, 84, 104, COLORS.ink, 900, 'center', 340);
    p.text(m.sub || '', W / 2, 168, 36, m.subColor, 800, 'center', 370);

    p.text(`LEVEL ${m.level}`, right, 44, 30, COLORS.dim, 700);
    p.text(`x${m.mult}`, right, 104, 76, m.mult > 1 ? COLORS.goldCss : COLORS.ink, 900);
    p.text(`${m.streak} in a row`, right, 168, 30, m.streak > 0 ? COLORS.cyan : COLORS.dim, 700, 'center', 290);

    // The surge meter along the bottom edge.
    const mx = 44;
    const mh = 14;
    const my = H - 42;
    const mw = W - mx * 2;
    g.beginPath();
    g.roundRect(mx, my, mw, mh, mh / 2);
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.fill();
    if (m.charge > 0) {
      g.beginPath();
      g.roundRect(mx, my, Math.max(mh, mw * Math.min(1, m.charge)), mh, mh / 2);
      g.fillStyle = m.charge >= 1 || m.surge ? COLORS.surgeCss : COLORS.cyan;
      g.fill();
    }
    p.commit();
  }

  // spec: { accent, title, titleColor, big, bigColor, lines: [{text,color,dot}], grid: [[label, value, color]], hint, hint2 }
  drawCard(spec) {
    const p = this.card;
    const { W, H, g } = p;
    p.card(spec.accent || COLORS.cyan);
    const hasStats = !!spec.grid;
    if (spec.title) p.text(spec.title, W / 2, hasStats ? 74 : spec.lines && spec.lines.length > 1 ? 88 : H * 0.36, hasStats ? 64 : 88, spec.titleColor || COLORS.ink, 900, 'center', W * 0.86);
    if (spec.big !== undefined) p.text(String(spec.big), W / 2, hasStats ? 168 : H * 0.42, hasStats ? 104 : 210, spec.bigColor || COLORS.ink, 900, 'center', W * 0.86);
    if (spec.lines) {
      const many = spec.lines.length > 1;
      let y = many ? 178 : H * 0.54;
      for (const line of spec.lines) {
        if (line.dot) {
          g.beginPath();
          g.arc(W * 0.19, y, 13, 0, Math.PI * 2);
          g.fillStyle = line.dot;
          g.fill();
          p.text(line.text, W * 0.24, y, 36, line.color || COLORS.ink, 700, 'left', W * 0.68);
        } else {
          p.text(line.text, W / 2, y, 36, line.color || COLORS.ink, 700, 'center', W * 0.86);
        }
        y += 62;
      }
    }
    if (hasStats) {
      const cw = (W - 80) / 2;
      spec.grid.forEach((cell, i) => {
        const cx = 40 + (i % 2) * cw + cw / 2;
        const cy = 262 + Math.floor(i / 2) * 104;
        p.text(cell[0], cx, cy, 28, COLORS.dim, 700, 'center', cw * 0.9);
        p.text(cell[1], cx, cy + 42, 48, cell[2] || COLORS.ink, 900, 'center', cw * 0.9);
      });
    }
    if (spec.hint2) p.text(spec.hint2, W / 2, H - 92, 32, COLORS.ink, 800, 'center', W * 0.86);
    if (spec.hint) p.text(spec.hint, W / 2, H - 48, 30, COLORS.dim, 700, 'center', W * 0.88);
    p.commit();
    this.showCard(true);
  }
}
