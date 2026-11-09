import { Vector3 } from '@iwsdk/core';
import { CFG } from './config.js';
import { getJointPosition } from './hands.js';

// "Pinch to press": a press is the moment a hand closes, never a held pinch. Looking at a tile while already
// pinching does nothing, which is what keeps "a glance does not open anything" true.
export class PinchDetector {
  constructor(start = CFG.pinchStart, release = CFG.pinchRelease) {
    this.start = start;
    this.release = release;
    this.closed = false;
    this.seenOpen = false;
  }

  // distance: thumb tip to index tip in metres, or null when the hand is not tracked.
  // Returns true on the one frame the pinch closes. A hand that first appears already pinched must open first.
  update(distance) {
    if (distance === null) {
      this.closed = false;
      this.seenOpen = false;
      return false;
    }
    if (this.closed) {
      if (distance > this.release) {
        this.closed = false;
        this.seenOpen = true;
      }
      return false;
    }
    if (distance < this.start) {
      this.closed = true;
      const press = this.seenOpen;
      this.seenOpen = false;
      return press;
    }
    if (distance > this.release) this.seenOpen = true;
    return false;
  }
}

// Both hands. Either one can press, wherever it is resting: the hand does not have to point at anything.
export class HandPinch {
  constructor() {
    this.detectors = { left: new PinchDetector(), right: new PinchDetector() };
    this.tip = new Vector3();
    this.thumb = new Vector3();
  }

  update() {
    let pressed = false;
    for (const side of ['left', 'right']) {
      const tip = getJointPosition(side, 'index-finger-tip', this.tip);
      const thumb = tip && getJointPosition(side, 'thumb-tip', this.thumb);
      if (this.detectors[side].update(tip && thumb ? tip.distanceTo(thumb) : null)) pressed = true;
    }
    return pressed;
  }
}
