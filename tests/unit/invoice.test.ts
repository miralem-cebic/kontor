import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { documentTotals, emptyLineDraft, hasNegativeRate, type LineDraft } from '../../src/domain/document';
import {
  byInvoiceDate,
  customerDefaults,
  draftDueDate,
  draftFromInvoice,
  dueDate,
  emptyInvoiceDraft,
  invoiceDraftFromQuote,
  invoiceMatches,
  invoiceTotals,
  issueProblems,
  readInvoice,
  SMALL_AMOUNT_LIMIT,
  TAX_TREATMENTS,
  vatNote,
  type InvoiceDraft,
  type IssueFacts,
} from '../../src/domain/invoice';
import { basisPoints, cents, quantity } from '../../src/domain/money';
import { UNITS } from '../../src/domain/units';
import { VAT_RATES } from '../../src/domain/vat';
import { fcParams, sampleContact, sampleInvoice, sampleQuote } from './fixtures';

let seq = 0;
const key = () => `k${++seq}`;
const problems = (r: ReturnType<typeof readInvoice>) => (r.ok ? [] : r.error.map((e) => `${e.field}:${e.problem}`));
const line = (over: Partial<LineDraft> = {}): LineDraft => ({ ...emptyLineDraft(key()), name: 'Webdesign', quantity: '2', unitPrice: '85', ...over });
const draft = (over: Partial<InvoiceDraft> = {}): InvoiceDraft => ({ ...emptyInvoiceDraft('2026-10-31', 'account-1', 14), customerId: 'c1', ...over });

describe('readInvoice', () => {
  it('needs a customer and an account; lines may still be missing', () => {
    expect(problems(readInvoice(emptyInvoiceDraft('2026-10-31', '', 14), 'de', false))).toEqual(['customerId:required', 'accountId:required']);
    const r = readInvoice(draft({ subject: ' Relaunch ', orderReference: ' PO-1 ' }), 'de', false);
    expect(r.ok && r.value).toEqual({
      customerId: 'c1',
      accountId: 'account-1',
      content: {
        date: '2026-10-31',
        service: { kind: 'date', date: '2026-10-31' },
        paymentTermDays: 14,
        taxTreatment: 'standard',
        orderReference: 'PO-1',
        leitwegId: '',
        subject: 'Relaunch',
        introText: '',
        closingText: '',
        lines: [],
      },
    });
  });

  it('a new invoice starts with today as the date of service, the company term and the default account', () => {
    expect(emptyInvoiceDraft('2026-12-15', 'a1', 30)).toMatchObject({ date: '2026-12-15', serviceKind: 'date', serviceDate: '2026-12-15', paymentTermDays: '30', accountId: 'a1', taxTreatment: 'standard' });
  });

  it('checks the dates of the invoice and of the service', () => {
    expect(problems(readInvoice(draft({ date: '2026-02-30', serviceDate: '' }), 'de', false))).toEqual(['date:date', 'serviceDate:date']);
    const period = (serviceStart: string, serviceEnd: string) => problems(readInvoice(draft({ serviceKind: 'period', serviceStart, serviceEnd }), 'de', false));
    expect(period('', '')).toEqual(['serviceStart:date', 'serviceEnd:date']);
    expect(period('2026-10-31', '2026-10-01')).toEqual(['serviceEnd:periodEnd']);
    expect(period('2026-10-01', '2026-10-01')).toEqual([]);
    // the date of service of the other kind is not checked
    const r = readInvoice(draft({ serviceKind: 'period', serviceDate: 'x', serviceStart: '2026-10-01', serviceEnd: '2026-10-31' }), 'de', false);
    expect(r.ok && r.value.content.service).toEqual({ kind: 'period', start: '2026-10-01', end: '2026-10-31' });
  });

  it('checks the payment term, the order number and the Leitweg-ID', () => {
    expect(problems(readInvoice(draft({ paymentTermDays: '366' }), 'de', false))).toEqual(['paymentTermDays:paymentTerm']);
    expect(problems(readInvoice(draft({ paymentTermDays: '' }), 'de', false))).toEqual(['paymentTermDays:paymentTerm']);
    expect(problems(readInvoice(draft({ orderReference: 'x'.repeat(101) }), 'de', false))).toEqual(['orderReference:tooLong']);
    expect(problems(readInvoice(draft({ leitwegId: 'Amt Köln' }), 'de', false))).toEqual(['leitwegId:leitwegId']);
    const r = readInvoice(draft({ paymentTermDays: '0', leitwegId: ' 04011000-12345-34 ' }), 'de', false);
    expect(r.ok && [r.value.content.paymentTermDays, r.value.content.leitwegId]).toEqual([0, '04011000-12345-34']);
  });

  it('a small business has no tax treatment to choose', () => {
    const r = readInvoice(draft({ taxTreatment: 'reverseCharge' }), 'de', true);
    expect(r.ok && r.value.content.taxTreatment).toBe('standard');
  });

  it('without VAT a deduction may use up lines of another rate', () => {
    const lines = [line(), line({ name: 'Rabatt', quantity: '-1', unitPrice: '100', vatRate: basisPoints(700) })];
    expect(problems(readInvoice(draft({ lines }), 'de', false))).toEqual(['lines:negativeTotal']);
    expect(problems(readInvoice(draft({ lines, taxTreatment: 'reverseCharge' }), 'de', false))).toEqual([]);
    expect(problems(readInvoice(draft({ lines, taxTreatment: 'intraCommunitySupply' }), 'de', false))).toEqual([]);
  });

  it('names the line and the field of an error', () => {
    expect(problems(readInvoice(draft({ lines: [line(), line({ name: '', unitPrice: 'x' })] }), 'de', false))).toEqual(['line.1.name:required', 'line.1.unitPrice:price']);
  });
});

describe('totals and due date', () => {
  it('VAT per rate with standard VAT; none for reverse charge, an intra-community supply or a small business', () => {
    const inv = sampleInvoice();
    expect(invoiceTotals(inv, false)).toEqual(documentTotals(inv.lines, false));
    expect(invoiceTotals(inv, false).tax).toBe(22288);
    for (const taxTreatment of ['reverseCharge', 'intraCommunitySupply'] as const) {
      expect(invoiceTotals({ ...inv, taxTreatment }, false)).toMatchObject({ net: 136250, tax: 0, gross: 136250 });
    }
    expect(invoiceTotals(inv, true)).toMatchObject({ tax: 0, gross: 136250 });
  });

  it('the note that explains why there is no VAT', () => {
    expect(TAX_TREATMENTS.map((v) => vatNote(v, false))).toEqual([null, 'reverseCharge', 'intraCommunitySupply']);
    expect(TAX_TREATMENTS.map((v) => vatNote(v, true))).toEqual(['smallBusiness', 'smallBusiness', 'smallBusiness']);
  });

  it('the due date follows from the date and the payment term', () => {
    expect(dueDate(sampleInvoice())).toBe('2026-11-14');
    expect(dueDate(sampleInvoice({ paymentTermDays: 0 }))).toBe('2026-10-31');
    expect(draftDueDate({ date: '2026-12-20', paymentTermDays: '14' })).toBe('2027-01-03');
    expect([draftDueDate({ date: '2026-12-20', paymentTermDays: '' }), draftDueDate({ date: '2026-12-20', paymentTermDays: '366' }), draftDueDate({ date: '', paymentTermDays: '14' })]).toEqual([null, null, null]);
  });
});

describe('defaults', () => {
  it('a customer brings its payment term, order number and Leitweg-ID; without a term the company default applies', () => {
    expect(customerDefaults(sampleContact(), 14)).toEqual({ paymentTermDays: '30', orderReference: 'PO-4711', leitwegId: '' });
    expect(customerDefaults(sampleContact({ paymentTermDays: null, leitwegId: '04011000-12345-34' }), 14)).toEqual({
      paymentTermDays: '14',
      orderReference: 'PO-4711',
      leitwegId: '04011000-12345-34',
    });
  });

  it('an invoice from a quote takes over its subject and lines, not its texts', () => {
    const quote = sampleQuote({ closingText: 'Gültig 30 Tage.' });
    const d = invoiceDraftFromQuote(draft({ customerId: 'c7' }), quote, 'de', key);
    expect(d).toMatchObject({ customerId: 'c7', date: '2026-10-31', subject: 'Website-Relaunch', introText: '', closingText: '' });
    expect(d.lines.map((l) => [l.name, l.quantity, l.unitPrice, l.vatRate])).toEqual([
      ['Webdesign', '12,5', '85,00', 1900],
      ['Lektorat', '1', '300,00', 700],
    ]);
    const r = readInvoice(d, 'de', false);
    expect(r.ok && r.value.content.lines).toEqual(quote.lines);
  });
});

describe('draft ↔ invoice', () => {
  const arbLine = fc.record({
    name: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim() === s && s !== ''),
    description: fc.constantFrom('', 'Zweite Zeile\nund dritte'),
    quantity: fc.integer({ min: -999_999, max: 999_999 }).filter((q) => q !== 0).map(quantity),
    unit: fc.constantFrom(...UNITS),
    unitPrice: fc.integer({ min: 0, max: 99_999_999 }).map(cents),
    vatRate: fc.constantFrom(...VAT_RATES),
  });
  const arbService = fc.oneof(
    fc.constant({ kind: 'date' as const, date: '2026-10-15' }),
    fc.constant({ kind: 'period' as const, start: '2026-10-01', end: '2026-10-31' }),
  );

  it('an invoice survives the round trip through the draft, in both languages', () =>
    fc.assert(
      fc.property(
        fc.array(arbLine, { maxLength: 5 }),
        arbService,
        fc.constantFrom(...TAX_TREATMENTS),
        fc.integer({ min: 0, max: 365 }),
        fc.constantFrom('de' as const, 'en' as const),
        (lines, service, taxTreatment, paymentTermDays, locale) => {
          const inv = sampleInvoice({ lines, service, taxTreatment, paymentTermDays });
          const r = readInvoice(draftFromInvoice('c1', 'a1', inv, locale, key), locale, false);
          if (hasNegativeRate(invoiceTotals(inv, false))) return problems(r).join() === 'lines:negativeTotal';
          return r.ok && r.value.customerId === 'c1' && r.value.accountId === 'a1' && JSON.stringify(r.value.content) === JSON.stringify(inv);
        },
      ),
      fcParams,
    ));
});

describe('issueProblems', () => {
  const facts = (over: Partial<IssueFacts> = {}): IssueFacts => ({
    lineCount: 2,
    gross: cents(158_538),
    taxTreatment: 'standard',
    customer: sampleContact(),
    ownVatId: 'DE136695976',
    accountActive: true,
    ...over,
  });
  const noAddress = sampleContact({ address: null });
  const inAustria = (vatId: string) => sampleContact({ address: { street: 'Ring 1', postalCode: '1010', city: 'Wien', country: 'AT' }, vatId });

  it('a complete draft can be issued', () => {
    expect(issueProblems(facts())).toEqual([]);
  });

  it('needs a customer, a line and an active account', () => {
    expect(issueProblems(facts({ customer: null, lineCount: 0, accountActive: false }))).toEqual(['noCustomer', 'noLines', 'accountRemoved']);
  });

  it('needs the address of the customer, except for a small amount invoice up to 250 € gross', () => {
    expect(issueProblems(facts({ customer: noAddress, gross: SMALL_AMOUNT_LIMIT }))).toEqual([]);
    expect(issueProblems(facts({ customer: noAddress, gross: cents(SMALL_AMOUNT_LIMIT + 1) }))).toEqual(['customerAddress']);
    // § 33 UStDV does not apply to reverse charge
    expect(issueProblems(facts({ customer: noAddress, gross: cents(10_000), taxTreatment: 'reverseCharge' }))).toEqual(['customerAddress']);
  });

  it('an intra-community supply needs both VAT IDs, the customer’s from another EU state', () => {
    expect(issueProblems(facts({ taxTreatment: 'intraCommunitySupply', customer: inAustria('ATU12345678') }))).toEqual([]);
    expect(issueProblems(facts({ taxTreatment: 'intraCommunitySupply', customer: inAustria('') }))).toEqual(['customerVatId']);
    expect(issueProblems(facts({ taxTreatment: 'intraCommunitySupply', customer: sampleContact() }))).toEqual(['customerVatId']);
    expect(issueProblems(facts({ taxTreatment: 'intraCommunitySupply', customer: inAustria('ATU12345678'), ownVatId: '' }))).toEqual(['ownVatId']);
  });

  it('reverse charge needs both VAT IDs only for a customer in another EU state', () => {
    expect(issueProblems(facts({ taxTreatment: 'reverseCharge', customer: sampleContact({ vatId: '' }), ownVatId: '' }))).toEqual([]);
    expect(issueProblems(facts({ taxTreatment: 'reverseCharge', customer: inAustria(''), ownVatId: '' }))).toEqual(['customerVatId', 'ownVatId']);
    const inSwitzerland = sampleContact({ address: { street: 'Bahnhofstrasse 1', postalCode: '8001', city: 'Zürich', country: 'CH' }, vatId: '' });
    expect(issueProblems(facts({ taxTreatment: 'reverseCharge', customer: inSwitzerland }))).toEqual([]);
  });
});

describe('lists', () => {
  it('searches the customer and the subject', () => {
    expect(invoiceMatches(sampleInvoice(), 'Kunde GmbH', 'kunde')).toBe(true);
    expect(invoiceMatches(sampleInvoice(), 'Kunde GmbH', 'relaunch')).toBe(true);
    expect(invoiceMatches(sampleInvoice(), 'Kunde GmbH', 'Logo')).toBe(false);
  });

  it('newest first', () => {
    const invoices = [sampleInvoice({ date: '2026-10-01' }), sampleInvoice({ date: '2026-10-31', subject: 'B' }), sampleInvoice({ date: '2026-10-31', subject: 'A' })];
    expect(invoices.sort(byInvoiceDate).map((i) => `${i.date} ${i.subject}`)).toEqual(['2026-10-31 A', '2026-10-31 B', '2026-10-01 Website-Relaunch']);
  });
});
