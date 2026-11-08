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

test('dunning: an overdue invoice gets the payment reminder with its interest, the claim, and a log entry', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await addCustomer(page, 'Kunde GmbH');
  const year = isoToday().slice(0, 4);
  const month = isoToday().slice(0, 7);

  // an invoice of 1 September 2026 with the default term of 14 days: due on 15 September, overdue today
  await nav(page, 'Rechnungen');
  await page.getByRole('button', { name: 'Neue Rechnung' }).click();
  await page.getByLabel('Kunde').selectOption({ label: 'Kunde GmbH' });
  await page.getByLabel('Rechnungsdatum').fill('2026-09-01');
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

  // the dunning card: nothing issued yet; the preview of the first dunning shows the reminder and its interest
  const dunning = page.locator('section[aria-labelledby="invoice-dunning"]');
  await expect(dunning.getByText('Noch keine Mahnung.')).toBeVisible();
  await dunning.getByRole('button', { name: 'Mahnung erstellen' }).click();
  await expect(dunning.locator('dl').getByText('Zahlungserinnerung')).toBeVisible();
  await expect(dunning.locator('dl').getByText('Verzugszinsen seit dem')).toBeVisible();
  await expect(dunning.getByText('Pauschale (§ 288 Abs. 5 BGB)')).toBeVisible();

  // saving records it; the table shows the level, the interest and the flat fee
  await dunning.locator('form').getByRole('button', { name: 'Mahnung speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Mahnung erstellt' })).toBeVisible();
  const table = dunning.getByRole('table');
  await expect(table.getByText('Zahlungserinnerung')).toBeVisible();
  await expect(table.getByRole('row').nth(1)).toContainText('40,00');

  // the folder holds the dunning and the log tells it
  const files = await readFolders(page);
  expect(Object.keys(files).filter((f) => f.startsWith('Ordner-1/dunnings/'))).toHaveLength(1);
  const audit = (files[`Ordner-1/audit/${month}.jsonl`] ?? '').trim().split('\n').map((l) => JSON.parse(l) as { action: string });
  expect(audit.map((a) => a.action)).toEqual(['issue', 'dunning']);
  expect(errors).toEqual([]);
});
