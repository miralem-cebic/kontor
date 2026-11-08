import { expect, test, type Page } from '@playwright/test';
import { APP_URL, isoToday, setUpCompany, watchErrors } from './helpers';

const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name }).click();
const line = (page: Page, n: number) => page.getByRole('group', { name: `Position ${n}`, exact: true });

test('reports: income per customer, expenses per category, open items, the year comparison, the search and the CSV', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', smallBusiness: false });
  const year = isoToday().slice(0, 4);

  // a customer
  await nav(page, 'Kontakte');
  await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
  await page.getByLabel('Firmenname').fill('Kunde GmbH');
  await page.getByLabel('Straße und Hausnummer').fill('Ringstraße 5');
  await page.getByLabel('PLZ').fill('10115');
  await page.getByRole('textbox', { name: 'Ort', exact: true }).fill('Berlin');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: '„Kunde GmbH“ gespeichert' })).toBeVisible();

  // an expense of 49,99 € with 7,98 € VAT, category "Telefon"
  await nav(page, 'Ausgaben');
  await page.getByRole('button', { name: 'Neue Ausgabe' }).click();
  await page.getByLabel('Lieferant').fill('Telekom');
  await page.getByLabel('Betrag in € (brutto)').fill('49,99');
  await page.getByLabel('Kategorie').fill('Telefon');
  await page.getByRole('button', { name: 'Ausgabe speichern' }).click();

  // an invoice of 8 hours at 95 € net: 760,00 € net, 904,40 € gross; issued, 300 € paid
  await nav(page, 'Rechnungen');
  await page.getByRole('button', { name: 'Neue Rechnung' }).click();
  await page.getByLabel('Kunde').selectOption({ label: 'Kunde GmbH' });
  await page.getByLabel('Betreff').fill('Beratung');
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await line(page, 1).getByLabel('Bezeichnung').fill('Beratung');
  await line(page, 1).getByLabel('Menge').fill('8');
  await line(page, 1).getByLabel('Einzelpreis netto €').fill('95');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('button', { name: 'Kunde GmbH' }).filter({ hasText: 'Kunde GmbH' }).last().click();
  await page.getByRole('button', { name: 'Rechnung ausstellen' }).click();
  await page.getByRole('group', { name: /^Rechnung jetzt ausstellen\?/ }).getByRole('button', { name: 'Jetzt ausstellen' }).click();
  await expect(page.getByRole('heading', { name: `Rechnung RE-${year}-0001` })).toBeVisible();
  const payments = page.locator('section[aria-labelledby="invoice-payments"]');
  await payments.getByRole('button', { name: 'Zahlung erfassen' }).click();
  await page.getByLabel('Betrag').fill('300');
  await page.getByRole('button', { name: 'Zahlung speichern' }).click();
  await expect(payments.getByText('Teilbezahlt')).toBeVisible();

  // income per customer: the net part of 300 € of 904,40 € gross is 252,10 €
  await nav(page, 'Auswertungen');
  await expect(page.getByRole('heading', { name: 'Auswertungen', level: 1 })).toBeVisible();
  const turnover = page.getByRole('region', { name: `Einnahmen ${year} je Kunde (Schätzung)` });
  await expect(turnover.getByRole('row', { name: /Kunde GmbH/ })).toContainText('252,10');
  await expect(turnover.getByRole('row', { name: /^Summe/ })).toContainText('252,10');
  await expect(page.getByText('Alle Zahlen sind Schätzungen').first()).toBeVisible();

  // expenses per category, without the VAT that comes back
  await page.getByRole('tab', { name: 'Ausgaben je Kategorie' }).click();
  const categories = page.getByRole('region', { name: `Ausgaben ${year} je Kategorie (Schätzung)` });
  await expect(categories.getByRole('row', { name: /Telefon/ })).toContainText('42,01');

  // open items: 604,40 € on the invoice, not yet due
  await page.getByRole('tab', { name: 'Offene Posten' }).click();
  const open = page.getByRole('region', { name: /^Offene Posten \(Stand/ });
  await expect(open.getByRole('row', { name: /RE-/ })).toContainText('604,40');
  await expect(open.getByRole('row', { name: /RE-/ })).toContainText('nicht überfällig');
  await expect(page.getByRole('region', { name: 'Summe je Kunde' }).getByRole('row', { name: /Kunde GmbH/ })).toContainText('604,40');

  // the comparison: this year against the year before
  await page.getByRole('tab', { name: 'Vorjahresvergleich' }).click();
  const comparison = page.getByRole('region', { name: `${year} im Vergleich zu ${Number(year) - 1} (Schätzung)` });
  await expect(comparison.getByRole('row', { name: /^Summe/ })).toContainText('252,10');
  await expect(comparison.getByRole('row', { name: /^Summe/ })).toContainText('42,01');

  // the tabs work with the keyboard (WAI-ARIA tabs pattern): only the selected tab is in the Tab order, the arrow keys
  // wrap around, Home and End go to the first and the last tab, and the tab moved to is selected and focused
  const tab = (name: string) => page.getByRole('tab', { name });
  await expect(tab('Vorjahresvergleich')).toHaveAttribute('tabindex', '0');
  await expect(tab('Einnahmen je Kunde')).toHaveAttribute('tabindex', '-1');
  await tab('Vorjahresvergleich').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab('Einnahmen je Kunde')).toBeFocused();
  await expect(tab('Einnahmen je Kunde')).toHaveAttribute('aria-selected', 'true');
  await expect(turnover).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(tab('Vorjahresvergleich')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab('Einnahmen je Kunde')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tab('Ausgaben je Kategorie')).toHaveAttribute('aria-selected', 'true');
  await expect(categories).toBeVisible();
  await page.keyboard.press('End');
  await expect(tab('Vorjahresvergleich')).toBeFocused();
  await expect(comparison).toBeVisible();

  // the search finds the invoice by its number, with the kind of record
  await page.getByLabel('Alles durchsuchen').fill(`RE-${year}-0001`);
  const results = page.getByRole('region', { name: 'Suchergebnisse' });
  await expect(results.getByRole('row', { name: /Rechnung/ })).toContainText(`RE-${year}-0001`);
  await page.getByLabel('Alles durchsuchen').fill('telekom');
  await expect(results.getByRole('row', { name: /Ausgabe/ })).toContainText('Telekom');
  await page.getByLabel('Alles durchsuchen').fill('gibtesnicht');
  await expect(results.getByText('Nichts gefunden.')).toBeVisible();

  // the CSV of the open report is downloaded
  await page.getByRole('tab', { name: 'Offene Posten' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV exportieren' }).click();
  expect((await download).suggestedFilename()).toBe(`kontor-open-${isoToday()}.csv`);

  expect(errors).toEqual([]);
});
