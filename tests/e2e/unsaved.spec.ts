import { readFileSync } from 'node:fs';
import { readZip } from '../../src/data/import/zip';
import { APP_URL, expect, openSettings, readFolders, setUpCompany, test, watchErrors } from './helpers';

// A change the folder refuses for good (here: the contact file was replaced by one of a newer kontor) waits apart: the
// other changes are still saved, the export of the folder stays possible, and the change can be discarded (#95).

test('a change the folder refuses for good does not stop the work, and can be discarded', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio' });
  await page.getByRole('navigation').getByRole('button', { name: 'Kontakte' }).click();
  await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
  await page.getByLabel('Firmenname').fill('Kunde GmbH');
  await page.getByLabel('Straße und Hausnummer').fill('Ringstraße 5');
  await page.getByLabel('PLZ').fill('10115');
  await page.getByRole('textbox', { name: 'Ort', exact: true }).fill('Berlin');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: '„Kunde GmbH“ gespeichert' })).toBeVisible();

  // another device with a newer kontor rewrites the contact file
  const contactPath = Object.keys(await readFolders(page)).find((p) => p.includes('/contacts/'));
  expect(contactPath).toBeDefined();
  await page.evaluate((path) => {
    const key = `kontor.e2e.dir.${path!.replace('/', ':f:')}`;
    const entry = JSON.parse(localStorage.getItem(key)!) as { c: string; m: number };
    const contact = JSON.parse(entry.c) as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ c: JSON.stringify({ ...contact, schemaVersion: 999 }), m: entry.m + 1000 }));
  }, contactPath);

  // the change of the contact is refused and listed apart; the save status stays "saved"
  await page.getByRole('button', { name: /^Kunde GmbH/ }).click();
  await page.getByLabel('Firmenname').fill('Kunde AG');
  await page.getByRole('button', { name: 'Speichern' }).click();
  const unsaved = page.getByRole('alert').filter({ hasText: 'Nicht gespeichert, der Ordner nimmt diese Änderungen nicht an' });
  await expect(unsaved).toContainText('Kontakt „Kunde AG“: Dieser Ordner wurde mit einer neueren kontor-Version gespeichert.');
  await expect(page.getByRole('status').filter({ hasText: /^Gespeichert$/ })).toBeVisible();

  // the export is offered without the change, and holds the folder as it is
  await openSettings(page, 'App');
  await page.getByRole('button', { name: 'Ordner als ZIP exportieren' }).click();
  const leaveOut = page.getByRole('button', { name: 'Ordner trotzdem exportieren, ohne diese Änderungen' });
  await expect(leaveOut).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), leaveOut.click()]);
  const read = await readZip(readFileSync((await download.path())!));
  expect(read.ok && [...read.value.keys()].some((name) => name.startsWith('contacts/'))).toBe(true);

  // discarding asks first, then reads the folder again: the newer file cannot be read here, and the list is empty
  await unsaved.getByRole('button', { name: 'Verwerfen' }).click();
  await page.getByRole('group', { name: /^Die Änderung an Kontakt „Kunde AG“ verwerfen/ }).getByRole('button', { name: 'Ja, verwerfen' }).click();
  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
  await expect(unsaved).toHaveCount(0);
  await expect(page.getByRole('status', { name: '1 Datei(en) im Ordner konnten nicht gelesen werden' })).toContainText('contacts/');
  // the folder still holds the newer file, untouched
  expect(JSON.parse((await readFolders(page))[contactPath!]!)).toMatchObject({ schemaVersion: 999, name: 'Kunde GmbH' });
  expect(errors).toEqual([]);
});
