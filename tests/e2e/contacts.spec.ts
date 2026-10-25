import { expect, test, type Page } from '@playwright/test';
import { APP_URL, readFolders, setUpCompany, switcher, watchErrors } from './helpers';

interface ContactJson {
  id: string;
  name: string;
  kind: string;
  roles: { customer: boolean; supplier: boolean };
  vatId: string;
  leitwegId: string;
  orderReference: string;
  paymentTermDays: number | null;
  address: unknown;
  deletedAt: string | null;
}

async function readContacts(page: Page, folder: string): Promise<ContactJson[]> {
  const files = await readFolders(page);
  return Object.entries(files)
    .filter(([path]) => path.startsWith(`${folder}/contacts/`))
    .map(([, text]) => JSON.parse(text) as ContactJson);
}

const contactsNav = (page: Page) => page.getByRole('navigation').getByRole('button', { name: 'Kontakte' });

test('customers and suppliers: create with checks, search, edit, delete', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio' });
  await contactsNav(page).click();
  await expect(page.getByText('Noch keine Kontakte.')).toBeVisible();

  // a business customer, with the checks of the form
  await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
  await expect(page.getByRole('heading', { name: 'Neuer Kontakt' })).toBeFocused();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Bitte ausfüllen.')).toBeVisible();
  await expect(page.getByLabel('Firmenname')).toBeFocused();
  await page.getByLabel('Firmenname').fill('Stadtwerke Musterstadt');
  await page.getByLabel('Ansprechpartner/in').fill('Frau Beispiel');
  await page.getByLabel('Kunden- bzw. Lieferantennummer').fill('K-1001');
  await page.getByRole('textbox', { name: 'Ort', exact: true }).fill('Musterstadt');
  await page.getByLabel('USt-IdNr.').fill('DE136695977');
  await page.getByLabel('Leitweg-ID').fill('04011000');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Bitte ausfüllen.').first()).toBeVisible();
  await expect(page.getByText('Keine gültige USt-IdNr. aus der EU')).toBeVisible();
  await expect(page.getByText('Keine gültige Leitweg-ID')).toBeVisible();
  await page.getByLabel('Straße und Hausnummer').fill('Rathausplatz 1');
  await page.getByLabel('PLZ').fill('12345');
  await page.getByLabel('USt-IdNr.').fill('de 136 695 976');
  await page.getByLabel('Leitweg-ID').fill('04011000-12345-34');
  await page.getByLabel('Bestell- bzw. PO-Nummer').fill('PO-2026-17');
  await page.getByLabel('Zahlungsziel in Tagen').fill('30');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: '„Stadtwerke Musterstadt“ gespeichert' })).toBeVisible();

  // a private supplier with a name only; the customer number must be unique
  await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
  await page.getByRole('radio', { name: 'Privatperson' }).check();
  await expect(page.getByLabel('Ansprechpartner/in')).toHaveCount(0);
  for (const label of ['USt-IdNr.', 'Leitweg-ID', 'Bestell- bzw. PO-Nummer']) await expect(page.getByLabel(label)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Zahlung und Notizen' })).toBeVisible();
  await expect(page.getByText('Schon eingetragene Werte werden nicht gespeichert.')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Kunde' }).uncheck();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Bitte Kunde, Lieferant oder beides wählen.')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Lieferant' }).check();
  await page.getByLabel('Vor- und Nachname').fill('Bea Beispiel');
  await page.getByLabel('Kunden- bzw. Lieferantennummer').fill('k-1001');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Diese Nummer hat schon ein anderer Kontakt.')).toBeVisible();
  await page.getByLabel('Kunden- bzw. Lieferantennummer').fill('L-1');
  await page.getByRole('button', { name: 'Speichern' }).click();

  // list, filter and search
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(3);
  await page.getByRole('button', { name: 'Lieferanten' }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Bea Beispiel');
  await page.getByRole('button', { name: 'Alle' }).click();
  await page.getByLabel('Kontakte durchsuchen').fill('muster');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Stadtwerke Musterstadt');
  await page.getByLabel('Kontakte durchsuchen').fill('hamburg');
  await expect(page.getByText('Keine Kontakte gefunden.')).toBeVisible();
  await page.getByLabel('Kontakte durchsuchen').fill('');

  let contacts = await readContacts(page, 'Ordner-1');
  expect(contacts).toHaveLength(2);
  expect(contacts.find((c) => c.name === 'Stadtwerke Musterstadt')).toMatchObject({
    kind: 'company',
    roles: { customer: true, supplier: false },
    vatId: 'DE136695976',
    leitwegId: '04011000-12345-34',
    orderReference: 'PO-2026-17',
    paymentTermDays: 30,
    address: { street: 'Rathausplatz 1', postalCode: '12345', city: 'Musterstadt', country: 'DE' },
    deletedAt: null,
  });
  expect(contacts.find((c) => c.name === 'Bea Beispiel')).toMatchObject({ kind: 'person', roles: { customer: false, supplier: true }, address: null, paymentTermDays: null });

  // edit, then delete with confirmation
  await page.getByRole('button', { name: /^Bea Beispiel/ }).click();
  await page.getByLabel('Vor- und Nachname').fill('Bea Beispiel-Muster');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(rows.nth(1)).toContainText('Bea Beispiel-Muster');
  await page.getByRole('button', { name: /^Bea Beispiel-Muster/ }).click();
  await page.getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByText('Kontakt löschen?')).toBeVisible();
  await page.getByRole('group', { name: /Kontakt löschen/ }).getByRole('button', { name: 'Löschen' }).click();
  await expect(rows).toHaveCount(2);

  // the deleted contact stays in its file, with the time of deletion
  contacts = await readContacts(page, 'Ordner-1');
  expect(contacts).toHaveLength(2);
  expect(contacts.find((c) => c.name === 'Bea Beispiel-Muster')?.deletedAt).toBeTruthy();

  // after a reload everything is still there
  await page.reload();
  await contactsNav(page).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Stadtwerke Musterstadt');
  expect(errors).toEqual([]);
});

test('every company has its own contacts', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio' });
  await contactsNav(page).click();
  await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
  await page.getByLabel('Firmenname').fill('Nur bei Alpha');
  await page.getByRole('button', { name: 'Speichern' }).click();

  await switcher(page).click();
  await page.getByRole('menuitem', { name: 'Unternehmen hinzufügen' }).click();
  await setUpCompany(page, { name: 'Beta Beratung' });
  await contactsNav(page).click();
  await expect(page.getByText('Noch keine Kontakte.')).toBeVisible();

  await switcher(page).click();
  await page.getByRole('menuitemradio', { name: 'Alpha Studio' }).click();
  await contactsNav(page).click();
  await expect(page.getByRole('button', { name: /^Nur bei Alpha/ })).toBeVisible();
  expect(await readContacts(page, 'Ordner-2')).toEqual([]);
  expect(errors).toEqual([]);
});
