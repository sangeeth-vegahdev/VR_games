// Test proposed smooth extension curve:
// ndc.y from +1.0 to -1.0
// camY = 0.95, planeZ = -0.55, lowestReach = 0.40, REACH_Y0 = 0.05

const camY = 0.95;
const lowestReach = 0.40;
const REACH_Y0 = 0.05;
const shortfall = lowestReach - REACH_Y0; // 0.35m

function getGloveY(targetY) {
  // NDC of target:
  const ndc_y = (targetY - camY) / 0.55;
  const rawRayY = targetY;

  // Smooth bottom extension:
  // Zero offset above ndc.y = -0.75
  // Smoothly increases between -0.75 and -1.0
  let offset = 0;
  if (lowestReach > REACH_Y0 && ndc_y < -0.75) {
    // t goes 0 -> 1 as ndc_y goes -0.75 -> -1.0
    const t = Math.min(1, (-ndc_y - 0.75) / 0.25);
    // Smooth cubic Hermite curve
    const k = t * t * (3 - 2 * t);
    offset = shortfall * k;
  }
  return { ndc_y, rawRayY, gloveY: rawRayY - offset, offset };
}

console.log("Target Y | NDC.y  | Raw Ray Y | Offset (m) | Glove Y | Error (cm)");
console.log("---------------------------------------------------------------");
for (let y = 1.0; y >= 0.35; y -= 0.05) {
  const res = getGloveY(y);
  const errCm = (res.gloveY - y) * 100;
  console.log(`${y.toFixed(2).padStart(8)} | ${res.ndc_y.toFixed(3).padStart(6)} | ${res.rawRayY.toFixed(3).padStart(9)} | ${res.offset.toFixed(3).padStart(10)} | ${res.gloveY.toFixed(3).padStart(7)} | ${errCm.toFixed(1).padStart(9)} cm`);
}

