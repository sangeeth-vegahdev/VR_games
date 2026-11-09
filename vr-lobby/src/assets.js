import { AssetType, defineAssets } from '@iwsdk/core';

const url = (file) => `${import.meta.env.BASE_URL}${file.replace(/^\/+/u, '')}`;

const model = (file, name) => ({
  url: url(`models/${file}`),
  type: AssetType.GLTF,
  name,
  priority: 'critical',
});

export default defineAssets({
  'hand-right': model('hand-right.glb', 'Right hand'),
  'hand-left': model('hand-left.glb', 'Left hand'),
});

