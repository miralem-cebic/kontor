import { expect, test } from '@playwright/test';
import { APP_URL, setUpCompany, watchErrors } from './helpers';

test('the advance VAT return: the period, the due date, the input tax of an expense, a copy button per value, what is not covered', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });

  // an expense of 119.00 € with 19.00 € VAT, dated today
  await page.getByRole('button', { name: 'Ausgaben' }).click();
  await page.getByRole('button', { name: 'Neue Ausgabe' }).click();
  await page.getByLabel('Lieferant').fill('Telekom');
  await page.getByLabel('Betrag in € (brutto)').fill('119,00');
  await page.getByRole('button', { name: 'Ausgabe speichern' }).click();

  await page.getByRole('button', { name: 'Steuern' }).click();
  await expect(page.getByRole('heading', { name: 'Umsatzsteuer-Voranmeldung' })).toBeVisible();
  await expect(page.getByText('Ausfüllhilfe und Schätzung, keine Steuerberatung')).toBeVisible();

  // the expense is in the current month, not in the last one that is over
  const now = new Date();
  await page.getByLabel('Art', { exact: true }).selectOption('month');
  await page.getByLabel('Jahr', { exact: true }).selectOption(String(now.getFullYear()));
  await page.getByLabel('Monat', { exact: true }).selectOption(String(now.getMonth() + 1));
  const input = page.getByRole('row', { name: /^66 / });
  await expect(input).toContainText('19,00');
  await expect(page.getByRole('row', { name: /^83 / })).toContainText('-19,00');
  await expect(page.getByText(/^Fällig am /)).toBeVisible();

  // the value is copied as ELSTER takes it: a comma, no grouping
  await page.getByRole('button', { name: 'Steuer 66 kopieren (19,00)' }).click();
  await expect(page.getByText('Kopiert: 19,00').or(page.getByText('Kopieren nicht möglich'))).toBeVisible();

  // what kontor leaves out is listed
  await expect(page.getByRole('heading', { name: 'Nicht abgedeckt' })).toBeVisible();
  await expect(page.getByText('Anzahlungen: Eine Rechnung zählt erst')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a small business sees that no advance return is needed', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Beta Studio', smallBusiness: true });
  await page.getByRole('button', { name: 'Steuern' }).click();
  await expect(page.getByText('Keine Voranmeldung nötig')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  expect(errors).toEqual([]);
});
