const { chromium } = require('playwright');

async function profile() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--use-gl=angle', '--use-angle=gl', '--enable-webgl']
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  await page.goto('https://localhost:8082/?tutorial=0&device=metaQuest3', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const profileData = await page.evaluate(async () => {
    const world = window.__world;
    const renderer = world.renderer;
    const scene = world.scene;
    const camera = world.camera;

    // 1. Scene graph stats
    let meshCount = 0;
    let triCount = 0;
    scene.traverse((obj) => {
      if (obj.isMesh) {
        meshCount++;
        if (obj.geometry) {
          const index = obj.geometry.index;
          const pos = obj.geometry.attributes.position;
          triCount += index ? index.count / 3 : (pos ? pos.count / 3 : 0);
        }
      }
    });

    // 2. Measure render call vs system update call
    const samples = 60;
    let totalRenderTime = 0;
    let totalUpdateTime = 0;

    const gameSys = window.__game.sys;

    for (let i = 0; i < samples; i++) {
      const t0 = performance.now();
      gameSys.update(1 / 60);
      const t1 = performance.now();
      renderer.render(scene, camera);
      const t2 = performance.now();
      totalUpdateTime += (t1 - t0);
      totalRenderTime += (t2 - t1);
      await new Promise(r => requestAnimationFrame(r));
    }

    return {
      meshCount,
      triCount: Math.round(triCount),
      avgUpdateMs: +(totalUpdateTime / samples).toFixed(2),
      avgRenderMs: +(totalRenderTime / samples).toFixed(2),
      rendererInfo: {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        points: renderer.info.render.points,
        lines: renderer.info.render.lines,
      },
      shadowsEnabled: renderer.shadowMap.enabled,
      shadowAutoUpdate: renderer.shadowMap.autoUpdate,
      shadowNeedsUpdate: renderer.shadowMap.needsUpdate,
    };
  });

  console.log('Profile Results:', JSON.stringify(profileData, null, 2));
  await browser.close();
}

profile().catch(console.error);
