import { expect, test, type Page } from '@playwright/test';
import { APP_URL, isoToday, readFolders, setUpCompany, watchErrors } from './helpers';

const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name }).click();
const line = (page: Page, n: number) => page.getByRole('group', { name: `Position ${n}`, exact: true });
const decisionCard = (page: Page) => page.locator('section[aria-labelledby="quote-decision"]');

async function addCustomer(page: Page, name: string) {
  await nav(page, 'Kontakte');
  await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
  await page.getByLabel('Firmenname').fill(name);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: `„${name}“ gespeichert` })).toBeVisible();
}

test('quote decisions: accepted, declined and removed, shown in the list, kept across a reload (F21)', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  await addCustomer(page, 'Kunde GmbH');
  const year = isoToday().slice(0, 4);
  const number = `AN-${year}-0001`;

  // a quote, finalized: it is sent and open
  await nav(page, 'Angebote');
  await page.getByRole('button', { name: 'Neues Angebot' }).click();
  await page.getByLabel('Kunde').selectOption({ label: 'Kunde GmbH' });
  await page.getByLabel('Betreff').fill('Website');
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await line(page, 1).getByLabel('Bezeichnung').fill('Konzept');
  await line(page, 1).getByLabel('Einzelpreis netto €').fill('1000');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('table').getByRole('row').nth(1).getByRole('button', { name: 'Kunde GmbH' }).click();
  await page.getByRole('button', { name: 'Angebot abschließen' }).click();
  await page.getByRole('group', { name: /^Angebot jetzt abschließen\?/ }).getByRole('button', { name: 'Jetzt abschließen' }).click();
  await expect(page.getByRole('heading', { name: `Angebot ${number}` })).toBeVisible();

  // the customer accepts it: the decision counts on the quote, the quote does not change
  await expect(decisionCard(page).getByText('Noch keine Entscheidung.')).toBeVisible();
  await decisionCard(page).getByRole('button', { name: 'Als angenommen erfassen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Entscheidung erfasst' })).toBeVisible();
  await expect(decisionCard(page).locator('dd').first()).toHaveText('Angenommen');
  await expect(page.getByRole('heading', { name: `Angebot ${number}` })).toBeVisible();

  // a wrong decision is removed; the card offers the decision again
  await decisionCard(page).getByRole('button', { name: 'Entscheidung zurücknehmen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Entscheidung zurückgenommen' })).toBeVisible();
  await expect(decisionCard(page).getByText('Noch keine Entscheidung.')).toBeVisible();
  await decisionCard(page).getByRole('button', { name: 'Als abgelehnt erfassen' }).click();
  await expect(decisionCard(page).locator('dd').first()).toHaveText('Abgelehnt');

  // the list shows the state, and the decision filter finds the quote
  await page.locator('.card-actions').getByRole('button', { name: 'Zurück zur Liste' }).click();
  const decisions = page.getByRole('group', { name: 'Entscheidung' });
  await decisions.getByRole('button', { name: /^Abgelehnt/ }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('Abgelehnt');
  await decisions.getByRole('button', { name: /^Offen/ }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(0);
  await decisions.getByRole('button', { name: /^Alle/ }).click();

  // the decision survives a reload, and both decision files and both log lines are in the folder
  await page.reload();
  await nav(page, 'Angebote');
  await page.getByRole('table').getByRole('row').nth(1).getByRole('button', { name: 'Kunde GmbH' }).click();
  await expect(decisionCard(page).locator('dd').first()).toHaveText('Abgelehnt');
  const files = await readFolders(page);
  expect(Object.keys(files).filter((f) => f.startsWith('Ordner-1/quoteStatus/'))).toHaveLength(2);
  const month = isoToday().slice(0, 7);
  const audit = (files[`Ordner-1/audit/${month}.jsonl`] ?? '').trim().split('\n').map((l) => JSON.parse(l) as { action: string });
  expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['issueQuote', 'quoteDecision', 'deleteQuoteDecision']));
  expect(errors).toEqual([]);
});
