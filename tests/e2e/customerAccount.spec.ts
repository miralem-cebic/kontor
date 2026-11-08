import type { Page } from '@playwright/test';
import { APP_URL, expect, setUpCompany, test, watchErrors } from './helpers';

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

/** Opens the customer account of a customer from the contacts list */
async function openAccount(page: Page, name: string) {
  await nav(page, 'Kontakte');
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Kundenkonto' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('customer account: invoice, part payment, balance; a cancellation leaves a credit to refund', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await addCustomer(page, 'Kunde GmbH');
  const summary = page.locator('section[aria-labelledby="account-summary"]');
  const facts = summary.locator('dd');

  // 8 hours at 95 € net and 19 % VAT: 904,40 € gross; a part payment of 300 €
  await nav(page, 'Rechnungen');
  await page.getByRole('button', { name: 'Neue Rechnung' }).click();
  await page.getByLabel('Kunde').selectOption({ label: 'Kunde GmbH' });
  await page.getByLabel('Betreff').fill('Beratung');
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await line(page, 1).getByLabel('Bezeichnung').fill('Beratung');
  await line(page, 1).getByLabel('Menge').fill('8');
  await line(page, 1).getByLabel('Einzelpreis netto €').fill('95');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('button', { name: 'Kunde GmbH' }).filter({ hasText: 'Kunde GmbH' }).last().click();
  await page.getByRole('button', { name: 'Rechnung ausstellen' }).click();
  await page.getByRole('group', { name: /^Rechnung jetzt ausstellen\?/ }).getByRole('button', { name: 'Jetzt ausstellen' }).click();
  await expect(page.getByRole('heading', { name: /^Rechnung RE-\d{4}-0001$/ })).toBeVisible();
  const payments = page.locator('section[aria-labelledby="invoice-payments"]');
  await payments.getByRole('button', { name: 'Zahlung erfassen' }).click();
  await page.getByLabel('Betrag').fill('300');
  await page.getByRole('button', { name: 'Zahlung speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Zahlung erfasst' })).toBeVisible();

  // the account: owed 604,40 €, nothing overdue (due in 14 days), the invoice and the payment in date order
  await openAccount(page, 'Kunde GmbH');
  await expect(facts.nth(0)).toContainText('904,40');
  await expect(facts.nth(1)).toContainText('300,00');
  await expect(facts.nth(2)).toContainText('604,40');
  await expect(facts.nth(3)).toContainText('0,00');
  await expect(summary.getByText('Der Kunde schuldet')).toBeVisible();
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText('Rechnung');
  await expect(rows.nth(1)).toContainText('904,40');
  await expect(rows.nth(2)).toContainText('Zahlung');
  await expect(rows.nth(2)).toContainText('604,40');

  // the invoice is cancelled: the customer is credited with the 300 € paid, which is to be refunded
  await page.getByRole('button', { name: 'Zurück zum Kontakt' }).click();
  await page.getByRole('button', { name: 'Zurück zur Liste' }).click();
  await nav(page, 'Rechnungen');
  await page.getByRole('button', { name: 'Kunde GmbH' }).filter({ hasText: 'Kunde GmbH' }).last().click();
  await page.getByRole('button', { name: 'Stornieren' }).click();
  await page.getByRole('group', { name: /stornieren\?/ }).getByRole('button', { name: 'Jetzt stornieren' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'storniert' })).toBeVisible();

  await openAccount(page, 'Kunde GmbH');
  await expect(facts.nth(0)).toContainText('0,00');
  await expect(facts.nth(2)).toContainText('-300,00');
  await expect(summary.getByText('Guthaben für den Kunden')).toBeVisible();
  await expect(page.getByRole('table').getByRole('row').filter({ hasText: 'Stornorechnung' })).toHaveCount(1);
  expect(errors).toEqual([]);
});
