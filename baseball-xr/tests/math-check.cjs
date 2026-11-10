// Mathematical simulation of what happens when a player aims at the ball / target ring:
// Camera at (0, 0.95, 0) in world space, fovY = 90 deg (tan(45) = 1)
// Catch plane at z = -0.55

const camY = 0.95;
const camZ = 0.0;
const planeZ = -0.55;
const REACH_Y0 = 0.05;

// Perspective projection:
// ndc.y = (Y_target - camY) / (-(planeZ - camZ) * tan(fovY/2))
// Since -(planeZ - camZ) = 0.55 and tan(45) = 1:
// ndc.y = (Y_target - 0.95) / 0.55

console.log("Visual target vs Glove placement:\n");
console.log("Target Y | Visual NDC.y | Raw ray Y | Shortfall offset | Glove Pocket Y | ERROR (Glove - Target)");
console.log("-----------------------------------------------------------------------------------------");

const lowestReach = camY - 0.55; // 0.95 - 0.55 = 0.40m

for (let y = 1.0; y >= 0.40; y -= 0.05) {
  const ndc_y = (y - camY) / 0.55;
  const rawRayY = y; // intersectPlane will recover exact y!
  let gloveY = rawRayY;
  let offset = 0;
  if (lowestReach > REACH_Y0 && ndc_y < 0) {
    const shortfall = lowestReach - REACH_Y0; // 0.35
    offset = shortfall * (-ndc_y);
    gloveY -= offset;
  }
  const err = gloveY - y;
  console.log(`${y.toFixed(2).padStart(8)} | ${ndc_y.toFixed(3).padStart(12)} | ${rawRayY.toFixed(3).padStart(9)} | ${offset.toFixed(3).padStart(16)} | ${gloveY.toFixed(3).padStart(14)} | ${err.toFixed(3).padStart(23)}`);
}

