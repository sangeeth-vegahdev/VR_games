// The mitt must sit under the mouse pointer on what the player sees: in a plain browser, and in an
// IWER XR session for several head positions and rotations. Also checks the resting point (screen
// centre on the called zone), the mitt's distance from the eye, the easing (frame-rate independent),
// and writes a screenshot of the plain-browser view for a visual check.
// Usage: GAME_URL=https://localhost:8082 OUT_DIR=<dir> node tests/pointer-alignment.test.cjs
const path = require('path');
const { chromium } = require('playwright');

const GAME_URL = process.env.GAME_URL || 'https://localhost:8082';
const OUT_DIR = process.env.OUT_DIR || process.cwd();
const TOL_PX = 4; // alignment tolerance, in screen pixels
const GRID = [-0.5, 0, 0.5]; // pointer positions, as a fraction of the canvas half-size

// Quaternion for a yaw (about +Y) then a pitch (about +X), in radians.
function quat(yaw, pitch) {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp }; // qy * qx
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const checks = {};
  const report = {};

  await page.goto(GAME_URL + '/?tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });
  await page.waitForTimeout(800);

  report.fps = await page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
          else res(n);
        };
        requestAnimationFrame(tick);
      }),
  );

  const canvasRect = () =>
    page.evaluate(() => {
      const r = window.__game.sys.desktop.canvas().getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
  const pointAt = (rect, gx, gy) => ({
    x: rect.left + rect.width / 2 + (gx * rect.width) / 2,
    y: rect.top + rect.height / 2 - (gy * rect.height) / 2,
  });
  // The pocket, projected through the world camera back to page pixels.
  const projectedPocket = () =>
    page.evaluate(() => {
      const s = window.__game.sys;
      const cv = s.desktop.canvas().getBoundingClientRect();
      const p = s.glove.pocket.clone().project(window.__world.camera);
      return {
        x: cv.left + ((p.x + 1) / 2) * cv.width,
        y: cv.top + ((1 - p.y) / 2) * cv.height,
        visible: p.z > -1 && p.z < 1,
        clamped: s.desktop.clamped,
      };
    });
  const mittState = () =>
    page.evaluate(() => {
      const s = window.__game.sys;
      const cam = s.glove.v[7];
      window.__world.camera.getWorldPosition(cam);
      return {
        active: s.desktop.active,
        ok: s.glove.ok,
        pocket: { x: s.glove.pocket.x, y: s.glove.pocket.y, z: s.glove.pocket.z },
        camera: { x: cam.x, y: cam.y, z: cam.z },
        distance: s.glove.pocket.distanceTo(cam),
      };
    });

  // Each pointer position: move there, wait for the mitt to settle, then project it back.
  async function settle(p) {
    const t0 = Date.now();
    let q = await projectedPocket();
    let err = Math.hypot(q.x - p.x, q.y - p.y);
    while (err > 1 && Date.now() - t0 < 8000) {
      await page.waitForTimeout(150);
      q = await projectedPocket();
      err = Math.hypot(q.x - p.x, q.y - p.y);
    }
    return { q, err, ms: Date.now() - t0 };
  }
  async function alignmentPass(label) {
    const rect = await canvasRect();
    const out = [];
    for (const gx of GRID) {
      for (const gy of GRID) {
        const p = pointAt(rect, gx, gy);
        await page.mouse.move(p.x, p.y, { steps: 4 });
        const { q, err, ms } = await settle(p);
        out.push({ gx, gy, errPx: Math.round(err * 100) / 100, settleMs: ms, visible: q.visible, clamped: q.clamped });
      }
    }
    report[label] = out;
    // Inside the mitt's reach the pocket must sit under the pointer. Past the reach it is held at the
    // edge by design, so those points are reported, not counted.
    const inReach = out.filter((o) => !o.clamped);
    checks[`${label}: pocket under the pointer inside reach (${inReach.length} points, <= ${TOL_PX}px)`] =
      inReach.length > 0 && inReach.every((o) => o.errPx <= TOL_PX && o.visible);
    report[`${label} clamped (held at reach edge)`] = out.filter((o) => o.clamped).length;
  }

  // ----- 1. Plain browser -----
  await page.mouse.move(640, 360);
  await page.waitForTimeout(1500);
  const st = await mittState();
  report.desktopRest = st;
  checks['desktop: screen centre rests on the called zone (y within 0.05 m of camera - 0.35 m)'] =
    Math.abs(st.pocket.y - (st.camera.y - 0.35)) < 0.05 && Math.abs(st.pocket.x) < 0.03;
  checks['desktop: mitt is 2.2 to 3.0 m from the eye (was 1.45 m)'] = st.distance > 2.2 && st.distance < 3.0;
  await alignmentPass('desktop');
  const rect = await canvasRect();
  const centre = pointAt(rect, 0, 0);
  await page.mouse.move(centre.x, centre.y);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT_DIR, 'plain-browser-mitt.png') });

  // Easing is frame-rate independent: one second of easing with 60 steps and with 120 steps must end
  // in the same place. (Checked on the real object, then restored.)
  const easing = await page.evaluate(() => {
    const d = window.__game.sys.desktop;
    const save = { pos: d.position.clone(), target: d.target.clone(), wasActive: d.wasActive };
    const run = (steps) => {
      d.position.set(0, 0.9, -0.55);
      d.target.set(1.0, 1.9, -0.55);
      d.wasActive = true;
      for (let i = 0; i < steps; i++) d.ease(1 / steps);
      return d.position.clone();
    };
    const a = run(60);
    const b = run(120);
    const c = run(7); // a slow frame rate: still lands on the same curve
    d.position.copy(save.pos);
    d.target.copy(save.target);
    d.wasActive = save.wasActive;
    return { gap60v120: a.distanceTo(b), gap60v7: a.distanceTo(c) };
  });
  report.easing = easing;
  checks['desktop: easing is frame-rate independent (60 vs 120 vs 7 steps agree within 5 mm)'] =
    easing.gap60v120 < 0.005 && easing.gap60v7 < 0.005;

  // ----- 2. IWER XR session (controllers; the mouse is the mitt) -----
  await page.evaluate(() => {
    window.IWER_DEVICE.primaryInputMode = 'controller';
    window.__world.launchXR();
  });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  const poses = [
    { name: 'XR default head', position: null, orientation: null },
    { name: 'XR head 0.3 m left, turned 15 deg', position: { x: -0.3, y: 1.6, z: 0 }, orientation: quat(0.26, 0) },
    { name: 'XR head higher, tilted down 15 deg', position: { x: 0, y: 1.8, z: 0 }, orientation: quat(0, -0.26) },
  ];
  for (const pose of poses) {
    if (pose.position || pose.orientation) {
      await page.evaluate(async (pose) => {
        const args = { device: 'headset', position: pose.position, orientation: pose.orientation };
        Object.keys(args).forEach((k) => args[k] === null && delete args[k]);
        await window.IWER_DEVICE.remote.dispatch('set_transform', args);
      }, pose);
    }
    await page.waitForTimeout(700);
    await alignmentPass(pose.name);
  }

  // ----- Report -----
  console.log(JSON.stringify(report, null, 2));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) {
    console.log((v ? 'PASS ' : 'FAIL ') + k);
    if (!v) bad++;
  }
  console.log((errors.length === 0 ? 'PASS ' : 'FAIL ') + 'no page errors');
  if (errors.length) console.log(errors);
  await browser.close();
  process.exit(bad || errors.length ? 1 : 0);
})();
