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
  constructor(world, balls) {
    this.balls = balls;
    // Scoreboard above the ball's flight path, in front of the player.
    this.board = new Panel(world, 2.4, 1.0, 400, [0, 2.6, -3.4]); // above the sightscreen, so it never hides the ball
    // Round-over / title card, closer and lower.
    this.card = new Panel(world, 2.0, 1.2, 400, [0, 1.8, -1.6]);
    this.card.mesh.visible = false;
    this.model = { score: 0, misses: 0, ballNo: 0, kmh: 0, message: '', color: '#fff' };
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
    const colMax = w * 0.40;
    p.text(`Score ${m.score}`, w * 0.28, 110, 72, GOOD, 700, 'center', colMax);
    p.text(`Missed ${m.misses}`, w * 0.72, 110, 72, m.misses ? BAD : DIM, 700, 'center', colMax);
    p.text(
      m.ballNo ? `Ball ${m.ballNo} / ${this.balls}   |   ${m.kmh} km/h` : `${this.balls} balls per round`,
      w / 2,
      205,
      46,
      DIM,
      600,
      'center',
      w * 0.85,
    );
    p.text(m.message, w / 2, 295, 70, m.color, 700, 'center', w * 0.85);
    p.commit();
  }

  showCard(title, lines, hint) {
    const p = this.card;
    p.card();
    const w = p.canvas.width;
    p.text(title, w / 2, 100, 84, '#ffffff', 700, 'center', w * 0.9);
    lines.forEach((line, i) => p.text(line.text, w / 2, 190 + i * 72, 48, line.color || DIM, 600, 'center', w * 0.85));
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
