import { APP_URL, expect, isoToday, readFolders, setUpCompany, test, watchErrors } from './helpers';

// Files of the folder that cannot be read stay listed where the figures are, not only in a toast that is gone after
// four seconds; one toast is shown for the whole load, and no daily backup is made of a state known to be incomplete (#96).

test('files that cannot be read are listed on the overview, the reports and the taxes, and stop the daily backup', async ({ page }) => {
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

  // a sync client leaves a half-written contact and a document of a newer kontor; today's backup is gone
  const files = await readFolders(page);
  const contactPath = Object.keys(files).find((p) => p.includes('/contacts/'))!;
  const folder = contactPath.split('/')[0]!;
  const documentId = '9b2f6a52-1c33-4d6e-8f3a-2b8d3c4e5f60';
  await page.evaluate(
    ({ folder, contactPath, documentId, today }) => {
      const key = (path: string) => `kontor.e2e.dir.${path.replace('/', ':f:')}`;
      localStorage.setItem(key(contactPath), JSON.stringify({ c: '{"schemaVersion": 17, "id": ', m: Date.now() }));
      localStorage.setItem(`kontor.e2e.dir.${folder}:f:documents/${documentId}.json`, JSON.stringify({ c: JSON.stringify({ schemaVersion: 999, id: documentId }), m: Date.now() }));
      localStorage.removeItem(`kontor.e2e.dir.${folder}:f:backups/${today}.json`);
    },
    { folder, contactPath, documentId, today: isoToday() },
  );
  await page.reload();

  // one toast for the load, and the notice with both files, which stays after the toast is gone
  const toast = page.getByRole('status').filter({ hasText: '2 Datei(en) im Ordner konnten nicht gelesen werden. Die Übersicht zeigt, welche.' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Schließen' }).click();
  const notice = page.getByRole('status', { name: '2 Datei(en) im Ordner konnten nicht gelesen werden' });
  await expect(notice).toContainText('Die Zahlen können unvollständig sein');
  await notice.getByText('Betroffene Dateien').click();
  await expect(notice).toContainText(contactPath.slice(folder.length + 1));
  await expect(notice).toContainText(`documents/${documentId}.json`);

  await page.getByRole('navigation').getByRole('button', { name: 'Auswertungen' }).click();
  await expect(page.getByRole('status', { name: '2 Datei(en) im Ordner konnten nicht gelesen werden' })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Steuern' }).click();
  await expect(page.getByRole('status', { name: '2 Datei(en) im Ordner konnten nicht gelesen werden' })).toBeVisible();

  // no backup of the incomplete state, and the unreadable files are left as they are
  const after = await readFolders(page);
  expect(Object.keys(after).filter((p) => p.startsWith(`${folder}/backups/`))).toEqual([]);
  expect(after[contactPath]).toBe('{"schemaVersion": 17, "id": ');
  expect(errors).toEqual([]);
});
