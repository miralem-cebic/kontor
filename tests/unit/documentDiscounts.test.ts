import { describe, expect, it } from 'vitest';
import { NO_DISCOUNT, type Discount } from '../../src/domain/discount';
import { draftLineNet, draftTotals, documentTotals, emptyLineDraft, lineTotal, type LineDraft } from '../../src/domain/document';
import { cancellationContent, draftFromInvoice, emptyInvoiceDraft, invoiceDraftFromQuote, invoiceTotals, readInvoice } from '../../src/domain/invoice';
import { basisPoints, cents, quantity } from '../../src/domain/money';
import { draftFromQuote, readQuote, type QuoteDraft, emptyQuoteDraft } from '../../src/domain/quote';
import { lineChanges } from '../../src/domain/quoteVersions';
import { sampleInvoice, sampleLine, sampleQuote } from './fixtures';

// Discounts (F23): on a line and on the whole document of a quote or an invoice. The amounts below are worked out by
// hand; the sample lines are 12,5 h × 85,00 € at 19 % (1062,50 €) and 1 × 300,00 € at 7 %.

let seq = 0;
const key = () => `k${++seq}`;
const problems = (r: ReturnType<typeof readQuote>) => (r.ok ? [] : r.error.map((e) => `${e.field}:${e.problem}`));
const percent = (rate: number): Discount => ({ kind: 'percent', rate: basisPoints(rate) });
const amount = (value: number): Discount => ({ kind: 'amount', amount: cents(value) });
const line = (over: Partial<LineDraft> = {}): LineDraft => ({ ...emptyLineDraft(key()), name: 'Webdesign', quantity: '2', unitPrice: '85', ...over });
const draft = (over: Partial<QuoteDraft> = {}): QuoteDraft => ({ ...emptyQuoteDraft('2026-10-22'), customerId: 'c1', ...over });

describe('discount on a line', () => {
  it('a percentage: 2 × 85,00 € less 10 % is 153,00 €', () => {
    const l = sampleLine({ quantity: quantity(2000), unitPrice: cents(8500), discount: percent(1000) });
    expect(lineTotal(l)).toBe(15300);
    expect(documentTotals([l], false, NO_DISCOUNT)).toMatchObject({ subtotal: 17000, discount: 1700, net: 15300, tax: 2907, gross: 18207 });
  });

  it('an amount: 170,00 € less 20,00 € is 150,00 €', () => {
    const l = sampleLine({ quantity: quantity(2000), unitPrice: cents(8500), discount: amount(2000) });
    expect(documentTotals([l], false, NO_DISCOUNT)).toMatchObject({ subtotal: 17000, discount: 2000, net: 15000 });
  });

  it('a line of a deduction takes off in its direction: −1 × 100,00 € with 10,00 € off is −90,00 €', () => {
    const l = sampleLine({ quantity: quantity(-1000), unitPrice: cents(10000), discount: amount(1000) });
    expect(lineTotal(l)).toBe(-9000);
  });
});

describe('discount on the whole document', () => {
  it('a percentage applies to the net amount of every rate; the VAT is rounded once per rate', () => {
    const t = documentTotals(sampleQuote().lines, false, percent(1000));
    expect(t.byRate).toEqual([
      { rate: 700, net: 27000, tax: 1890 },
      { rate: 1900, net: 95625, tax: 18169 },
    ]);
    expect(t).toMatchObject({ subtotal: 136250, discount: 13625, net: 122625, tax: 20059, gross: 142684 });
  });

  it('an amount is shared between the rates in proportion to their amounts', () => {
    const t = documentTotals(sampleQuote().lines, false, amount(100000));
    expect(t.byRate).toEqual([
      { rate: 700, net: 7982, tax: 559 },
      { rate: 1900, net: 28268, tax: 5371 },
    ]);
    expect(t).toMatchObject({ subtotal: 136250, discount: 100000, net: 36250, tax: 5930, gross: 42180 });
  });

  it('a discount of the whole document does not change the lines', () => {
    const lines = sampleQuote().lines;
    documentTotals(lines, false, percent(1000));
    expect(lines).toEqual(sampleQuote().lines);
  });

  it('a small business charges no VAT, but the discount still counts', () => {
    expect(documentTotals(sampleQuote().lines, true, percent(1000))).toMatchObject({ net: 122625, tax: 0, gross: 122625 });
  });

  it('line and document discounts add up: 10 % off the line (1062,50 → 956,25 €), then 10 % of that (95,63 €, rounded)', () => {
    const lines = [sampleLine({ discount: percent(1000) })];
    const t = documentTotals(lines, false, percent(1000));
    expect(t).toMatchObject({ subtotal: 106250, discount: 20188, net: 86062 });
  });
});

describe('readQuote with discounts', () => {
  it('a line discount larger than its line is refused', () => {
    expect(problems(readQuote(draft({ lines: [line({ discountKind: 'amount', discountValue: '171' })] }), 'de', false))).toEqual(['line.0.discountValue:discountTooLarge']);
  });

  it('a percentage above 100 % is refused', () => {
    expect(problems(readQuote(draft({ lines: [line({ discountKind: 'percent', discountValue: '101' })] }), 'de', false))).toEqual(['line.0.discountValue:percent']);
  });

  it('a document discount larger than the lines is refused', () => {
    expect(problems(readQuote(draft({ lines: [line()], discountKind: 'amount', discountValue: '171' }), 'de', false))).toEqual(['discountValue:discountTooLarge']);
  });

  it('a document discount of exactly the net amount is allowed; the total is then 0 €', () => {
    const r = readQuote(draft({ lines: [line()], discountKind: 'amount', discountValue: '170' }), 'de', false);
    expect(r.ok && r.value.content.discount).toEqual(amount(17000));
  });

  it('keeps the discounts of the lines and of the document', () => {
    const r = readQuote(draft({ lines: [line({ discountKind: 'percent', discountValue: '10' })], discountKind: 'percent', discountValue: '5' }), 'de', false);
    expect(r.ok && r.value.content.lines[0]?.discount).toEqual(percent(1000));
    expect(r.ok && r.value.content.discount).toEqual(percent(500));
  });

  it('a draft made from a quote reads back with the same discounts', () => {
    const q = sampleQuote({ discount: percent(500), lines: [sampleLine({ discount: amount(100) })] });
    const r = readQuote(draftFromQuote('c1', q, 'de', key), 'de', false);
    expect(r.ok && r.value.content).toEqual({ date: q.date, validUntil: q.validUntil, subject: q.subject, introText: q.introText, closingText: q.closingText, lines: q.lines, discount: q.discount });
  });
});

describe('the editor', () => {
  it('shows the net amount of a line after its discount', () => {
    expect(draftLineNet(line({ discountKind: 'percent', discountValue: '10' }), 'de')).toBe(15300);
  });

  it('shows nothing for a line whose discount cannot be read', () => {
    expect(draftLineNet(line({ discountKind: 'amount', discountValue: '999' }), 'de')).toBeNull();
  });

  it('shows the totals with the discount of the document', () => {
    const t = draftTotals([line()], 'de', false, { discountKind: 'percent', discountValue: '10' });
    expect(t).toMatchObject({ subtotal: 17000, discount: 1700, net: 15300, tax: 2907, gross: 18207 });
  });

  it('ignores a document discount that cannot be read yet', () => {
    expect(draftTotals([line()], 'de', false, { discountKind: 'amount', discountValue: 'x' }).net).toBe(17000);
  });
});

describe('invoices with discounts', () => {
  it('invoiceDraftFromQuote takes over the discount of the quote', () => {
    const base = emptyInvoiceDraft('2026-11-04', 'account-1', 14);
    const d = invoiceDraftFromQuote(base, sampleQuote({ discount: percent(1000) }), 'de', key);
    expect(d).toMatchObject({ discountKind: 'percent', discountValue: '10' });
  });

  it('a draft made from an invoice reads back with the same discounts', () => {
    const inv = sampleInvoice({ discount: amount(5000), lines: [sampleLine({ discount: percent(500) })] });
    const r = readInvoice(draftFromInvoice('c1', 'account-1', inv, 'de', key), 'de', false);
    expect(r.ok && r.value.content).toMatchObject({ discount: amount(5000), lines: [expect.objectContaining({ discount: percent(500) })] });
  });

  it('a cancellation reverses every amount of a discounted invoice, to the cent', () => {
    const original = sampleInvoice({
      discount: percent(500),
      lines: [sampleLine({ discount: percent(1000) }), sampleLine({ name: 'Lektorat', quantity: quantity(1000), unitPrice: cents(30000), vatRate: basisPoints(700), discount: amount(1234) })],
    });
    const o = invoiceTotals(original, false);
    const c = invoiceTotals(cancellationContent(original, '2026-11-05'), false);
    expect(c).toEqual({
      ...o,
      subtotal: -o.subtotal,
      discount: -o.discount,
      net: -o.net,
      tax: -o.tax,
      gross: -o.gross,
      byRate: o.byRate.map((r) => ({ rate: r.rate, net: -r.net, tax: -r.tax })),
    });
  });

  it('a cancellation keeps the discounts of the invoice', () => {
    const original = sampleInvoice({ discount: percent(500), lines: [sampleLine({ discount: amount(100) })] });
    const c = cancellationContent(original, '2026-11-05');
    expect(c.discount).toEqual(percent(500));
    expect(c.lines[0]?.discount).toEqual(amount(100));
  });
});

describe('versions of a quote', () => {
  it('a changed discount of a line is a change of the line', () => {
    const before = sampleLine();
    const after = sampleLine({ discount: percent(1000) });
    expect(lineChanges([before], [after])).toEqual([{ kind: 'changed', before, after, fields: ['discount'] }]);
  });

  it('a line without discount changes nothing', () => {
    expect(lineChanges([sampleLine({ discount: NO_DISCOUNT })], [sampleLine()])).toEqual([]);
  });
});
