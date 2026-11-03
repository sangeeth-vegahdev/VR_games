import { AssetType, defineAssets } from '@iwsdk/core';

// Evaluated by both the app and the editor: keep it deterministic and free of side effects.
// The pitcher is CC0 (Quaternius), the hand is MIT; see ASSETS.md.
const url = (file) => `${import.meta.env.BASE_URL}${file.replace(/^\/+/u, '')}`;

const model = (file, name) => ({
  url: url(`models/${file}`),
  type: AssetType.GLTF,
  name,
  priority: 'critical',
});

export default defineAssets({
  pitcher: model('pitcher.glb', 'Pitcher'),
  // Rigged hand (MIT, @webxr-input-profiles/assets): the bare hand on a PC is not shown, but the
  // SDK loads hand-left/right.glb itself for tracked hands in a headset (see src/hands.js).
  'hand-right': model('hand-right.glb', 'Right hand'),
});
