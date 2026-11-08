import type { Page } from '@playwright/test';
import { APP_URL, expect, readFolders, setUpCompany, test, watchErrors } from './helpers';

const openExpenses = (page: Page) => page.getByRole('button', { name: 'Ausgaben' }).click();
const expenseFiles = async (page: Page) => {
  const files = await readFolders(page);
  return Object.entries(files)
    .filter(([path]) => path.startsWith('Ordner-1/expenses/'))
    .map(([, text]) => JSON.parse(text) as Record<string, unknown>);
};

test('expenses: create with checks, the VAT inside the amount, edit, reload, delete', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await openExpenses(page);
  await expect(page.getByText('Noch keine Ausgaben erfasst.')).toBeVisible();

  // supplier and amount are required; the first invalid field gets the focus
  await page.getByRole('button', { name: 'Neue Ausgabe' }).click();
  await expect(page.getByRole('heading', { name: 'Neue Ausgabe' })).toBeFocused();
  await page.getByRole('button', { name: 'Ausgabe speichern' }).click();
  await expect(page.getByText('Bitte ausfüllen.')).toHaveCount(2);
  await expect(page.getByLabel('Betrag in € (brutto)')).toBeFocused();

  // an amount of 0 is refused; a valid amount shows the VAT inside it
  await page.getByLabel('Lieferant').fill('Telekom');
  await page.getByLabel('Betrag in € (brutto)').fill('0');
  await expect(page.getByText('Der Betrag muss größer als 0 sein.')).toBeVisible();
  await page.getByLabel('Betrag in € (brutto)').fill('49,99');
  await expect(page.getByText('Darin enthalten: 7,98 €')).toBeVisible();
  await page.getByLabel('Datum der Zahlung').fill('2026-10-28');
  await page.getByLabel('Belegnummer').fill('R-4711');
  await page.getByLabel('Kategorie').fill('Telefon');
  await page.getByRole('button', { name: 'Ausgabe speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Ausgabe von „Telekom“ gespeichert' })).toBeVisible();

  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText(['28.10.2026', 'Telekom', 'R-4711', 'Telefon', '49,99 €', '7,98 €'].join(''));

  // the file is written with the amount in cents and the rate of the receipt
  await expect.poll(() => expenseFiles(page)).toHaveLength(1);
  const [saved] = await expenseFiles(page);
  expect(saved).toMatchObject({ supplier: 'Telekom', reference: 'R-4711', gross: 4999, taxTreatment: 'domestic', vatRate: 1900, category: 'Telefon', deletedAt: null });

  // reload: the expense is there
  await page.reload();
  await openExpenses(page);
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);

  // edit: for a supplier in the EU the VAT rate is not asked and the VAT column shows a dash
  await page.getByRole('button', { name: /^Telekom/ }).click();
  await expect(page.getByLabel('Umsatzsteuersatz')).toHaveValue('1900');
  await page.getByLabel('Umsatzsteuer auf dem Beleg').selectOption({ label: 'Lieferant aus der EU (Reverse-Charge)' });
  await expect(page.getByLabel('Umsatzsteuersatz')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ausgabe speichern' }).click();
  await expect(rows.nth(1)).toContainText('–');

  // delete asks first, then the expense leaves the list and its file stays
  await page.getByRole('button', { name: /^Telekom/ }).click();
  await page.getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('group', { name: 'Ausgabe löschen? Sie verschwindet aus der Liste; die Datei bleibt erhalten.' })).toBeVisible();
  await page.getByRole('group').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByText('Noch keine Ausgaben erfasst.')).toBeVisible();
  await expect.poll(async () => (await expenseFiles(page))[0]?.deletedAt).toBeTruthy();
  expect(errors).toEqual([]);
});
