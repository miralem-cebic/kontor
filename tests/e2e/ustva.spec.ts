import { APP_URL, expect, setUpCompany, test, watchErrors } from './helpers';

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
  // the page holds two sections with the same period fields; this test is about the first
  const section = page.getByRole('region', { name: 'Umsatzsteuer-Voranmeldung' });
  await expect(section.getByRole('heading', { name: 'Umsatzsteuer-Voranmeldung' })).toBeVisible();
  await expect(section.getByText('Ausfüllhilfe und Schätzung, keine Steuerberatung')).toBeVisible();

  // the expense is in the current month, not in the last one that is over
  const now = new Date();
  await section.getByLabel('Art', { exact: true }).selectOption('month');
  await section.getByLabel('Jahr', { exact: true }).selectOption(String(now.getFullYear()));
  await section.getByLabel('Monat', { exact: true }).selectOption(String(now.getMonth() + 1));
  const input = section.getByRole('row', { name: /^66 / });
  await expect(input).toContainText('19,00');
  await expect(section.getByRole('row', { name: /^83 / })).toContainText('-19,00');
  await expect(section.getByText(/^Fällig am /)).toBeVisible();

  // the value is copied as ELSTER takes it: a comma, no grouping
  await page.getByRole('button', { name: 'Steuer 66 kopieren (19,00)' }).click();
  await expect(page.getByText('Kopiert: 19,00').or(page.getByText('Kopieren nicht möglich'))).toBeVisible();

  // what kontor leaves out is listed
  await expect(section.getByRole('heading', { name: 'Nicht abgedeckt' })).toBeVisible();
  await expect(section.getByText('Anzahlungen: Eine Rechnung zählt erst')).toBeVisible();
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

test('the summary report (ZM): the period, the due date without extension, nothing to report, the link to the BZSt portal, what is not covered', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await page.getByRole('button', { name: 'Steuern' }).click();

  const section = page.getByRole('region', { name: /^Zusammenfassende Meldung/ });
  await expect(section.getByRole('heading', { name: /^Zusammenfassende Meldung/ })).toBeVisible();
  await expect(section.getByText('Ausfüllhilfe, keine Steuerberatung')).toBeVisible();
  await expect(section.getByText(/^Fällig am /)).toBeVisible();
  // no invoices: nothing to report and no table
  await expect(section.getByText('keine Zusammenfassende Meldung nötig', { exact: false })).toBeVisible();
  await expect(section.getByRole('table')).toHaveCount(0);

  // the link goes to the portal of the BZSt, in a new window
  const link = section.getByRole('link', { name: /BZSt-Online-Portal/ });
  await expect(link).toHaveAttribute('href', 'https://online.portal.bzst.de');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);

  // months are possible too
  await section.getByLabel('Art', { exact: true }).selectOption('month');
  await expect(section.getByText(/^Fällig am /)).toBeVisible();
  await expect(section.getByRole('heading', { name: 'Nicht abgedeckt' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a small business sees that no summary report is needed', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Beta Studio', smallBusiness: true });
  await page.getByRole('button', { name: 'Steuern' }).click();
  await expect(page.getByText('Keine Zusammenfassende Meldung nötig')).toBeVisible();
  expect(errors).toEqual([]);
});

test('reverse charge (#34): the 99 € fee of an EU supplier is owed and deducted (46/47, 67), with the booking behind the number', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });

  await page.getByRole('button', { name: 'Ausgaben' }).click();
  await page.getByRole('button', { name: 'Neue Ausgabe' }).click();
  await page.getByLabel('Lieferant').fill('Apple Distribution International');
  await page.getByLabel('Betrag in € (brutto)').fill('99');
  await page.getByLabel('Umsatzsteuer auf dem Beleg').selectOption({ label: 'Lieferant aus der EU (Reverse-Charge)' });
  await page.getByRole('button', { name: 'Ausgabe speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'gespeichert' })).toBeVisible();

  await page.getByRole('button', { name: 'Steuern' }).click();
  const section = page.getByRole('region', { name: 'Umsatzsteuer-Voranmeldung' });
  const now = new Date();
  await section.getByLabel('Art', { exact: true }).selectOption('month');
  await section.getByLabel('Jahr', { exact: true }).selectOption(String(now.getFullYear()));
  await section.getByLabel('Monat', { exact: true }).selectOption(String(now.getMonth() + 1));

  // line 30 of the form: base 46, tax 47; the same tax as input tax in 67; nothing left to pay
  const owed = section.getByRole('row', { name: /^46 \/ 47 / });
  await expect(owed).toContainText('99,00');
  await expect(owed).toContainText('18,81');
  await expect(section.getByRole('row', { name: /^67 / })).toContainText('18,81');
  await expect(section.getByRole('row', { name: /^83 / })).toContainText('0,00');
  await expect(owed.getByRole('button', { name: 'Steuer 47 kopieren (18,81)' })).toBeVisible();

  // the booking behind the number
  await owed.getByText('Buchungen dahinter (1)').click();
  await expect(owed.getByText('Ausgabe Apple Distribution International')).toBeVisible();
  expect(errors).toEqual([]);
});

test('reverse charge (#34): a small business gets a return only for that tax, without input tax', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Beta Studio', smallBusiness: true });

  await page.getByRole('button', { name: 'Ausgaben' }).click();
  await page.getByRole('button', { name: 'Neue Ausgabe' }).click();
  await page.getByLabel('Lieferant').fill('Apple Distribution International');
  await page.getByLabel('Betrag in € (brutto)').fill('99');
  await page.getByLabel('Umsatzsteuer auf dem Beleg').selectOption({ label: 'Lieferant aus der EU (Reverse-Charge)' });
  await page.getByRole('button', { name: 'Ausgabe speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'gespeichert' })).toBeVisible();

  await page.getByRole('button', { name: 'Steuern' }).click();
  const section = page.getByRole('region', { name: 'Umsatzsteuer-Voranmeldung' });
  const now = new Date();
  await section.getByLabel('Art', { exact: true }).selectOption('month');
  await section.getByLabel('Jahr', { exact: true }).selectOption(String(now.getFullYear()));
  await section.getByLabel('Monat', { exact: true }).selectOption(String(now.getMonth() + 1));

  await expect(section.getByText('Voranmeldung nur für die Steuer nach § 13b UStG')).toBeVisible();
  await expect(section.getByRole('row', { name: /^46 \/ 47 / })).toContainText('18,81');
  await expect(section.getByRole('row', { name: /^83 / })).toContainText('18,81');
  // no supplies and no input tax on this return
  await expect(section.getByRole('row', { name: /^81 / })).toHaveCount(0);
  await expect(section.getByRole('row', { name: /^66 / })).toHaveCount(0);
  await expect(section.getByRole('row', { name: /^67 / })).toHaveCount(0);

  // a period without such an expense: the small business note
  await section.getByLabel('Monat', { exact: true }).selectOption(String(((now.getMonth() + 1) % 12) + 1));
  await expect(section.getByText('Keine Voranmeldung nötig')).toBeVisible();
  expect(errors).toEqual([]);
});
