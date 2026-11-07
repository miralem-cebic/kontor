import { expect, test, type Page } from '@playwright/test';
import { APP_URL, isoToday, openSettings, setUpCompany, watchErrors } from './helpers';

const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name }).click();
const line = (page: Page, n: number) => page.getByRole('group', { name: `Position ${n}`, exact: true });

async function addCustomer(page: Page, name: string) {
  await nav(page, 'Kontakte');
  await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
  await page.getByLabel('Firmenname').fill(name);
  await page.getByLabel('Straße und Hausnummer').fill('Ringstraße 5');
  await page.getByLabel('PLZ').fill('10115');
  await page.getByRole('textbox', { name: 'Ort', exact: true }).fill('Berlin');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: `„${name}“ gespeichert` })).toBeVisible();
}

/** A draft invoice for the customer with one line of `price` €; `date` (ISO) replaces the invoice date when given */
async function draftInvoice(page: Page, price: string, date?: string) {
  await nav(page, 'Rechnungen');
  await page.getByRole('button', { name: 'Neue Rechnung' }).click();
  await page.getByLabel('Kunde').selectOption({ label: 'Kunde GmbH' });
  await page.getByLabel('Betreff').fill('Beratung');
  if (date) await page.getByLabel('Rechnungsdatum').fill(date);
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await line(page, 1).getByLabel('Bezeichnung').fill('Beratung');
  await line(page, 1).getByLabel('Menge').fill('1');
  await line(page, 1).getByLabel('Einzelpreis €').fill(price);
}

test('the waiver of the small business scheme is explained in the settings before it is chosen', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: true });
  await openSettings(page, 'Steuer');
  const note = page.getByRole('note', { name: 'Verzicht auf die Kleinunternehmerregelung' });
  await expect(note).toContainText('Option zur Regelbesteuerung, § 19 Abs. 3 UStG');
  await expect(note).toContainText('unwiderruflich');
  await expect(note).toContainText('mindestens 5 Kalenderjahre');
  await expect(note).toContainText('letzten Tag des Februars des zweiten Kalenderjahres');
  expect(errors).toEqual([]);
});

test('the overview warns when the 100,000 € limit is crossed, and an invoice dated after it needs VAT', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: true });
  await addCustomer(page, 'Kunde GmbH');
  const today = isoToday();

  // 100,000.01 € without VAT, issued and paid in full today: the limit is crossed today
  await draftInvoice(page, '100000,01');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('button', { name: 'Kunde GmbH' }).filter({ hasText: 'Kunde GmbH' }).last().click();
  await page.getByRole('button', { name: 'Rechnung ausstellen' }).click();
  await page.getByRole('group', { name: /^Rechnung jetzt ausstellen\?/ }).getByRole('button', { name: 'Jetzt ausstellen' }).click();
  await expect(page.getByRole('heading', { name: /^Rechnung RE-/ })).toBeVisible();
  const payments = page.locator('section[aria-labelledby="invoice-payments"]');
  await payments.getByRole('button', { name: 'Zahlung erfassen' }).click();
  await page.getByRole('button', { name: 'Zahlung speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Zahlung erfasst' })).toBeVisible();

  await nav(page, 'Übersicht');
  const warning = page.getByRole('status', { name: 'Kleinunternehmer-Grenzen (zur Orientierung)' });
  await expect(warning).toContainText('Die Umsatzgrenze von 100.000,00 € wurde am');
  await expect(warning).toContainText('Rechnungen ab diesem Tag brauchen Umsatzsteuer');
  await expect(warning).toContainText('Gezählt werden nur die Zahlungen dieser Firma');

  // a new invoice dated today is possible (the day itself is not refused), one dated later is refused with the reason
  await draftInvoice(page, '10', today);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('row').filter({ hasText: 'Entwurf' }).getByRole('button', { name: 'Kunde GmbH' }).click();
  await expect(page.getByText('Alle Angaben für das Ausstellen sind da.')).toBeVisible();
  const tomorrow = new Date(`${today}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  await page.getByLabel('Rechnungsdatum').fill(tomorrow.toISOString().slice(0, 10));
  await expect(page.getByText(/Das Rechnungsdatum liegt nach dem \d\d\.\d\d\.\d{4}\./)).toBeVisible();
  await expect(page.getByText('Alle Angaben für das Ausstellen sind da.')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the overview shows the § 13b banner for a small business with a reverse-charge expense', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: true });
  await nav(page, 'Übersicht');
  await expect(page.getByText('nach § 13b UStG')).toHaveCount(0);

  await page.getByRole('button', { name: 'Ausgaben' }).click();
  await page.getByRole('button', { name: 'Neue Ausgabe' }).click();
  await page.getByLabel('Lieferant').fill('Apple Distribution International');
  await page.getByLabel('Betrag in € (brutto)').fill('99');
  await page.getByLabel('Umsatzsteuer auf dem Beleg').selectOption({ label: 'Lieferant aus der EU (Reverse-Charge)' });
  await page.getByRole('button', { name: 'Ausgabe speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'gespeichert' })).toBeVisible();

  await nav(page, 'Übersicht');
  await expect(page.getByText('schuldest du die Umsatzsteuer selbst (§ 13b UStG)')).toBeVisible();
  await expect(page.getByText('1 Ausgabe(n) mit Umkehr der Steuerschuldnerschaft')).toBeVisible();
  expect(errors).toEqual([]);
});
