const { chromium } = require('playwright');

async function checkHierarchy() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--use-gl=angle', '--use-angle=gl', '--enable-webgl']
  });
  const page = await browser.newPage();
  await page.goto('https://localhost:8082/?tutorial=0&device=metaQuest3', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__world && window.__game, null, { timeout: 20000 });

  // Launch XR
  await page.evaluate(async () => {
    if (window.IWER_DEVICE) window.IWER_DEVICE.primaryInputMode = 'hand';
    await window.__world.launchXR();
  });
  await page.waitForTimeout(1000);

  const data = await page.evaluate(() => {
    const world = window.__world;
    const camera = world.camera;
    const player = world.player;

    function getParents(obj) {
      const p = [];
      let c = obj;
      while (c) {
        p.push({ name: c.name || c.type, id: c.id, pos: c.position.toArray() });
        c = c.parent;
      }
      return p;
    }

    return {
      cameraParents: getParents(camera),
      playerParents: getParents(player),
      cameraWorldPos: camera.getWorldPosition(new camera.position.constructor()).toArray(),
      playerHeadWorldPos: player.head.getWorldPosition(new camera.position.constructor()).toArray(),
      playerPos: player.position.toArray(),
      cameraLocalPos: camera.position.toArray(),
    };
  });

  console.log('Hierarchy & Positions in XR:\n', JSON.stringify(data, null, 2));
  await browser.close();
}

checkHierarchy().catch(console.error);

