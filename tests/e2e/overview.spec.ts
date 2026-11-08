import { APP_URL, expect, setUpCompany, test, watchErrors } from './helpers';

test('the overview shows this year net: the expense without the VAT that comes back, the twelve months, the limits', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });

  // an expense of 49.99 € with 7.98 € VAT: it counts with 42.01 € net for a regular business
  await page.getByRole('button', { name: 'Ausgaben' }).click();
  await page.getByRole('button', { name: 'Neue Ausgabe' }).click();
  await page.getByLabel('Lieferant').fill('Telekom');
  await page.getByLabel('Betrag in € (brutto)').fill('49,99');
  await page.getByRole('button', { name: 'Ausgabe speichern' }).click();

  await page.getByRole('button', { name: 'Übersicht' }).click();
  const expenses = page.getByRole('region', { name: 'Ausgaben (netto)' });
  await expect(expenses).toContainText('42,01');
  await expect(page.getByRole('region', { name: 'Einnahmen (netto)' })).toContainText('0,00');
  await expect(page.getByRole('region', { name: 'Überschuss (Schätzung)' })).toContainText('-42,01');

  // the twelve months of the year, and the limits with their orientation
  await expect(page.getByRole('region', { name: 'Monate' }).getByRole('row')).toHaveCount(13);
  await expect(page.getByText('Umsatz des laufenden Jahres (netto): 0,00 € von 100.000,00 € darunter')).toBeVisible();
  await expect(page.getByText('Alle Zahlen sind Schätzungen')).toBeVisible();
  expect(errors).toEqual([]);
});
