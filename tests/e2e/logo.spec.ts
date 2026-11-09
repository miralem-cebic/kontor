import { APP_URL, expect, openSettings, readFolders, setUpCompany, switcher, test, watchErrors } from './helpers';

// The logo file of the folder is used only when it is the file company.json names (#78): a file replaced in a shared
// folder is neither shown nor printed, and the settings and the confirmation before issuing say so.

test('a logo file that was replaced in the folder is neither shown nor printed, and the person is told', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio', logo: true });
  await expect(switcher(page).locator('img')).toHaveCount(1);

  // another file under the name of the logo: one byte more, so its SHA-256 is no longer the saved one
  const logoPath = Object.keys(await readFolders(page)).find((p) => p.includes('/assets/logo-'));
  expect(logoPath).toBeDefined();
  await page.evaluate((path) => {
    const key = `kontor.e2e.dir.${path!.replace('/', ':f:')}`;
    const entry = JSON.parse(localStorage.getItem(key)!) as { c: string };
    const [head, data] = entry.c.split(',');
    const bytes = atob(data!) + '\0';
    localStorage.setItem(key, JSON.stringify({ ...entry, c: `${head},${btoa(bytes)}` }));
  }, logoPath);
  await page.reload();
  await expect(switcher(page)).toContainText('Alpha Studio');
  await expect(switcher(page).locator('img')).toHaveCount(0);

  await openSettings(page, 'Logo');
  await expect(page.getByRole('status').filter({ hasText: 'Die Logodatei im Ordner ist nicht mehr die gespeicherte' })).toBeVisible();
  expect(errors).toEqual([]);
});
