import { Raycaster, Vector2 } from '@iwsdk/core';

// On a PC the mouse stands in for the eyes and the click for the pinch. Keys 1, 2, 3 open a game directly;
// Enter or Space press whatever the ring is on.
export class DesktopPointer {
  constructor(world, onSelect) {
    this.raycaster = new Raycaster();
    this.ndc = new Vector2();
    this.moved = false; // until the mouse moves, the ring rests on the first tile
    this.el = world.renderer.domElement;

    this.el.addEventListener('pointermove', (e) => {
      const rect = this.el.getBoundingClientRect();
      this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.moved = true;
    });
    this.el.addEventListener('click', () => onSelect());
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') onSelect();
      else if (/^[1-9]$/.test(e.key)) {
        window.dispatchEvent(new CustomEvent('lobby-select-game', { detail: { index: Number(e.key) - 1 } }));
      }
    });
  }

  ray(camera) {
    this.raycaster.setFromCamera(this.ndc, camera);
    return this.raycaster.ray;
  }
}
