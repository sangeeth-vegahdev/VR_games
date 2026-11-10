const { chromium } = require('playwright');

async function inspectXR() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--use-gl=angle', '--use-angle=gl', '--enable-webgl']
  });
  const page = await browser.newPage();
  await page.goto('https://localhost:8082/?tutorial=0&device=metaQuest3', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 20000 });

  // Launch WebXR
  await page.evaluate(async () => {
    if (window.IWER_DEVICE) window.IWER_DEVICE.primaryInputMode = 'hand';
    await window.__world.launchXR();
  });
  await page.waitForTimeout(1000);

  const xrData = await page.evaluate(() => {
    const world = window.__world;
    const game = window.__game.sys;
    const cam = world.camera;
    const head = game.player.head;
    const rig = game.player;

    const data = {
      worldCamPos: cam.position.toArray(),
      worldCamQuat: cam.quaternion.toArray(),
      headWorldPos: head.getWorldPosition(new cam.position.constructor()).toArray(),
      headLocalPos: head.position.toArray(),
      rigPos: rig.position.toArray(),
      desktopActive: game.desktop.active,
      desktopHit: game.desktop.hit.toArray(),
      desktopPosition: game.desktop.position.toArray(),
      glovePocket: game.glove.pocket.toArray(),
      gloveOk: game.glove.ok,
      gloveVisible: game.glove.object.visible,
      lowestReach: game.desktop.lowestReach(),
    };

    // Move mouse to bottom of screen (ndc.y = -1)
    game.desktop.ndc.set(0, -1);
    game.desktop.seen = true;
    game.desktop.projectToPlane(game.desktop.hit);
    data.hitAtBottomNdc = game.desktop.hit.toArray();

    // Now test what happens when head is tilted down
    return data;
  });

  console.log('XR Inspection Data:\n', JSON.stringify(xrData, null, 2));
  await browser.close();
}

inspectXR().catch(console.error);

