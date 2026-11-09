import { CFG, gridSize } from './config.js';

// The flat PC view is framed like the view through the headset: the visor rim from index.html, with the grid
// sized and placed in the opening. In a headset the frame is hidden, because the real rim is already there and
// a drawn one would only cover part of the view.
const VIEW_W = 757; // the frame's viewBox
const VIEW_H = 502;
const GRID_SHARE = 0.51; // of the frame's height
const GRID_CENTRE = 0.44; // down the frame, 0 = top

export class VisorFrame {
  constructor(world, grid) {
    this.world = world;
    this.grid = grid;
    this.el = document.getElementById('visor');
    this.fit = this.fit.bind(this);
    window.addEventListener('resize', this.fit);
    this.fit();
  }

  fit() {
    const { camera } = this.world;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const frameH = Math.min(H, (W * VIEW_H) / VIEW_W);
    const metresHigh = (gridSize().h / GRID_SHARE) * (H / frameH); // what the whole window must span at the grid
    camera.fov = 2 * Math.atan(metresHigh / 2 / CFG.grid.distance) * (180 / Math.PI);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    this.grid.placeOnDesktop((0.5 - GRID_CENTRE) * (frameH / H) * metresHigh);
  }

  setInHeadset(inHeadset) {
    if (this.el) this.el.style.display = inHeadset ? 'none' : '';
    if (!inHeadset) this.fit();
  }
}
