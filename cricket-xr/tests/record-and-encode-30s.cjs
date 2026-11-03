const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { chromium } = require('playwright');

const OUT = path.resolve('hd-preview-frames');
if (fs.existsSync(OUT)) {
  fs.rmSync(OUT, { recursive: true, force: true });
}
fs.mkdirSync(OUT, { recursive: true });

const W = 1280;
const H = 720;
const FPS = 24;
const BALLS = 6;

(async () => {
  console.log('=== RECORDING 30s HD DEMO VIDEO (HIGH CATCH + CLEAN HUD) ===\n');

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: [
      '--ignore-certificate-errors',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
      '--enable-webgl2',
    ],
  });

  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: W, height: H },
  });

  await page.goto(`https://localhost:8081/?balls=${BALLS}`);
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 40000 });

  // Enter WebXR mode with hand tracking
  await page.evaluate((n) => {
    localStorage.removeItem('cricket-catch-best-' + n);
    window.IWER_DEVICE.primaryInputMode = 'hand';
    window.__world.launchXR();
  }, BALLS);
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Configure player view and hand tracking
  await page.evaluate(async () => {
    // Hide emulator GUI panels
    const fixed = [...document.body.children].find((e) => getComputedStyle(e).position === 'fixed' && e.querySelector('canvas'));
    if (fixed) {
      for (const kid of fixed.children) {
        if (kid.tagName === 'CANVAS' && getComputedStyle(kid).zIndex !== '3') continue;
        kid.style.display = 'none';
      }
    }

    const d = window.IWER_DEVICE;
    const s = window.__game.sys;

    // Head position: viewing crease and sightscreen
    await d.remote.dispatch('look_at', { device: 'headset', target: { x: 0, y: 1.05, z: -3.5 } });

    // Open hand pose
    for (const side of ['left', 'right']) {
      d.hands[side].connected = true;
      await d.remote.dispatch('set_hand_pose', { device: 'hand-' + side, poseId: 'open' });
    }

    // Natural fielding ready stance (both hands in front of body at waist/chest)
    const rest = {
      left: { x: -0.22, y: 0.95, z: -0.42 },
      right: { x: 0.22, y: 0.95, z: -0.42 },
    };
    const cur = {
      left: { ...rest.left },
      right: { ...rest.right },
    };
    window.__hands = { rest, cur, target: { left: { ...rest.left }, right: { ...rest.right } } };

    window.__moveHands = () => {
      for (const side of ['left', 'right']) {
        const c = cur[side];
        const t = window.__hands.target[side];
        c.x += (t.x - c.x) * 0.45;
        c.y += (t.y - c.y) * 0.45;
        c.z += (t.z - c.z) * 0.45;
        d.remote.dispatch('set_transform', { device: 'hand-' + side, position: { ...c }, anchor: 'grip' });
      }
    };

    // Track audio events for exact synchronization
    window.__audioEvents = [];
    window.__currentFrame = 0;

    const origPlay = s.sound.play.bind(s.sound);
    s.sound.play = (name) => {
      const typeMap = {
        'hit.ogg': 'hit',
        'confirm.ogg': 'caught',
        'hurt.ogg': 'missed',
        'ui.ogg': 'ui',
        'level_up.ogg': 'over',
      };
      const type = typeMap[name] || 'ui';
      window.__audioEvents.push({ frame: window.__currentFrame, type });
      return origPlay(name);
    };

    // Step function for precise 24 FPS
    window.__real = s.constructor.prototype.update;
    s.update = () => {};
    window.__frame = () => new Promise((r) => window.__world.session.requestAnimationFrame(() => r()));
  });

  await page.evaluate(() => window.__moveHands());
  await page.waitForTimeout(600);

  let frameNo = 0;
  const shot = async () => {
    await page.evaluate((fn) => {
      window.__currentFrame = fn;
      window.__moveHands();
      return window.__frame();
    }, frameNo);
    const filename = `f${String(frameNo++).padStart(4, '0')}.png`;
    await page.screenshot({ path: path.join(OUT, filename) });
  };

  console.log('Capturing intro title card...');
  for (let i = 0; i < 24; i++) await shot(); // 1s intro card

  // Start the round
  console.log('Starting round...');
  await page.evaluate(() => {
    const s = window.__game.sys;
    s.lockout = 0;
    s.tryStart();
  });

  // Target 720 frames (30.0s @ 24 FPS)
  const MAX_FRAMES = 720;
  let ballPlan = [
    { catch: true, high: false, hand: 'right' },  // Ball 1: Fast slip catch
    { catch: false, high: false, hand: 'none' },   // Ball 2: Dropped catch (showing coach shrug)
    { catch: true, high: true, hand: 'cup' },     // Ball 3: Lofted High Skier (High Catch!)
    { catch: true, high: false, hand: 'left' },   // Ball 4: Fast swing catch on left hand
    { catch: true, high: false, hand: 'right' },  // Ball 5: Clean right hand catch
    { catch: true, high: false, hand: 'right' },  // Ball 6: Final winning catch
  ];

  console.log('Recording active gameplay frames...');
  while (frameNo < MAX_FRAMES) {
    const state = await page.evaluate((plan) => {
      const s = window.__game.sys;
      const h = window.__hands;
      const bIdx = Math.max(0, s.ballNo - 1);
      const curPlan = plan[bIdx] || { catch: true, high: false, hand: 'right' };

      // Force high catch on Ball 3
      if (s.ballNo === 3 && s.state === 'swinging') {
        s.isHighCatch = true;
      }

      // Step physics at 60Hz rate
      const simSteps = Math.round(60 / 24); // 2.5 simulation ticks per video frame
      for (let i = 0; i < simSteps; i++) {
        window.__real.call(s, 1 / 60);
      }

      const flying = s.state === 'swinging' || s.state === 'flying';
      if (flying && curPlan.catch) {
        if (curPlan.hand === 'cup') {
          // Cup catch: bring both hands together to meet ball
          h.target.left.x = s.aim.x - 0.08;
          h.target.left.y = s.aim.y;
          h.target.left.z = s.aim.z + 0.05;

          h.target.right.x = s.aim.x + 0.08;
          h.target.right.y = s.aim.y;
          h.target.right.z = s.aim.z + 0.05;
        } else if (curPlan.hand === 'left') {
          h.target.left.x = s.aim.x;
          h.target.left.y = s.aim.y;
          h.target.left.z = s.aim.z + 0.05;
          Object.assign(h.target.right, h.rest.right);
        } else {
          h.target.right.x = s.aim.x;
          h.target.right.y = s.aim.y;
          h.target.right.z = s.aim.z + 0.05;
          Object.assign(h.target.left, h.rest.left);
        }
      } else {
        // Return hands to ready fielding stance
        Object.assign(h.target.left, h.rest.left);
        Object.assign(h.target.right, h.rest.right);
      }

      return {
        state: s.state,
        ballNo: s.ballNo,
        score: s.score,
        misses: s.misses,
      };
    }, ballPlan);

    await shot();

    if (frameNo % 100 === 0) {
      console.log(` -> Frame ${frameNo}/${MAX_FRAMES} (Ball ${state.ballNo}/${BALLS}, Score: ${state.score}, Missed: ${state.misses})`);
    }

    if (state.state === 'over' && frameNo >= 660) {
      // Pad end card to 720 frames
      while (frameNo < MAX_FRAMES) await shot();
      break;
    }
  }

  // Retrieve recorded audio events
  const audioEvents = await page.evaluate(() => window.__audioEvents);
  await browser.close();

  console.log(`\nCaptured ${frameNo} frames and ${audioEvents.length} synchronized audio events.`);

  // Write audio events metadata
  const meta = {
    totalFrames: frameNo,
    fps: FPS,
    events: audioEvents,
  };
  fs.writeFileSync('audio-events.json', JSON.stringify(meta, null, 2), 'utf8');

  // Encode with FFmpeg
  console.log('\n=== ENCODING MP4 WITH STEREO AUDIO ===');
  const totalDuration = (frameNo / FPS).toFixed(2);
  const audioMap = {
    ui: 'public/audio/ui.ogg',
    hit: 'public/audio/hit.ogg',
    caught: 'public/audio/confirm.ogg',
    missed: 'public/audio/hurt.ogg',
    over: 'public/audio/level_up.ogg',
  };

  const validEvents = audioEvents.filter((e) => audioMap[e.type] && fs.existsSync(audioMap[e.type]));
  let ffmpegCmd = '';

  if (validEvents.length === 0) {
    ffmpegCmd = `ffmpeg -y -framerate ${FPS} -i "${OUT}/f%04d.png" -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p cricket_catch_30s_hd.mp4`;
  } else {
    const inputs = [`-framerate ${FPS} -i "${OUT}/f%04d.png"`];
    const filterParts = [];
    const mixInputs = [];

    validEvents.forEach((ev, idx) => {
      inputs.push(`-i "${audioMap[ev.type]}"`);
      const delayMs = Math.round((ev.frame / FPS) * 1000);
      const audioIdx = idx + 1;
      filterParts.push(`[${audioIdx}:a]adelay=${delayMs}|${delayMs}[a${idx}]`);
      mixInputs.push(`[a${idx}]`);
    });

    const filterComplex = `${filterParts.join(';')};${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest[aout]`;
    ffmpegCmd = `ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterComplex}" -map 0:v -map "[aout]" -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -c:a aac -b:a 192k -t ${totalDuration} cricket_catch_30s_hd.mp4`;
  }

  console.log('Running FFmpeg encoding...');
  execSync(ffmpegCmd, { stdio: 'inherit' });

  // Copy to workspace root and cricket-xr
  const rootOut = path.resolve('..', 'cricket_catch_30s_hd.mp4');
  fs.copyFileSync('cricket_catch_30s_hd.mp4', rootOut);
  console.log(`Video generated successfully at: ${rootOut} and cricket_catch_30s_hd.mp4`);

  console.log('\n=== VIDEO CREATION COMPLETE ===');
})();

