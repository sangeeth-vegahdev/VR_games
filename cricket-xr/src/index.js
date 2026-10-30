import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { CatchSpikeSystem } from './catch-spike.js';

World.create(document.getElementById('scene-container'), projectOptions).then((world) => {
  window.__world = world;
  world.registerSystem(CatchSpikeSystem);
});
