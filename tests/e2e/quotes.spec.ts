import { expect, test, type Page } from '@playwright/test';
import { APP_URL, isoToday, readFolders, setUpCompany, watchErrors } from './helpers';

const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name }).click();
const line = (page: Page, n: number) => page.getByRole('group', { name: `Position ${n}`, exact: true });

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
    .filter(([path]) => path.startsWith('Ordner-1/documents/'))
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
  await expect(page.getByRole('note')).toContainText('Angebote sind vorerst Entwürfe.');
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
  await sections.getByRole('button', { name: 'Schlusstext' }).click();
  await expect(page.getByRole('heading', { name: 'Schlusstext' })).toBeFocused();
  await expect(sections.getByRole('button', { name: 'Schlusstext' })).toHaveAttribute('aria-current', 'location');
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
  expect(file).toMatchObject({ schemaVersion: 3, kind: 'quote', date: isoToday(), validUntil: daysFromToday(14), subject: 'Website-Relaunch', deletedAt: null });
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

test('a small business quotes without VAT; an old quote is marked as expired and can be filtered', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Klein Design' });
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
  expect(errors).toEqual([]);
});
