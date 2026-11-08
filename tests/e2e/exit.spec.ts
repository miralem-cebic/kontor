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
