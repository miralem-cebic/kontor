import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { documentTotals, draftLineNet, draftTotals, emptyLineDraft, lineDraftFromItem, lineNetInRange, type LineDraft } from '../../src/domain/document';
import { basisPoints, cents, quantity } from '../../src/domain/money';
import { byQuoteDate, draftFromQuote, emptyQuoteDraft, isExpired, quoteMatches, readQuote, type QuoteDraft } from '../../src/domain/quote';
import { UNITS } from '../../src/domain/units';
import { VAT_RATES } from '../../src/domain/vat';
import { fcParams, sampleItem, sampleLine, sampleQuote } from './fixtures';

let seq = 0;
const key = () => `k${++seq}`;
const problems = (r: ReturnType<typeof readQuote>) => (r.ok ? [] : r.error.map((e) => `${e.field}:${e.problem}`));
const line = (over: Partial<LineDraft> = {}): LineDraft => ({ ...emptyLineDraft(key()), name: 'Webdesign', quantity: '2', unitPrice: '85', ...over });
const draft = (over: Partial<QuoteDraft> = {}): QuoteDraft => ({ ...emptyQuoteDraft('2026-10-22'), customerId: 'c1', ...over });

describe('totals', () => {
  it('sums per rate and rounds the VAT once per rate (ADR 0003)', () => {
    const t = documentTotals(sampleQuote().lines, false);
    expect(t.byRate).toEqual([
      { rate: 700, net: 30000, tax: 2100 },
      { rate: 1900, net: 106250, tax: 20188 },
    ]);
    expect([t.net, t.tax, t.gross]).toEqual([136250, 22288, 158538]);
  });

  it('a small business charges no VAT', () => {
    const t = documentTotals(sampleQuote().lines, true);
    expect([t.net, t.tax, t.gross]).toEqual([136250, 0, 136250]);
  });

  it('a negative quantity deducts', () => {
    const t = documentTotals([sampleLine(), sampleLine({ name: 'Rabatt', quantity: quantity(-1000), unitPrice: cents(6250) })], false);
    expect(t.net).toBe(100000);
  });

  it('checks the size of a line exactly, before it is computed', () => {
    expect(lineNetInRange(cents(99_999_999_999), quantity(1000))).toBe(true);
    expect(lineNetInRange(cents(99_999_999_999), quantity(1001))).toBe(false);
    expect(lineNetInRange(cents(99_999_999_999), quantity(-999_999_999))).toBe(false);
  });

  it('the editor sums only the lines that can be read so far', () => {
    const lines = [line(), line({ quantity: 'zwei' }), line({ unitPrice: '' }), line({ quantity: '1', unitPrice: '100', vatRate: basisPoints(700) })];
    expect(lines.map((l) => draftLineNet(l, 'de'))).toEqual([17000, null, null, 10000]);
    const t = draftTotals(lines, 'de', false);
    expect([t.net, t.tax, t.gross]).toEqual([27000, 3930, 30930]);
  });
});

describe('readQuote', () => {
  it('needs a customer and valid dates; lines may still be missing', () => {
    expect(problems(readQuote({ ...emptyQuoteDraft('2026-10-22') }, 'de'))).toEqual(['customerId:required']);
    expect(problems(readQuote(draft({ date: '2026-02-30', validUntil: '' }), 'de'))).toEqual(['date:date', 'validUntil:date']);
    expect(problems(readQuote(draft({ validUntil: '2026-10-21' }), 'de'))).toEqual(['validUntil:validUntil']);
    const r = readQuote(draft({ subject: ' Relaunch ' }), 'de');
    expect(r.ok && r.value).toEqual({
      customerId: 'c1',
      content: { date: '2026-10-22', validUntil: '2026-11-21', subject: 'Relaunch', introText: '', closingText: '', lines: [] },
    });
  });

  it('a new quote is valid for 30 days', () => {
    expect(emptyQuoteDraft('2026-12-15').validUntil).toBe('2027-01-14');
  });

  it('names the line and the field of an error', () => {
    const r = readQuote(draft({ lines: [line(), line({ name: '', quantity: '0', unitPrice: '-1' }), line({ quantity: '1,5', unitPrice: '1.250,5' })] }), 'de');
    expect(problems(r)).toEqual(['line.1.name:required', 'line.1.quantity:quantity', 'line.1.unitPrice:priceNegative']);
    const ok = readQuote(draft({ lines: [line({ quantity: '1,5', unitPrice: '1.250,5' })] }), 'de');
    expect(ok.ok && ok.value.content.lines[0]).toMatchObject({ quantity: 1500, unitPrice: 125050 });
  });

  it('refuses a line whose amount is too large', () => {
    expect(problems(readQuote(draft({ lines: [line({ quantity: '2', unitPrice: '999.999.999,99' })] }), 'de'))).toEqual(['line.0.quantity:lineTooLarge']);
    expect(problems(readQuote(draft({ lines: [line({ quantity: '1.000.000' })] }), 'de'))).toEqual(['line.0.quantity:quantity']);
  });

  it('refuses more than 200 lines', () => {
    const many = Array.from({ length: 201 }, () => line());
    expect(problems(readQuote(draft({ lines: many }), 'de'))).toEqual(['lines:tooManyLines']);
  });

  it('a line from the catalogue takes over text, unit, price and rate', () => {
    const l = lineDraftFromItem('k', sampleItem(), 'de');
    expect(l).toMatchObject({ name: 'Webdesign', description: 'Gestaltung und Umsetzung\nnach Aufwand', quantity: '1', unit: 'HUR', unitPrice: '85,00', vatRate: 1900 });
  });
});

describe('draft ↔ quote', () => {
  const arbLine = fc.record({
    name: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim() === s && s !== ''),
    description: fc.constantFrom('', 'Zweite Zeile\nund dritte'),
    quantity: fc.integer({ min: -999_999, max: 999_999 }).filter((q) => q !== 0).map(quantity),
    unit: fc.constantFrom(...UNITS),
    unitPrice: fc.integer({ min: 0, max: 99_999_999 }).map(cents),
    vatRate: fc.constantFrom(...VAT_RATES),
  });

  it('a quote survives the round trip through the draft, in both languages', () =>
    fc.assert(
      fc.property(fc.array(arbLine, { maxLength: 5 }), fc.constantFrom('de' as const, 'en' as const), (lines, locale) => {
        const quote = sampleQuote({ lines });
        const r = readQuote(draftFromQuote('c1', quote, locale, key), locale);
        return r.ok && r.value.customerId === 'c1' && JSON.stringify(r.value.content) === JSON.stringify(quote);
      }),
      fcParams,
    ));
});

describe('lists', () => {
  it('searches the customer and the subject', () => {
    expect(quoteMatches(sampleQuote(), 'Kunde GmbH', 'kunde')).toBe(true);
    expect(quoteMatches(sampleQuote(), 'Kunde GmbH', 'RELAUNCH')).toBe(true);
    expect(quoteMatches(sampleQuote(), 'Kunde GmbH', 'Logo')).toBe(false);
  });

  it('a quote has expired after its last valid day', () => {
    expect(isExpired(sampleQuote(), '2026-11-21')).toBe(false);
    expect(isExpired(sampleQuote(), '2026-11-22')).toBe(true);
  });

  it('newest first', () => {
    const quotes = [sampleQuote({ date: '2026-10-01' }), sampleQuote({ date: '2026-10-22', subject: 'B' }), sampleQuote({ date: '2026-10-22', subject: 'A' })];
    expect(quotes.sort(byQuoteDate).map((q) => `${q.date} ${q.subject}`)).toEqual(['2026-10-22 A', '2026-10-22 B', '2026-10-01 Website-Relaunch']);
  });
});
