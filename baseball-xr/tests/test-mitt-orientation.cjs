const MITT_LOW_Y = 0.12;
const MITT_UP_Y = 0.45;
const MITT_DOWN_Y = -0.7;
const MITT_UP_Y_DIR = 0.97;
const MITT_DOWN_Z = 0.15;
const MITT_UP_Z = 0.24;

function catcherUp(pocketY) {
  const t = Math.max(0, Math.min(1, (pocketY - MITT_LOW_Y) / (MITT_UP_Y - MITT_LOW_Y)));
  const k = t * t * (3 - 2 * t);
  const y = MITT_DOWN_Y + (MITT_UP_Y_DIR - MITT_DOWN_Y) * k;
  const z = MITT_DOWN_Z + (MITT_UP_Z - MITT_DOWN_Z) * k;
  const len = Math.hypot(y, z);
  return { y: y / len, z: z / len, k };
}

console.log("Pocket Y | Finger Y | Finger Z | Fingers Direction");
console.log("--------------------------------------------------");
for (let y = 0.85; y >= 0.05; y -= 0.05) {
  const dir = catcherUp(y);
  const desc = dir.y > 0.7 ? "Fingers UP (standard target)" : dir.y > 0.2 ? "Fingers angled forward" : dir.y > -0.2 ? "Horizontal" : "Fingers DOWN (dirt scoop)";
  console.log(`${y.toFixed(2).padStart(8)} | ${dir.y.toFixed(3).padStart(8)} | ${dir.z.toFixed(3).padStart(8)} | ${desc}`);
}

