import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeContact, makeInvoice } from '../../src/data/schema';
import type { BankAccount } from '../../src/data/types';
import { cents, quantity } from '../../src/domain/money';
import { documentContent, type DocumentContent } from '../../src/pdf/content';
import { layoutDocument, MM, PAGE, wrap, type Item, type Layout, type Metrics, type TextItem } from '../../src/pdf/layout';
import { fcParams, sampleCompany, sampleContact, sampleInvoice, sampleLine } from './fixtures';

/** Every character is half as wide as the font is tall */
const metrics: Metrics = { width: (text, _font, size) => [...text].length * size * 0.5 };

const company = sampleCompany();
const customer = makeContact(sampleContact());
const account = company.bank.accounts[0] as BankAccount;
const content = (lines = sampleInvoice().lines, over: Parameters<typeof sampleInvoice>[0] = {}): DocumentContent =>
  documentContent({ company, document: makeInvoice(customer.id, account.id, sampleInvoice({ ...over, lines }), null), customer, account, lang: 'de' });
const texts = (items: readonly Item[]) => items.filter((i): i is TextItem => i.kind === 'text');
const manyLines = (n: number, description = '') => Array.from({ length: n }, (_, i) => sampleLine({ name: `Position ${i + 1}`, description, quantity: quantity(1000), unitPrice: cents(10000) }));

/** The top of the footer: its rule, the last rule that spans the body on a page */
const footerTop = (page: Layout['pages'][number]) => Math.max(...page.items.filter((i) => i.kind === 'rule' && i.x1 === 25 * MM && i.x2 === 190 * MM).map((i) => (i.kind === 'rule' ? i.y1 : 0)));

describe('wrap', () => {
  it('breaks between words, keeps line breaks and breaks a word that is too long', () => {
    // 10 pt: 5 points per character, 50 points = 10 characters
    expect(wrap('eins zwei drei vier', 50, 'regular', 10, metrics)).toEqual(['eins zwei', 'drei vier']);
    expect(wrap('Zeile 1\n\nZeile 3', 50, 'regular', 10, metrics)).toEqual(['Zeile 1', '', 'Zeile 3']);
    expect(wrap('Donaudampfschifffahrt', 50, 'regular', 10, metrics)).toEqual(['Donaudampf', 'schifffahr', 't']);
    expect(wrap('  ', 50, 'regular', 10, metrics)).toEqual([]);
  });

  it('never makes a line wider than allowed, and loses no character', () =>
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), fc.integer({ min: 10, max: 400 }), (text, width) => {
        const lines = wrap(text, width, 'regular', 10, metrics);
        const tooWide = lines.some((l) => metrics.width(l, 'regular', 10) > width && [...l].length > 1);
        return !tooWide && lines.join('').replace(/\s/g, '') === text.replace(/\s/g, '');
      }),
      fcParams,
    ));
});

describe('layoutDocument', () => {
  it('one page: the address field and the information block of DIN 5008 form B, the footer and the page number', () => {
    const layout = layoutDocument(content(), metrics, { logo: false });
    expect(layout.pages).toHaveLength(1);
    const items = texts(layout.pages[0]?.items ?? []);
    const at = (text: string) => items.find((i) => i.text === text);
    // the address starts below 62.7 mm, 25 mm from the left; the information block at 125 mm
    expect(at('Kunde GmbH')).toMatchObject({ x: 25 * MM });
    expect(at('Kunde GmbH')?.y).toBeGreaterThan(62.7 * MM);
    expect(at('Rechnungsnummer')).toMatchObject({ x: 125 * MM });
    expect(at('Seite 1 von 1')).toBeDefined();
    expect(layout.pages[0]?.items.filter((i) => i.kind === 'watermark')).toEqual([{ kind: 'watermark', text: 'ENTWURF', size: 110 }]);
    expect(layout.pages[0]?.items.some((i) => i.kind === 'logo')).toBe(false);
    expect(layoutDocument(content(), metrics, { logo: true }).pages[0]?.items.some((i) => i.kind === 'logo')).toBe(true);
  });

  it('numbers are right aligned in their column', () => {
    const items = texts(layoutDocument(content(), metrics, { logo: false }).pages[0]?.items ?? []);
    const totals = items.filter((i) => i.text.endsWith('€') && i.text.includes('1.062,50'));
    // the line amount ends at the right margin (190 mm)
    expect(totals.map((i) => i.x + metrics.width(i.text, i.font, i.size))).toContainEqual(190 * MM);
  });

  it('many lines continue on the next page, with the table header and the running head', () => {
    const layout = layoutDocument(content(manyLines(60)), metrics, { logo: false });
    expect(layout.pages.length).toBeGreaterThan(1);
    const second = texts(layout.pages[1]?.items ?? []).map((i) => i.text);
    expect(second).toContain('Rechnungsentwurf · Kunde GmbH');
    expect(second).toContain('Bezeichnung');
    expect(second).toContain(`Seite 2 von ${layout.pages.length}`);
    // every line is there, once
    const all = layout.pages.flatMap((p) => texts(p.items).map((i) => i.text));
    for (let i = 1; i <= 60; i++) expect(all.filter((t) => t === `Position ${i}`)).toHaveLength(1);
    expect(all.filter((t) => t === 'Gesamtbetrag')).toHaveLength(1);
  });

  it('a line longer than a page breaks between its lines', () => {
    const long = sampleLine({ name: 'Lang', description: Array.from({ length: 120 }, (_, i) => `Zeile ${i + 1}`).join('\n') });
    const layout = layoutDocument(content([long]), metrics, { logo: false });
    const all = layout.pages.flatMap((p) => texts(p.items).map((i) => i.text));
    expect(layout.pages.length).toBeGreaterThan(1);
    expect(all).toContain('Zeile 1');
    expect(all).toContain('Zeile 120');
  });

  it('no text runs into the footer or off the page, whatever the lines', () =>
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), fc.string({ maxLength: 400 }), fc.string({ maxLength: 120 }), (n, description, name) => {
        const lines = manyLines(n, description).map((l, i) => (i === 0 ? { ...l, name: name.trim() || 'x' } : l));
        const layout = layoutDocument(content(lines, { introText: description, closingText: description }), metrics, { logo: false });
        return layout.pages.every((page) => {
          const top = footerTop(page);
          return texts(page.items).every((t) => {
            const inFooter = t.y > top;
            const right = t.x + metrics.width(t.text, t.font, t.size);
            return t.x >= 0 && right <= PAGE.width - 10 * MM && t.y > 0 && t.y < PAGE.height && (inFooter ? t.size <= 7 : true);
          });
        });
      }),
      { ...fcParams, numRuns: Math.min(fcParams.numRuns, 60) },
    ));
});
