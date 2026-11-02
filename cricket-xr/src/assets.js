import { AssetType, defineAssets } from '@iwsdk/core';

// Evaluated by both the app and the editor: keep it deterministic and free of side effects.
// Scenery and coach are CC0 (Quaternius / Kenney), the hand is MIT; see ASSETS.md.
const url = (file) => `${import.meta.env.BASE_URL}${file.replace(/^\/+/u, '')}`;

const model = (file, name) => ({
  url: url(`models/${file}`),
  type: AssetType.GLTF,
  name,
  priority: 'critical',
});

export default defineAssets({
  coach: model('coach.glb', 'Coach'),
  'tree-oak': model('tree_oak.glb', 'Oak tree'),
  'tree-pine': model('tree_pine.glb', 'Pine tree'),
  'tree-pine-tall': model('tree_pine_tall.glb', 'Tall pine tree'),
  'tree-fat': model('tree_fat.glb', 'Round tree'),
  bush: model('bush.glb', 'Bush'),
  'bush-large': model('bush_large.glb', 'Large bush'),
  fence: model('fence.glb', 'Fence'),
  tent: model('tent.glb', 'Pavilion tent'),
  'rock-large': model('rock_large.glb', 'Large rock'),
  'rock-small': model('rock_small.glb', 'Small rock'),
  // Rigged hand (MIT, @webxr-input-profiles/assets): the mouse-controlled hand on a PC. In a headset the
  // SDK loads hand-left/right.glb itself for the tracked hands (see src/hands.js).
  'hand-right': model('hand-right.glb', 'Right hand'),
});
