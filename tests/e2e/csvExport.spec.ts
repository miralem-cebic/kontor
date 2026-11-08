import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { APP_URL, expect, setUpCompany, test, watchErrors } from './helpers';

/** Clicks the export button of the open list and returns the saved file as text (with its byte order mark removed) */
async function downloadCsv(page: Page, name: RegExp): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV exportieren' }).click()]);
  expect(download.suggestedFilename()).toMatch(name);
  const bytes = readFileSync((await download.path())!);
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  return bytes.toString('utf8').replace(/^\uFEFF/, '');
}

test('the item list exports as a CSV file for a spreadsheet: semicolons, CRLF, quoted line breaks', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await page.getByRole('button', { name: 'Artikel & Leistungen' }).click();
  await page.getByRole('button', { name: 'Neuer Artikel' }).click();
  await page.getByLabel('Artikelnummer').fill('L-100');
  await page.getByLabel('Bezeichnung').fill('Webdesign');
  await page.getByLabel('Beschreibung').fill('Gestaltung und Umsetzung\nnach Aufwand');
  await page.getByLabel('Einheit').selectOption({ label: 'Stunde' });
  await page.getByLabel('Nettopreis in €').fill('85');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: '„Webdesign“ gespeichert' })).toBeVisible();

  const text = await downloadCsv(page, /^kontor-items-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(text).toBe('Artikelnummer;Bezeichnung;Beschreibung;Einheit;Nettopreis;USt-Satz\r\nL-100;Webdesign;"Gestaltung und Umsetzung\nnach Aufwand";Stunde;85,00;19\r\n');
  expect(errors).toEqual([]);
});

test('a text that a spreadsheet could read as a formula is exported as text', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await page.getByRole('button', { name: 'Ausgaben' }).click();
  await page.getByRole('button', { name: 'Neue Ausgabe' }).click();
  await page.getByLabel('Lieferant').fill('=Telekom');
  await page.getByLabel('Betrag in € (brutto)').fill('10');
  await page.getByRole('button', { name: 'Ausgabe speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Ausgabe von „=Telekom“ gespeichert' })).toBeVisible();

  const text = await downloadCsv(page, /^kontor-expenses-\d{4}-\d{2}-\d{2}\.csv$/);
  const [header, row] = text.split('\r\n');
  expect(header?.split(';')[1]).toBe('Lieferant');
  expect(row?.split(';').slice(1, 4)).toEqual(["'=Telekom", '', '']);
  expect(row?.split(';')[4]).toBe('10,00');
  expect(errors).toEqual([]);
});
