import { AnimatedHand, BufferAttribute, Color, MeshStandardMaterial } from '@iwsdk/core';

// Solid, softly lit hands for hand tracking with smooth wrist alpha gradient.
// In raw WebXR models, the hand cuts off abruptly at the wrist joint with a flat circular disc.
// We calculate vertex distance from the wrist joint and discard the flat cap vertices,
// smoothly fading the forearm into thin air without any visible severed stump.

const skin = new MeshStandardMaterial({
  color: 0xd9a483,
  roughness: 0.55,
  metalness: 0,
  emissive: 0x3a2418,
  emissiveIntensity: 0.6,
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

// A hit lights up the hand that made it (fading back in about a third of a second).
let glow = 0;
const restColor = new Color(0x3a2418);
const hitColor = new Color();
export function glowHands(hex) {
  hitColor.setHex(hex);
  glow = 1;
}
export function updateHands(dt) {
  if (glow <= 0) return;
  glow = Math.max(0, glow - dt * 3);
  skin.emissive.copy(restColor).lerp(hitColor, glow * 0.8);
  skin.emissiveIntensity = 0.6 + glow * 0.8;
}

// Each tracked hand registers its model here, so the game can read where the fingertips and wrists are.
const tracked = { left: null, right: null };

// World position of a joint ('index-finger-tip', 'wrist') on one hand, or false if that hand is not drawn now.
export function jointPos(side, name, out) {
  const h = tracked[side];
  const joint = h && h.joints[name];
  if (!joint || !h.model.visible) return false;
  joint.getWorldPosition(out);
  return true;
}

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
          const wx = wrist.position.x;
          const wy = wrist.position.y;
          const wz = wrist.position.z;
          const pos = geometry.attributes.position;
          const count = pos.count;
          const distances = new Float32Array(count);
          for (let i = 0; i < count; i++) {
            const dx = pos.getX(i) - wx;
            const dy = pos.getY(i) - wy;
            const dz = pos.getZ(i) - wz;
            distances[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
          }
          geometry.setAttribute('wristDist', new BufferAttribute(distances, 1));
        }
      }
      const joints = {};
      for (const name of ['wrist', 'index-finger-tip']) joints[name] = this.model.getObjectByName(name) || null;
      tracked[side] = { model: this.model, joints };
    }
  }
  SkinHand.assetKeyPrefix = 'bulb-hand';
  SkinHand.assetPath = `${import.meta.env.BASE_URL}models/hand-${side}.glb`;
  return SkinHand;
}

// Swaps the hand visual on both sides. Safe before an XR session starts: the SDK builds the visual when
// the hand connects.
export function useSkinHands(input) {
  const adapters = input && input.visualAdapters && input.visualAdapters.hand;
  if (!adapters) return false;
  for (const side of ['left', 'right']) adapters[side].updateVisualImplementation(handClass(side));
  return true;
}
