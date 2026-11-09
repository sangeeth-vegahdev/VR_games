// How much work does one hit cost on the CPU? (canvas redraw + particles + popup). Run with the dev server up.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'] });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 600 } });
  await page.goto('https://localhost:8083/?hearts=3&tutorial=0');
  await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const s = window.__game.sys;
    s.hud.showBar(true);
    const time = (fn, n = 300) => { const t = performance.now(); for (let i = 0; i < n; i++) fn(i); return (performance.now() - t) / n; };
    const bar = time((i) => { s.hud.m.score = i * 17; s.hud.dirty = true; s.hud.drawBar(); });
    const popup = time((i) => s.fx.popup(0, 0, 0, 0, '+' + i, '250 ms', '#35f2ff'));
    const burst = time(() => s.fx.burst(0, 0, 0, 0x12e8ff, 22));
    const sound = time(() => s.sound.hit(null, 3), 50);
    return { barRedrawMs: +bar.toFixed(3), popupMs: +popup.toFixed(3), burstMs: +burst.toFixed(4), soundMs: +sound.toFixed(3) };
  });
  console.log(JSON.stringify(r));
  await browser.close();
})();
