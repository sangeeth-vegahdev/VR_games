// Feature tests for the parts added for the hackathon: first-round tutorial, lightning pairs, SURGE, the
// city, ranks, the hands-lost pause, the Exit button, and the fit inside Meta VR Glasses' view.
// Needs the dev server (npx vite --port 8083). Screenshots go to tests/out/.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const GAME_URL = process.env.GAME_URL || 'https://localhost:8083';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); if (!ok) failures++; };

(async () => {
  const browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|favicon/.test(m.text()) && errors.push(m.text()));

  // A fresh device: no saved state, so the first round is the tutorial.
  await page.goto(GAME_URL + '/?hearts=3');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  // ---------- glasses fit (pure geometry on the real board) ----------
  const fit = await page.evaluate(() => {
    const s = window.__game.sys;
    const rig = s.board.rig;
    rig.updateMatrixWorld(true);
    const drop = window.__game.cfg.boardDrop; // the eyes sit this far above the board's centre
    const worst = { h: 0, up: -90, down: 90 };
    const take = (x, y, z) => {
      const dz = -z;
      const h = (Math.atan2(Math.abs(x), dz) * 180) / Math.PI;
      const v = (Math.atan2(y - drop, dz) * 180) / Math.PI;
      worst.h = Math.max(worst.h, h);
      worst.up = Math.max(worst.up, v);
      worst.down = Math.min(worst.down, v);
    };
    const local = new (s.v.constructor)();
    // Every bulb, with a margin of its own radius around its centre, and every button.
    for (const b of s.board.bulbs) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        local.copy(b.node.position);
        local.x += dx * b.radius * 1.2 * Math.cos(b.node.rotation.y);
        local.z += dx * b.radius * 1.2 * Math.sin(-b.node.rotation.y);
        local.y += dy * b.radius * 1.2;
        take(local.x, local.y, local.z);
      }
    }
    for (const k in s.board.buttons) {
      const bt = s.board.buttons[k];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        local.copy(bt.node.position);
        local.x += sx * (bt.w / 2) * Math.cos(bt.node.rotation.y);
        local.z += sx * (bt.w / 2) * Math.sin(-bt.node.rotation.y);
        local.y += sy * (bt.h / 2);
        take(local.x, local.y, local.z);
      }
    }
    // The two panels, measured from their drawn geometry (they sit on the same curve as the wall).
    const panels = {};
    for (const name of ['bar', 'card']) {
      const p = s.hud[name];
      const pos = p.mesh.geometry.attributes.position;
      let mh = 0, mu = -90, md = 90;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i) + p.group.position.y, z = pos.getZ(i);
        const h = (Math.atan2(Math.abs(x), -z) * 180) / Math.PI;
        const v = (Math.atan2(y - drop, -z) * 180) / Math.PI;
        mh = Math.max(mh, h); mu = Math.max(mu, v); md = Math.min(md, v);
      }
      panels[name] = { h: +mh.toFixed(1), up: +mu.toFixed(1), down: +md.toFixed(1) };
    }
    return { bulbsAndButtons: { h: +worst.h.toFixed(1), up: +worst.up.toFixed(1), down: +worst.down.toFixed(1) }, panels };
  });
  console.log('glasses fit (limits: 37 sideways, 25 up, 43 down)', JSON.stringify(fit));
  const f = fit.bulbsAndButtons;
  check('every bulb and button is inside the Glasses view with margin', f.h <= 36 && f.up <= 24 && f.down >= -42, JSON.stringify(f));
  for (const k of ['bar', 'card']) check(`${k} panel is inside the Glasses view with margin`, fit.panels[k].h <= 36 && fit.panels[k].up <= 24 && fit.panels[k].down >= -42, JSON.stringify(fit.panels[k]));

  // ---------- title ----------
  await page.screenshot({ path: path.join(OUT, 'f1-title.png') });
  check('the bulbs are instanced (38 of each part)', await page.evaluate(() => {
    const s = window.__game.sys;
    return s.board.glassMesh.count === 38 && s.board.filMesh.count === 38 && s.board.capMesh.count === 38;
  }));
  check('Exit button is hidden outside a headset', await page.evaluate(() => !window.__game.sys.board.buttons.exit.node.visible));
  check('SURGE button is hidden at the start', await page.evaluate(() => !window.__game.sys.board.buttons.surge.node.visible));

  // ---------- tutorial ----------
  await page.evaluate(() => window.__game.start());
  await page.waitForFunction(() => window.__game.state === 'play', null, { timeout: 150000 });
  check('the first round is the tutorial', await page.evaluate(() => window.__game.tutorial === true));
  await page.waitForFunction(() => window.__game.active.length > 0, null, { timeout: 30000 });
  const tut = await page.evaluate(() => { const s = window.__game.sys; const b = s.board.bulbs[s.active[0].i]; return { life: b.life, hearts: s.hearts }; });
  check('tutorial bulbs stay lit a long time', tut.life >= 10, 'life ' + tut.life);
  await page.screenshot({ path: path.join(OUT, 'f2-tutorial.png') });
  // A wrong touch and a timeout cost nothing in the tutorial.
  const wrongKept = await page.evaluate(() => {
    const s = window.__game.sys;
    const lit = s.active[0].i;
    const other = s.board.idleBulbs([]).find((k) => k !== lit);
    s.onBulb(other);
    s.lockUntil = 0;
    const b = s.board.bulbs[lit];
    b.t0 = performance.now() - 20000; // expired
    return s.hearts;
  });
  await page.waitForTimeout(400);
  check('tutorial: a wrong touch or a timeout costs no heart', wrongKept === 3 && (await page.evaluate(() => window.__game.hearts)) === 3);
  for (let n = 0; n < 3; n++) {
    await page.waitForFunction(() => window.__game.active.length > 0, null, { timeout: 30000 });
    await page.evaluate(() => { const s = window.__game.sys; s.onBulb(s.active[0].i); });
    await page.waitForTimeout(150);
  }
  check('three hits end the tutorial', await page.evaluate(() => window.__game.tutorial === false && window.__game.stats.hits === 3));

  // ---------- surge ----------
  await page.evaluate(() => { const s = window.__game.sys; s.clearLit(false); s.spawnIn = 0.1; });
  for (let n = 0; n < 15; n++) {
    await page.waitForFunction(() => window.__game.active.some((a) => a.kind !== 'decoy'), null, { timeout: 30000 });
    await page.evaluate(() => { const s = window.__game.sys; const a = s.active.find((x) => x.kind !== 'decoy'); s.onBulb(a.i); s.spawnIn = 0.1; });
    await page.waitForTimeout(60);
  }
  check('15 hits fill the surge meter', await page.evaluate(() => window.__game.surgeReady === true));
  check('the SURGE button appears and can be touched', await page.evaluate(() => window.__game.sys.board.buttons.surge.node.visible && window.__game.sys.board.buttons.surge.interactive));
  await page.screenshot({ path: path.join(OUT, 'f3-surge-ready.png') });
  const before = await page.evaluate(() => ({ score: window.__game.score, hearts: window.__game.hearts }));
  await page.evaluate(() => window.__game.sys.onButton('surge'));
  check('SURGE starts', await page.evaluate(() => window.__game.surging === true));
  // The software renderer is slow, so keep the bulbs alive and ask for more until three are lit.
  await page.waitForFunction(() => {
    const s = window.__game.sys;
    s.active.forEach((q) => { const bb = s.board.bulbs[q.i]; bb.life = 60; });
    s.spawnIn = 0;
    return s.active.length >= 3;
  }, null, { timeout: 60000 });
  await page.screenshot({ path: path.join(OUT, 'f4-surge.png') });
  const sg = await page.evaluate(() => {
    const s = window.__game.sys;
    const lit = s.active[0];
    const other = s.board.idleBulbs([]).find((k) => !s.active.some((a) => a.i === k));
    s.lockUntil = 0;
    s.onBulb(other); // a wrong touch during a surge
    const h = s.hearts;
    const sc = s.score;
    s.onBulb(lit.i);
    return { hearts: h, gain: s.score - sc, max: s.active.length };
  });
  check('surge: a wrong touch is forgiven', sg.hearts === before.hearts);
  check('surge: hits score double', sg.gain >= 2 * 100, 'gain ' + sg.gain);
  check('surge: at most 3 bulbs lit at once', sg.max <= 3);
  await page.evaluate(() => { window.__game.sys.surgeT = 0.05; });
  await page.waitForFunction(() => !window.__game.surging, null, { timeout: 10000 });
  check('surge ends by itself and play continues', await page.evaluate(() => window.__game.state === 'play'));
  check('the SURGE button goes away again', await page.evaluate(() => !window.__game.sys.board.buttons.surge.node.visible));

  // ---------- lightning pairs ----------
  const pair = await page.evaluate(async () => {
    const s = window.__game.sys;
    s.level = 6;
    s.streak = 0;
    for (let tries = 0; tries < 400; tries++) {
      s.clearLit(false);
      s.spawnWave(performance.now());
      const linked = s.active.filter((a) => a.pair >= 0);
      if (linked.length === 2) {
        const [a, b] = linked;
        const arcVisible = s.fx.arc.visible;
        const sc0 = s.score;
        s.onBulb(a.i);
        const afterFirst = s.score - sc0;
        const arcHidden = !s.fx.arc.visible;
        const sc1 = s.score;
        s.onBulb(b.i);
        return { found: true, arcVisible, arcHidden, first: afterFirst, second: s.score - sc1, pairs: s.pairs };
      }
    }
    return { found: false };
  });
  check('level 6 spawns lightning pairs', pair.found);
  check('a pair shows lightning between its bulbs, which goes when one is hit', pair.arcVisible && pair.arcHidden);
  check('touching the second bulb in time pays double', pair.second >= pair.first * 1.8 && pair.pairs === 1, JSON.stringify(pair));
  await page.screenshot({ path: path.join(OUT, 'f5-late.png') });

  // ---------- the city ----------
  const city = await page.evaluate(() => {
    const s = window.__game.sys;
    s.score = 0; s.pushHud(); const low = s.cityPower();
    s.score = 40000; s.pushHud(); const high = s.cityPower();
    return { low, high, windows: s.stage.windowCount };
  });
  check('score lights the city (more score, more windows)', city.high > city.low + 0.5 && city.windows > 800, JSON.stringify(city));

  // ---------- game over, rank, lifetime ----------
  await page.evaluate(() => { const s = window.__game.sys; s.score = 30000; s.hits = 5; s.loseHeart(); s.loseHeart(); s.loseHeart(); s.loseHeart(); });
  await page.waitForFunction(() => window.__game.state === 'over', null, { timeout: 10000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'f6-over.png') });
  const saved = await page.evaluate(() => ({ life: localStorage.getItem('bulbrush-life'), played: localStorage.getItem('bulbrush-played'), power: window.__game.sys.stage.powerGoal }));
  check('lifetime score and "played" are saved', Number(saved.life) >= 30000 && saved.played === '1', JSON.stringify(saved));
  check('a new best sends the city fireworks and keeps it lit', await page.evaluate(() => window.__game.sys.stage.fireT > 0 && window.__game.sys.stage.powerGoal >= 0.7));

  // ---------- the second round is not a tutorial ----------
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__game.start());
  await page.waitForFunction(() => window.__game.state === 'play', null, { timeout: 150000 });
  check('the second round is not a tutorial', await page.evaluate(() => window.__game.tutorial === false));

  // ---------- music clock ----------
  // Driven directly: the software renderer runs the game clock far too slowly to time it in real time.
  const music = await page.evaluate(() => {
    const s = window.__game.sys.sound;
    const s0 = s.step;
    let beats = 0;
    for (let i = 0; i < 200; i++) { s.update(0.05); if (s.beat) beats++; } // ten seconds
    return { steps: s.step - s0, beats, mood: s.mood, bpm: s.bpm };
  });
  const expected = (10 * music.bpm) / 60; // beats in ten seconds
  check('the music clock keeps time (a beat every 60/BPM s)', music.mood === 'play' && Math.abs(music.beats - expected) <= 1.5 && music.steps >= expected * 3.5, JSON.stringify(music));
  check('the tempo stays under 150 BPM (under 3 pulses a second)', music.bpm < 150);

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
