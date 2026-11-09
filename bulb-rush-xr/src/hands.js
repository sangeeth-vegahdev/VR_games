import { AnimatedHand, Color, MeshStandardMaterial } from '@iwsdk/core';

// Solid, softly lit hands for hand tracking.
//
// The SDK's default hands are outline-only and are fetched from a CDN at run time, so on a slow or
// blocked connection the player would see no hands at all. These use the same rigged hand model
// (generic-hand from @webxr-input-profiles/assets, MIT, see public/LICENSE-webxr-input-profiles.txt),
// shipped with the game in public/models. The SDK still drives every finger joint from hand tracking;
// only the look and the file location change. A little emissive keeps hands readable in the dark room.

const skin = new MeshStandardMaterial({
  color: 0xd9a483,
  roughness: 0.55,
  metalness: 0,
  emissive: 0x3a2418,
  emissiveIntensity: 0.6,
});

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
      mesh.frustumCulled = false;
      mesh.material = skin;
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
