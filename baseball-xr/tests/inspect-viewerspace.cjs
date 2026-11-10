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

    const res = await page.evaluate(() => {
      const d = window.IWER_DEVICE;
      const vs = d?.viewerSpace;
      return {
        viewerSpaceKeys: vs ? Object.keys(vs) : [],
        vsProto: Object.getOwnPropertyNames(Object.getPrototypeOf(vs || {})),
        quatType: vs?.quaternion ? Object.prototype.toString.call(vs.quaternion) : typeof vs?.quaternion,
        quatVal: vs?.quaternion ? Array.from(vs.quaternion) : null,
      };
    });

    console.log(JSON.stringify(res, null, 2));

  } finally {
    if (browser) await browser.close();
  }
})();

