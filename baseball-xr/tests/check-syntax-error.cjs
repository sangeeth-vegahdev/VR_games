const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
  });

  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  page.on('pageerror', err => {
    console.error('PageError details:', {
      message: err.message,
      stack: err.stack,
    });
  });

  await page.goto('https://localhost:8082/?tutorial=0', { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await browser.close();
})();
