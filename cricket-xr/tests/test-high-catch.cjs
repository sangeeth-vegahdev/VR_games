const assert = require('assert');

const CFG = {
  gravity: 9.8,
  arriveZ: 0,
  targetSpreadX: 0.45,
  targetSpreadY: 0.25,
  chestBelowHead: 0.25,
  catchRadius: 0.28,
};

function simulateBall(ballNo) {
  const from = { x: 0, y: 1.4, z: -18 };
  const headY = 1.6;
  const aim = {
    x: (Math.random() * 2 - 1) * CFG.targetSpreadX,
    y: headY - CFG.chestBelowHead + (Math.random() * 2 - 1) * CFG.targetSpreadY,
    z: CFG.arriveZ,
  };

  const isHighCatch = ballNo > 3 && Math.random() < 0.25;
  const isStraight = isHighCatch ? (Math.random() < 0.6) : (Math.random() < 0.3);

  let side = 0;
  let swingA = 0;
  if (!isStraight) {
    side = Math.random() < 0.5 ? -1 : 1;
    swingA = 0.8;
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
  let maxAltitude = from.y;
  let caught = false;

  for (let t = 0; t <= flight + 0.1; t += dt) {
    vel.y -= CFG.gravity * dt;
    vel.x += side * swingA * dt;
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;
    if (pos.y > maxAltitude) maxAltitude = pos.y;

    const distToAim = Math.hypot(pos.x - aim.x, pos.y - aim.y, pos.z - aim.z);
    if (distToAim < CFG.catchRadius) {
      caught = true;
    }
  }

  return {
    ballNo,
    isHighCatch,
    isStraight,
    side,
    flightTime: +flight.toFixed(2),
    maxAltitude: +maxAltitude.toFixed(2),
    caught,
  };
}

console.log('=== SIMULATING 200 DELIVERIES (STRAIGHT + CURVED + HIGH) ===\n');
let straightCount = 0;
let curvedCount = 0;
let straightHighCount = 0;
let curvedHighCount = 0;

for (let i = 1; i <= 200; i++) {
  const res = simulateBall(i);
  assert(res.caught, `Ball ${i} missed catch zone!`);

  if (res.isHighCatch) {
    if (res.isStraight) straightHighCount++;
    else curvedHighCount++;
  } else {
    if (res.isStraight) straightCount++;
    else curvedCount++;
  }
}

console.log(`Normal Curved Balls:    ${curvedCount}`);
console.log(`Normal Straight Balls:  ${straightCount}`);
console.log(`High Straight Catches:  ${straightHighCount}`);
console.log(`High Curved Catches:    ${curvedHighCount}`);
console.log(`Catch Success Rate:     200/200 (100% PASS)`);
