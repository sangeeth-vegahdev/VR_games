const { Vector3, PerspectiveCamera, Raycaster } = require('three');

// Active view camera (what renders the screen in browser / WebXR):
const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 200);
camera.position.set(0, 1.60, 0); // camera pose
camera.updateMatrixWorld(true);

const ray = new Raycaster();
const emuX = 0.25;
const emuY = -0.3; // user mouse at some arbitrary point on screen

ray.setFromCamera({ x: emuX, y: emuY }, camera);

// If gaze origin and direction come from the active rendering camera:
const origin = ray.ray.origin.clone();
const dir = ray.ray.direction.clone();

const ballPos = new Vector3(0, 0.85, -5);
const dist = origin.distanceTo(ballPos);

const targetPoint = origin.clone().addScaledVector(dir, dist);

// Project back to screen:
const projected = targetPoint.clone().project(camera);

console.log('Mouse input (emuX, emuY):', emuX, emuY);
console.log('Projected reticle on screen:', projected.x.toFixed(6), projected.y.toFixed(6));
console.log('Error in X:', Math.abs(projected.x - emuX));
console.log('Error in Y:', Math.abs(projected.y - emuY));

