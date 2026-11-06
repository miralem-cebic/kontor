import { describe, expect, it } from 'vitest';
import { cents } from '../../src/domain/money';
import { netShareOf, overview, smallBusinessLimitState, type OverviewExpense, type OverviewInvoice, type OverviewPayment } from '../../src/domain/overview';

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
  ...over,
});

const run = (over: { invoices?: OverviewInvoice[]; payments?: OverviewPayment[]; expenses?: OverviewExpense[]; smallBusiness?: boolean; year?: number } = {}) =>
  overview({ year: over.year ?? 2026, today: TODAY, smallBusiness: over.smallBusiness ?? false, invoices: over.invoices ?? [invoice()], payments: over.payments ?? [], expenses: over.expenses ?? [] });

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
    expect(o).toMatchObject({ income: 5_000, expenses: 10_000, profit: -5_000, turnover: 10_000 });
    expect(o.months[3]).toEqual({ month: 4, income: 5_000, expenses: 10_000, profit: -5_000 });
  });

  it('shows what is still open, and what of it is overdue', () => {
    const o = run({ payments: [{ invoiceId: 'r1', date: '2026-04-02', amount: cents(5_950) }] });
    expect(o).toMatchObject({ openReceivables: 5_950, overdueReceivables: 5_950, overdueCount: 1 });
  });

  it('leaves out drafts and cancelled invoices from what is open, and a cancellation reduces the turnover', () => {
    const draft = invoice({ id: 'd1', issued: false });
    const cancelled = invoice({ id: 'c1', cancelled: true });
    const cancellation = invoice({ id: 's1', date: '2026-04-01', isCancellation: true, net: cents(-10_000), gross: cents(-11_900), dueDate: '' });
    const o = run({ invoices: [draft, cancelled, cancellation] });
    // the cancelled invoice and its cancellation cancel out in the turnover; the draft is not counted
    expect(o).toMatchObject({ openReceivables: 0, overdueReceivables: 0, overdueCount: 0, turnover: 0 });
  });

  it('counts only the payments and expenses of the year shown', () => {
    const o = run({
      payments: [{ invoiceId: 'r1', date: '2025-12-30', amount: cents(5_950) }],
      expenses: [{ date: '2027-01-02', gross: cents(11_900), vat: cents(0) }],
    });
    expect(o).toMatchObject({ income: 0, expenses: 0, turnover: 10_000 });
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
    expect(o).toMatchObject({ income: 5_950, expenses: 11_900, profit: -5_950, turnover: 11_900 });
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
