import { expect, test, type Page } from '@playwright/test';
import { APP_URL, isoToday, setUpCompany, watchErrors } from './helpers';

const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name }).click();
const line = (page: Page, n: number) => page.getByRole('group', { name: `Position ${n}`, exact: true });

test('documents in the language of the customer: an English customer gets an English invoice and mail (F05)', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });

  // a customer whose documents are made in English
  await nav(page, 'Kontakte');
  await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
  await page.getByLabel('Firmenname').fill('Client Ltd');
  await page.getByLabel('Straße und Hausnummer').fill('Ringstraße 5');
  await page.getByLabel('PLZ').fill('10115');
  await page.getByRole('textbox', { name: 'Ort', exact: true }).fill('Berlin');
  await page.getByLabel('E-Mail für Rechnungen').fill('accounts@client.example');
  await page.getByLabel('Sprache der Dokumente').selectOption('en');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: '„Client Ltd“ gespeichert' })).toBeVisible();

  // an invoice to that customer, issued today
  const year = isoToday().slice(0, 4);
  await nav(page, 'Rechnungen');
  await page.getByRole('button', { name: 'Neue Rechnung' }).click();
  await page.getByLabel('Kunde').selectOption({ label: 'Client Ltd' });
  await page.getByLabel('Betreff').fill('Consulting');
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await line(page, 1).getByLabel('Bezeichnung').fill('Consulting');
  await line(page, 1).getByLabel('Menge').fill('2');
  await line(page, 1).getByLabel('Einzelpreis netto €').fill('150');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('button', { name: 'Client Ltd' }).filter({ hasText: 'Client Ltd' }).last().click();
  await page.getByRole('button', { name: 'Rechnung ausstellen' }).click();
  await page.getByRole('group', { name: /^Rechnung jetzt ausstellen\?/ }).getByRole('button', { name: 'Jetzt ausstellen' }).click();
  await expect(page.getByRole('heading', { name: `Rechnung RE-${year}-0001` })).toBeVisible();

  // the mail is English: its subject, its text and its file name
  const sendCard = page.locator('section[aria-labelledby="send-section"]');
  await sendCard.getByRole('button', { name: 'E-Mail vorbereiten' }).click();
  await expect(page.getByLabel('Empfänger')).toHaveValue('accounts@client.example');
  await expect(page.getByLabel('Betreff')).toHaveValue(`Invoice RE-${year}-0001`);
  await expect(page.locator('.send-form textarea')).toHaveValue(/^Dear Sir or Madam,/);
  const [eml] = await Promise.all([page.waitForEvent('download'), sendCard.getByRole('button', { name: 'E-Mail-Datei erstellen' }).click()]);
  expect(eml.suggestedFilename()).toBe(`Invoice_RE-${year}-0001_Client-Ltd.eml`);
  expect(errors).toEqual([]);
});
