const { chromium } = require('playwright');

(async () => {
  console.log('Starting Google Chrome with Meta WebXR Emulator...');
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    args: [
      '--ignore-certificate-errors',
      '--allow-insecure-localhost',
      '--enable-webgl',
      '--enable-webgl2',
      '--start-maximized',
    ],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: null,
  });

  const page = await context.newPage();
  console.log('Loading Cricket Catch (https://localhost:8081/?autoxr=1)...');
  await page.goto('https://localhost:8081/?autoxr=1');

  await page.waitForFunction(() => window.__world && window.__game, null, { timeout: 30000 });
  console.log('Waiting for Immersive WebXR Session to enter...');

  await page.evaluate(async () => {
    if (window.IWER_DEVICE) {
      window.IWER_DEVICE.primaryInputMode = 'hand';
    }
    if (window.__world && !window.__world.session) {
      await window.__world.launchXR();
    }
  });

  await page.waitForFunction(() => !!(window.__world && window.__world.session), null, { timeout: 20000 });
  console.log('================================================================');
  console.log('   META WEBXR EMULATOR (IWER) SESSION IS ACTIVE AND RUNNING!   ');
  console.log('================================================================');
  console.log('Move your mouse over the window to control hands and catch balls.');
  console.log('Click or press any key to start a round.');
  console.log('Use bottom-left buttons to switch devices or jump to Glove Up (Baseball).');

  // Keep script alive indefinitely while browser is open
  await new Promise((resolve) => {
    browser.on('disconnected', resolve);
  });
  console.log('Browser session finished.');
  process.exit(0);
})().catch((err) => {
  console.error('Launch failed:', err);
  process.exit(1);
});

