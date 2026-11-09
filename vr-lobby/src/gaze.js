import { Quaternion, Vector3 } from '@iwsdk/core';

// "Look to point": the ray the lobby reads to decide which tile the ring is on.
//
// Uses tracked eye gaze when the headset has it and the player allowed it. Some runtimes report a "gaze" ray
// that is only the head's direction, so the ray only counts as eyes once it has been seen to leave the head's
// forward line; until then, and on headsets without eye tracking, the head's direction is used.
const SEPARATION_RAD = (2.5 * Math.PI) / 180;

export class GazeRay {
  constructor() {
    this.mode = 'head'; // 'eyes' | 'head'
    this.eyeSeen = false;
    this.origin = new Vector3();
    this.dir = new Vector3(0, 0, -1);
    this.eyeDir = new Vector3();
    this.q = new Quaternion();
  }

  sample(player) {
    player.head.getWorldPosition(this.origin);
    this.dir.set(0, 0, -1).applyQuaternion(player.head.getWorldQuaternion(this.q));
    this.mode = 'head';
    if (player.gazeOrigin !== 'tracked' || !player.eyeSpace) return;
    this.eyeDir.set(0, 0, -1).applyQuaternion(player.eyeSpace.getWorldQuaternion(this.q));
    if (this.eyeDir.angleTo(this.dir) > SEPARATION_RAD) this.eyeSeen = true;
    if (this.eyeSeen) {
      player.eyeSpace.getWorldPosition(this.origin);
      this.dir.copy(this.eyeDir);
      this.mode = 'eyes';
    }
  }
}

function inside(px, py, r, margin) {
  return Math.abs(px - r.x) <= r.w / 2 + margin && Math.abs(py - r.y) <= r.h / 2 + margin;
}

// Which tile is at this point on the grid? The gaps between tiles belong to the tiles beside them, so there is
// no dead strip, and the tile already in focus keeps it until the gaze has clearly moved off (`stickiness`).
// Returns an index into `rects`, or -1 when the point is off the grid.
export function pickTile(px, py, rects, current, gap, stickiness) {
  if (current >= 0 && inside(px, py, rects[current], gap / 2 + stickiness)) return current;
  return rects.findIndex((r) => inside(px, py, r, gap / 2));
}
