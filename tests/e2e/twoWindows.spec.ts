import { APP_URL, expect, openSettings, readFolders, setUpCompany, switcher, test, watchErrors } from './helpers';

// One window per company (#97): a second window of the same browser does not open a company that is open already; it
// can take it over, and then the first window saves what is open and closes the company.

test('a company open in one window is not opened in a second one, unless it is taken over', async ({ page, context }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await setUpCompany(page, { name: 'Alpha Studio' });

  const second = await context.newPage();
  const secondErrors = watchErrors(second);
  await second.goto(APP_URL);
  await expect(second.getByRole('heading', { name: '„Alpha Studio“ ist in einem anderen Fenster geöffnet' })).toBeVisible();
  // the first window goes on working
  await expect(switcher(page)).toContainText('Alpha Studio');

  // a change in the first window that is still pending when the second window takes over is saved first
  await openSettings(page, 'Stammdaten');
  const master = page.getByRole('region', { name: 'Stammdaten' });
  await master.getByLabel('Firmenname').fill('Alpha Studio GmbH');
  await master.getByRole('button', { name: 'Speichern' }).click();

  await second.getByRole('button', { name: 'Hier öffnen' }).click();
  await expect(switcher(second)).toContainText('Alpha Studio GmbH');
  await expect(page.getByRole('heading', { name: '„Alpha Studio GmbH“ wurde in einem anderen Fenster geöffnet' })).toBeVisible();

  // and back: the first window takes it over again
  await page.getByRole('button', { name: 'Hier öffnen' }).click();
  await expect(switcher(page)).toContainText('Alpha Studio GmbH');
  await expect(second.getByRole('heading', { name: /wurde in einem anderen Fenster geöffnet$/ })).toBeVisible();

  // a reload of the window that has the company open opens it again
  await page.reload();
  await expect(switcher(page)).toContainText('Alpha Studio GmbH');
  expect(Object.keys(await readFolders(page)).some((p) => p.endsWith('/company.json'))).toBe(true);
  expect(errors).toEqual([]);
  expect(secondErrors).toEqual([]);
});
