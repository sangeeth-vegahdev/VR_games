import { AnimatedHand, BufferAttribute, MeshStandardMaterial } from '@iwsdk/core';

// Solid, skin-toned hands for hand tracking with smooth wrist alpha gradient.
// In raw WebXR models, the hand cuts off abruptly at the wrist joint with a flat circular disc.
// We calculate vertex distance from the wrist joint and apply a smooth alpha gradient,
// so the wrist dissolves naturally into thin air without any visible severed stump.

export const skin = new MeshStandardMaterial({
  color: 0xc58c66,
  roughness: 0.62,
  metalness: 0,
  transparent: true,
  depthWrite: true,
  alphaTest: 0.02,
});

skin.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
       attribute float wristDist;
       varying float vWristDist;`
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vWristDist = wristDist;`
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
       varying float vWristDist;`
    )
    .replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       if (vWristDist < 0.033) discard;
       float wristFade = smoothstep(0.033, 0.085, vWristDist);
       gl_FragColor.a *= wristFade;`
    );
};

export const trackedHands = { left: null, right: null };
const JOINTS = [
  'wrist',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-tip',
  'thumb-metacarpal',
  'thumb-phalanx-distal',
  'thumb-tip',
];

function handClass(side) {
  class SkinHand extends AnimatedHand {
    init() {
      const mesh = this.model.getObjectByProperty('type', 'SkinnedMesh');
      if (mesh) {
        mesh.frustumCulled = false;
        mesh.material = skin;
        const wrist = this.model.getObjectByName('wrist');
        const geometry = mesh.geometry;
        if (wrist && geometry && geometry.attributes.position) {
          const wristPos = wrist.position;
          const pos = geometry.attributes.position;
          const count = pos.count;
          const distances = new Float32Array(count);
          for (let i = 0; i < count; i++) {
            const dx = pos.getX(i) - wristPos.x;
            const dy = pos.getY(i) - wristPos.y;
            const dz = pos.getZ(i) - wristPos.z;
            distances[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
          }
          geometry.setAttribute('wristDist', new BufferAttribute(distances, 1));
        }
      }
      const joints = {};
      for (const name of JOINTS) joints[name] = this.model.getObjectByName(name) || null;
      trackedHands[side] = { mesh, model: this.model, joints };
    }
  }
  SkinHand.assetKeyPrefix = 'cricket-hand';
  SkinHand.assetPath = `${import.meta.env.BASE_URL}models/hand-${side}.glb`;
  return SkinHand;
}

// Swaps the hand visual on both sides. Safe to call before an XR session starts: the SDK creates the
// visual when the hand connects.
export function useSkinHands(input) {
  const adapters = input && input.visualAdapters && input.visualAdapters.hand;
  if (!adapters) return false;
  for (const side of ['left', 'right']) adapters[side].updateVisualImplementation(handClass(side));
  return true;
}
