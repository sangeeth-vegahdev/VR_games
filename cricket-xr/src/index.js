import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { GameSystem } from './game.js';

World.create(document.getElementById('scene-container'), projectOptions).then((world) => {
  window.__world = world;
  world.registerSystem(GameSystem);

  const params = new URLSearchParams(window.location.search);
  if (params.has('autoxr')) {
    setTimeout(async () => {
      try {
        if (window.IWER_DEVICE) {
          window.IWER_DEVICE.primaryInputMode = 'hand';
        }
        await world.launchXR();
      } catch (e) {
        console.warn('Auto XR launch notice:', e);
      }
    }, 600);
  }
});
