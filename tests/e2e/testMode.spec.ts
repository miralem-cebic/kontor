import { expect, test as plainTest } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// The test mode keeps company folders in localStorage, which every file:// page can read. A link or a shortcut must not
// be able to switch it on: only the Playwright setup can, with a flag set before the app's script runs (helpers.ts).
// This test uses the plain Playwright `test`, without that flag (#83).

plainTest('a URL parameter does not switch on the test mode', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve('dist/index.html')).href + '?e2e');
  await expect(page.locator('.wizard').getByRole('heading', { name: 'Browser' })).toBeVisible();
  expect(await page.evaluate(() => window.__e2e === undefined)).toBe(true);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('kontor.e2e')))).toEqual([]);
  expect(errors).toEqual([]);
});
