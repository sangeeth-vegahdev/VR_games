import { Vector3, Quaternion } from '@iwsdk/core';
const v = new Vector3(0, 0, -1);
const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 45 * Math.PI / 180);
v.applyQuaternion(q);
console.log('+45 deg:', v);

const vDown = new Vector3(0, 0, -1);
const qDown = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -45 * Math.PI / 180);
vDown.applyQuaternion(qDown);
console.log('-45 deg:', vDown);

