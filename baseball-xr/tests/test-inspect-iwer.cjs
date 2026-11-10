const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
      args: ['--ignore-certificate-errors', '--enable-webgl', '--enable-webgl2'],
    });

    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await page.goto('https://localhost:8082/?autoxr=1&tutorial=0', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const info = await page.evaluate(() => {
      const d = window.IWER_DEVICE;
      const proto = Object.getPrototypeOf(d || {});
      const p2 = Object.getPrototypeOf(proto || {});
      return {
        keys: d ? Object.keys(d) : [],
        protoMethods: Object.getOwnPropertyNames(proto),
        p2Methods: Object.getOwnPropertyNames(p2),
        fovy: d?.fovy,
        ipd: d?.ipd,
      };
    });

    console.log(JSON.stringify(info, null, 2));

  } finally {
    if (browser) await browser.close();
  }
})();

