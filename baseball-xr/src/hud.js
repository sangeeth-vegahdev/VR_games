import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

// World-space panels drawn on canvas textures (screen-space UI does not exist in a headset).
class Panel {
  constructor(world, width, height, pixelsPerMetre, position) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * pixelsPerMetre);
    this.canvas.height = Math.round(height * pixelsPerMetre);
    this.ctx = this.canvas.getContext('2d');
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({ map: this.texture, transparent: true, side: DoubleSide, depthWrite: false }),
    );
    this.mesh.position.set(...position);
    world.createTransformEntity(this.mesh);
  }

  card() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(14, 22, 38, 0.82)';
    ctx.beginPath();
    ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 36);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.stroke();
  }

  text(value, x, y, size, color = '#ffffff', weight = 700, align = 'center', maxWidth = null) {
    const { ctx } = this;
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (maxWidth) {
      ctx.fillText(value, x, y, maxWidth);
    } else {
      ctx.fillText(value, x, y);
    }
  }

  commit() {
    this.texture.needsUpdate = true;
  }
}

const GOOD = '#4be38a';
const BAD = '#ff6b6b';
const DIM = '#9fb0cc';

export class Hud {
  constructor(world, pitches) {
    this.pitches = pitches;
    // Scoreboard high above the line of the pitch, so it never hides the pitcher or the ball.
    this.board = new Panel(world, 2.4, 1.1, 400, [0, 2.75, -3.8]);
    // Title / round-over card, closer and lower.
    this.card = new Panel(world, 2.0, 1.3, 400, [0, 1.75, -1.7]);
    this.card.mesh.visible = false;
    this.model = { catches: 0, misses: 0, pitchNo: 0, mph: 0, pitchName: '', focus: null, message: '', color: '#fff' };
    this.drawBoard();
  }

  set(partial) {
    let changed = false;
    for (const k in partial) {
      if (this.model[k] !== partial[k]) {
        this.model[k] = partial[k];
        changed = true;
      }
    }
    if (changed) this.drawBoard();
  }

  drawBoard() {
    const m = this.model;
    const p = this.board;
    p.card();
    const w = p.canvas.width;
    const colMax = w * 0.4;
    p.text(`Catches ${m.catches}`, w * 0.28, 95, 70, GOOD, 700, 'center', colMax);
    p.text(`Missed ${m.misses}`, w * 0.72, 95, 70, m.misses ? BAD : DIM, 700, 'center', colMax);
    const pitchLine = m.pitchNo
      ? `Pitch ${m.pitchNo} / ${this.pitches}${m.pitchName ? `   |   ${m.pitchName}  ${m.mph} mph` : ''}`
      : `${this.pitches} pitches per round`;
    p.text(pitchLine, w / 2, 182, 44, DIM, 600, 'center', w * 0.88);
    if (m.focus !== null) {
      const pct = Math.round(m.focus * 100);
      p.text(`Eyes on the ball  ${pct}%`, w / 2, 252, 42, pct >= 70 ? GOOD : pct >= 40 ? '#ffd166' : BAD, 600, 'center', w * 0.85);
    }
    p.text(m.message, w / 2, 345, 66, m.color, 700, 'center', w * 0.88);
    p.commit();
  }

  showCard(title, lines, hint) {
    const p = this.card;
    p.card();
    const w = p.canvas.width;
    p.text(title, w / 2, 100, 84, '#ffffff', 700, 'center', w * 0.9);
    lines.forEach((line, i) => p.text(line.text, w / 2, 192 + i * 66, 44, line.color || DIM, 600, 'center', w * 0.88));
    p.text(hint, w / 2, p.canvas.height - 50, 38, DIM, 600, 'center', w * 0.9);
    p.commit();
    p.mesh.visible = true;
    this.board.mesh.visible = false; // the card already shows the result
  }

  hideCard() {
    this.card.mesh.visible = false;
    this.board.mesh.visible = true;
  }
}

export const COLORS = { good: GOOD, bad: BAD, dim: DIM, ink: '#ffffff' };
