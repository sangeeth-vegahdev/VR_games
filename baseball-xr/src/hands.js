import { AnimatedHand, MeshStandardMaterial } from '@iwsdk/core';

// Solid, skin-toned hands for hand tracking, shipped with the game.
//
// The SDK's default hands are outline-only and are downloaded from a CDN at run time, so on a slow or
// blocked connection the player sees no hands at all. These use the same rigged hand model
// (generic-hand from @webxr-input-profiles/assets, MIT, see public/LICENSE-webxr-input-profiles.txt),
// shipped in public/models. The SDK still drives every finger joint from hand tracking.
//
// Each hand registers itself in `trackedHands`, so the game can read its joints (to put the mitt on
// and to read how far the fingers are closed) and hide the hand that is inside the mitt.

export const skin = new MeshStandardMaterial({ color: 0xd19a76, roughness: 0.62, metalness: 0 });

export const trackedHands = { left: null, right: null };

const JOINTS = [
  'wrist',
  'index-finger-metacarpal',
  'pinky-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'thumb-tip',
  'middle-finger-tip',
  'index-finger-tip',
];

function handClass(side) {
  class SkinHand extends AnimatedHand {
    init() {
      const mesh = this.model.getObjectByProperty('type', 'SkinnedMesh');
      mesh.frustumCulled = false;
      mesh.material = skin;
      const joints = {};
      for (const name of JOINTS) joints[name] = this.model.getObjectByName(name) || null;
      trackedHands[side] = { mesh, model: this.model, joints, visual: this };
    }
  }
  SkinHand.assetKeyPrefix = 'baseball-hand';
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
