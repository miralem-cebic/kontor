import type { Page } from '@playwright/test';
import { APP_URL, expect, isoToday, readFolders, setUpCompany, test, watchErrors } from './helpers';

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

test('payments: a part payment leaves the rest open, an overpayment is refused, a removal is logged', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await addCustomer(page, 'Kunde GmbH');
  const year = isoToday().slice(0, 4);
  const month = isoToday().slice(0, 7);

  // 8 hours at 95 € net and 19 % VAT: 904,40 € gross
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
  await expect(page.getByRole('heading', { name: `Rechnung RE-${year}-0001` })).toBeVisible();

  const payments = page.locator('section[aria-labelledby="invoice-payments"]');
  // the summary: gross, paid, open
  const [grossFact, paidFact, openFact] = [0, 1, 2].map((i) => payments.locator('dl.facts dd').nth(i));
  await expect(payments.getByText('Noch keine Zahlung erfasst.')).toBeVisible();
  await expect(grossFact).toContainText('904,40');
  await expect(paidFact).toContainText('0,00');
  await expect(openFact).toContainText('904,40');

  // a part payment; the form proposes the open amount, the rest stays open
  await payments.getByRole('button', { name: 'Zahlung erfassen' }).click();
  await expect(page.getByLabel('Betrag')).toHaveValue('904,40');
  await page.getByLabel('Betrag').fill('300');
  await page.getByLabel('Notiz').fill('Anzahlung');
  await page.getByRole('button', { name: 'Zahlung speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Zahlung erfasst' })).toBeVisible();
  await expect(payments.getByText('Teilbezahlt')).toBeVisible();
  await expect(paidFact).toContainText('300,00');
  await expect(openFact).toContainText('604,40');
  await expect(payments.getByRole('row').filter({ hasText: 'Anzahlung' })).toContainText('300,00');

  // more than the open amount is refused and the form stays open
  await payments.getByRole('button', { name: 'Zahlung erfassen' }).click();
  await page.getByLabel('Betrag').fill('604,41');
  await page.getByRole('button', { name: 'Zahlung speichern' }).click();
  await expect(page.getByText('Mehr als der offene Betrag')).toBeVisible();
  await payments.locator('form').getByRole('button', { name: 'Abbrechen' }).click();

  // a removal asks first; afterwards the open amount is what it was before
  await payments.getByRole('row').filter({ hasText: 'Anzahlung' }).getByRole('button', { name: 'Entfernen' }).click();
  const confirm = payments.getByRole('group', { name: /^Zahlung vom .* entfernen\?/ });
  await confirm.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(confirm).toHaveCount(0);
  await payments.getByRole('row').filter({ hasText: 'Anzahlung' }).getByRole('button', { name: 'Entfernen' }).click();
  await page.getByRole('group', { name: /^Zahlung vom .* entfernen\?/ }).getByRole('button', { name: 'Ja, entfernen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Zahlung entfernt' })).toBeVisible();
  await expect(payments.getByText('Noch keine Zahlung erfasst.')).toBeVisible();
  await expect(paidFact).toContainText('0,00');
  await expect(openFact).toContainText('904,40');

  // the list counts the open invoice; the folder holds both payment files and the log tells every step
  await page.getByRole('button', { name: 'Zurück zur Liste' }).first().click();
  const filter = page.getByRole('group', { name: 'Nach Status filtern' });
  await expect(filter.getByRole('button')).toHaveText(['Alle 1', 'Entwürfe 0', 'Ausgestellt 1', 'Offen 1', 'Überfällig 0']);

  // the one recorded payment stays in its file, removed (the refused overpayment was never written)
  const files = await readFolders(page);
  const paymentFiles = Object.entries(files).filter(([f]) => f.startsWith('Ordner-1/payments/'));
  expect(paymentFiles).toHaveLength(1);
  expect(JSON.parse(paymentFiles[0]?.[1] ?? '{}')).toMatchObject({ amount: 30_000, note: 'Anzahlung', deletedAt: expect.any(String) });
  const audit = (files[`Ordner-1/audit/${month}.jsonl`] ?? '').trim().split('\n').map((l) => JSON.parse(l) as { action: string });
  expect(audit.map((a) => a.action)).toEqual(['issue', 'recordPayment', 'deletePayment']);
  expect(errors).toEqual([]);
});
