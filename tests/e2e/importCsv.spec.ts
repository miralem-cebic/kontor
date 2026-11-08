import { APP_URL, expect, readFolders, setUpCompany, test, watchErrors } from './helpers';

const contactFiles = async (page: Parameters<typeof readFolders>[0]) => {
  const files = await readFolders(page);
  return Object.entries(files)
    .filter(([path]) => path.startsWith('Ordner-1/contacts/'))
    .map(([, text]) => JSON.parse(text) as Record<string, unknown>);
};

test('a CSV file imports contacts as one batch; a row with a problem is shown and left out; the batch can be taken back', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await page.getByRole('button', { name: 'Kontakte' }).click();
  await page.getByRole('button', { name: 'Importieren' }).click();
  await expect(page.getByRole('heading', { name: 'Kontakte importieren' })).toBeVisible();

  // a file with a header line; the columns are suggested from the header
  const csv = ['Name;Kundennummer;E-Mail;Rollen', 'Kunde GmbH;K-0100;buchhaltung@kunde.example;Kunde', 'Müller & Söhne;;kein-mail;Lieferant', 'Ohne Nummer;;ok@kunde.example;Kunde'].join('\r\n');
  await page.locator('input[type="file"]').setInputFiles({ name: 'kontakte.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await expect(page.getByLabel('Name')).toHaveValue('0');
  await expect(page.getByLabel('Kundennummer')).toHaveValue('1');

  // the preview shows the rows: the bad e-mail address is a problem of its row
  await page.getByRole('button', { name: 'Zeilen prüfen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'In Ordnung: 2. Nicht in Ordnung: 1.' })).toBeVisible();
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(2)).toContainText('Müller & Söhne');
  await expect(rows.nth(2)).not.toContainText('in Ordnung');

  // the rows that are fine are imported as one batch
  await page.getByRole('button', { name: 'Die Zeilen in Ordnung importieren' }).click();
  await expect(page.locator('p[role="status"]', { hasText: 'Importiert: 2' })).toBeVisible();

  // the contacts were written with the batch, and the row without a number got the next free one
  await expect.poll(async () => (await contactFiles(page)).length).toBe(2);
  const saved = await contactFiles(page);
  const numbers = saved.map((c) => c['customerNumber']).sort();
  expect(numbers).toEqual(['K-0100', 'K-0101']);
  const batches = new Set(saved.map((c) => c['importBatchId']));
  expect(batches.size).toBe(1);
  expect(typeof [...batches][0]).toBe('string');

  // taking the batch back removes its contacts; the file of the import is not kept
  await page.getByRole('button', { name: 'Kontakte' }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(3);
  await page.getByRole('button', { name: 'Importieren' }).click();
  await page.getByRole('button', { name: 'Rückgängig machen' }).click();
  await page.getByRole('group').getByRole('button', { name: 'Ja, zurücknehmen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Zurückgenommen: 2' })).toBeVisible();
  await expect.poll(async () => (await contactFiles(page)).every((c) => c['deletedAt'] !== null)).toBe(true);
  expect(errors).toEqual([]);
});
