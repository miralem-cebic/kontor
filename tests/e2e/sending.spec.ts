import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { APP_URL, expect, isoToday, readFolders, setUpCompany, test, watchErrors } from './helpers';

const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name }).click();
const line = (page: Page, n: number) => page.getByRole('group', { name: `Position ${n}`, exact: true });

async function addCustomer(page: Page, name: string, email: string) {
  await nav(page, 'Kontakte');
  await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
  await page.getByLabel('Firmenname').fill(name);
  await page.getByLabel('Straße und Hausnummer').fill('Ringstraße 5');
  await page.getByLabel('PLZ').fill('10115');
  await page.getByRole('textbox', { name: 'Ort', exact: true }).fill('Berlin');
  await page.getByLabel('E-Mail für Rechnungen').fill(email);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: `„${name}“ gespeichert` })).toBeVisible();
}

/** The lines of the audit log of a month, as the folder holds them */
async function auditOf(page: Page, month: string): Promise<{ action: string; files: unknown[]; send?: Record<string, unknown> }[]> {
  const files = await readFolders(page);
  return (files[`Ordner-1/audit/${month}.jsonl`] ?? '')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { action: string; files: unknown[]; send?: Record<string, unknown> });
}

test('sending: an invoice and a dunning go out as mail files with their PDF attached, and each mail is logged', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await addCustomer(page, 'Kunde GmbH', 'einkauf@kunde.example');
  const month = isoToday().slice(0, 7);

  // an invoice of 1 September 2026 with the default term of 14 days: due on 15 September, so overdue today
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
  await expect(page.getByRole('heading', { name: 'Rechnung RE-2026-0001' })).toBeVisible();

  // the mail of the invoice: the form is filled in from the invoice, the file is a draft with the PDF attached
  const sendCard = page.locator('section[aria-labelledby="send-section"]');
  await sendCard.getByRole('button', { name: 'E-Mail vorbereiten' }).click();
  await expect(page.getByLabel('Empfänger')).toHaveValue('einkauf@kunde.example');
  await expect(page.getByLabel('Betreff')).toHaveValue('Rechnung RE-2026-0001');
  await expect(page.locator('.send-form textarea')).toHaveValue(/RE-2026-0001 vom 01\.09\.2026 über .+\s€\./);
  const [eml] = await Promise.all([page.waitForEvent('download'), sendCard.getByRole('button', { name: 'E-Mail-Datei erstellen' }).click()]);
  expect(eml.suggestedFilename()).toBe('Rechnung_RE-2026-0001_Kunde-GmbH.eml');
  const mail = readFileSync(await eml.path(), 'utf8');
  expect(mail.startsWith('X-Unsent: 1\r\n')).toBe(true);
  expect(mail).toContain('To: einkauf@kunde.example\r\n');
  expect(mail).toContain('Content-Type: application/pdf; name="Rechnung_RE-2026-0001_Kunde-GmbH.pdf"');
  await expect(page.getByRole('status').filter({ hasText: 'E-Mail-Datei Rechnung_RE-2026-0001_Kunde-GmbH.eml erstellt' })).toBeVisible();

  // the dunning: its letter is a mail of its own, and the table row opens its form
  const dunning = page.locator('section[aria-labelledby="invoice-dunning"]');
  await dunning.getByRole('button', { name: 'Mahnung erstellen' }).click();
  await dunning.locator('form').getByRole('button', { name: 'Mahnung speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Mahnung erstellt' })).toBeVisible();
  await dunning.getByRole('button', { name: 'E-Mail zu Zahlungserinnerung vorbereiten' }).click();
  await expect(dunning.getByLabel('Betreff')).toHaveValue('Zahlungserinnerung zu Rechnung RE-2026-0001');
  const [letter] = await Promise.all([page.waitForEvent('download'), dunning.getByRole('button', { name: 'E-Mail-Datei erstellen' }).click()]);
  expect(letter.suggestedFilename()).toBe('Zahlungserinnerung_RE-2026-0001_Kunde-GmbH.eml');
  expect(readFileSync(await letter.path(), 'utf8')).toContain('name="Zahlungserinnerung_RE-2026-0001_Kunde-GmbH.pdf"');

  // the mail program: the PDF is downloaded to be attached, and the link opens a new mail with the text
  await sendCard.getByRole('button', { name: 'E-Mail vorbereiten' }).click();
  const [pdf] = await Promise.all([page.waitForEvent('download'), sendCard.getByRole('button', { name: 'Im Mailprogramm öffnen' }).click()]);
  expect(pdf.suggestedFilename()).toBe('Rechnung_RE-2026-0001_Kunde-GmbH.pdf');
  await expect(page.getByRole('status').filter({ hasText: 'Mailprogramm geöffnet' })).toBeVisible();

  // the folder: the invoice and the letter are logged as prepared, each with the file it attached
  const audit = await auditOf(page, month);
  expect(audit.map((a) => a.action)).toEqual(['issue', 'send', 'dunning', 'send', 'send']);
  expect(audit[1]).toMatchObject({ send: { kind: 'invoice', channel: 'eml', to: 'einkauf@kunde.example', dunningId: null } });
  expect(audit[1]?.files).toEqual(audit[0]?.files);
  expect(audit[3]).toMatchObject({ send: { kind: 'dunning', channel: 'eml' } });
  expect(audit[3]?.send?.['dunningId']).toEqual(expect.any(String));
  expect(audit[3]?.files).toEqual([]);
  expect(audit[4]).toMatchObject({ send: { kind: 'invoice', channel: 'mailto' } });
  expect(errors).toEqual([]);
});
