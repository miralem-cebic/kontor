import type { Page } from '@playwright/test';
import { APP_URL, expect, openSettings, setUpCompany, test, watchErrors } from './helpers';

const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name }).click();

/** A customer with only a name: its number is the one the form suggests */
async function saveCustomer(page: Page, name: string, number: string) {
  await nav(page, 'Kontakte');
  await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
  await expect(page.getByLabel('Kunden- bzw. Lieferantennummer')).toHaveValue(number);
  await page.getByLabel('Firmenname').fill(name);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: `„${name}“ gespeichert` })).toBeVisible();
}

test('numbers of new contacts and items come from the pattern of the settings (F28)', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });

  // the first two customers get the next free numbers
  await saveCustomer(page, 'Erste GmbH', 'K-0001');
  await saveCustomer(page, 'Zweite GmbH', 'K-0002');

  // a deleted customer keeps its number: the next one does not take it again
  await nav(page, 'Kontakte');
  await page.getByRole('button', { name: /Erste GmbH/ }).first().click();
  await page.getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('group', { name: /Kontakt löschen/ }).getByRole('button', { name: 'Löschen' }).click();
  await saveCustomer(page, 'Dritte GmbH', 'K-0003');

  // an item starts with A-0001
  await page.getByRole('button', { name: 'Artikel & Leistungen' }).click();
  await page.getByRole('button', { name: 'Neuer Artikel' }).click();
  await expect(page.getByLabel('Artikelnummer')).toHaveValue('A-0001');
  await page.getByLabel('Bezeichnung').fill('Webdesign');
  await page.getByLabel('Einheit').selectOption({ label: 'Stunde' });
  await page.getByLabel('Nettopreis in €').fill('85');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: '„Webdesign“ gespeichert' })).toBeVisible();

  // the settings name the pattern and the first number it gives
  await openSettings(page, 'Rechnungen');
  await expect(page.getByLabel('Nummer neuer Kontakte')).toHaveValue('K-{NNNN}');
  await expect(page.getByLabel('Nummer neuer Artikel')).toHaveValue('A-{NNNN}');
  await expect(page.getByText('Der erste neue Kontakt bekäme die Nummer K-0001.')).toBeVisible();
  await expect(page.getByText('Der erste neue Artikel bekäme die Nummer A-0001.')).toBeVisible();
  expect(errors).toEqual([]);
});
