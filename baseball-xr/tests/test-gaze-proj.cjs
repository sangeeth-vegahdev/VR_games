const { Vector3, PerspectiveCamera, Quaternion } = require('three');

// When in WebXR in Three.js:
// camera position in local tracking space:
const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 200);
camera.position.set(0, 1.60, 0); // local XR pose in Three.js!
camera.updateMatrixWorld(true);

const halfFovY = Math.tan((35 * Math.PI) / 180);
const halfFovX = halfFovY * (16 / 9);

const emuX = 0;
const emuY = 0; // mouse right at center of screen!

// origin is from player.head.getWorldPosition:
const origin = new Vector3(0, 0.95, 0); // with rig offset!
const dir = new Vector3(emuX * halfFovX, emuY * halfFovY, -1).normalize();

const ballPos = new Vector3(0, 0.85, -1); // ball close to plate (1m)
const dist = origin.distanceTo(ballPos);

const targetPoint = origin.clone().addScaledVector(dir, dist);

// Project back to camera screen:
const projected = targetPoint.clone().project(camera);

console.log('Original mouse (emuX, emuY):', emuX, emuY);
console.log('Projected ring on screen (x, y):', projected.x.toFixed(4), projected.y.toFixed(4));
console.log('Screen offset in Y (NDC):', projected.y - emuY);
