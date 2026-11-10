const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
      args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
    });

    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
    await page.goto('https://localhost:8082/?tutorial=0', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const sceneObjects = await page.evaluate(() => {
      const world = window.__world;
      const scene = world?.scene;
      if (!scene) return [];

      const list = [];
      scene.traverse((obj) => {
        if (obj.isMesh || obj.isPoints || obj.isSprite || obj.isInstancedMesh) {
          list.push({
            type: obj.type,
            name: obj.name || obj.parent?.name || 'unnamed',
            visible: obj.visible,
            triangles: obj.geometry?.index ? obj.geometry.index.count / 3 : (obj.geometry?.attributes?.position?.count || 0) / 3,
            material: Array.isArray(obj.material) ? obj.material.map(m => m.type) : obj.material?.type,
            count: obj.count || 1,
            castShadow: obj.castShadow,
            receiveShadow: obj.receiveShadow,
          });
        }
      });
      return list;
    });

    console.log(`Total renderable objects: ${sceneObjects.length}`);
    const byType = {};
    let totalTriangles = 0;
    for (const obj of sceneObjects) {
      byType[obj.type] = (byType[obj.type] || 0) + 1;
      totalTriangles += (obj.triangles * obj.count);
    }
    console.log('By type:', byType);
    console.log('Total triangles:', Math.round(totalTriangles));
    console.log('Sample objects (first 25):', sceneObjects.slice(0, 25));

  } catch (err) {
    console.error(err);
  } finally {
    if (browser) await browser.close();
  }
})();

