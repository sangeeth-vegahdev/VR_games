const { Vector3, PerspectiveCamera, Raycaster } = require('three');

const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 200);
camera.position.set(0, 1.15, 1.1); // desktop camera pose from iwsdk.config.json
camera.lookAt(0, 0.85, -19.24);
camera.updateMatrixWorld(true);

const ray = new Raycaster();
const emuX = 0.35;
const emuY = -0.25;

ray.setFromCamera({ x: emuX, y: emuY }, camera);

const origin = ray.ray.origin.clone();
const dir = ray.ray.direction.clone();

// Ball at midpoint
const ballPos = new Vector3(0.2, 1.1, -8);

// Planar depth projection:
const distZ = Math.abs((ballPos.z - origin.z) / dir.z);
const targetPoint = origin.clone().addScaledVector(dir, distZ);

// Project back to screen:
const projected = targetPoint.clone().project(camera);

console.log('Target ball Z:', ballPos.z);
console.log('Ring Z:', targetPoint.z);
console.log('Projected screen (x, y):', projected.x.toFixed(4), projected.y.toFixed(4));
console.log('Error vs cursor (x, y):', Math.abs(projected.x - emuX), Math.abs(projected.y - emuY));

