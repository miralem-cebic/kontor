import type { Page } from '@playwright/test';
import { APP_URL, expect, isoToday, readFolders, setUpCompany, test, watchErrors } from './helpers';

const openExpenses = (page: Page) => page.getByRole('button', { name: 'Ausgaben' }).click();
/** The text of a file of the folder: the helper gives binary files as data URLs */
const textOfFile = (value: string | undefined): string | undefined => (value?.startsWith('data:') ? Buffer.from(value.split(',')[1] ?? '', 'base64').toString('utf8') : value);

test('a receipt is copied into the folder, opened, removed, replaced by a link, and kept over a reload', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });

  // an expense, saved; its receipt card shows that there is none
  await openExpenses(page);
  await page.getByRole('button', { name: 'Neue Ausgabe' }).click();
  await page.getByLabel('Lieferant').fill('Telekom');
  await page.getByLabel('Betrag in € (brutto)').fill('49,99');
  await page.getByRole('button', { name: 'Ausgabe speichern' }).click();
  await page.getByRole('button', { name: /^Telekom/ }).click();
  await expect(page.getByText('Noch kein Beleg.')).toBeVisible();

  // a PDF is copied into belege/<year>/ with the expense's ID in front of its name, and logged
  const pdf = Buffer.from('%PDF-1.4 Beleg Telekom Oktober');
  await page.locator('input[type="file"]').setInputFiles({ name: 'Telekom Oktober.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByRole('status').filter({ hasText: 'Beleg gespeichert' })).toBeVisible();
  await expect(page.getByText('Telekom Oktober.pdf', { exact: true })).toBeVisible();

  const year = isoToday().slice(0, 4);
  const month = isoToday().slice(0, 7);
  const files = await readFolders(page);
  const receiptPaths = Object.keys(files).filter((p) => p.startsWith(`Ordner-1/belege/${year}/`));
  expect(receiptPaths).toHaveLength(1);
  expect(receiptPaths[0]?.endsWith('-Telekom Oktober.pdf')).toBe(true);
  expect(textOfFile(files[receiptPaths[0]!])).toBe('%PDF-1.4 Beleg Telekom Oktober');
  expect(files[`Ordner-1/audit/${month}.jsonl`]).toContain('"action":"attachReceipt"');

  // opening hands out the file with its name
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Herunterladen' }).click()]);
  expect(download.suggestedFilename()).toMatch(/-Telekom Oktober\.pdf$/);

  // removed: the expense says so, the file stays in the folder
  await page.getByRole('button', { name: 'Beleg entfernen' }).click();
  await page.getByRole('group').getByRole('button', { name: 'Ja, entfernen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Beleg entfernt' })).toBeVisible();
  await expect(page.getByText('Noch kein Beleg.')).toBeVisible();
  expect(textOfFile((await readFolders(page))[receiptPaths[0]!])).toBe('%PDF-1.4 Beleg Telekom Oktober');

  // a link that is not http or https is refused; a https link is kept
  await page.getByLabel('Oder ein Link zum Beleg').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Link speichern' }).click();
  await expect(page.getByText('Der Link muss mit https:// oder http:// beginnen.')).toBeVisible();
  await page.getByLabel('Oder ein Link zum Beleg').fill('https://cloud.example/beleg.pdf');
  await page.getByRole('button', { name: 'Link speichern' }).click();
  await expect(page.getByRole('link', { name: 'https://cloud.example/beleg.pdf' })).toBeVisible();
  await expect(page.getByText('kontor bewahrt diesen Beleg nicht auf.')).toBeVisible();

  // the link is still there after a reload
  await page.reload();
  await openExpenses(page);
  await page.getByRole('button', { name: /^Telekom/ }).click();
  await expect(page.getByRole('link', { name: 'https://cloud.example/beleg.pdf' })).toBeVisible();
  expect(errors).toEqual([]);
});
