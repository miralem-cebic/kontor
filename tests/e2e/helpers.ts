import { expect, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const APP_URL = pathToFileURL(resolve('dist/index.html')).href + '?e2e';

/** A 1×1 PNG */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

export interface CompanyInput {
  name: string;
  owner?: string;
  smallBusiness?: boolean;
  trade?: { municipality: string; multiplier: string };
  logo?: boolean;
}

/** Collects page errors and console errors; a test ends with `expect(errors).toEqual([])` */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

/** Runs the setup assistant from its first step to "Finish", in a new empty folder. */
export async function setUpCompany(page: Page, c: CompanyInput) {
  const wizard = page.locator('.wizard');
  await expect(wizard.getByRole('heading', { name: 'Browser' })).toBeVisible();
  await page.getByRole('button', { name: 'Weiter' }).click();

  await expect(wizard.getByRole('heading', { name: 'Ordner' })).toBeVisible();
  await page.getByRole('button', { name: 'Ordner wählen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ist leer' })).toBeVisible();
  await page.getByRole('button', { name: 'Weiter' }).click();

  await expect(wizard.getByRole('heading', { name: 'Stammdaten' })).toBeVisible();
  await page.getByLabel('Firmenname').fill(c.name);
  await page.getByLabel('Inhaber/in').fill(c.owner ?? 'Erika Mustermann');
  await page.getByLabel('Straße und Hausnummer').fill('Hauptstraße 1');
  await page.getByLabel('PLZ').fill('50667');
  await page.getByRole('textbox', { name: 'Ort', exact: true }).fill('Köln');
  await page.getByLabel('E-Mail').fill('erika@example.com');
  if (c.logo) await page.locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Weiter' }).click();

  await expect(wizard.getByRole('heading', { name: 'Steuer' })).toBeVisible();
  await page.getByLabel('Steuernummer').fill('12/345/67890');
  if (c.smallBusiness ?? true) await page.getByLabel('Ja, ich bin Kleinunternehmer').check();
  else {
    await page.getByLabel('Nein, ich weise Umsatzsteuer aus').check();
    await page.getByLabel('Soll-Versteuerung').check();
    await page.getByLabel('Vierteljährlich').check();
    await page.getByLabel('Dauerfristverlängerung').check();
  }
  if (c.trade) {
    await page.getByLabel('Gewerbe').check();
    await page.getByRole('textbox', { name: 'Gemeinde', exact: true }).fill(c.trade.municipality);
    await page.getByLabel('Hebesatz in %').fill(c.trade.multiplier);
  } else await page.getByLabel('Freiberuflich').check();
  await page.getByRole('button', { name: 'Weiter' }).click();

  await expect(wizard.getByRole('heading', { name: 'Bank' })).toBeVisible();
  await page.getByLabel('IBAN').fill('DE89 3704 0044 0532 0130 00');
  await page.getByRole('button', { name: 'Weiter' }).click();

  await expect(wizard.getByRole('heading', { name: 'Rechnungen' })).toBeVisible();
  await page.getByRole('button', { name: 'Weiter' }).click();

  await expect(wizard.getByRole('heading', { name: 'Zusammenfassung' })).toBeVisible();
  await page.getByRole('button', { name: 'Fertig' }).click();
  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
  await expect(switcher(page)).toContainText(c.name);
}

export const switcher = (page: Page) => page.getByRole('button', { name: /^Unternehmen: / });

/** Opens the settings and one of their sections from the side panel, by its German name */
export async function openSettings(page: Page, section: string) {
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.getByRole('navigation', { name: 'Bereiche der Einstellungen' }).getByRole('button', { name: section, exact: true }).click();
}

/** Waits for pending writes, then reads the simulated folders as "folder/path" → content */
export async function readFolders(page: Page): Promise<Record<string, string>> {
  await page.evaluate(() => window.__e2e?.flush());
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const k of Object.keys(localStorage)) {
      const m = /^kontor\.e2e\.dir\.([^:]+):f:(.+)$/.exec(k);
      if (m) out[`${m[1]}/${m[2]}`] = (JSON.parse(localStorage.getItem(k) ?? '{}') as { c: string }).c;
    }
    return out;
  });
}

export async function readCompanyFile(page: Page, folder: string) {
  const files = await readFolders(page);
  const text = files[`${folder}/company.json`];
  if (!text) throw new Error(`No company.json in ${folder}: ${Object.keys(files).join(', ')}`);
  return JSON.parse(text) as Record<string, unknown> & { id: string; name: string; fieldUpdatedAt: Record<string, string> };
}

export function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
