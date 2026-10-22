import { expect, test, type Page } from '@playwright/test';
import { APP_URL, setUpCompany, watchErrors } from './helpers';

/** Only the content area scrolls; the page itself never does, in either direction */
const pageScrolls = (page: Page) =>
  page.evaluate(() => {
    const e = document.scrollingElement;
    return !!e && (e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth);
  });

test('the page itself does not scroll, only the content area', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1135, height: 800 });
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', trade: { municipality: 'Neuberg', multiplier: '380' } });
  for (const area of ['Angebote', 'Kontakte', 'Artikel & Leistungen', 'Einstellungen']) {
    await page.getByRole('button', { name: area, exact: true }).click();
    expect(await pageScrolls(page), area).toBe(false);
  }
  expect(errors).toEqual([]);
});
