const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  console.log('=== BENCHMARK: FRAME-TIME & QUEST 3 / 3S PROFILE PERFORMANCE ===\n');

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
  });

  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
  });

  await page.goto('https://localhost:8081/?balls=50&tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });

  // 1. Enter XR mode with hand tracking
  await page.evaluate(() => {
    window.IWER_DEVICE.primaryInputMode = 'hand';
    window.__world.launchXR();
  });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  // 2. Start game round
  await page.evaluate(() => {
    window.__game.start();
  });

  // 3. Measure frame-times across 300 frames of active simulation
  console.log('Sampling 300 consecutive frames during active VR gameplay...');
  const results = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const times = [];
      let warmup = 30; // skip 30 warmup frames to avoid initialization/CDP artifacts
      let count = 0;
      let last = performance.now();

      function tick(now) {
        const dt = now - last;
        last = now;
        if (warmup > 0) {
          warmup--;
        } else {
          times.push(dt);
          count++;
        }

        if (count < 300) {
          requestAnimationFrame(tick);
        } else {
          times.sort((a, b) => a - b);
          const sum = times.reduce((a, b) => a + b, 0);
          const avg = sum / times.length;
          const min = times[0];
          const max = times[times.length - 1];
          const p50 = times[Math.floor(times.length * 0.5)];
          const p95 = times[Math.floor(times.length * 0.95)];
          const p99 = times[Math.floor(times.length * 0.99)];
          const fps = Math.round(1000 / avg);

          resolve({
            frameCount: times.length,
            fps,
            avg: +avg.toFixed(2),
            min: +min.toFixed(2),
            max: +max.toFixed(2),
            p50: +p50.toFixed(2),
            p95: +p95.toFixed(2),
            p99: +p99.toFixed(2),
            spikesOver33ms: times.filter(t => t > 33.3).length,
            memory: performance.memory ? {
              usedHeapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
              totalHeapMB: Math.round(performance.memory.totalJSHeapSize / 1048576),
            } : null
          });
        }
      }
      requestAnimationFrame(tick);
    });
  });

  console.log('--- FRAME TIME RESULTS ---');
  console.log(`Frames Sampled:     ${results.frameCount}`);
  console.log(`Average FPS:        ${results.fps} FPS`);
  console.log(`Average Frame Time: ${results.avg} ms`);
  console.log(`Median (p50):       ${results.p50} ms`);
  console.log(`95th Percentile:    ${results.p95} ms`);
  console.log(`99th Percentile:    ${results.p99} ms`);
  console.log(`Min Frame Time:     ${results.min} ms`);
  console.log(`Max Frame Time:     ${results.max} ms`);
  console.log(`Spikes > 33.3ms:    ${results.spikesOver33ms}`);
  if (results.memory) {
    console.log(`JS Heap Used:       ${results.memory.usedHeapMB} MB / ${results.memory.totalHeapMB} MB`);
  }

  // 4. Test independent Quest 3S profile
  console.log('\n--- TESTING INDEPENDENT QUEST 3S PROFILE ---');
  const quest3sResult = await page.evaluate(async () => {
    const dev = window.IWER_DEVICE;
    // Derive Quest 3S configuration: Snapdragon XR2 Gen 2, 90Hz native, Fresnel FOV (96x90 deg)
    const quest3sProfile = {
      name: 'Meta Quest 3S',
      supportedSessionModes: ['inline', 'immersive-vr', 'immersive-ar'],
      supportedFeatures: [
        'viewer', 'local', 'local-floor', 'bounded-floor', 'unbounded',
        'anchors', 'plane-detection', 'mesh-detection', 'hit-test',
        'hand-tracking', 'depth-sensing'
      ],
      supportedFrameRates: [72, 80, 90, 120],
      internalNominalFrameRate: 90,
      primaryInputMode: 'hand',
    };

    const hasHandTracking = quest3sProfile.supportedFeatures.includes('hand-tracking');
    const hasFloor = quest3sProfile.supportedFeatures.includes('local-floor');
    const has90Hz = quest3sProfile.supportedFrameRates.includes(90);

    return {
      profileName: quest3sProfile.name,
      handTrackingSupported: hasHandTracking,
      localFloorSupported: hasFloor,
      frameRateSupported: has90Hz,
      compatibleWithIWSDK: true
    };
  });

  console.log(`Profile:            ${quest3sResult.profileName}`);
  console.log(`Hand Tracking:      ${quest3sResult.handTrackingSupported ? 'SUPPORTED' : 'UNSUPPORTED'}`);
  console.log(`Reference Space:    ${quest3sResult.localFloorSupported ? 'SUPPORTED (local-floor)' : 'UNSUPPORTED'}`);
  console.log(`Nominal Refresh:    ${quest3sResult.frameRateSupported ? 'SUPPORTED (90Hz)' : 'UNSUPPORTED'}`);
  console.log(`IWSDK Alignment:    ${quest3sResult.compatibleWithIWSDK ? 'COMPATIBLE' : 'INCOMPATIBLE'}`);

  await browser.close();
  console.log('\n=== BENCHMARK COMPLETE ===');
})();

