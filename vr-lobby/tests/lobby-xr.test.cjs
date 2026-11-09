// End-to-end test of the lobby under IWER (Meta Quest 3 emulation): look at a sport, pinch, the game opens.
// Needs the lobby dev server: `npm run dev`, or set LOBBY_URL.
//
// The head turns and the hand pinches through the emulator, so this runs the real path through the real scene.

const { chromium } = require('playwright');

const LOBBY_URL = process.env.LOBBY_URL || 'https://localhost:8080';
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failures++;
};

const ARGS = ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'];

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  const errors = [];

  async function open() {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    // Opening a game leaves the lobby; stay on a stub so the outcome can be read without the game servers.
    await page.route(/:808[1-3]\/?$/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'game' }));
    await page.goto(`${LOBBY_URL}/?guide=1`);
    await page.waitForFunction(() => window.__lobby && window.__world, null, { timeout: 60000 });
    return page;
  }

  // Enter the emulated session with the right hand resting and open, then add test helpers to the page.
  async function enterXR(page) {
    await page.evaluate(() => {
      if (window.IWER_DEVICE) window.IWER_DEVICE.primaryInputMode = 'hand';
      window.__world.launchXR();
    });
    await page.waitForFunction(() => !!window.__world.session, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__lobby.placed, null, { timeout: 10000 });
    await page.evaluate(async () => {
      const d = window.IWER_DEVICE;
      const l = window.__lobby;
      window.__t = {
        settle: () => new Promise((r) => setTimeout(r, 350)),
        // Turn the head to look at a tile's ring centre.
        async lookAt(index) {
          const c = l.grid.tiles[index].ringCentre();
          const target = l.grid.root.localToWorld(l.grid.o.clone().set(c.x, c.y, 0));
          await d.remote.dispatch('look_at', { device: 'headset', target: { x: target.x, y: target.y, z: target.z } });
          await this.settle();
        },
        async lookAway() {
          await d.remote.dispatch('look_at', { device: 'headset', target: { x: 0, y: 6, z: 0.5 } });
          await this.settle();
        },
        async pose(poseId) {
          await d.remote.dispatch('set_hand_pose', { device: 'hand-right', poseId });
          await this.settle();
        },
      };
      d.hands.right.connected = true;
      await d.remote.dispatch('set_transform', { device: 'hand-right', position: { x: 0.25, y: 1.0, z: -0.3 } });
      await window.__t.pose('open');
    });
  }

  const read = (page) => page.evaluate(() => {
    const l = window.__lobby;
    return { state: l.state, game: l.selectedGame && l.selectedGame.id, focused: l.grid.focused, gesture: l.selectedGesture, step: l.guide.step };
  });

  // 1. The grid.
  let page = await open();
  const ids = await page.evaluate(() => window.__lobby.grid.tiles.map((t) => t.game.id));
  check('Three tiles, one per real game', ids.join() === 'baseball,cricket,bulbrush', ids.join());
  check('PC view shows the visor frame', await page.evaluate(() => getComputedStyle(document.getElementById('visor')).display !== 'none'));
  check('PC: the ring starts on the first tile', (await read(page)).focused === 0);

  // 2. Headset.
  await enterXR(page);
  check('Headset view hides the drawn visor frame', await page.evaluate(() => getComputedStyle(document.getElementById('visor')).display === 'none'));

  // 3. Looking moves the ring and never opens anything.
  for (const [index, id] of ids.entries()) {
    await page.evaluate((i) => window.__t.lookAt(i), index);
    const s = await read(page);
    check(`Looking at ${id} puts the ring on it`, s.focused === index, `focused=${s.focused}`);
    check(`Looking at ${id} does not open it`, s.state === 'browse');
  }
  await page.evaluate(() => new Promise((r) => setTimeout(r, 2500)));
  check('A long stare opens nothing', (await read(page)).state === 'browse');

  // 4. The guide asks for the next thing.
  check('Guide asks for a pinch once a tile has the ring', (await read(page)).step === 'pinch');

  // 5. Pinching while looking at nothing does nothing, and moving the eyes onto a tile mid-pinch does not press.
  await page.evaluate(() => window.__t.lookAway());
  let s = await read(page);
  check('Looking away clears the ring', s.focused === -1, `focused=${s.focused}`);
  check('Guide goes back to asking for a look', s.step === 'look');
  await page.evaluate(() => window.__t.pose('pinch'));
  check('A pinch with no tile in view opens nothing', (await read(page)).state === 'browse');
  await page.evaluate(() => window.__t.lookAt(1));
  s = await read(page);
  check('Glancing at a tile during a held pinch opens nothing', s.state === 'browse' && s.focused === 1, `state=${s.state}`);
  await page.evaluate(() => window.__t.pose('open'));

  // 6. Look, then pinch: the game opens, and it is the one the ring was on.
  await page.evaluate(() => window.__t.lookAt(1));
  await page.evaluate(() => window.__t.pose('pinch'));
  s = await read(page);
  check('Look at Cricket Catch + pinch opens Cricket Catch', s.state === 'launching' && s.game === 'cricket', `state=${s.state} game=${s.game} via ${s.gesture}`);
  await page.waitForURL(/:8081/, { timeout: 5000 }).catch(() => {});
  check('The browser goes to the game', /:8081/.test(page.url()), page.url());
  await page.close();

  // 7. A controller trigger counts as a pinch.
  page = await open();
  await enterXR(page);
  await page.evaluate(() => window.__t.lookAt(2));
  await page.evaluate(() => window.__lobby.onSelectStart());
  s = await read(page);
  check('Controller trigger opens the tile in view', s.state === 'launching' && s.game === 'bulbrush', `game=${s.game}`);
  await page.close();

  // 8. On a PC: a key, and the mouse.
  page = await open();
  await page.keyboard.press('2');
  s = await read(page);
  check('PC: key 2 opens the second tile', s.state === 'launching' && s.game === 'cricket', `game=${s.game}`);
  await page.close();

  page = await open();
  const spot = await page.evaluate(() => {
    const l = window.__lobby;
    const c = l.grid.tiles[2].ringCentre();
    const v = l.grid.root.localToWorld(l.grid.o.clone().set(c.x, c.y, 0)).project(window.__world.camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  });
  await page.mouse.move(spot.x, spot.y);
  await page.waitForTimeout(300);
  await page.mouse.click(spot.x, spot.y);
  s = await read(page);
  check('PC: click on a tile opens it', s.state === 'launching' && s.game === 'bulbrush', `game=${s.game}`);
  await page.close();

  check('No page errors', errors.length === 0, errors.join(' | '));
  console.log(`\nTOTAL FAILURES: ${failures}\n`);
  await browser.close();
  process.exit(failures > 0 ? 1 : 0);
})();
