import type { Page } from '@playwright/test';
import { APP_URL, expect, isoToday, readFolders, setUpCompany, test, watchErrors } from './helpers';

const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name }).click();

const filesIn = async (page: Page, dir: string) => {
  const files = await readFolders(page);
  return Object.entries(files)
    .filter(([path]) => path.startsWith(`Ordner-1/${dir}/`))
    .map(([, text]) => text);
};
const payoutFiles = async (page: Page) => (await filesIn(page, 'payouts')).map((text) => JSON.parse(text) as Record<string, unknown>);

async function addPayer(page: Page, name: string, vatId = '') {
  await nav(page, 'Kontakte');
  await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
  await page.getByLabel('Firmenname').fill(name);
  if (vatId) await page.getByLabel('USt-IdNr.').fill(vatId);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: `„${name}“ gespeichert` })).toBeVisible();
}

test('payouts: checks, the tax treatment is chosen, EU VAT ID of the payer, book, income in the overview, reports and customer account, edit, delete, audit', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await addPayer(page, 'Google Deutschland');
  await addPayer(page, 'Apple Distribution International', 'IE9700053D');

  await nav(page, 'Auszahlungen');
  await expect(page.getByText('Noch keine Auszahlung.')).toBeVisible();
  await page.getByRole('button', { name: 'Neue Auszahlung' }).click();
  await expect(page.getByRole('heading', { name: 'Neue Auszahlung' })).toBeFocused();

  // the payer, the amount and the tax treatment are required: nothing is preselected
  await expect(page.getByLabel('Steuerliche Behandlung')).toHaveValue('');
  await page.getByRole('button', { name: 'Auszahlung speichern' }).click();
  await expect(page.getByText('Bitte ausfüllen.')).toHaveCount(3);

  // a company with regular VAT is not offered the small business treatment
  const treatment = page.getByLabel('Steuerliche Behandlung');
  await expect(treatment.getByRole('option', { name: /Kleinunternehmer/ })).toHaveCount(0);
  await expect(treatment.getByRole('option', { name: /Deutscher Zahler/ })).toHaveCount(1);

  // a treatment in the EU needs the VAT ID of the payer: the first payer has none
  await page.getByLabel('Betrag in €').fill('1.234,56');
  await page.getByLabel(/^Zahler/).selectOption({ label: 'Google Deutschland' });
  await treatment.selectOption({ label: 'Unternehmen in der EU, nicht steuerbar (§ 3a Abs. 2 UStG)' });
  await expect(page.getByText('Prüfe das Dokument.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Auszahlung speichern' }).click();
  await expect(page.getByText(/braucht der Zahler eine gültige USt-IdNr\./)).toBeVisible();
  await page.getByLabel(/^Zahler/).selectOption({ label: 'Apple Distribution International' });
  await expect(page.getByText(/braucht der Zahler eine gültige USt-IdNr\./)).toHaveCount(0);

  // the statement is an https link, nothing else
  await page.getByLabel('Link zur Abrechnung').fill('http://example.com/statement');
  await page.getByRole('button', { name: 'Auszahlung speichern' }).click();
  await expect(page.getByText('Kein gültiger https-Link.')).toBeVisible();
  await page.getByLabel('Link zur Abrechnung').fill('https://reportingitc.apple.com/statement/2026-10');
  await page.getByLabel('Abgedeckter Monat').fill('2026-10');
  await page.getByLabel('Datum des Zahlungseingangs').fill(isoToday());
  await page.getByRole('button', { name: 'Auszahlung speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Auszahlung von „Apple Distribution International“ gespeichert' })).toBeVisible();

  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Apple Distribution International');
  await expect(rows.nth(1)).toContainText('2026-10');
  await expect(rows.nth(1)).toContainText('Unternehmen in der EU, nicht steuerbar');
  await expect(rows.nth(1)).toContainText('1.234,56 €');

  // the file has the amount in cents, the treatment the person chose and no VAT
  await expect.poll(() => payoutFiles(page)).toHaveLength(1);
  const [saved] = await payoutFiles(page);
  expect(saved).toMatchObject({
    amount: 123456,
    taxTreatment: 'euB2bNotTaxable',
    vatRate: 0,
    period: '2026-10',
    statementUrl: 'https://reportingitc.apple.com/statement/2026-10',
    date: isoToday(),
    deletedAt: null,
  });

  // booking is logged
  await expect.poll(async () => (await filesIn(page, 'audit')).join('\n')).toContain('"action":"bookPayout"');

  // the whole amount is income of the year
  await nav(page, 'Übersicht');
  await expect(page.getByRole('region', { name: 'Einnahmen (netto)' })).toContainText('1.234,56');
  await expect(page.getByRole('region', { name: 'Überschuss (Schätzung)' })).toContainText('1.234,56');

  // the income per customer names the payer
  await nav(page, 'Auswertungen');
  await expect(page.getByRole('table').first()).toContainText('Apple Distribution International');

  // the customer account of the payer lists it beside the invoices, without a balance
  await nav(page, 'Kontakte');
  await page.getByRole('button', { name: 'Apple Distribution International', exact: true }).click();
  await page.getByRole('button', { name: 'Kundenkonto' }).click();
  const section = page.getByRole('region', { name: 'Auszahlungen ohne Rechnung' });
  await expect(section).toContainText('1.234,56 €');
  await expect(page.locator('section[aria-labelledby="account-summary"]').locator('dd').nth(2)).toContainText('0,00 €');

  // edit: a German payer with VAT inside the amount; only the net part is income
  await nav(page, 'Auszahlungen');
  await page.getByRole('button', { name: 'Apple Distribution International' }).click();
  await treatment.selectOption({ label: 'Deutscher Zahler, Umsatzsteuer enthalten' });
  await expect(page.getByLabel('Umsatzsteuersatz')).toHaveValue('1900');
  await expect(page.getByText('Darin enthalten: 197,11 € Umsatzsteuer. Als Einnahme zählen 1.037,45 €.')).toBeVisible();
  await page.getByRole('button', { name: 'Auszahlung speichern' }).click();
  await expect(rows.nth(1)).toContainText('1.037,45 €');
  await nav(page, 'Übersicht');
  await expect(page.getByRole('region', { name: 'Einnahmen (netto)' })).toContainText('1.037,45');
  await expect.poll(async () => (await payoutFiles(page))[0]).toMatchObject({ taxTreatment: 'domesticTaxed', vatRate: 1900, amount: 123456 });

  // the platform that collects VAT is a manual treatment with a warning
  await nav(page, 'Auszahlungen');
  await page.getByRole('button', { name: 'Apple Distribution International' }).click();
  await treatment.selectOption({ label: 'Plattform erhebt die Umsatzsteuer (manuell)' });
  await expect(page.getByText(/Wie diese Auszahlung steuerlich zu behandeln ist, ist offen/)).toBeVisible();
  await page.getByRole('button', { name: 'Abbrechen' }).click();

  // delete asks first; the payout no longer counts, and its file stays
  await page.getByRole('button', { name: 'Apple Distribution International' }).click();
  await page.getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('group').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByText('Noch keine Auszahlung.')).toBeVisible();
  await expect.poll(async () => (await payoutFiles(page))[0]?.['deletedAt']).toBeTruthy();
  await expect.poll(async () => (await filesIn(page, 'audit')).join('\n')).toContain('"action":"deletePayout"');
  await nav(page, 'Übersicht');
  await expect(page.getByRole('region', { name: 'Einnahmen (netto)' })).toContainText('0,00');

  // reload: still nothing, and the file is still read
  await page.reload();
  await nav(page, 'Auszahlungen');
  await expect(page.getByText('Noch keine Auszahlung.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('payouts: a small business cannot pick a treatment that has VAT inside, and the list exports as CSV', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Beta Apps', smallBusiness: true });
  await addPayer(page, 'Stripe Payments Europe');
  await nav(page, 'Auszahlungen');
  await page.getByRole('button', { name: 'Neue Auszahlung' }).click();
  const treatment = page.getByLabel('Steuerliche Behandlung');
  await expect(treatment.getByRole('option', { name: /Deutscher Zahler/ })).toHaveCount(0);
  await expect(treatment.getByRole('option', { name: /Kleinunternehmer, ohne Umsatzsteuer/ })).toHaveCount(1);

  await page.getByLabel('Betrag in €').fill('50');
  await page.getByLabel(/^Zahler/).selectOption({ label: 'Stripe Payments Europe' });
  await treatment.selectOption({ label: 'Kleinunternehmer, ohne Umsatzsteuer (§ 19 UStG)' });
  await page.getByRole('button', { name: 'Auszahlung speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Auszahlung von „Stripe Payments Europe“ gespeichert' })).toBeVisible();
  await expect.poll(() => payoutFiles(page)).toHaveLength(1);
  expect((await payoutFiles(page))[0]).toMatchObject({ taxTreatment: 'smallBusiness', amount: 5000, vatRate: 0 });

  // the list as a CSV download
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV exportieren' }).click();
  expect((await download).suggestedFilename()).toMatch(/^kontor-payouts-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(errors).toEqual([]);
});
