// Build acceptance test: open dist/index.html via file:// in the installed Chrome
// and check that the app starts without console errors.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const url = pathToFileURL(resolve('dist/index.html')).href;
const channel = process.env.BROWSER_CHANNEL || 'chrome';
const browser = await chromium.launch({ channel, headless: process.env.HEADED ? false : true });
const page = await browser.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url);
// The first screen of the setup assistant: the browser check with its "continue" button
await page.locator('.wizard button.primary').first().waitFor({ timeout: 5000 });
const env = await page.evaluate(async () => {
  await document.fonts.ready;
  return {
    protocol: location.protocol,
    secureContext: isSecureContext,
    directoryPicker: typeof showDirectoryPicker === 'function',
    indexedDb: typeof indexedDB !== 'undefined',
    subtleCrypto: typeof crypto.subtle?.digest === 'function',
    font: document.fonts.check('600 14px "Inter"'),
    fontFamilyUsed: getComputedStyle(document.body).fontFamily.split(',')[0],
    ui: document.querySelector('.wizard button.primary')?.textContent ?? null,
  };
});
console.log(`Browser: ${channel} ${browser.version()}`);
console.log(env);
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'No console errors or warnings.');
await browser.close();
process.exit(problems.length || !env.directoryPicker || !env.secureContext || !env.subtleCrypto || !env.font ? 1 : 0);
