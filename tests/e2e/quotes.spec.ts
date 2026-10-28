import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { APP_URL, isoToday, readFolders, setUpCompany, watchErrors } from './helpers';

const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name }).click();
const line = (page: Page, n: number) => page.getByRole('group', { name: `Position ${n}`, exact: true });
const finalizeList = (page: Page) => page.getByRole('list', { name: 'Vor dem Abschließen noch zu tun:' });
const german = (iso: string) => iso.split('-').reverse().join('.');

async function addContact(page: Page, name: string, roles: { customer: boolean; supplier: boolean }) {
  await nav(page, 'Kontakte');
  await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
  await page.getByLabel('Firmenname').fill(name);
  await page.getByRole('checkbox', { name: 'Kunde' }).setChecked(roles.customer);
  await page.getByRole('checkbox', { name: 'Lieferant' }).setChecked(roles.supplier);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: `„${name}“ gespeichert` })).toBeVisible();
}

async function addItem(page: Page) {
  await nav(page, 'Artikel & Leistungen');
  await page.getByRole('button', { name: 'Neuer Artikel' }).click();
  await page.getByLabel('Artikelnummer').fill('L-100');
  await page.getByLabel('Bezeichnung').fill('Webdesign');
  await page.getByLabel('Beschreibung').fill('Gestaltung und Umsetzung');
  await page.getByLabel('Einheit').selectOption({ label: 'Stunde' });
  await page.getByLabel(/^(Netto)?[Pp]reis in €/).fill('85');
  await page.getByRole('button', { name: 'Speichern' }).click();
}

const daysFromToday = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function readDocuments(page: Page) {
  const files = await readFolders(page);
  return Object.entries(files)
    .filter(([path]) => /^Ordner-1\/documents\/[^/]+\.json$/.test(path))
    .map(([, text]) => JSON.parse(text) as Record<string, unknown> & { lines: Record<string, unknown>[] });
}

test('quotes: lines from the catalogue and free lines, totals, checks, order, edit, delete and reload', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await addContact(page, 'Kunde GmbH', { customer: true, supplier: false });
  await addContact(page, 'Lieferant AG', { customer: false, supplier: true });
  await addItem(page);

  await nav(page, 'Angebote');
  await expect(page.getByRole('note')).toContainText('Entwürfe lassen sich ändern und löschen.');
  await page.getByRole('button', { name: 'Neues Angebot' }).click();
  await expect(page.getByRole('heading', { name: 'Neues Angebot' })).toBeFocused();
  await expect(page.getByLabel('Angebotsdatum')).toHaveValue(isoToday());
  await expect(page.getByLabel('Gültig bis')).toHaveValue(daysFromToday(30));

  // a customer is required; suppliers are not offered
  await expect(page.getByLabel('Kunde').locator('option')).toHaveText(['– Kunde wählen –', 'Kunde GmbH']);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Bitte ausfüllen.')).toBeVisible();
  await expect(page.getByLabel('Kunde')).toBeFocused();
  await page.getByLabel('Kunde').selectOption({ label: 'Kunde GmbH' });
  await page.getByLabel('Gültig bis').fill(daysFromToday(-1));
  await expect(page.getByText('Darf nicht vor dem Angebotsdatum liegen.')).toBeVisible();
  await page.getByLabel('Gültig bis').fill(daysFromToday(14));
  await page.getByLabel('Betreff').fill('Website-Relaunch');

  // a line from the catalogue: the quantity gets the focus
  await page.getByRole('button', { name: 'Aus dem Katalog' }).click();
  await page.getByRole('searchbox', { name: 'Katalog durchsuchen' }).fill('web');
  await page.getByRole('region', { name: 'Artikel aus dem Katalog' }).getByRole('button', { name: /^Webdesign/ }).click();
  await expect(line(page, 1).getByLabel('Menge')).toBeFocused();
  await expect(line(page, 1).getByLabel('Bezeichnung')).toHaveValue('Webdesign');
  await expect(line(page, 1).getByLabel('Einzelpreis netto €')).toHaveValue('85,00');
  await expect(line(page, 1).getByLabel('Einheit')).toHaveValue('HUR');
  await line(page, 1).getByLabel('Menge').fill('12,5');
  await expect(line(page, 1)).toContainText('1.062,50 €');

  // a free line at 7 %: the name gets the focus
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await expect(line(page, 2).getByLabel('Bezeichnung')).toBeFocused();
  await line(page, 2).getByLabel('Bezeichnung').fill('Lektorat');
  await line(page, 2).getByLabel('Einzelpreis netto €').fill('300');
  await line(page, 2).getByLabel('USt.').selectOption('700');

  // VAT per rate, rounded once per rate
  const totals = page.getByLabel('Summen');
  await expect(totals).toContainText('Summe netto1.362,50 €');
  await expect(totals).toContainText('Umsatzsteuer 7 %21,00 €');
  await expect(totals).toContainText('Umsatzsteuer 19 %201,88 €');
  await expect(totals).toContainText('Gesamtbetrag1.585,38 €');

  // an incomplete line is reported in its place
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await line(page, 3).getByLabel('Menge').fill('0');
  await page.getByRole('button', { name: 'Speichern' }).click();
  // name and price are missing, the quantity is 0
  await expect(line(page, 3).getByText('Bitte ausfüllen.')).toHaveCount(2);
  await expect(line(page, 3).getByText('Bitte eine Menge wie 1 oder 2,5 eingeben')).toBeVisible();
  await expect(line(page, 3).getByLabel('Bezeichnung')).toBeFocused();
  await page.getByRole('button', { name: 'Position 3 entfernen' }).click();
  await expect(line(page, 3)).toHaveCount(0);

  // a deduction may lower the lines of its rate, but not below zero; the check shows while typing
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await line(page, 3).getByLabel('Bezeichnung').fill('Rabatt');
  await line(page, 3).getByLabel('Menge').fill('-2');
  await line(page, 3).getByLabel('Einzelpreis netto €').fill('300');
  await line(page, 3).getByLabel('USt.').selectOption('700');
  const negative = page.getByText('Die Summe der Positionen darf nicht negativ sein, auch nicht je Steuersatz.', { exact: false });
  await expect(negative).toBeVisible();
  await line(page, 3).getByLabel('Menge').fill('-1');
  await expect(negative).toHaveCount(0);
  await expect(totals).toContainText('Gesamtbetrag1.264,38 €');
  await page.getByRole('button', { name: 'Position 3 entfernen' }).click();

  // the side panel jumps to a section and marks it
  const sections = page.getByRole('navigation', { name: 'Abschnitte des Angebots' });
  await sections.getByRole('button', { name: 'Abschließen' }).click();
  await expect(page.getByRole('heading', { name: 'Abschließen' })).toBeFocused();
  await expect(sections.getByRole('button', { name: 'Abschließen' })).toHaveAttribute('aria-current', 'location');
  await sections.getByRole('button', { name: 'Angebot' }).click();
  await expect(page.getByRole('heading', { name: 'Angebot', exact: true })).toBeFocused();
  await expect(sections.getByRole('button', { name: 'Angebot' })).toHaveAttribute('aria-current', 'location');

  // move the free line up
  await expect(page.getByRole('button', { name: 'Position 1 nach oben' })).toBeDisabled();
  await page.getByRole('button', { name: 'Position 2 nach oben' }).click();
  await expect(line(page, 1).getByLabel('Bezeichnung')).toHaveValue('Lektorat');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Angebot für „Kunde GmbH“ gespeichert' })).toBeVisible();

  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Kunde GmbH');
  await expect(rows.nth(1)).toContainText('Website-Relaunch');
  await expect(rows.nth(1)).toContainText('1.585,38 €');
  await expect(rows.nth(1)).not.toContainText('abgelaufen');

  const [file] = await readDocuments(page);
  expect(file).toMatchObject({ schemaVersion: 6, kind: 'quote', date: isoToday(), validUntil: daysFromToday(14), subject: 'Website-Relaunch', issued: null, deletedAt: null });
  expect(file?.lines).toEqual([
    { name: 'Lektorat', description: '', quantity: 1000, unit: 'H87', unitPrice: 30000, vatRate: 700 },
    { name: 'Webdesign', description: 'Gestaltung und Umsetzung', quantity: 12500, unit: 'HUR', unitPrice: 8500, vatRate: 1900 },
  ]);

  // after a reload: open, change, save
  await page.reload();
  await nav(page, 'Angebote');
  await page.getByRole('button', { name: 'Kunde GmbH' }).click();
  await expect(page.getByRole('heading', { name: 'Kunde GmbH · Website-Relaunch' })).toBeVisible();
  await expect(line(page, 2).getByLabel('Menge')).toHaveValue('12,5');
  await line(page, 2).getByLabel('Menge').fill('10');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(rows.nth(1)).toContainText('1.332,50 €');

  // delete after asking; the file stays
  await page.getByRole('button', { name: 'Kunde GmbH' }).click();
  await page.getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('group', { name: /^Angebot löschen\?/ }).getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Angebot für „Kunde GmbH“ gelöscht' })).toBeVisible();
  await expect(page.getByText('Noch keine Angebote.')).toBeVisible();
  expect((await readDocuments(page))[0]?.['deletedAt']).toEqual(expect.any(String));
  expect(errors).toEqual([]);
});

test('a small business quotes without VAT; an old quote is marked as expired and can be filtered; its PDF has the logo', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Klein Design', logo: 'svg' });
  await addContact(page, 'Kunde GmbH', { customer: true, supplier: false });

  await nav(page, 'Angebote');
  await page.getByRole('button', { name: 'Neues Angebot' }).click();
  await page.getByLabel('Kunde').selectOption({ label: 'Kunde GmbH' });
  await page.getByLabel('Angebotsdatum').fill('2020-01-02');
  await page.getByLabel('Gültig bis').fill('2020-01-31');
  await page.getByRole('button', { name: 'Aus dem Katalog' }).click();
  const picker = page.getByRole('region', { name: 'Artikel aus dem Katalog' });
  await expect(picker).toContainText('Der Katalog ist leer.');
  await picker.getByRole('button', { name: 'Schließen' }).click();
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await line(page, 1).getByLabel('Bezeichnung').fill('Beratung');
  await line(page, 1).getByLabel('Menge').fill('3');
  await line(page, 1).getByLabel('Einheit').selectOption({ label: 'Stunde' });
  await line(page, 1).getByLabel('Einzelpreis €').fill('60');
  await expect(line(page, 1).getByLabel('USt.')).toHaveCount(0);
  await expect(page.getByLabel('Summen')).toHaveText('Gesamtbetrag180,00 €');
  await expect(page.getByText('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.')).toBeVisible();
  await page.getByRole('button', { name: 'Speichern' }).click();

  const row = page.getByRole('table').getByRole('row').nth(1);
  await expect(row).toContainText('02.01.2020');
  await expect(row).toContainText('ohne Betreff');
  await expect(row).toContainText('abgelaufen');
  await expect(row).toContainText('180,00 €');
  await expect(row).toContainText('Entwurf');

  // a valid quote next to it; the filter shows either kind, with the counts
  await page.getByRole('button', { name: 'Neues Angebot' }).click();
  await page.getByLabel('Kunde').selectOption({ label: 'Kunde GmbH' });
  await page.getByLabel('Betreff').fill('Wartung');
  await page.getByRole('button', { name: 'Speichern' }).click();
  const rows = page.getByRole('table').getByRole('row');
  const filter = page.getByRole('group', { name: 'Nach Gültigkeit filtern' });
  await expect(filter.getByRole('button')).toHaveText(['Alle 2', 'Gültig 1', 'Abgelaufen 1']);
  await expect(rows).toHaveCount(3);
  await filter.getByRole('button', { name: /^Abgelaufen/ }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('02.01.2020');
  await filter.getByRole('button', { name: /^Gültig/ }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Wartung');
  await page.getByRole('searchbox').fill('nichts');
  await expect(filter.getByRole('button')).toHaveText(['Alle 0', 'Gültig 0', 'Abgelaufen 0']);
  await expect(page.getByText('Keine Angebote gefunden.')).toBeVisible();

  // the PDF of the quote, with the SVG logo drawn as an image
  await page.getByRole('searchbox').fill('');
  await filter.getByRole('button', { name: /^Alle/ }).click();
  await page.getByRole('button', { name: 'Kunde GmbH' }).first().click();
  await expect(page.getByRole('button', { name: 'PDF herunterladen' })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF herunterladen' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^Angebotsentwurf_\d{4}-\d\d-\d\d_Kunde-GmbH\.pdf$/);
  const pdf = await PDFDocument.load(await readFile((await download.path()) ?? ''), { updateMetadata: false });
  const images = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  expect(images?.keys()).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('finalizing a quote: the next quote number, the final PDF in the folder, no change afterwards, an invoice and a copy from it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await addContact(page, 'Kunde GmbH', { customer: true, supplier: false });
  const year = isoToday().slice(0, 4);
  const number = `AN-${year}-0001`;
  const rows = page.getByRole('table').getByRole('row');

  await nav(page, 'Angebote');
  await page.getByRole('button', { name: 'Neues Angebot' }).click();
  const sections = page.getByRole('navigation', { name: 'Abschnitte des Angebots' });
  await expect(sections.getByRole('button')).toHaveText(['Angebot', 'Positionen', 'Schlusstext', 'Abschließen']);
  await expect(finalizeList(page).getByRole('listitem')).toHaveText(['Wähle einen Kunden.', 'Füge mindestens eine Position hinzu.']);
  await page.getByLabel('Kunde').selectOption({ label: 'Kunde GmbH' });
  await page.getByLabel('Betreff').fill('Website');
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await line(page, 1).getByLabel('Bezeichnung').fill('Konzept');
  await line(page, 1).getByLabel('Einzelpreis netto €').fill('1000');
  // a quote that has run out is not sent
  await page.getByLabel('Angebotsdatum').fill(daysFromToday(-20));
  await page.getByLabel('Gültig bis').fill(daysFromToday(-1));
  await expect(finalizeList(page).getByRole('listitem')).toHaveText(['Das Angebot ist abgelaufen. Setze „Gültig bis“ auf heute oder später.']);
  await page.getByLabel('Angebotsdatum').fill(isoToday());
  await page.getByLabel('Gültig bis').fill(daysFromToday(14));
  await expect(page.getByText('Alle Angaben für das Abschließen sind da.')).toBeVisible();
  // a new quote is saved before it can be finalized
  await expect(page.getByText('Speichere das Angebot, um es abzuschließen.')).toBeVisible();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(rows.nth(1)).toContainText('Entwurf');
  await rows.nth(1).getByRole('button', { name: 'Kunde GmbH' }).click();

  // a change not saved yet is saved with it; finalizing asks first
  await page.getByLabel('Betreff').fill('Website-Relaunch');
  await page.getByRole('button', { name: 'Angebot abschließen' }).click();
  const confirm = page.getByRole('group', { name: /^Angebot jetzt abschließen\?/ });
  await confirm.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole('button', { name: 'Angebot abschließen' }).click();
  await confirm.getByRole('button', { name: 'Jetzt abschließen' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Angebot ${number} abgeschlossen` })).toBeVisible();

  // read-only: the number, the file in the folder, no saving or deleting
  await expect(page.getByRole('heading', { name: `Angebot ${number}` })).toBeVisible();
  await expect(page.getByText('Abgeschlossen', { exact: true })).toBeVisible();
  await expect(page.getByText(`documents/quotes/${number}.pdf`)).toBeVisible();
  await expect(page.getByText('Website-Relaunch')).toBeVisible();
  await expect(page.getByText(/Gesamtbetrag\s*1\.190,00\s€/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Speichern' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Löschen' })).toHaveCount(0);

  // the PDF is the file in the folder: the quote with its number, without the draft marks
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF herunterladen' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`Angebot_${number}_Kunde-GmbH.pdf`);
  const pdf = await PDFDocument.load(await readFile((await download.path()) ?? ''), { updateMetadata: false });
  expect(pdf.getTitle()).toBe(`Angebot – ${number} – Kunde GmbH – ${german(isoToday())}`);

  const files = await readFolders(page);
  expect(Object.keys(files)).toContain(`Ordner-1/documents/quotes/${number}.pdf`);
  expect(Object.keys(files).filter((f) => f.startsWith('Ordner-1/documents/issued/'))).toEqual([]);
  const range = JSON.parse(files['Ordner-1/numbering/quote.json'] ?? '{}') as { range: string; counters: unknown[] };
  expect(range).toMatchObject({ range: 'quote', counters: [{ key: year, last: 1 }] });
  const audit = (files[`Ordner-1/audit/${isoToday().slice(0, 7)}.jsonl`] ?? '').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
  expect(audit).toMatchObject([{ action: 'issueQuote', number }]);
  const [quote] = await readDocuments(page);
  expect(quote).toMatchObject({ schemaVersion: 6, subject: 'Website-Relaunch', issued: { number, pdf: { file: `${number}.pdf` } } });

  // an invoice made from the quote names its number
  await page.getByRole('button', { name: 'Rechnung erstellen' }).click();
  await expect(page.getByRole('heading', { name: 'Neue Rechnung' })).toBeVisible();
  await expect(page.getByText(`Erstellt aus dem Angebot ${number} vom ${german(isoToday())} (Website-Relaunch).`)).toBeVisible();
  await expect(page.getByLabel('Betreff')).toHaveValue('Website-Relaunch');

  // after a reload the list shows the number, and the quote can be found by it; a copy starts a new draft
  await page.reload();
  await nav(page, 'Angebote');
  await page.getByRole('searchbox').fill(number);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText(number);
  await rows.nth(1).getByRole('button', { name: 'Kunde GmbH' }).click();
  await page.getByRole('button', { name: 'Als neues Angebot kopieren' }).click();
  await expect(page.getByText(`Kopie des Angebots ${number}.`)).toBeVisible();
  await expect(page.getByLabel('Betreff')).toHaveValue('Website-Relaunch');
  await expect(page.getByLabel('Gültig bis')).toHaveValue(daysFromToday(30));
  await expect(line(page, 1).getByLabel('Bezeichnung')).toHaveValue('Konzept');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('searchbox').fill('');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'Entwurf' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('quote versions: a change of a finalized quote is a new version with a suffix, and the history shows what changed', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await addContact(page, 'Kunde GmbH', { customer: true, supplier: false });
  const year = isoToday().slice(0, 4);
  const today = german(isoToday());
  const [first, second] = [`AN-${year}-0001`, `AN-${year}-0001-2`];
  const rows = page.getByRole('table').getByRole('row');
  const finalize = async () => {
    await page.getByRole('button', { name: 'Angebot abschließen' }).click();
    await page.getByRole('group', { name: /^Angebot jetzt abschließen\?/ }).getByRole('button', { name: 'Jetzt abschließen' }).click();
  };

  await nav(page, 'Angebote');
  await page.getByRole('button', { name: 'Neues Angebot' }).click();
  await page.getByLabel('Kunde').selectOption({ label: 'Kunde GmbH' });
  await page.getByLabel('Betreff').fill('Website-Relaunch');
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await line(page, 1).getByLabel('Bezeichnung').fill('Konzept');
  await line(page, 1).getByLabel('Einzelpreis netto €').fill('1000');
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await line(page, 2).getByLabel('Bezeichnung').fill('Umsetzung');
  await line(page, 2).getByLabel('Menge').fill('10');
  await line(page, 2).getByLabel('Einzelpreis netto €').fill('85');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await rows.nth(1).getByRole('button', { name: 'Kunde GmbH' }).click();
  await finalize();
  await expect(page.getByRole('heading', { name: `Angebot ${first}` })).toBeVisible();
  const history = page.getByRole('region', { name: 'Versionen' });
  await expect(history).toContainText('Noch keine weitere Version.');

  // a change is a new version: a draft with everything from the quote, which gets the number with a suffix
  await page.getByRole('button', { name: 'Neue Version' }).click();
  await expect(page.getByRole('heading', { name: `Version 2 von ${first}` })).toBeVisible();
  await expect(page.getByText(`Version 2 des Angebots ${first}: ersetzt ${first} vom ${today} und bekommt beim Abschließen die Nummer ${second}.`)).toBeVisible();
  await expect(page.getByLabel('Betreff')).toHaveValue('Website-Relaunch');
  await page.getByRole('button', { name: 'Position 1 entfernen' }).click();
  await line(page, 1).getByLabel('Menge').fill('12');
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await line(page, 2).getByLabel('Bezeichnung').fill('Hosting');
  await line(page, 2).getByLabel('Einzelpreis netto €').fill('120');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(rows.filter({ hasText: 'Version 2' })).toContainText('Entwurf');

  // the finalized quote offers no second version while one exists
  await rows.filter({ hasText: first }).getByRole('button', { name: 'Kunde GmbH' }).click();
  await expect(page.getByRole('button', { name: 'Neue Version' })).toHaveCount(0);
  await expect(page.locator('dl.facts')).toContainText('Ersetzt durchEntwurf der Version 2');
  await page.locator('dl.facts').getByRole('button', { name: 'Entwurf der Version 2' }).click();
  await finalize();
  await expect(page.getByRole('status').filter({ hasText: `Angebot ${second} abgeschlossen` })).toBeVisible();
  await expect(page.getByRole('heading', { name: `Angebot ${second}` })).toBeVisible();
  await expect(page.locator('dl.facts')).toContainText(`Ersetzt das Angebot${first} vom ${today}`);

  // the history: the versions and what changed, and how often the customer's quotes were changed
  await expect(history).toContainText('Entfernt: Konzept');
  await expect(history).toContainText('Umsetzung: Menge 10 → 12');
  await expect(history).toContainText(/Neu: Hosting \(1 Stück × 120,00\s€\)/);
  await expect(history).toContainText(/Gesamtbetrag 2\.201,50\s€ → 1\.356,60\s€/);
  await expect(history).toContainText('Bei Kunde GmbH: abgeschlossene Angebote: 1 · davon geändert: 1 · Änderungen insgesamt: 1');

  // the PDF names the quote it replaces; the files are in the folder
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF herunterladen' }).click();
  expect((await downloading).suggestedFilename()).toBe(`Angebot_${second}_Kunde-GmbH.pdf`);
  const files = await readFolders(page);
  expect(Object.keys(files)).toEqual(expect.arrayContaining([`Ordner-1/documents/quotes/${first}.pdf`, `Ordner-1/documents/quotes/${second}.pdf`]));
  const version = (await readDocuments(page)).find((d) => d['revises'] !== null);
  expect(version).toMatchObject({ revises: { number: first, firstNumber: first, version: 2 }, issued: { number: second } });

  // the replaced quote stays as it was and is marked; the list counts the changes
  await history.getByRole('button', { name: `${first} vom ${today}` }).click();
  await expect(page.getByRole('heading', { name: `Angebot ${first}` })).toBeVisible();
  await expect(page.getByText('Ersetzt', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Neue Version' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Zurück zur Liste' }).first().click();
  await expect(rows.filter({ hasText: 'Ersetzt' })).toHaveCount(1);
  await expect(page.getByText('Abgeschlossene Angebote: 1 · davon geändert: 1 · Änderungen insgesamt: 1')).toBeVisible();
  expect(errors).toEqual([]);
});
