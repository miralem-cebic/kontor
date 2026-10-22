import { expect, test, type Page } from '@playwright/test';
import { APP_URL, readCompanyFile, readFolders, setUpCompany, watchErrors } from './helpers';

const openCatalogue = (page: Page) => page.getByRole('button', { name: 'Artikel & Leistungen' }).click();
const itemFiles = async (page: Page) => {
  const files = await readFolders(page);
  return Object.entries(files)
    .filter(([path]) => path.startsWith('Ordner-1/items/'))
    .map(([, text]) => JSON.parse(text) as Record<string, unknown>);
};

test('the catalogue: create with checks, search, edit, delete, reload and English', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await openCatalogue(page);
  await expect(page.getByText('Noch keine Artikel oder Leistungen.')).toBeVisible();

  // name and price are required; the first invalid field gets the focus
  await page.getByRole('button', { name: 'Neuer Artikel' }).click();
  await expect(page.getByRole('heading', { name: 'Neuer Artikel' })).toBeFocused();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Bitte ausfüllen.')).toHaveCount(2);
  await expect(page.getByLabel('Bezeichnung')).toBeFocused();

  await page.getByLabel('Artikelnummer').fill('L-100');
  await page.getByLabel('Bezeichnung').fill('Webdesign');
  await page.getByLabel('Beschreibung').fill('Gestaltung und Umsetzung\nnach Aufwand');
  await page.getByLabel('Einheit').selectOption({ label: 'Stunde' });
  await page.getByLabel('Nettopreis in €').fill('85,001');
  await expect(page.getByText('Bitte ausfüllen.')).toHaveCount(0);
  await expect(page.getByText('Bitte einen Betrag wie 85,00 eingeben')).toBeVisible();
  await page.getByLabel('Nettopreis in €').fill('-5');
  await expect(page.getByText('Der Preis darf nicht negativ sein.')).toBeVisible();
  await page.getByLabel('Nettopreis in €').fill('85');
  await expect(page.getByLabel('Umsatzsteuer')).toHaveValue('1900');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: '„Webdesign“ gespeichert' })).toBeVisible();

  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText(['L-100', 'Webdesign', 'Gestaltung und Umsetzung', 'Stunde', '85,00 €', '19 %'].join(''));

  // a second item: the number must be unique, ignoring case
  await page.getByRole('button', { name: 'Neuer Artikel' }).click();
  await page.getByLabel('Artikelnummer').fill('l-100');
  await page.getByLabel('Bezeichnung').fill('Buchsatz');
  await page.getByLabel('Einheit').selectOption({ label: 'Pauschale' });
  await page.getByLabel('Nettopreis in €').fill('1.250');
  await page.getByLabel('Umsatzsteuer').selectOption('700');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Diese Nummer hat schon ein anderer Artikel.')).toBeVisible();
  await expect(page.getByLabel('Artikelnummer')).toBeFocused();
  await page.getByLabel('Artikelnummer').fill('B-1');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(rows).toHaveCount(3);
  // sorted by name
  await expect(rows.nth(1)).toContainText('Buchsatz');
  await expect(rows.nth(1)).toContainText('1.250,00 €');
  await expect(rows.nth(1)).toContainText('7 %');

  // search
  await page.getByRole('searchbox', { name: 'Artikel durchsuchen' }).fill('aufwand');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Webdesign');
  await page.getByRole('searchbox', { name: 'Artikel durchsuchen' }).fill('Logo');
  await expect(page.getByText('Keine Artikel gefunden.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Artikel durchsuchen' }).fill('');

  // edit: the price is shown as typed
  await page.getByRole('button', { name: /^Webdesign/ }).click();
  await expect(page.getByLabel('Nettopreis in €')).toHaveValue('85,00');
  await page.getByLabel('Nettopreis in €').fill('95,50');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(rows.nth(2)).toContainText('95,50 €');

  // delete after asking
  await page.getByRole('button', { name: /^Buchsatz/ }).click();
  await page.getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('group', { name: /^Artikel löschen\?/ }).getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('status').filter({ hasText: '„Buchsatz“ gelöscht' })).toBeVisible();
  await expect(rows).toHaveCount(2);

  // one file per item; the deleted one stays
  const files = await itemFiles(page);
  expect(files).toHaveLength(2);
  expect(files.find((f) => f['name'] === 'Buchsatz')).toMatchObject({ deletedAt: expect.any(String), unit: 'LS', netPrice: 125000, vatRate: 700 });
  expect(files.find((f) => f['name'] === 'Webdesign')).toMatchObject({
    schemaVersion: 2,
    number: 'L-100',
    description: 'Gestaltung und Umsetzung\nnach Aufwand',
    unit: 'HUR',
    netPrice: 9550,
    vatRate: 1900,
    deletedAt: null,
  });

  await page.reload();
  await openCatalogue(page);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('95,50 €');

  // English: prices and units follow the interface language
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.getByLabel('Sprache').selectOption('en');
  await page.getByRole('button', { name: 'Items & services' }).click();
  await expect(rows.nth(1)).toContainText('Hour');
  await expect(rows.nth(1)).toContainText('€95.50');
  await page.getByRole('button', { name: /^Webdesign/ }).click();
  await expect(page.getByLabel('Net price in €')).toHaveValue('95.50');
  expect(errors).toEqual([]);
});

test('a small business sees prices without VAT', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Klein Design' });
  await openCatalogue(page);
  await page.getByRole('button', { name: 'Neuer Artikel' }).click();
  await expect(page.getByLabel('Nettopreis in €')).toHaveCount(0);
  await expect(page.getByText('Als Kleinunternehmer weist du keine Umsatzsteuer aus.')).toBeVisible();
  await expect(page.getByText('Gilt erst, wenn du nicht mehr Kleinunternehmer bist.')).toBeVisible();
  await page.getByLabel('Bezeichnung').fill('Beratung');
  await page.getByLabel('Preis in €').fill('60');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('columnheader')).toHaveText(['Nr.', 'Bezeichnung', 'Einheit', 'Preis']);
  await expect(page.getByRole('table')).toContainText('60,00 €');
  expect(errors).toEqual([]);
});

test('unsaved items from an earlier session are restored and written', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio' });
  const { id: companyId } = await readCompanyFile(page, 'Ordner-1');
  const at = new Date().toISOString();
  const stamps = Object.fromEntries(['number', 'name', 'description', 'unit', 'netPrice', 'vatRate', 'deletedAt'].map((f) => [f, at]));
  const item = { schemaVersion: 2, id: '0f8fad5b-d9cb-469f-a165-70867728950e', number: '', name: 'Gerettet', description: '', unit: 'DAY', netPrice: 64000, vatRate: 1900, createdAt: at, deletedAt: null, fieldUpdatedAt: stamps };
  // a copy that does not pass the checks is left out
  const broken = { ...item, id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', name: 'Kaputt', netPrice: 1.5 };
  await page.evaluate(({ key, copy }) => localStorage.setItem(key, JSON.stringify(copy)), {
    key: `kontor.unsaved.v1.${companyId}`,
    copy: { at, company: null, contacts: [], items: [item, broken] },
  });

  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Ungespeicherte Änderungen aus der letzten Sitzung wurden wiederhergestellt.' })).toBeVisible();
  await openCatalogue(page);
  await expect(page.getByRole('table')).toContainText('Gerettet');
  await expect(page.getByRole('table')).not.toContainText('Kaputt');
  expect((await itemFiles(page)).map((f) => f['name'])).toEqual(['Gerettet']);
  expect(await page.evaluate((key) => localStorage.getItem(key), `kontor.unsaved.v1.${companyId}`)).toBeNull();
  expect(errors).toEqual([]);
});
