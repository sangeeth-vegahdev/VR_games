const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const iconsDir = path.join(__dirname, '..', 'public', 'icons');
  if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <defs>
        <radialGradient id="bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#1a2d42"/>
          <stop offset="100%" stop-color="#0a101d"/>
        </radialGradient>
        <radialGradient id="ball" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#ff4d4d"/>
          <stop offset="45%" stop-color="#b81b1b"/>
          <stop offset="100%" stop-color="#4d0505"/>
        </radialGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#000" flood-opacity="0.6"/>
        </filter>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#bg)"/>
      <circle cx="256" cy="230" r="140" fill="url(#ball)" filter="url(#shadow)"/>
      <!-- Seam -->
      <path d="M 170 125 C 220 180, 220 280, 170 335" stroke="#f0e6d2" stroke-width="7" stroke-dasharray="8 6" fill="none"/>
      <path d="M 178 125 C 228 180, 228 280, 178 335" stroke="#f0e6d2" stroke-width="7" stroke-dasharray="8 6" fill="none"/>
      <!-- Glow rim -->
      <circle cx="256" cy="230" r="139" stroke="rgba(255,255,255,0.2)" stroke-width="3" fill="none"/>
      <text x="256" y="420" font-family="system-ui, sans-serif" font-weight="900" font-size="44" fill="#ffffff" text-anchor="middle" letter-spacing="2">CRICKET CATCH</text>
      <text x="256" y="460" font-family="system-ui, sans-serif" font-weight="600" font-size="24" fill="#4be38a" text-anchor="middle" letter-spacing="3">WEBXR VR</text>
    </svg>
  `;

  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;overflow:hidden;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: path.join(iconsDir, 'icon-512.png'), omitBackground: true });
  console.log('Generated icon-512.png');

  await page.setViewportSize({ width: 192, height: 192 });
  await page.screenshot({ path: path.join(iconsDir, 'icon-192.png'), omitBackground: true });
  console.log('Generated icon-192.png');

  await browser.close();
})();

