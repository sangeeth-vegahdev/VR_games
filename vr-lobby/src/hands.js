import { AnimatedHand, MeshStandardMaterial, Vector3 } from '@iwsdk/core';

export const skinMaterial = new MeshStandardMaterial({
  color: 0xdeb887,
  roughness: 0.6,
  metalness: 0.05,
  emissive: 0x2c1a0e,
  emissiveIntensity: 0.35,
});

export const trackedHands = {
  left: null,
  right: null,
};

const JOINTS = [
  'wrist',
  'thumb-tip',
  'index-finger-tip',
  'index-finger-phalanx-distal',
  'index-finger-metacarpal',
  'middle-finger-tip',
  'pinky-finger-metacarpal',
];

function createHandClass(side) {
  class LobbyHand extends AnimatedHand {
    init() {
      const mesh = this.model.getObjectByProperty('type', 'SkinnedMesh');
      if (mesh) {
        mesh.frustumCulled = false;
        mesh.material = skinMaterial;
      }
      const joints = {};
      for (const name of JOINTS) {
        joints[name] = this.model.getObjectByName(name) || null;
      }
      trackedHands[side] = {
        model: this.model,
        joints,
        side,
        visual: this,
      };
    }
  }
  LobbyHand.assetKeyPrefix = `lobby-hand-${side}`;
  LobbyHand.assetPath = `${import.meta.env.BASE_URL}models/hand-${side}.glb`;
  return LobbyHand;
}

export function useSkinHands(input) {
  const adapters = input && input.visualAdapters && input.visualAdapters.hand;
  if (!adapters) return false;
  for (const side of ['left', 'right']) {
    adapters[side].updateVisualImplementation(createHandClass(side));
  }
  return true;
}

const _v = new Vector3();
export function getJointPosition(side, jointName, out = _v) {
  const h = trackedHands[side];
  const j = h && h.joints[jointName];
  if (!j || !h.model.visible) return null;
  j.getWorldPosition(out);
  return out;
}

