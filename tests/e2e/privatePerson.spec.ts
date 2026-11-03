import { expect, test, type Page } from '@playwright/test';
import { APP_URL, readFolders, setUpCompany, watchErrors } from './helpers';

const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name }).click();

test('a private person has no VAT ID, Leitweg-ID or order number; the section is Payment and notes (F27)', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });

  await nav(page, 'Kontakte');
  await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
  await page.getByRole('radio', { name: 'Privatperson' }).check();
  await page.getByLabel('Vor- und Nachname').fill('Bea Beispiel');

  // the company-only fields are not there; the payment term and the notes are
  await expect(page.getByLabel('USt-IdNr.')).toHaveCount(0);
  await expect(page.getByLabel('Leitweg-ID')).toHaveCount(0);
  await expect(page.getByLabel('Bestell- bzw. PO-Nummer')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Zahlung und Notizen' })).toBeVisible();
  await expect(page.getByText('Eine Privatperson hat keine USt-IdNr., Leitweg-ID, Bestellnummer und Ansprechpartner.')).toBeVisible();
  await expect(page.getByLabel('Notizen').last()).toBeVisible();

  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: '„Bea Beispiel“ gespeichert' })).toBeVisible();
  const files = await readFolders(page);
  const contact = Object.entries(files).find(([path]) => path.startsWith('Ordner-1/contacts/'))?.[1] ?? '';
  expect(JSON.parse(contact)).toMatchObject({ kind: 'person', vatId: '', leitwegId: '', orderReference: '', contactPerson: '' });
  expect(errors).toEqual([]);
});
