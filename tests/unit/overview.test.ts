import { describe, expect, it } from 'vitest';
import { cents } from '../../src/domain/money';
import { netShareOf, overview, smallBusinessLimitState, turnoverEntries, type OverviewExpense, type OverviewInvoice, type OverviewPayment, type OverviewPayout } from '../../src/domain/overview';

const TODAY = '2026-06-01';

/** A regular invoice of 100.00 € net and 119.00 € gross, issued in March and due at its end */
const invoice = (over: Partial<OverviewInvoice> = {}): OverviewInvoice => ({
  id: 'r1',
  date: '2026-03-10',
  issued: true,
  isCancellation: false,
  cancelled: false,
  net: cents(10_000),
  gross: cents(11_900),
  dueDate: '2026-03-24',
  taxableInGermany: true,
  ...over,
});

const run = (over: { invoices?: OverviewInvoice[]; payments?: OverviewPayment[]; expenses?: OverviewExpense[]; payouts?: OverviewPayout[]; smallBusiness?: boolean; year?: number } = {}) =>
  overview({ year: over.year ?? 2026, today: TODAY, smallBusiness: over.smallBusiness ?? false, invoices: over.invoices ?? [invoice()], payments: over.payments ?? [], expenses: over.expenses ?? [], payouts: over.payouts ?? [] });

describe('netShareOf: the net part of a payment', () => {
  it('takes the share of the invoice that the amount pays, rounded once', () => {
    expect(netShareOf(cents(5_950), cents(10_000), cents(11_900))).toBe(5_000);
    expect(netShareOf(cents(2), cents(1), cents(3))).toBe(1);
    expect(netShareOf(cents(1), cents(1), cents(3))).toBe(0);
  });

  it('takes the same share of an invoice with negative sums (a cancellation) instead of failing', () => {
    // the app records no payment on a cancellation, but a payment file read from the folder may point to one
    expect(netShareOf(cents(-5_950), cents(-10_000), cents(-11_900))).toBe(-5_000);
    expect(netShareOf(cents(5_950), cents(-10_000), cents(-11_900))).toBe(5_000);
  });
});

describe('overview with a payment that points to a cancellation', () => {
  it('still computes the figures', () => {
    const cancellation = invoice({ id: 's1', isCancellation: true, net: cents(-10_000), gross: cents(-11_900), dueDate: '' });
    const o = run({ invoices: [invoice(), cancellation], payments: [{ invoiceId: 's1', date: '2026-04-02', amount: cents(5_950) }] });
    expect(o.income).toBe(5_000);
  });
});

describe('overview of a regular business', () => {
  it('counts the net part of the payments and the expenses without the VAT that comes back', () => {
    const o = run({
      payments: [{ invoiceId: 'r1', date: '2026-04-02', amount: cents(5_950) }],
      expenses: [{ date: '2026-04-05', gross: cents(11_900), vat: cents(1_900) }],
    });
    expect(o).toMatchObject({ income: 5_000, expenses: 10_000, profit: -5_000, turnover: 5_000 });
    expect(o.months[3]).toEqual({ month: 4, income: 5_000, expenses: 10_000, profit: -5_000 });
  });

  it('shows what is still open, and what of it is overdue', () => {
    const o = run({ payments: [{ invoiceId: 'r1', date: '2026-04-02', amount: cents(5_950) }] });
    expect(o).toMatchObject({ openReceivables: 5_950, overdueReceivables: 5_950, overdueCount: 1 });
  });

  it('leaves out drafts and cancelled invoices from what is open', () => {
    const draft = invoice({ id: 'd1', issued: false });
    const cancelled = invoice({ id: 'c1', cancelled: true });
    const cancellation = invoice({ id: 's1', date: '2026-04-01', isCancellation: true, net: cents(-10_000), gross: cents(-11_900), dueDate: '' });
    const o = run({ invoices: [draft, cancelled, cancellation] });
    expect(o).toMatchObject({ openReceivables: 0, overdueReceivables: 0, overdueCount: 0, turnover: 0 });
  });

  it('counts only the payments and expenses of the year shown', () => {
    const o = run({
      payments: [{ invoiceId: 'r1', date: '2025-12-30', amount: cents(5_950) }],
      expenses: [{ date: '2027-01-02', gross: cents(11_900), vat: cents(0) }],
    });
    expect(o).toMatchObject({ income: 0, expenses: 0, turnover: 0 });
  });
});

describe('overview of a small business', () => {
  it('has no VAT to take off: expenses count with their gross amount', () => {
    const small = invoice({ net: cents(11_900), gross: cents(11_900) });
    const o = run({
      smallBusiness: true,
      invoices: [small],
      payments: [{ invoiceId: 'r1', date: '2026-04-02', amount: cents(5_950) }],
      expenses: [{ date: '2026-04-05', gross: cents(11_900), vat: cents(1_900) }],
    });
    expect(o).toMatchObject({ income: 5_950, expenses: 11_900, profit: -5_950, turnover: 5_950 });
  });
});

describe('the turnover of the small business limits (§ 19 Abs. 2 UStG: vereinnahmte Entgelte)', () => {
  const pay = (invoiceId: string, date: string, amount: number): OverviewPayment => ({ invoiceId, date, amount: cents(amount) });

  it('is the net part of the payments, on the day they arrived, not the invoices of the year', () => {
    // issued in December 2025, paid in January 2026: it belongs to 2026
    const december = invoice({ date: '2025-12-20', dueDate: '2026-01-03' });
    const paid = run({ invoices: [december], payments: [pay('r1', '2026-01-10', 11_900)] });
    expect(paid.turnover).toBe(10_000);
    expect(run({ invoices: [december], year: 2025 }).turnover).toBe(0);
  });

  it('leaves out a service that is not taxable in Germany (place of supply abroad), which is no domestic supply', () => {
    const abroad = invoice({ id: 'a1', net: cents(10_000), gross: cents(10_000), taxableInGermany: false });
    const o = run({ invoices: [invoice(), abroad], payments: [pay('r1', '2026-04-02', 11_900), pay('a1', '2026-04-03', 10_000)] });
    expect(o.income).toBe(20_000);
    expect(o.turnover).toBe(10_000);
  });

  it('turnoverEntries lists the net part of each payment with its date, without those of a service not taxable in Germany', () => {
    const abroad = invoice({ id: 'a1', net: cents(10_000), gross: cents(10_000), taxableInGermany: false });
    const entries = turnoverEntries([invoice(), abroad], [pay('r1', '2026-04-02', 5_950), pay('a1', '2026-04-03', 10_000), pay('gone', '2026-04-04', 700)]);
    // a payment of an unknown invoice counts with its whole amount, like in the income
    expect(entries).toEqual([
      { date: '2026-04-02', amount: 5_000 },
      { date: '2026-04-04', amount: 700 },
    ]);
  });
});

describe('overview with payouts (income without an invoice)', () => {
  const payout = (over: Partial<OverviewPayout> = {}): OverviewPayout => ({ date: '2026-11-03', amount: cents(123_456), vat: cents(0), ...over });

  it('counts the whole amount of a payout without German VAT in the month the money arrived', () => {
    const o = run({ invoices: [], payouts: [payout()] });
    expect(o).toMatchObject({ income: 123_456, expenses: 0, profit: 123_456 });
    expect(o.months[10]).toEqual({ month: 11, income: 123_456, expenses: 0, profit: 123_456 });
  });

  it('counts a domestic payout without the VAT inside it', () => {
    const o = run({ invoices: [], payouts: [payout({ amount: cents(11_900), vat: cents(1_900) })] });
    expect(o.income).toBe(10_000);
  });

  it('adds payouts to the payments of invoices', () => {
    const o = run({ payments: [{ invoiceId: 'r1', date: '2026-04-02', amount: cents(5_950) }], payouts: [payout({ amount: cents(1_000) })], expenses: [{ date: '2026-05-01', gross: cents(400), vat: cents(0) }] });
    expect(o).toMatchObject({ income: 6_000, expenses: 400, profit: 5_600 });
  });

  it('counts only the payouts of the year', () => {
    const o = run({ invoices: [], payouts: [payout({ date: '2025-12-31' }), payout({ date: '2027-01-01' }), payout({ date: '2026-01-01', amount: cents(500) })] });
    expect(o.income).toBe(500);
  });

  it('a payout is no invoice: it is neither receivable nor part of the turnover compared with the small business limits (open question 2 of #30)', () => {
    const o = run({ invoices: [], payouts: [payout()] });
    expect(o).toMatchObject({ openReceivables: 0, overdueReceivables: 0, turnover: 0 });
  });

  it('counts the same for a small business (no VAT inside, whole amount)', () => {
    const o = run({ smallBusiness: true, invoices: [], payouts: [payout()] });
    expect(o.income).toBe(123_456);
  });
});

describe('the small business limits (§ 19 UStG, as an orientation)', () => {
  it('compares the turnover of the previous year and of the current year with the limits of the year', () => {
    expect(smallBusinessLimitState(2026, cents(2_400_000), cents(10_100_000))).toEqual({
      previousLimit: 2_500_000,
      currentLimit: 10_000_000,
      previousAbove: false,
      currentAbove: true,
    });
  });
});
