const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
  });

  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  await page.goto('https://localhost:8082/?tutorial=0&device=metaQuest3', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 20000 });
  await page.mouse.move(640, 360);
  await page.evaluate(() => window.__world.launchXR());
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Take screenshot with hamburger closed
  const shotClosed = path.resolve(__dirname, 'hamburger-closed.png');
  await page.screenshot({ path: shotClosed });
  console.log('Saved closed screenshot:', shotClosed);

  // Click hamburger to open
  await page.click('#emulator-toggle-btn');
  await page.waitForTimeout(200);

  // Take screenshot with hamburger open
  const shotOpen = path.resolve(__dirname, 'hamburger-open.png');
  await page.screenshot({ path: shotOpen });
  console.log('Saved open screenshot:', shotOpen);

  await browser.close();
})();

