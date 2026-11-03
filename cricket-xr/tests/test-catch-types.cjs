const assert = require('assert');

const CFG = {
  gravity: 9.8,
  arriveZ: 0,
  targetSpreadX: 0.45,
  targetSpreadY: 0.20,
  chestBelowHead: 0.25,
  catchRadius: 0.28,
};

function simulateBall(ballNo) {
  const from = { x: 0, y: 1.4, z: -18 };
  const headY = 1.6;

  // Decide catch type: ~60% normal, ~20% high, ~20% low
  const roll = Math.random();
  const isHighCatch = ballNo > 3 && roll < 0.20;
  const isLowCatch = ballNo > 2 && !isHighCatch && roll < 0.42;

  let targetY;
  if (isHighCatch) {
    targetY = headY - CFG.chestBelowHead + (Math.random() * 2 - 1) * CFG.targetSpreadY;
  } else if (isLowCatch) {
    // Low catch near knee/shin height (0.55m to 0.70m off turf)
    targetY = 0.62 + (Math.random() * 2 - 1) * 0.08;
  } else {
    // Normal chest/waist height (1.15m to 1.55m)
    targetY = headY - CFG.chestBelowHead + (Math.random() * 2 - 1) * CFG.targetSpreadY;
  }

  const aim = {
    x: (Math.random() * 2 - 1) * CFG.targetSpreadX,
    y: targetY,
    z: CFG.arriveZ,
  };

  const isStraight = isHighCatch ? (Math.random() < 0.6) : (Math.random() < 0.35);
  let side = 0;
  let swingA = 0;
  if (!isStraight) {
    side = Math.random() < 0.5 ? -1 : 1;
    swingA = 0.75;
  }

  const throwSpeed = 12 + (22 - 12) * Math.min(1, ballNo / 25);
  const dz = aim.z - from.z;
  const len = Math.hypot(aim.x - from.x, aim.y - from.y, dz);
  const flight = isHighCatch ? 2.1 : (len / throwSpeed);

  const vel = {
    x: (aim.x - from.x) / flight - 0.5 * side * swingA * flight,
    y: (aim.y - from.y) / flight + 0.5 * CFG.gravity * flight,
    z: dz / flight,
  };

  const pos = { ...from };
  const dt = 1 / 60;
  let caught = false;
  let minFlightHeight = from.y;

  for (let t = 0; t <= flight; t += dt) {
    vel.y -= CFG.gravity * dt;
    vel.x += side * swingA * dt;
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;
    if (pos.y < minFlightHeight) minFlightHeight = pos.y;

    const distToAim = Math.hypot(pos.x - aim.x, pos.y - aim.y, pos.z - aim.z);
    if (distToAim < CFG.catchRadius) {
      caught = true;
    }
  }

  // Ensure ball never touches the turf (0m) before reaching player
  assert(minFlightHeight >= 0.40, `Ball dipped too close to turf! min=${minFlightHeight}`);

  return {
    ballNo,
    type: isHighCatch ? 'high' : (isLowCatch ? 'low' : 'normal'),
    isStraight,
    aimY: +aim.y.toFixed(2),
    minFlightHeight: +minFlightHeight.toFixed(2),
    caught,
  };
}

console.log('=== SIMULATING 300 DELIVERIES (HIGH, LOW, NORMAL) ===\n');
const counts = { high: 0, low: 0, normal: 0, straight: 0, curved: 0 };

for (let i = 1; i <= 300; i++) {
  const res = simulateBall(i);
  assert(res.caught, `Ball ${i} failed to land in catch radius!`);
  counts[res.type]++;
  if (res.isStraight) counts.straight++;
  else counts.curved++;
}

console.log(`Normal Catches (Chest/Waist): ${counts.normal}`);
console.log(`High Catches (Sky Lofted):    ${counts.high}`);
console.log(`Low Catches (Knee/Shin Dip):  ${counts.low}`);
console.log(`Straight Deliveries:          ${counts.straight}`);
console.log(`Curved Deliveries:            ${counts.curved}`);
console.log(`Catch Success Rate:           300/300 (100% PASS)`);
