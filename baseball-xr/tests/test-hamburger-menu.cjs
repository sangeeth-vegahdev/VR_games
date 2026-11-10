const { chromium } = require('playwright');
const assert = require('assert');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
      args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
    });

    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
    await page.goto('https://localhost:8082/?tutorial=0', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('emulator-toggle-btn'), null, { timeout: 15000 });

    // 1. Initial state: menu must be hidden
    const initialDisplay = await page.evaluate(() => {
      const sw = document.getElementById('iwsdk-device-switcher');
      const icon = document.getElementById('emulator-toggle-icon');
      return {
        display: sw.style.display,
        visible: sw.offsetWidth > 0 && sw.offsetHeight > 0,
        iconText: icon.textContent,
      };
    });
    console.log('1. Initial state (hidden):', initialDisplay);
    assert.strictEqual(initialDisplay.display, 'none', 'Menu must be hidden by default');
    assert.strictEqual(initialDisplay.visible, false, 'Menu element must not be visible on screen');
    assert.strictEqual(initialDisplay.iconText, '☰', 'Hamburger icon must be ☰');

    // 2. Click hamburger button -> should open
    await page.click('#emulator-toggle-btn');
    await page.waitForTimeout(100);

    const openedDisplay = await page.evaluate(() => {
      const sw = document.getElementById('iwsdk-device-switcher');
      const icon = document.getElementById('emulator-toggle-icon');
      return {
        display: sw.style.display,
        visible: sw.offsetWidth > 0 && sw.offsetHeight > 0,
        iconText: icon.textContent,
      };
    });
    console.log('2. After first click (opened):', openedDisplay);
    assert.strictEqual(openedDisplay.display, 'flex', 'Menu must display flex when opened');
    assert.strictEqual(openedDisplay.visible, true, 'Menu must be visible');
    assert.strictEqual(openedDisplay.iconText, '✕', 'Toggle icon must switch to ✕');

    // 3. Click hamburger button again -> should close
    await page.click('#emulator-toggle-btn');
    await page.waitForTimeout(100);

    const closedDisplay = await page.evaluate(() => {
      const sw = document.getElementById('iwsdk-device-switcher');
      const icon = document.getElementById('emulator-toggle-icon');
      return {
        display: sw.style.display,
        visible: sw.offsetWidth > 0 && sw.offsetHeight > 0,
        iconText: icon.textContent,
      };
    });
    console.log('3. After second click (closed):', closedDisplay);
    assert.strictEqual(closedDisplay.display, 'none', 'Menu must hide again');
    assert.strictEqual(closedDisplay.visible, false, 'Menu element must be hidden');
    assert.strictEqual(closedDisplay.iconText, '☰', 'Icon must revert to ☰');

    console.log('\nSUCCESS: Hamburger menu opens on click and closes on next click!');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();

