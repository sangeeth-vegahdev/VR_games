const { Vector3, Raycaster, PerspectiveCamera, Plane } = require('three');

const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 200);
camera.position.set(0, 1.60, 0); // local XR pose in Three.js
camera.updateMatrixWorld(true);

const rigPos = new Vector3(0, -0.65, 0); // catcher rig Y
const plane = new Plane(new Vector3(0, 0, 1), 0.55); // z = -0.55

const ray = new Raycaster();
ray.setFromCamera({ x: 0, y: -1 }, camera); // bottom edge

// Without rig offset:
const hitWithout = new Vector3();
ray.ray.intersectPlane(plane, hitWithout);
console.log('Hit WITHOUT rig offset (current bug):', hitWithout.y);

// WITH rig offset:
ray.ray.origin.add(rigPos);
const hitWith = new Vector3();
ray.ray.intersectPlane(plane, hitWith);
console.log('Hit WITH rig offset (fixed):', hitWith.y);

// With deep crouch (-1.05 rig pos):
ray.setFromCamera({ x: 0, y: -1 }, camera);
ray.ray.origin.add(new Vector3(0, -1.05, 0));
const hitDeep = new Vector3();
ray.ray.intersectPlane(plane, hitDeep);
console.log('Hit WITH deep crouch (-1.05m rig pos):', hitDeep.y);

