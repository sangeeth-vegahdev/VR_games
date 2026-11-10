const assert = require('assert');

// Test the crouch logic directly
const CATCHER_EYE_Y = 0.95;

function computeTargetBaseY(physicalHeadY, gazeDirY) {
  const standingHeadY = Math.max(1.35, physicalHeadY);
  const tiltDown = Math.max(0, -gazeDirY);
  const extraCrouch = Math.min(0.35, tiltDown * 0.50);
  return CATCHER_EYE_Y - standingHeadY - extraCrouch;
}

// 1. Standing head at 1.60m looking forward (gazeDirY = 0)
const baseForward = computeTargetBaseY(1.60, 0);
assert.strictEqual(baseForward, 0.95 - 1.60, 'Forward stance sits at 0.95 - 1.60 = -0.65');

// 2. Head tilted down 30 deg (gazeDirY = -0.5)
const baseDown30 = computeTargetBaseY(1.60, -0.5);
assert.strictEqual(baseDown30, 0.95 - 1.60 - 0.25, 'Tilted 30 deg down drops extra 0.25m');
assert.ok(baseForward - baseDown30 >= 0.25, 'Crouch drops by 25cm');

// 3. Head tilted down 60 deg (gazeDirY = -0.866)
const baseDown60 = computeTargetBaseY(1.60, -0.866);
assert.strictEqual(baseDown60, 0.95 - 1.60 - 0.35, 'Tilted 60 deg down hits 35cm crouch cap');

console.log('Crouch math verification passed!');

