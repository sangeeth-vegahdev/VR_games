const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
  await page.goto('https://localhost:8081/?balls=50&tutorial=0');
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 30000 });

  // Start game so title card is dismissed and scoreboard is visible
  await page.evaluate(() => {
    window.__game.start();
    window.__game.sys.hud.set({ score: 10, misses: 9, ballNo: 20, kmh: 71, message: 'CAUGHT!', color: '#4be38a' });
  });
  await page.waitForTimeout(600);

  const shotPath1 = path.join(__dirname, '..', 'scoreboard-fixed-10-9.png');
  await page.screenshot({ path: shotPath1 });
  console.log(`Saved screenshot 1: ${shotPath1}`);

  // Test 2: Maximum digits test (Score 49, Missed 49, Ball 50 / 50, 85 km/h)
  await page.evaluate(() => {
    window.__game.sys.hud.set({ score: 49, misses: 49, ballNo: 50, kmh: 85, message: 'MISSED!', color: '#ff6b6b' });
  });
  await page.waitForTimeout(600);

  const shotPath2 = path.join(__dirname, '..', 'scoreboard-fixed-49-49.png');
  await page.screenshot({ path: shotPath2 });
  console.log(`Saved screenshot 2: ${shotPath2}`);

  await browser.close();
})();
