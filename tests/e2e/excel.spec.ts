import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { APP_URL, setUpCompany, watchErrors } from './helpers';

test('an item list exports as an Excel file that imports back: the same number is refused, a new one is fine', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await page.getByRole('button', { name: 'Artikel & Leistungen' }).click();
  await page.getByRole('button', { name: 'Neuer Artikel' }).click();
  await page.getByLabel('Artikelnummer').fill('L-100');
  await page.getByLabel('Bezeichnung').fill('Webdesign');
  await page.getByLabel('Einheit').selectOption({ label: 'Stunde' });
  await page.getByLabel('Nettopreis in €').fill('85,5');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: '„Webdesign“ gespeichert' })).toBeVisible();

  // the Excel file of the list: a real ZIP archive with the workbook in it
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel exportieren' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^kontor-items-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const bytes = readFileSync((await download.path())!);
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');

  // imported back: the item of the same number is refused, a new one is fine
  await page.getByRole('button', { name: 'Importieren' }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'artikel.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes });
  await expect(page.getByLabel('Nettopreis')).toHaveValue('4');
  await page.getByRole('button', { name: 'Zeilen prüfen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'In Ordnung: 0. Nicht in Ordnung: 1.' })).toBeVisible();
  await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('Diese Nummer hat schon ein anderer Artikel.');
  expect(errors).toEqual([]);
});
