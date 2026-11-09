import { readFileSync } from 'node:fs';
import { readZip } from '../../src/data/import/zip';
import { APP_URL, expect, openSettings, setUpCompany, test, watchErrors } from './helpers';

test('the company folder exports as a ZIP file: the folder as it is, every list as CSV, and a readme', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await openSettings(page, 'App');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Ordner als ZIP exportieren' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^kontor-\d{4}-\d{2}-\d{2}\.zip$/);

  const read = await readZip(readFileSync((await download.path())!));
  expect(read.ok).toBe(true);
  if (!read.ok) return;
  const names = [...read.value.keys()];
  expect(names).toEqual(expect.arrayContaining(['company.json', 'listen/contacts.csv', 'listen/items.csv', 'listen/expenses.csv', 'listen/payouts.csv', 'LIESMICH.txt']));

  // the folder's company file is in the archive as it is
  const company = JSON.parse(new TextDecoder().decode(read.value.get('company.json')!)) as { name: string; schemaVersion: number };
  expect(company).toMatchObject({ name: 'Alpha Studio', schemaVersion: 17 });

  // a list as a CSV file: the byte order mark, then the header line
  const contacts = new TextDecoder().decode(read.value.get('listen/contacts.csv')!);
  expect(contacts.startsWith('Kundennummer;Art;')).toBe(true);
  expect(read.value.get('listen/contacts.csv')!.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
  expect(errors).toEqual([]);
});

test('a file whose name some programs read as a path is left out of the archive and named in the readme (#80)', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio' });
  // a file another system wrote into the folder: on Windows, a ZIP tool would unpack it a folder up (a name that starts
  // with a dot is hidden and never listed)
  await page.evaluate(() => {
    localStorage.setItem('kontor.e2e.dir.Ordner-1:d:belege', '1');
    localStorage.setItem('kontor.e2e.dir.Ordner-1:f:belege/Rechnung\\..\\..\\Startup\\x.bat', JSON.stringify({ c: 'echo', m: 1 }));
  });
  await openSettings(page, 'App');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Ordner als ZIP exportieren' }).click()]);
  await expect(page.getByRole('status').filter({ hasText: '1 Datei(en) mit einem Namen, den manche Programme als Pfad lesen, sind nicht im Export.' })).toBeVisible();
  const read = await readZip(readFileSync((await download.path())!));
  expect(read.ok).toBe(true);
  if (!read.ok) return;
  expect([...read.value.keys()].some((name) => name.includes('Startup'))).toBe(false);
  expect(new TextDecoder().decode(read.value.get('LIESMICH.txt')!)).toContain('- belege/Rechnung\\..\\..\\Startup\\x.bat');
  expect(errors).toEqual([]);
});
