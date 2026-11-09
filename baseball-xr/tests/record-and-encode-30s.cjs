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
const PITCHES = 6;
const GAME_URL = process.env.GAME_URL || 'https://localhost:8082';

(async () => {
  console.log('=== RECORDING 30s HD DEMO VIDEO FOR GLOVE UP (BASEBALL VR) ===\n');

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

  await page.goto(`${GAME_URL}/?pitches=${PITCHES}&tutorial=0`);
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 40000 });

  // Enter WebXR mode with hand tracking
  await page.evaluate((n) => {
    try { localStorage.removeItem('glove-up-best-' + n + '-pro'); } catch (e) {}
    window.IWER_DEVICE.primaryInputMode = 'hand';
    window.__world.launchXR();
  }, PITCHES);
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 20000 });
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

    // Head seated at catcher height
    await d.remote.dispatch('set_transform', { device: 'headset', position: { x: 0, y: 1.15, z: 0.05 } });
    await d.remote.dispatch('look_at', { device: 'headset', target: { x: 0, y: 1.35, z: -18.4 } });

    // Open hand pose
    for (const side of ['left', 'right']) {
      d.hands[side].connected = true;
      await d.remote.dispatch('set_hand_pose', { device: 'hand-' + side, poseId: 'open' });
    }

    // Catcher stance: mitt on left hand, bare hand low
    const rest = {
      glove: { x: -0.22, y: 0.88, z: -0.42 },
      bare: { x: 0.28, y: 0.72, z: -0.32 },
    };
    const cur = {
      glove: { ...rest.glove },
      bare: { ...rest.bare },
    };
    window.__hands = { rest, cur, target: { glove: { ...rest.glove }, bare: { ...rest.bare } } };

    window.__moveHands = () => {
      const gSide = s.glove.side;
      const bSide = gSide === 'left' ? 'right' : 'left';

      const cg = cur.glove;
      const tg = window.__hands.target.glove;
      cg.x += (tg.x - cg.x) * 0.45;
      cg.y += (tg.y - cg.y) * 0.45;
      cg.z += (tg.z - cg.z) * 0.45;
      d.remote.dispatch('set_transform', {
        device: 'hand-' + gSide,
        position: { ...cg },
        orientation: { fingers: [0, 1, -0.3], palm: [0, 0, -1] },
        anchor: 'grip',
      });

      const cb = cur.bare;
      const tb = window.__hands.target.bare;
      cb.x += (tb.x - cb.x) * 0.45;
      cb.y += (tb.y - cb.y) * 0.45;
      cb.z += (tb.z - cb.z) * 0.45;
      d.remote.dispatch('set_transform', {
        device: 'hand-' + bSide,
        position: { ...cb },
        orientation: { fingers: [0, -0.2, -1], palm: [gSide === 'left' ? -1 : 1, 0, 0] },
        anchor: 'grip',
      });
    };

    window.__lookAtBall = (pIdx, plan) => {
      const b = s.ball.position;
      const flying = s.state === 'flying';
      const curPlan = plan && plan[pIdx] ? plan[pIdx] : null;
      if (flying) {
        if (curPlan && curPlan.catch === false && b.z > -4) {
          // Look away late when letting pitch through
          d.remote.dispatch('look_at', { device: 'headset', target: { x: b.x + 2.5, y: b.y + 1, z: b.z } });
        } else {
          // Track the ball with the eyes
          d.remote.dispatch('look_at', { device: 'headset', target: { x: b.x, y: b.y, z: b.z } });
        }
      } else if (s.state === 'windup') {
        d.remote.dispatch('look_at', { device: 'headset', target: { x: s.pitcher.ballPos.x, y: s.pitcher.ballPos.y, z: s.pitcher.ballPos.z } });
      } else {
        d.remote.dispatch('look_at', { device: 'headset', target: { x: 0, y: 1.35, z: -18.4 } });
      }
    };

    // Track audio events
    window.__audioEvents = [];
    window.__currentFrame = 0;

    const origCaught = s.sound.caught.bind(s.sound);
    s.sound.caught = (streak, weight) => {
      window.__audioEvents.push({ frame: window.__currentFrame, type: 'caught' });
      return origCaught(streak, weight);
    };

    const origMissed = s.sound.missed.bind(s.sound);
    s.sound.missed = () => {
      window.__audioEvents.push({ frame: window.__currentFrame, type: 'missed' });
      return origMissed();
    };

    const origStart = s.sound.start.bind(s.sound);
    s.sound.start = () => {
      window.__audioEvents.push({ frame: window.__currentFrame, type: 'start' });
      return origStart();
    };

    const origOver = s.sound.over.bind(s.sound);
    s.sound.over = () => {
      window.__audioEvents.push({ frame: window.__currentFrame, type: 'over' });
      return origOver();
    };

    // Precise step loop
    window.__real = s.constructor.prototype.update;
    s.update = () => {};
    window.__frame = () => new Promise((r) => window.__world.session.requestAnimationFrame(() => r()));
  });

  await page.evaluate(() => window.__moveHands());
  await page.waitForTimeout(600);

  let frameNo = 0;
  let pitchPlan = [
    { catch: true },   // Pitch 1: 4-seam fastball in the zone
    { catch: true },   // Pitch 2: Breaking pitch framed
    { catch: true },   // Pitch 3: Dropping curve
    { catch: false },  // Pitch 4: Let through to show eye-loss miss message
    { catch: true },   // Pitch 5: Fast slider
    { catch: true },   // Pitch 6: Final 98mph heater
  ];

  const shot = async (pIdx = 0) => {
    await page.evaluate(({ fn, pIdx, plan }) => {
      window.__currentFrame = fn;
      window.__moveHands();
      window.__lookAtBall(pIdx, plan);
      return window.__frame();
    }, { fn: frameNo++, pIdx, plan: pitchPlan });
    const filename = `f${String(frameNo - 1).padStart(4, '0')}.png`;
    await page.screenshot({ path: path.join(OUT, filename) });
  };

  console.log('Capturing intro title card...');
  for (let i = 0; i < 24; i++) await shot(); // 1s intro card

  // Start round
  console.log('Starting Glove Up round...');
  await page.evaluate(() => {
    const s = window.__game.sys;
    s.lockout = 0;
    s.tryStart();
  });

  const MAX_FRAMES = 720;
  console.log('Recording active gameplay frames...');

  while (frameNo < MAX_FRAMES) {
    const state = await page.evaluate((plan) => {
      const s = window.__game.sys;
      const h = window.__hands;
      const pIdx = Math.max(0, s.pitchNo - 1);
      const curPlan = plan[pIdx] || { catch: true };

      const simSteps = Math.round(60 / 24);
      for (let i = 0; i < simSteps; i++) {
        window.__real.call(s, 1 / 60);
      }

      const flying = s.state === 'flying';
      if (flying && curPlan.catch) {
        // Move mitt to pitch aim spot
        h.target.glove.x = s.aim.x;
        h.target.glove.y = s.aim.y;
        h.target.glove.z = s.aim.z + 0.04;
      } else {
        // Return mitt to target ready stance
        Object.assign(h.target.glove, h.rest.glove);
        Object.assign(h.target.bare, h.rest.bare);
      }

      return {
        state: s.state,
        pitchNo: s.pitchNo,
        catches: s.catches,
        misses: s.misses,
      };
    }, pitchPlan);

    await shot(state.pitchNo ? state.pitchNo - 1 : 0);

    if (frameNo % 100 === 0) {
      console.log(` -> Frame ${frameNo}/${MAX_FRAMES} (Pitch ${state.pitchNo}/${PITCHES}, Catches: ${state.catches}, Missed: ${state.misses})`);
    }

    if (state.state === 'over' && frameNo >= 660) {
      while (frameNo < MAX_FRAMES) await shot();
      break;
    }
  }

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
    start: 'public/audio/ui.ogg',
    caught: 'public/audio/coin.ogg',
    missed: 'public/audio/hurt.ogg',
    over: 'public/audio/level_up.ogg',
  };

  const validEvents = audioEvents.filter((e) => audioMap[e.type] && fs.existsSync(audioMap[e.type]));
  let ffmpegCmd = '';

  if (validEvents.length === 0) {
    ffmpegCmd = `ffmpeg -y -framerate ${FPS} -i "${OUT}/f%04d.png" -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p glove_up_30s_hd.mp4`;
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
    ffmpegCmd = `ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterComplex}" -map 0:v -map "[aout]" -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -c:a aac -b:a 192k -t ${totalDuration} glove_up_30s_hd.mp4`;
  }

  console.log('Running FFmpeg encoding...');
  execSync(ffmpegCmd, { stdio: 'inherit' });

  const rootOut = path.resolve('..', 'glove_up_30s_hd.mp4');
  fs.copyFileSync('glove_up_30s_hd.mp4', rootOut);
  console.log(`Video generated successfully at: ${rootOut} and glove_up_30s_hd.mp4`);

  console.log('\n=== VIDEO CREATION COMPLETE ===');
})();

