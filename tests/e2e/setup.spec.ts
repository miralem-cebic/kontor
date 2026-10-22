import { expect, test } from '@playwright/test';
import { APP_URL, isoToday, PNG, readCompanyFile, readFolders, switcher, watchErrors } from './helpers';

test('the setup assistant checks each step and writes the company folder', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await page.getByRole('button', { name: 'Weiter' }).click();

  // the folder step needs a folder
  await expect(page.getByRole('button', { name: 'Weiter' })).toBeDisabled();
  await page.getByRole('button', { name: 'Ordner wählen' }).click();
  await expect(page.getByText('Der Ordner „Ordner-1“ ist leer.')).toBeVisible();
  await page.getByRole('button', { name: 'Weiter' }).click();

  // an empty step is not accepted; the first invalid field gets the focus
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByText('Bitte ausfüllen.').first()).toBeVisible();
  await expect(page.getByLabel('Firmenname')).toBeFocused();
  await page.getByLabel('Firmenname').fill('Muster Design');
  await page.getByLabel('Inhaber/in').fill('Erika Mustermann');
  await page.getByLabel('Straße und Hausnummer').fill('Hauptstraße 1');
  await page.getByLabel('PLZ').fill('5066');
  await page.getByRole('textbox', { name: 'Ort', exact: true }).fill('Köln');
  await page.getByLabel('E-Mail').fill('erika@example.com');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByText('Bitte eine gültige Postleitzahl eingeben')).toBeVisible();
  await page.getByLabel('PLZ').fill('50667');
  await page.locator('input[type=file]').setInputFiles({ name: 'logo.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
  await expect(page.getByText('Nur PNG, JPG und SVG werden unterstützt.')).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('img', { name: 'Vorschau des Logos' })).toBeVisible();
  await page.getByRole('button', { name: 'Weiter' }).click();

  // tax: regular VAT with its follow-up questions, trade with multiplier
  await expect(page.getByRole('heading', { name: 'Steuer' })).toBeVisible();
  // who kontor is for, and that VAT covers all businesses of one person
  await expect(page.getByRole('note')).toContainText('kontor ist für Einzelunternehmen');
  await expect(page.getByRole('note')).toContainText('Kleinunternehmerregelung und Voranmeldung gelten für alle Betriebe zusammen');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByText('Bitte die Steuernummer oder die USt-IdNr. angeben.')).toBeVisible();
  await page.getByLabel('USt-IdNr.').fill('DE136695977');
  await page.getByRole('radio', { name: 'Nein, ich weise Umsatzsteuer aus' }).check();
  await page.getByRole('radio', { name: 'Soll-Versteuerung' }).check();
  await page.getByRole('radio', { name: 'Monatlich' }).check();
  await page.getByLabel('Dauerfristverlängerung').check();
  await page.getByRole('radio', { name: 'Gewerbe' }).check();
  await page.getByRole('textbox', { name: 'Gemeinde', exact: true }).fill('Köln');
  await page.getByLabel('Hebesatz in %').fill('150');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByText('Keine gültige deutsche USt-IdNr.')).toBeVisible();
  await expect(page.getByText('Bitte eine ganze Zahl ab 200 eingeben.')).toBeVisible();
  await page.getByLabel('USt-IdNr.').fill('DE 136 695 976');
  await page.getByLabel('Hebesatz in %').fill('475');
  await page.getByRole('button', { name: 'Weiter' }).click();

  // bank: the first account becomes the default; the holder is suggested from the owner, the IBAN check digits are checked
  await expect(page.getByText('Dieses Konto wird das Standardkonto für deine Rechnungen.')).toBeVisible();
  await expect(page.getByLabel('Kontoinhaber/in')).toHaveValue('Erika Mustermann');
  await page.getByLabel('IBAN').fill('DE89 3704 0044 0532 0130 01');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByText('Die Prüfziffer der IBAN stimmt nicht.')).toBeVisible();
  await page.getByLabel('IBAN').fill('de89 3704 0044 0532 0130 00');
  await page.getByRole('button', { name: 'Weiter' }).click();

  // invoices: live preview of the number
  const year = new Date().getFullYear();
  await expect(page.getByText(`Die erste Rechnung bekäme die Nummer RE-${year}-0001.`)).toBeVisible();
  await page.getByLabel('Rechnungsnummer').fill('{YY}-{NNN}');
  await expect(page.getByText(`Die erste Rechnung bekäme die Nummer ${String(year).slice(2)}-001.`)).toBeVisible();
  await page.getByLabel('Zahlungsziel in Tagen').fill('30');
  await page.getByRole('button', { name: 'Weiter' }).click();

  // summary, with a way back to a step
  await expect(page.getByRole('heading', { name: 'Zusammenfassung' })).toBeVisible();
  await expect(page.getByText('Soll-Versteuerung · Monatlich · mit Dauerfristverlängerung')).toBeVisible();
  await expect(page.getByText('Gewerbe, Köln, Hebesatz 475 %')).toBeVisible();
  await expect(page.getByText('DE89 3704 0044 0532 0130 00')).toBeVisible();
  await page.getByRole('button', { name: 'Bank ändern' }).click();
  await expect(page.getByRole('heading', { name: 'Bank' })).toBeFocused();
  await page.getByLabel('BIC').fill('COBADEFFXXX');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();

  // nothing is written before "Finish"
  expect(Object.keys(await readFolders(page))).toEqual([]);
  await page.getByRole('button', { name: 'Fertig' }).click();
  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
  await expect(switcher(page)).toContainText('Muster Design');

  const files = await readFolders(page);
  const company = await readCompanyFile(page, 'Ordner-1');
  expect(company).toMatchObject({
    schemaVersion: 2,
    name: 'Muster Design',
    address: { street: 'Hauptstraße 1', postalCode: '50667', city: 'Köln', country: 'DE' },
    tax: {
      taxNumber: '',
      vatId: 'DE136695976',
      vat: { kind: 'regular', method: 'accrual', period: 'monthly', permanentExtension: true },
      business: { kind: 'trade', municipality: 'Köln', multiplierPercent: 475 },
    },
    bank: { accounts: [{ kind: 'bank', name: '', holder: 'Erika Mustermann', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', deletedAt: null }] },
    invoiceDefaults: { numberPattern: '{YY}-{NNN}', paymentTermDays: 30, footer: '' },
    logo: { type: 'image/png' },
  });
  const bank = company['bank'] as { defaultAccountId: string; accounts: { id: string }[] };
  expect(bank.defaultAccountId).toBe(bank.accounts[0]?.id);
  const logo = company['logo'] as { file: string; sha256: string };
  expect(logo.file).toBe(`logo-${logo.sha256.slice(0, 16)}.png`);
  expect(Object.keys(files)).toContain(`Ordner-1/assets/${logo.file}`);
  expect(Object.keys(files)).toContain(`Ordner-1/backups/${isoToday()}.json`);
  await expect(page.locator('.sw-logo img')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a folder that is not empty gets a subfolder named after the company', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await page.evaluate(() => {
    localStorage.setItem('kontor.e2e.dir.Dokumente:d:', '1');
    localStorage.setItem('kontor.e2e.dir.Dokumente:f:notes.txt', JSON.stringify({ c: 'hello', m: 1 }));
    window.__e2e?.nextFolder('Dokumente');
  });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Ordner wählen' }).click();
  await expect(page.getByText('Der Ordner „Dokumente“ enthält schon Dateien.')).toBeVisible();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByLabel('Firmenname').fill('Beta: Büro/Web');
  await page.getByLabel('Inhaber/in').fill('Max Muster');
  await page.getByLabel('Straße und Hausnummer').fill('Weg 2');
  await page.getByLabel('PLZ').fill('10115');
  await page.getByRole('textbox', { name: 'Ort', exact: true }).fill('Berlin');
  await page.getByLabel('E-Mail').fill('max@example.com');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByLabel('Steuernummer').fill('1234567890');
  await page.getByRole('radio', { name: 'Ja, ich bin Kleinunternehmer' }).check();
  await page.getByRole('radio', { name: 'Freiberuflich' }).check();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByLabel('IBAN').fill('AT611904300234573201');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByText('Unterordner „Beta: Büro/Web“ in „Dokumente“')).toBeVisible();
  await page.getByRole('button', { name: 'Fertig' }).click();
  await expect(switcher(page)).toContainText('Beta: Büro/Web');

  const files = await readFolders(page);
  // unsafe characters in the folder name are replaced
  expect(Object.keys(files).sort()).toEqual(expect.arrayContaining(['Dokumente/notes.txt', 'Dokumente/Beta_ Büro_Web/company.json']));
  expect(files['Dokumente/notes.txt']).toBe('hello');
  expect(errors).toEqual([]);
});
