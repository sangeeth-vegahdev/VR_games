import { AnimatedHand, MeshStandardMaterial } from '@iwsdk/core';

// Solid, skin-toned hands for hand tracking.
//
// The SDK's default hands are outline-only and are downloaded from a CDN at run time, so on a slow or
// blocked connection the player sees no hands at all. These use the same rigged hand model
// (generic-hand from @webxr-input-profiles/assets, MIT, see public/LICENSE-webxr-input-profiles.txt),
// shipped with the game in public/models, and draw it solid so it reads clearly against the grass.
// The SDK still drives every finger joint from hand tracking; only the look and the file location change.

export const skin = new MeshStandardMaterial({ color: 0xc58c66, roughness: 0.62, metalness: 0 });

function handClass(side) {
  class SkinHand extends AnimatedHand {
    init() {
      const mesh = this.model.getObjectByProperty('type', 'SkinnedMesh');
      mesh.frustumCulled = false;
      mesh.material = skin;
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
