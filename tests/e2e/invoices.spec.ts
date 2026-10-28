import { PDFDocument } from '@cantoo/pdf-lib';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { APP_URL, isoToday, readFolders, setUpCompany, watchErrors } from './helpers';

const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name }).click();
const line = (page: Page, n: number) => page.getByRole('group', { name: `Position ${n}`, exact: true });
const issueList = (page: Page) => page.getByRole('list', { name: 'Vor dem Ausstellen noch zu tun:' });

interface ContactInput {
  name: string;
  address?: boolean;
  paymentTerm?: string;
  orderReference?: string;
}

async function addCustomer(page: Page, c: ContactInput) {
  await nav(page, 'Kontakte');
  await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
  await page.getByLabel('Firmenname').fill(c.name);
  if (c.address) {
    await page.getByLabel('Straße und Hausnummer').fill('Ringstraße 5');
    await page.getByLabel('PLZ').fill('10115');
    await page.getByRole('textbox', { name: 'Ort', exact: true }).fill('Berlin');
  }
  if (c.orderReference) await page.getByLabel('Bestell- bzw. PO-Nummer').fill(c.orderReference);
  if (c.paymentTerm) await page.getByLabel('Zahlungsziel in Tagen').fill(c.paymentTerm);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: `„${c.name}“ gespeichert` })).toBeVisible();
}

async function addItem(page: Page) {
  await nav(page, 'Artikel & Leistungen');
  await page.getByRole('button', { name: 'Neuer Artikel' }).click();
  await page.getByLabel('Bezeichnung').fill('Webdesign');
  await page.getByLabel('Einheit').selectOption({ label: 'Stunde' });
  await page.getByLabel(/^(Netto)?[Pp]reis in €/).fill('85');
  await page.getByRole('button', { name: 'Speichern' }).click();
}

/** The local day `days` days after today, as YYYY-MM-DD */
const daysFromToday = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const german = (iso: string) => iso.split('-').reverse().join('.');

async function readDocuments(page: Page) {
  const files = await readFolders(page);
  return Object.entries(files)
    .filter(([path]) => /^Ordner-1\/documents\/[^/]+\.json$/.test(path))
    .map(([, text]) => JSON.parse(text) as Record<string, unknown>);
}

test('invoices: defaults from the customer, period of service, tax treatment, payment, checks, edit, delete and reload', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await addCustomer(page, { name: 'Kunde GmbH', address: true, paymentTerm: '30', orderReference: 'PO-4711' });
  await addItem(page);

  await nav(page, 'Rechnungen');
  await expect(page.getByRole('note')).toContainText('Entwürfe lassen sich ändern und löschen.');
  await expect(page.getByText('Noch keine Rechnungen.')).toBeVisible();
  await page.getByRole('button', { name: 'Neue Rechnung' }).click();
  await expect(page.getByRole('heading', { name: 'Neue Rechnung' })).toBeFocused();
  await expect(page.getByLabel('Rechnungsdatum')).toHaveValue(isoToday());
  await expect(page.getByLabel('Leistungsdatum')).toHaveValue(isoToday());
  // the company default until a customer is chosen, then the customer's term and order number
  await expect(page.getByLabel('Zahlungsziel in Tagen')).toHaveValue('14');
  await expect(page.getByText(`Fällig am ${german(daysFromToday(14))}`)).toBeVisible();
  await expect(page.getByLabel('Zahlung auf')).toContainText('Bankkonto · DE89 3704 0044 0532 0130 00');
  await expect(issueList(page)).toContainText('Wähle einen Kunden.');
  await page.getByLabel('Kunde').selectOption({ label: 'Kunde GmbH' });
  await expect(page.getByLabel('Zahlungsziel in Tagen')).toHaveValue('30');
  await expect(page.getByText(`Fällig am ${german(daysFromToday(30))}`)).toBeVisible();
  await expect(page.getByLabel('Bestell- bzw. PO-Nummer')).toHaveValue('PO-4711');
  await page.getByLabel('Betreff').fill('Website-Relaunch');

  // a period of service: both days are required, the end not before the start
  await page.getByRole('radio', { name: 'In einem Zeitraum' }).check();
  await expect(page.getByLabel('Leistungsdatum')).toHaveCount(0);
  await page.getByLabel('Leistung vom').fill('2026-10-31');
  await page.getByLabel('Leistung bis').fill('2026-10-01');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Darf nicht vor dem Beginn des Zeitraums liegen.')).toBeVisible();
  await expect(page.getByLabel('Leistung bis')).toBeFocused();
  await page.getByLabel('Leistung vom').fill('2026-10-01');
  await page.getByLabel('Leistung bis').fill('2026-10-31');
  await expect(page.getByText('Darf nicht vor dem Beginn des Zeitraums liegen.')).toHaveCount(0);

  // lines with VAT
  await expect(issueList(page)).toHaveText(/Füge mindestens eine Position hinzu\./);
  await page.getByRole('button', { name: 'Aus dem Katalog' }).click();
  await page.getByRole('region', { name: 'Artikel aus dem Katalog' }).getByRole('button', { name: /^Webdesign/ }).click();
  await line(page, 1).getByLabel('Menge').fill('10');
  const totals = page.getByLabel('Summen');
  await expect(totals).toContainText('Umsatzsteuer 19 %161,50 €');
  await expect(totals).toContainText('Gesamtbetrag1.011,50 €');
  await expect(page.getByText('Alle Angaben für das Ausstellen sind da.')).toBeVisible();

  // reverse charge: no VAT, the note instead; an intra-community supply needs both VAT IDs
  await page.getByRole('radio', { name: 'Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG)' }).check();
  await expect(totals).toHaveText('Gesamtbetrag850,00 €');
  await expect(page.locator('.totals-box')).toContainText('Steuerschuldnerschaft des Leistungsempfängers');
  await expect(line(page, 1).getByLabel('USt.')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Steuerfreie innergemeinschaftliche Lieferung' }).check();
  await expect(issueList(page)).toContainText('Trage beim Kunden seine USt-IdNr. aus dem anderen EU-Staat ein');
  await expect(issueList(page)).toContainText('Trage in den Einstellungen deine eigene USt-IdNr. ein');
  // not taxable in Germany: no VAT and the note; a customer in Germany gets a hint
  await page.getByRole('radio', { name: 'Nicht im Inland steuerbar' }).check();
  await expect(totals).toHaveText('Gesamtbetrag850,00 €');
  await expect(page.locator('.totals-box')).toContainText('Nicht im Inland steuerbare Leistung (Leistungsort im Ausland, § 3a UStG)');
  await expect(page.getByText('Der Kunde sitzt in Deutschland. Leistungen an ihn sind in der Regel im Inland steuerbar.')).toBeVisible();
  await expect(page.getByText('Alle Angaben für das Ausstellen sind da.')).toBeVisible();
  await page.getByRole('radio', { name: 'Mit Umsatzsteuer' }).check();
  await expect(page.getByText('Der Kunde sitzt in Deutschland.', { exact: false })).toHaveCount(0);
  await expect(totals).toContainText('Gesamtbetrag1.011,50 €');

  // the side panel lists the sections
  const sections = page.getByRole('navigation', { name: 'Abschnitte der Rechnung' });
  await expect(sections.getByRole('button')).toHaveText(['Rechnung', 'Positionen', 'Steuer', 'Zahlung', 'Schlusstext', 'Ausstellen']);

  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rechnungsentwurf für „Kunde GmbH“ gespeichert' })).toBeVisible();
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Entwurf');
  await expect(rows.nth(1)).toContainText('Kunde GmbH');
  await expect(rows.nth(1)).toContainText('Website-Relaunch');
  await expect(rows.nth(1)).toContainText(german(daysFromToday(30)));
  await expect(rows.nth(1)).toContainText('1.011,50 €');

  const [file] = await readDocuments(page);
  expect(file).toMatchObject({
    schemaVersion: 6,
    kind: 'invoice',
    quoteId: null,
    date: isoToday(),
    service: { kind: 'period', start: '2026-10-01', end: '2026-10-31' },
    paymentTermDays: 30,
    taxTreatment: 'standard',
    orderReference: 'PO-4711',
    leitwegId: '',
    subject: 'Website-Relaunch',
    accountId: expect.any(String),
    issued: null,
    cancels: null,
    lines: [{ name: 'Webdesign', description: '', quantity: 10000, unit: 'HUR', unitPrice: 8500, vatRate: 1900 }],
    deletedAt: null,
  });

  // after a reload: open, change, save
  await page.reload();
  await nav(page, 'Rechnungen');
  await page.getByRole('button', { name: 'Kunde GmbH' }).click();
  await expect(page.getByRole('heading', { name: 'Kunde GmbH · Website-Relaunch' })).toBeVisible();
  await expect(page.getByLabel('Leistung vom')).toHaveValue('2026-10-01');
  await page.getByLabel('Zahlungsziel in Tagen').fill('400');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Bitte eine ganze Zahl von 0 bis 365 eingeben.')).toBeVisible();
  await page.getByLabel('Zahlungsziel in Tagen').fill('7');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(rows.nth(1)).toContainText(german(daysFromToday(7)));

  // the PDF of the draft: changes not saved yet are saved first, then the file is downloaded
  await page.getByRole('button', { name: 'Kunde GmbH' }).click();
  await page.getByLabel('Betreff').fill('Website-Relaunch Oktober');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF herunterladen' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`Rechnungsentwurf_${isoToday()}_Kunde-GmbH.pdf`);
  await expect(page.getByRole('status').filter({ hasText: `PDF „Rechnungsentwurf_${isoToday()}_Kunde-GmbH.pdf“ heruntergeladen` })).toBeVisible();
  const pdf = await PDFDocument.load(await readFile((await download.path()) ?? ''), { updateMetadata: false });
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getTitle()).toBe(`Rechnungsentwurf – Kunde GmbH – ${german(isoToday())}`);
  expect(pdf.getSubject()).toBe('Website-Relaunch Oktober');
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(rows.nth(1)).toContainText('Website-Relaunch Oktober');

  // delete after asking; the file stays
  await page.getByRole('button', { name: 'Kunde GmbH' }).click();
  await page.getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('group', { name: /^Rechnungsentwurf löschen\?/ }).getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rechnungsentwurf für „Kunde GmbH“ gelöscht' })).toBeVisible();
  await expect(page.getByText('Noch keine Rechnungen.')).toBeVisible();
  expect((await readDocuments(page))[0]?.['deletedAt']).toEqual(expect.any(String));
  expect(errors).toEqual([]);
});

test('a quote becomes an invoice; a small business invoices without VAT, without the address only up to 250 €', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Klein Design' });
  await addCustomer(page, { name: 'Kunde GmbH' });

  await nav(page, 'Angebote');
  await page.getByRole('button', { name: 'Neues Angebot' }).click();
  await expect(page.getByRole('button', { name: 'Rechnung erstellen' })).toHaveCount(0);
  await page.getByLabel('Kunde').selectOption({ label: 'Kunde GmbH' });
  await page.getByLabel('Betreff').fill('Beratung');
  await page.getByRole('textbox', { name: 'Schlusstext' }).fill('Das Angebot gilt 30 Tage.');
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await line(page, 1).getByLabel('Bezeichnung').fill('Beratung');
  await line(page, 1).getByLabel('Menge').fill('3');
  await line(page, 1).getByLabel('Einzelpreis €').fill('60');
  await page.getByRole('button', { name: 'Speichern' }).click();

  // a change that is not saved yet is saved before the invoice is made
  await page.getByRole('button', { name: 'Kunde GmbH' }).click();
  await line(page, 1).getByLabel('Menge').fill('4');
  await page.getByRole('button', { name: 'Rechnung erstellen' }).click();
  await expect(page.getByRole('heading', { name: 'Neue Rechnung' })).toBeFocused();
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Rechnungen' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText(/^Erstellt aus dem Angebot vom \d\d\.\d\d\.\d{4} \(Beratung\)\.$/)).toBeVisible();
  await expect(page.getByLabel('Kunde')).toHaveValue(/.+/);
  await expect(page.getByLabel('Kunde').locator('option:checked')).toHaveText('Kunde GmbH');
  await expect(page.getByLabel('Betreff')).toHaveValue('Beratung');
  await expect(page.getByRole('textbox', { name: 'Schlusstext' })).toHaveValue('');
  await expect(line(page, 1).getByLabel('Menge')).toHaveValue('4');

  // a small business: no tax section, the note on § 19 UStG; up to 250 € the address of the customer is not needed
  await expect(page.getByRole('navigation', { name: 'Abschnitte der Rechnung' }).getByRole('button', { name: 'Steuer' })).toHaveCount(0);
  await expect(page.getByLabel('Summen')).toHaveText('Gesamtbetrag240,00 €');
  await expect(page.getByText('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.')).toBeVisible();
  await expect(page.getByText('Alle Angaben für das Ausstellen sind da.')).toBeVisible();
  await line(page, 1).getByLabel('Menge').fill('5');
  await expect(issueList(page)).toContainText('Trage beim Kunden die Anschrift ein.');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rechnungsentwurf für „Kunde GmbH“ gespeichert' })).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);

  // the quote keeps its saved change and stays in its own list; the invoice refers to it
  await nav(page, 'Angebote');
  const quoteRows = page.getByRole('table').getByRole('row');
  await expect(quoteRows).toHaveCount(2);
  await expect(quoteRows.nth(1)).toContainText('240,00 €');
  const documents = await readDocuments(page);
  const quote = documents.find((d) => d['kind'] === 'quote');
  const invoice = documents.find((d) => d['kind'] === 'invoice');
  expect(invoice).toMatchObject({ quoteId: quote?.['id'], customerId: quote?.['customerId'], subject: 'Beratung', closingText: '', taxTreatment: 'standard' });
  expect(errors).toEqual([]);
});

test('issuing: the next number, the PDF in the folder, the audit entry, and no change afterwards', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await addCustomer(page, { name: 'Kunde GmbH', address: true });
  const year = isoToday().slice(0, 4);
  const rows = page.getByRole('table').getByRole('row');

  async function newInvoice(subject: string) {
    await nav(page, 'Rechnungen');
    await page.getByRole('button', { name: 'Neue Rechnung' }).click();
    await page.getByLabel('Kunde').selectOption({ label: 'Kunde GmbH' });
    await page.getByLabel('Betreff').fill(subject);
    // a new draft is saved before it can be issued
    await expect(page.getByText('Speichere den Entwurf, um ihn auszustellen.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Freie Position' }).click();
    await line(page, 1).getByLabel('Bezeichnung').fill('Beratung');
    await line(page, 1).getByLabel('Menge').fill('8');
    await line(page, 1).getByLabel('Einzelpreis netto €').fill('95');
    await expect(page.getByText('Speichere den Entwurf, um ihn auszustellen.')).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await page.getByRole('button', { name: 'Kunde GmbH' }).filter({ hasText: 'Kunde GmbH' }).last().click();
  }

  await newInvoice('Oktober');
  // a change not saved yet is saved before issuing; issuing asks first
  await page.getByLabel('Betreff').fill('Beratung Oktober');
  await page.getByRole('button', { name: 'Rechnung ausstellen' }).click();
  const confirm = page.getByRole('group', { name: /^Rechnung jetzt ausstellen\?/ });
  await confirm.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole('button', { name: 'Rechnung ausstellen' }).click();
  await confirm.getByRole('button', { name: 'Jetzt ausstellen' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Rechnung RE-${year}-0001 ausgestellt` })).toBeVisible();

  // read-only: the number, the master data of the time, no saving or deleting
  await expect(page.getByRole('heading', { name: `Rechnung RE-${year}-0001` })).toBeVisible();
  await expect(page.getByText(`documents/issued/RE-${year}-0001.pdf`)).toBeVisible();
  await expect(page.getByText('Beratung Oktober')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Speichern' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Löschen' })).toHaveCount(0);

  // the PDF is the file in the folder, with the number and without the draft mark
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF herunterladen' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`Rechnung_RE-${year}-0001_Kunde-GmbH.pdf`);
  const pdf = await PDFDocument.load(await readFile((await download.path()) ?? ''), { updateMetadata: false });
  expect(pdf.getTitle()).toBe(`Rechnung – RE-${year}-0001 – Kunde GmbH – ${german(isoToday())}`);

  const files = await readFolders(page);
  expect(Object.keys(files)).toContain(`Ordner-1/documents/issued/RE-${year}-0001.pdf`);
  const range = JSON.parse(files['Ordner-1/numbering/invoice.json'] ?? '{}') as { counters: unknown[]; reservations: { number: string }[] };
  expect(range.counters).toEqual([{ key: year, last: 1 }]);
  expect(range.reservations.map((r) => r.number)).toEqual([`RE-${year}-0001`]);
  const audit = (files[`Ordner-1/audit/${isoToday().slice(0, 7)}.jsonl`] ?? '').trim().split('\n');
  expect(audit.map((l) => (JSON.parse(l) as { action: string; number: string }).number)).toEqual([`RE-${year}-0001`]);
  const [issued] = (await readDocuments(page)).filter((d) => (d['issued'] as { number?: string } | null)?.number);
  expect(issued).toMatchObject({ subject: 'Beratung Oktober', issued: { number: `RE-${year}-0001`, pdf: { file: `RE-${year}-0001.pdf` } } });

  // the list shows the number; the next invoice gets the next number
  await page.getByRole('button', { name: 'Zurück zur Liste' }).first().click();
  await expect(rows.nth(1)).toContainText(`RE-${year}-0001`);
  await newInvoice('November');
  await page.getByRole('button', { name: 'Rechnung ausstellen' }).click();
  await page.getByRole('group', { name: /^Rechnung jetzt ausstellen\?/ }).getByRole('button', { name: 'Jetzt ausstellen' }).click();
  await expect(page.getByRole('heading', { name: `Rechnung RE-${year}-0002` })).toBeVisible();

  // after a reload the invoices are still issued; the filter tells drafts from issued ones
  await page.reload();
  await nav(page, 'Rechnungen');
  const filter = page.getByRole('group', { name: 'Nach Status filtern' });
  await expect(filter.getByRole('button')).toHaveText(['Alle 2', 'Entwürfe 0', 'Ausgestellt 2']);
  await page.getByRole('searchbox').fill(`RE-${year}-0002`);
  await expect(rows).toHaveCount(2);
  await rows.nth(1).getByRole('button', { name: 'Kunde GmbH' }).click();
  await expect(page.getByRole('heading', { name: `Rechnung RE-${year}-0002` })).toBeVisible();
  expect(errors).toEqual([]);
});

test('cancelling: a cancellation invoice with the next number, its PDF and audit entry, and a copy for the corrected invoice', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await addCustomer(page, { name: 'Kunde GmbH', address: true });
  const year = isoToday().slice(0, 4);
  const today = german(isoToday());
  const [first, second] = [`RE-${year}-0001`, `RE-${year}-0002`];
  const rows = page.getByRole('table').getByRole('row');

  await nav(page, 'Rechnungen');
  await page.getByRole('button', { name: 'Neue Rechnung' }).click();
  await page.getByLabel('Kunde').selectOption({ label: 'Kunde GmbH' });
  await page.getByLabel('Betreff').fill('Beratung');
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await line(page, 1).getByLabel('Bezeichnung').fill('Beratung');
  await line(page, 1).getByLabel('Menge').fill('8');
  await line(page, 1).getByLabel('Einzelpreis netto €').fill('95');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await rows.nth(1).getByRole('button', { name: 'Kunde GmbH' }).click();
  await page.getByRole('button', { name: 'Rechnung ausstellen' }).click();
  await page.getByRole('group', { name: /^Rechnung jetzt ausstellen\?/ }).getByRole('button', { name: 'Jetzt ausstellen' }).click();
  await expect(page.getByRole('heading', { name: `Rechnung ${first}` })).toBeVisible();

  // cancelling asks first, then issues the cancellation and shows it
  await page.getByRole('button', { name: 'Stornieren' }).click();
  const confirm = page.getByRole('group', { name: `Rechnung ${first} stornieren?`, exact: false });
  await confirm.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole('button', { name: 'Stornieren' }).click();
  await confirm.getByRole('button', { name: 'Jetzt stornieren' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Rechnung ${first} storniert, Stornorechnung ${second} ausgestellt` })).toBeVisible();
  await expect(page.getByRole('heading', { name: `Stornorechnung ${second}` })).toBeVisible();
  await expect(page.getByText(/Gesamtbetrag\s*-904,40\s€/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stornieren' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Als neue Rechnung kopieren' })).toHaveCount(0);

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF herunterladen' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`Stornorechnung_${second}_Kunde-GmbH.pdf`);
  const pdf = await PDFDocument.load(await readFile((await download.path()) ?? ''), { updateMetadata: false });
  expect(pdf.getTitle()).toBe(`Stornorechnung – ${second} – Kunde GmbH – ${today}`);

  // in the folder: the invoice unchanged, its cancellation with its PDF, and both audit entries
  const files = await readFolders(page);
  expect(Object.keys(files)).toContain(`Ordner-1/documents/issued/${second}.pdf`);
  const audit = (files[`Ordner-1/audit/${isoToday().slice(0, 7)}.jsonl`] ?? '').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
  expect(audit).toMatchObject([
    { action: 'issue', number: first },
    { action: 'cancel', number: second, cancels: { number: first } },
  ]);
  const documents = await readDocuments(page);
  expect(documents.find((d) => d['cancels'] === null)).toMatchObject({ issued: { number: first } });
  expect(documents.find((d) => d['cancels'] !== null)).toMatchObject({ issued: { number: second }, cancels: { number: first } });

  // the invoice is cancelled and no longer due; a copy is the start of the corrected invoice
  await page.getByRole('button', { name: `${first} vom ${today}` }).click();
  await expect(page.getByRole('heading', { name: `Rechnung ${first}` })).toBeVisible();
  await expect(page.getByText('Storniert', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `${second} vom ${today}` })).toBeVisible();
  await expect(page.getByText('Fällig am')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stornieren' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Als neue Rechnung kopieren' }).click();
  await expect(page.getByText(`Kopie der Rechnung ${first}.`)).toBeVisible();
  await expect(page.getByLabel('Betreff')).toHaveValue('Beratung');
  await expect(line(page, 1).getByLabel('Menge')).toHaveValue('8');
  await page.getByLabel('Betreff').fill('Beratung, korrigiert');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rechnungsentwurf für „Kunde GmbH“ gespeichert' })).toBeVisible();

  // the list marks both and keeps them after a reload
  await page.reload();
  await nav(page, 'Rechnungen');
  await expect(page.getByRole('group', { name: 'Nach Status filtern' }).getByRole('button')).toHaveText(['Alle 3', 'Entwürfe 1', 'Ausgestellt 2']);
  await expect(rows.filter({ hasText: second })).toContainText('Storno');
  await expect(rows.filter({ hasText: second })).toContainText(/-904,40\s€/);
  await expect(rows.filter({ hasText: first })).toContainText('Storniert');
  await expect(rows.filter({ hasText: 'Beratung, korrigiert' })).toContainText('Entwurf');
  expect(errors).toEqual([]);
});
