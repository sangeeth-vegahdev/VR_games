import { AmbientLight, DirectionalLight, Group } from '@iwsdk/core';

// The room is deliberately nothing: a dark space so only the tiles are lit. The tile pictures carry their own
// light, so these lights are only for the player's hands.
export function buildEnvironment(world) {
  const root = new Group();
  root.add(new AmbientLight(0xffffff, 0.7));
  const key = new DirectionalLight(0xffffff, 1.2);
  key.position.set(-1, 3, 2);
  root.add(key);
  world.createTransformEntity(root);
  return { root };
}
