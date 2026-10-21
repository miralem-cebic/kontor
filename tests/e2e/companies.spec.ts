import { expect, test } from '@playwright/test';
import { APP_URL, readCompanyFile, setUpCompany, switcher, watchErrors } from './helpers';

test('several companies: add a second one, switch, and the choice survives a reload', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', logo: true });

  // "Add company" keeps the current company open until the new one is ready; it can be cancelled
  await switcher(page).click();
  await page.getByRole('menuitem', { name: 'Unternehmen hinzufügen' }).click();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(switcher(page)).toContainText('Alpha Studio');

  await switcher(page).click();
  await page.getByRole('menuitem', { name: 'Unternehmen hinzufügen' }).click();
  await setUpCompany(page, { name: 'Beta Beratung', smallBusiness: false, trade: { municipality: 'München', multiplier: '490' } });

  // both are listed; switch back to the first one
  await switcher(page).click();
  await expect(page.getByRole('menuitemradio')).toHaveText(['Alpha Studio', 'Beta Beratung']);
  await expect(page.getByRole('menuitemradio', { name: 'Beta Beratung' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: 'Alpha Studio' }).click();
  await expect(switcher(page)).toContainText('Alpha Studio');
  await expect(page.locator('.sw-logo img')).toBeVisible();

  await page.reload();
  await expect(switcher(page)).toContainText('Alpha Studio');
  await switcher(page).click();
  await page.getByRole('menuitemradio', { name: 'Beta Beratung' }).click();
  await expect(switcher(page)).toContainText('Beta Beratung');
  await page.reload();
  await expect(switcher(page)).toContainText('Beta Beratung');

  // each company has its own folder
  expect((await readCompanyFile(page, 'Ordner-1')).name).toBe('Alpha Studio');
  expect((await readCompanyFile(page, 'Ordner-2')).name).toBe('Beta Beratung');
  expect(errors).toEqual([]);
});

test('a folder that already holds a company is opened, not set up again', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio' });
  const before = await readCompanyFile(page, 'Ordner-1');

  // a browser that does not know the folder yet (the list of companies is empty)
  await page.evaluate(() => localStorage.removeItem('kontor.e2e.companies'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Browser' })).toBeVisible();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.evaluate(() => window.__e2e?.nextFolder('Ordner-1'));
  await page.getByRole('button', { name: 'Ordner wählen' }).click();
  await expect(switcher(page)).toContainText('Alpha Studio');
  expect((await readCompanyFile(page, 'Ordner-1')).id).toBe(before.id);
  expect(errors).toEqual([]);
});

test('settings change the fields of the assistant and keep field timestamps', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio' });
  const before = await readCompanyFile(page, 'Ordner-1');

  await page.getByRole('button', { name: 'Einstellungen' }).click();
  const master = page.getByRole('region', { name: 'Stammdaten' });
  await expect(master.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  await master.getByLabel('Firmenname').fill('Alpha Studio GmbH');
  await master.getByLabel('E-Mail').fill('kein-mail');
  await master.getByRole('button', { name: 'Speichern' }).click();
  await expect(master.getByText('Bitte eine gültige E-Mail-Adresse eingeben.')).toBeVisible();
  await master.getByLabel('E-Mail').fill('hallo@alpha.example');
  await master.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Stammdaten gespeichert' })).toBeVisible();
  await expect(switcher(page)).toContainText('Alpha Studio GmbH');

  const tax = page.getByRole('region', { name: 'Steuer' });
  await tax.getByRole('radio', { name: 'Nein, ich weise Umsatzsteuer aus' }).check();
  await tax.getByRole('radio', { name: 'Ist-Versteuerung' }).check();
  await tax.getByRole('radio', { name: 'Nur Jahreserklärung' }).check();
  await expect(tax.getByLabel('Dauerfristverlängerung')).toHaveCount(0);
  await tax.getByRole('button', { name: 'Speichern' }).click();

  const after = await readCompanyFile(page, 'Ordner-1');
  expect(after).toMatchObject({ name: 'Alpha Studio GmbH', contact: { email: 'hallo@alpha.example' }, tax: { vat: { kind: 'regular', method: 'cash', period: 'yearly' } } });
  expect(after.fieldUpdatedAt['name']! > before.fieldUpdatedAt['name']!).toBe(true);
  expect(after.fieldUpdatedAt['tax']! > before.fieldUpdatedAt['tax']!).toBe(true);
  expect(after.fieldUpdatedAt['bank']).toBe(before.fieldUpdatedAt['bank']);

  // the switcher list shows the new name after a reload too
  await page.reload();
  await switcher(page).click();
  await expect(page.getByRole('menuitemradio')).toHaveText(['Alpha Studio GmbH']);
  expect(errors).toEqual([]);
});

test('the interface switches to English', async ({ page }) => {
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio' });
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.getByLabel('Sprache').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
