import { expect, test, type Page } from '@playwright/test';
import { APP_URL, openSettings, readCompanyFile, setUpCompany, switcher, watchErrors } from './helpers';

const openAccounts = async (page: Page) => {
  await openSettings(page, 'Bankkonten');
  return page.getByRole('region', { name: 'Bankkonten' });
};

interface StoredAccount {
  id: string;
  kind: string;
  name: string;
  deletedAt: string | null;
}

test('bank accounts: add with checks, change the default, remove, and the list survives a reload', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio' });
  const before = await readCompanyFile(page, 'Ordner-1');

  // the account of the setup assistant is the default
  const card = await openAccounts(page);
  const rows = card.getByRole('list', { name: 'Konten' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Bankkonto');
  await expect(rows.first()).toContainText('Standard für Rechnungen');
  await expect(rows.first()).toContainText('DE89 3704 0044 0532 0130 00 · Erika Mustermann');

  // a second bank account: the holder is suggested, the same IBAN twice is refused
  await card.getByRole('button', { name: 'Konto hinzufügen' }).click();
  await expect(card.getByRole('heading', { name: 'Neues Konto' })).toBeFocused();
  await expect(card.getByRole('radio', { name: 'Bankkonto' })).toBeChecked();
  await expect(card.getByLabel('Kontoinhaber/in')).toHaveValue('Erika Mustermann');
  await card.getByLabel('Bezeichnung').fill('Rücklagen');
  await card.getByLabel('IBAN').fill('de89 3704 0044 0532 0130 00');
  await card.getByRole('button', { name: 'Speichern' }).click();
  await expect(card.getByText('Dieses Konto ist schon angelegt.')).toBeVisible();
  await expect(card.getByLabel('IBAN')).toBeFocused();
  await card.getByLabel('IBAN').fill('AT61 1904 3002 3457 3201');
  await expect(card.getByText('Dieses Konto ist schon angelegt.')).toHaveCount(0);
  await card.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: '„Rücklagen“ gespeichert' })).toBeVisible();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('AT61 1904 3002 3457 3201');

  // a PayPal account needs a valid email address
  await card.getByRole('button', { name: 'Konto hinzufügen' }).click();
  await card.getByRole('radio', { name: 'PayPal' }).check();
  await expect(card.getByLabel('IBAN')).toHaveCount(0);
  await card.getByLabel('Bezeichnung').fill('PayPal Shop');
  await card.getByLabel('PayPal-E-Mail-Adresse').fill('shop@');
  await card.getByRole('button', { name: 'Speichern' }).click();
  await expect(card.getByText('Bitte eine gültige E-Mail-Adresse eingeben.')).toBeVisible();
  await card.getByLabel('PayPal-E-Mail-Adresse').fill('shop@alpha.example');
  await card.getByRole('button', { name: 'Speichern' }).click();
  await expect(rows).toHaveCount(3);

  // the default moves to PayPal
  await card.getByRole('button', { name: '„PayPal Shop“ als Standard festlegen' }).click();
  await expect(page.getByRole('status').filter({ hasText: '„PayPal Shop“ ist jetzt das Standardkonto' })).toBeVisible();
  await expect(rows.nth(2)).toContainText('Standard für Rechnungen');
  await expect(rows.first()).not.toContainText('Standard für Rechnungen');

  // the default cannot be removed; another account can, after asking
  await card.getByRole('button', { name: '„PayPal Shop“ ändern' }).click();
  await expect(card.getByText('Das Standardkonto lässt sich nicht entfernen.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Konto entfernen' })).toHaveCount(0);
  await expect(card.getByRole('radio')).toHaveCount(0);
  await card.getByRole('button', { name: 'Abbrechen' }).click();
  await card.getByRole('button', { name: '„Bankkonto“ ändern' }).click();
  await card.getByRole('button', { name: 'Konto entfernen' }).click();
  await card.getByRole('group', { name: /^Konto entfernen\?/ }).getByRole('button', { name: 'Konto entfernen' }).click();
  await expect(page.getByRole('status').filter({ hasText: '„Bankkonto“ entfernt' })).toBeVisible();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Rücklagen');

  // the removed account stays in the file; the change is stamped
  const after = await readCompanyFile(page, 'Ordner-1');
  const bank = after['bank'] as { defaultAccountId: string; accounts: StoredAccount[] };
  expect(bank.accounts.map((a) => [a.kind, a.name, a.deletedAt === null])).toEqual([
    ['bank', '', false],
    ['bank', 'Rücklagen', true],
    ['paypal', 'PayPal Shop', true],
  ]);
  expect(bank.defaultAccountId).toBe(bank.accounts[2]?.id);
  expect(after.fieldUpdatedAt['bank']! > before.fieldUpdatedAt['bank']!).toBe(true);
  expect(after.fieldUpdatedAt['name']).toBe(before.fieldUpdatedAt['name']);

  await page.reload();
  const reloaded = await openAccounts(page);
  const list = reloaded.getByRole('list', { name: 'Konten' }).getByRole('listitem');
  await expect(list).toHaveCount(2);
  await expect(list.nth(1)).toContainText('PayPal Shop');
  await expect(list.nth(1)).toContainText('Standard für Rechnungen');
  await expect(list.nth(1)).toContainText('shop@alpha.example');
  expect(errors).toEqual([]);
});

test('a company folder of version 1 opens; its bank account becomes the default and is saved in the new format', async ({ page }) => {
  const errors = watchErrors(page);
  const v1 = {
    schemaVersion: 1,
    id: '0f8fad5b-d9cb-469f-a165-70867728950e',
    name: 'Altbestand',
    owner: 'Erika Mustermann',
    address: { street: 'Hauptstraße 1', postalCode: '50667', city: 'Köln', country: 'DE' },
    contact: { email: 'erika@example.com', phone: '' },
    logo: null,
    tax: { taxNumber: '12/345/67890', vatId: '', vat: { kind: 'smallBusiness' }, business: { kind: 'freelance' } },
    bank: { holder: 'Erika Mustermann', iban: 'DE89370400440532013000', bic: '' },
    invoiceDefaults: { numberPattern: 'RE-{YYYY}-{NNNN}', paymentTermDays: 14, footer: '' },
    createdAt: '2026-10-01T09:00:00.000Z',
    fieldUpdatedAt: { name: '2026-10-01T09:00:00.000Z', bank: '2026-10-01T09:00:00.000Z' },
  };
  await page.goto(APP_URL);
  await page.evaluate((company) => {
    localStorage.setItem('kontor.e2e.dir.Alt:d:', '1');
    localStorage.setItem('kontor.e2e.dir.Alt:f:company.json', JSON.stringify({ c: JSON.stringify(company), m: 1 }));
    window.__e2e?.nextFolder('Alt');
  }, v1);
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Ordner wählen' }).click();
  await expect(switcher(page)).toContainText('Altbestand');

  const card = await openAccounts(page);
  const rows = card.getByRole('list', { name: 'Konten' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Standard für Rechnungen');
  await expect(rows.first()).toContainText('DE89 3704 0044 0532 0130 00');
  // reading does not write: the file keeps its version until something changes
  expect((await readCompanyFile(page, 'Alt'))['schemaVersion']).toBe(1);

  await card.getByRole('button', { name: 'Konto hinzufügen' }).click();
  await card.getByRole('radio', { name: 'PayPal' }).check();
  await card.getByLabel('PayPal-E-Mail-Adresse').fill('erika@example.com');
  await card.getByRole('button', { name: 'Speichern' }).click();
  await expect(rows).toHaveCount(2);

  const saved = await readCompanyFile(page, 'Alt');
  expect(saved).toMatchObject({
    schemaVersion: 5,
    bank: {
      defaultAccountId: 'account-1',
      accounts: [
        { id: 'account-1', kind: 'bank', name: '', holder: 'Erika Mustermann', iban: 'DE89370400440532013000', bic: '', deletedAt: null },
        { kind: 'paypal', name: '', email: 'erika@example.com', deletedAt: null },
      ],
    },
  });
  expect(errors).toEqual([]);
});
