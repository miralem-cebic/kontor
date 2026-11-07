import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cents, type Cents } from '../../src/domain/money';
import { overview } from '../../src/domain/overview';
import {
  availableYears,
  expensesByCategory,
  openItems,
  turnoverByCustomer,
  yearComparison,
  type ReportExpense,
  type ReportInput,
  type ReportInvoice,
} from '../../src/domain/reports';
import type { OverviewPayment } from '../../src/domain/overview';

const TODAY = '2026-06-01';

/** A regular invoice of 100.00 € net and 119.00 € gross for customer k1, issued in March and due at its end */
const invoice = (over: Partial<ReportInvoice> = {}): ReportInvoice => ({
  id: 'r1',
  number: 'RE-2026-0001',
  customerId: 'k1',
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

const expense = (over: Partial<ReportExpense> = {}): ReportExpense => ({ date: '2026-04-05', gross: cents(11_900), vat: cents(1_900), category: 'Telefon', ...over });

const input = (over: Partial<ReportInput> = {}): ReportInput => ({ year: 2026, today: TODAY, smallBusiness: false, invoices: [invoice()], payments: [], expenses: [], ...over });

const pay = (invoiceId: string, date: string, amount: number): OverviewPayment => ({ invoiceId, date, amount: cents(amount) });

describe('turnoverByCustomer: income per customer and month, on the cash basis', () => {
  it('counts the net part of each payment in the month it arrived', () => {
    const report = turnoverByCustomer(
      input({
        invoices: [invoice(), invoice({ id: 'r2', number: 'RE-2026-0002', customerId: 'k2', net: cents(20_000), gross: cents(23_800) })],
        payments: [pay('r1', '2026-04-02', 5_950), pay('r1', '2026-05-20', 5_950), pay('r2', '2026-04-30', 23_800)],
      }),
    );
    expect(report.rows.map((r) => r.key)).toEqual(['k2', 'k1']);
    const k1 = report.rows.find((r) => r.key === 'k1')!;
    expect(k1.total).toBe(10_000);
    expect(k1.months[3]).toBe(5_000);
    expect(k1.months[4]).toBe(5_000);
    expect(k1.months[0]).toBe(0);
    const k2 = report.rows.find((r) => r.key === 'k2')!;
    expect(k2.total).toBe(20_000);
    expect(report.total).toBe(30_000);
    expect(report.months[3]).toBe(25_000);
  });

  it('ignores payments of other years, and an unpaid invoice has no income yet', () => {
    const report = turnoverByCustomer(input({ payments: [pay('r1', '2025-12-30', 11_900), pay('r1', '2027-01-02', 11_900)] }));
    expect(report.rows).toEqual([]);
    expect(report.total).toBe(0);
  });

  it('counts a payment on an invoice without VAT with its whole amount', () => {
    const small = invoice({ net: cents(11_900), gross: cents(11_900) });
    const report = turnoverByCustomer(input({ smallBusiness: true, invoices: [small], payments: [pay('r1', '2026-04-02', 5_950)] }));
    expect(report.total).toBe(5_950);
  });

  it('puts a payment whose invoice is unknown under the empty customer key, with its whole amount, as the overview does', () => {
    const report = turnoverByCustomer(input({ payments: [pay('gone', '2026-04-02', 1_000)] }));
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ key: '', total: 1_000 });
  });

  it('a payment on a cancellation counts with the share of the cancellation, as in the overview', () => {
    const cancellation = invoice({ id: 's1', number: 'RE-2026-0002', isCancellation: true, net: cents(-10_000), gross: cents(-11_900), dueDate: '' });
    const report = turnoverByCustomer(input({ invoices: [invoice(), cancellation], payments: [pay('s1', '2026-04-02', 5_950)] }));
    expect(report.total).toBe(5_000);
  });

  it('sorts by the total, the biggest customer first, and ties by key', () => {
    const a = invoice({ id: 'a', customerId: 'ka' });
    const b = invoice({ id: 'b', customerId: 'kb' });
    const c = invoice({ id: 'c', customerId: 'kc', net: cents(50_000), gross: cents(59_500) });
    const report = turnoverByCustomer(input({ invoices: [b, a, c], payments: [pay('a', '2026-04-02', 11_900), pay('b', '2026-04-02', 11_900), pay('c', '2026-04-02', 59_500)] }));
    expect(report.rows.map((r) => r.key)).toEqual(['kc', 'ka', 'kb']);
  });
});

describe('expensesByCategory: expenses per category and month', () => {
  it('counts the expenses without the VAT that comes back, in the month they were paid', () => {
    const report = expensesByCategory(
      input({
        expenses: [
          expense(),
          expense({ date: '2026-05-05', gross: cents(5_950), vat: cents(950) }),
          expense({ date: '2026-05-06', gross: cents(2_000), vat: cents(0), category: 'Büro' }),
          expense({ date: '2025-12-31', gross: cents(9_999), vat: cents(0), category: 'Büro' }),
        ],
      }),
    );
    expect(report.rows.map((r) => [r.key, r.total])).toEqual([
      ['Telefon', 15_000],
      ['Büro', 2_000],
    ]);
    expect(report.rows[0]?.months[3]).toBe(10_000);
    expect(report.rows[0]?.months[4]).toBe(5_000);
    expect(report.total).toBe(17_000);
  });

  it('a small business has no VAT to take off', () => {
    const report = expensesByCategory(input({ smallBusiness: true, expenses: [expense()] }));
    expect(report.total).toBe(11_900);
  });

  it('puts expenses without a category under the empty key, and trims the category', () => {
    const report = expensesByCategory(input({ expenses: [expense({ category: '' }), expense({ category: '  ' }), expense({ category: ' Telefon ' }), expense({ category: 'Telefon' })] }));
    expect(report.rows.map((r) => r.key).sort()).toEqual(['', 'Telefon']);
    expect(report.rows.find((r) => r.key === '')?.total).toBe(20_000);
    expect(report.rows.find((r) => r.key === 'Telefon')?.total).toBe(20_000);
  });
});

describe('openItems: issued invoices with something open', () => {
  it('lists the open amount, the due date and the days overdue, oldest due date first', () => {
    const second = invoice({ id: 'r2', number: 'RE-2026-0002', customerId: 'k2', date: '2026-05-20', dueDate: '2026-06-03', net: cents(20_000), gross: cents(23_800) });
    const report = openItems(input({ invoices: [second, invoice()], payments: [pay('r1', '2026-04-02', 5_950)] }));
    expect(report.items.map((i) => [i.number, i.paid, i.open, i.daysOverdue])).toEqual([
      ['RE-2026-0001', 5_950, 5_950, 69],
      ['RE-2026-0002', 0, 23_800, 0],
    ]);
    expect(report.open).toBe(29_750);
    expect(report.overdue).toBe(5_950);
    expect(report.overdueCount).toBe(1);
  });

  it('the due date itself is not yet overdue', () => {
    const report = openItems(input({ invoices: [invoice({ dueDate: TODAY })] }));
    expect(report.items[0]?.daysOverdue).toBe(0);
    expect(report.overdueCount).toBe(0);
  });

  it('leaves out drafts, cancellations, cancelled and paid invoices', () => {
    const draft = invoice({ id: 'd1', issued: false });
    const cancelled = invoice({ id: 'c1', cancelled: true });
    const cancellation = invoice({ id: 's1', isCancellation: true, net: cents(-10_000), gross: cents(-11_900), dueDate: '' });
    const paid = invoice({ id: 'p1' });
    const report = openItems(input({ invoices: [draft, cancelled, cancellation, paid], payments: [pay('p1', '2026-03-12', 11_900)] }));
    expect(report.items).toEqual([]);
    expect(report.open).toBe(0);
  });

  it('an overpayment is not an open amount', () => {
    const report = openItems(input({ payments: [pay('r1', '2026-03-12', 20_000)] }));
    expect(report.items).toEqual([]);
  });

  it('is not limited to one year: open items are as of today', () => {
    const old = invoice({ id: 'o1', date: '2024-01-10', dueDate: '2024-01-24' });
    const report = openItems(input({ year: 2026, invoices: [old] }));
    expect(report.items).toHaveLength(1);
  });

  it('sums per customer: open amount, overdue amount and how many', () => {
    const k1b = invoice({ id: 'r2', number: 'RE-2026-0002', date: '2026-05-20', dueDate: '2026-06-30' });
    const k2 = invoice({ id: 'r3', number: 'RE-2026-0003', customerId: 'k2', net: cents(20_000), gross: cents(23_800), dueDate: '2026-03-01' });
    const report = openItems(input({ invoices: [invoice(), k1b, k2] }));
    expect(report.customers).toEqual([
      { key: 'k1', count: 2, open: 23_800, overdue: 11_900, overdueCount: 1 },
      { key: 'k2', count: 1, open: 23_800, overdue: 23_800, overdueCount: 1 },
    ]);
  });

  it('agrees with the open receivables of the overview', () => {
    const report = openItems(input({ invoices: [invoice(), invoice({ id: 'r2', dueDate: '2026-07-01' })], payments: [pay('r1', '2026-04-02', 1_000)] }));
    const o = overview(input({ invoices: [invoice(), invoice({ id: 'r2', dueDate: '2026-07-01' })], payments: [pay('r1', '2026-04-02', 1_000)] }));
    expect(report.open).toBe(o.openReceivables);
    expect(report.overdue).toBe(o.overdueReceivables);
    expect(report.overdueCount).toBe(o.overdueCount);
  });
});

describe('yearComparison: the year against the year before', () => {
  const data = input({
    invoices: [invoice(), invoice({ id: 'r0', date: '2025-03-10', dueDate: '2025-03-24' })],
    payments: [pay('r1', '2026-04-02', 11_900), pay('r0', '2025-04-02', 5_950), pay('r0', '2025-05-02', 5_950)],
    expenses: [expense(), expense({ date: '2025-04-20', gross: cents(23_800), vat: cents(3_800) })],
  });

  it('puts both years side by side, month by month', () => {
    const c = yearComparison(data);
    expect(c.year).toBe(2026);
    expect(c.previousYear).toBe(2025);
    expect(c.months).toHaveLength(12);
    expect(c.months[3]).toEqual({ month: 4, income: 10_000, expenses: 10_000, profit: 0, previousIncome: 5_000, previousExpenses: 20_000, previousProfit: -15_000 });
    expect(c.months[4]).toMatchObject({ income: 0, previousIncome: 5_000 });
  });

  it('has totals of both years and the change between them', () => {
    const c = yearComparison(data);
    expect(c.current).toEqual({ income: 10_000, expenses: 10_000, profit: 0 });
    expect(c.previous).toEqual({ income: 10_000, expenses: 20_000, profit: -10_000 });
    expect(c.change).toEqual({ income: 0, expenses: -10_000, profit: 10_000 });
  });

  it('is the same figures as the overview of each year', () => {
    const c = yearComparison(data);
    expect(c.current.income).toBe(overview(data).income);
    expect(c.previous.expenses).toBe(overview({ ...data, year: 2025 }).expenses);
  });
});

describe('availableYears', () => {
  it('lists the years of the dates and the current year, newest first, without duplicates', () => {
    expect(availableYears(['2024-03-01', '2024-12-31', '2026-01-01', 'junk', ''], 2026)).toEqual([2026, 2024]);
    expect(availableYears([], 2026)).toEqual([2026]);
    expect(availableYears(['2027-02-01'], 2026)).toEqual([2027, 2026]);
  });
});

/* ---------- Properties ---------- */

const amountArb = fc.integer({ min: 1, max: 5_000_000 });
const dateArb = fc.tuple(fc.constantFrom(2025, 2026, 2027), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 })).map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
const customerArb = fc.constantFrom('k1', 'k2', 'k3', 'k4');
const categoryArb = fc.constantFrom('', 'Telefon', 'Büro', 'Reise', 'Software');

const invoicesArb = fc.array(
  fc.record({
    net: amountArb,
    rate: fc.constantFrom(0, 700, 1900),
    customerId: customerArb,
    cancellation: fc.boolean(),
  }),
  { minLength: 1, maxLength: 6 },
).map((list) =>
  list.map(
    (x, i): ReportInvoice => {
      const net = x.cancellation ? -x.net : x.net;
      const gross = net + Math.round((net * x.rate) / 10_000);
      return invoice({ id: `i${i}`, number: `RE-${i}`, customerId: x.customerId, isCancellation: x.cancellation, net: cents(net), gross: cents(gross) });
    },
  ),
);

const paymentsArb = (count: number) => fc.array(fc.record({ invoice: fc.integer({ min: 0, max: count }), date: dateArb, amount: amountArb }), { maxLength: 12 }).map((list) => list.map((p) => pay(p.invoice === count ? 'unknown' : `i${p.invoice}`, p.date, p.amount)));

const expensesArb = fc.array(fc.record({ date: dateArb, gross: amountArb, vatShare: fc.integer({ min: 0, max: 19 }), category: categoryArb }), { maxLength: 12 }).map((list) =>
  list.map((e) => expense({ date: e.date, gross: cents(e.gross), vat: cents(Math.floor((e.gross * e.vatShare) / 119)), category: e.category })),
);

const sumOf = (values: readonly Cents[]): number => values.reduce((a, b) => a + b, 0);

describe('properties: the rows add up to the totals, and the totals are the overview', () => {
  it('turnover per customer: the customers add up to the totals per month and to the income of the overview', () => {
    fc.assert(
      fc.property(
        invoicesArb.chain((invoices) => paymentsArb(invoices.length).map((payments) => ({ invoices, payments }))),
        fc.boolean(),
        ({ invoices, payments }, smallBusiness) => {
          const data = input({ invoices, payments, smallBusiness });
          const report = turnoverByCustomer(data);
          expect(sumOf(report.rows.map((r) => r.total))).toBe(report.total);
          for (let m = 0; m < 12; m++) expect(sumOf(report.rows.map((r) => r.months[m] ?? 0))).toBe(report.months[m]);
          for (const r of report.rows) expect(sumOf(r.months)).toBe(r.total);
          expect(sumOf(report.months)).toBe(report.total);
          expect(report.total).toBe(overview(data).income);
        },
      ),
    );
  });

  it('expenses per category: the categories add up to the totals per month and to the expenses of the overview', () => {
    fc.assert(
      fc.property(expensesArb, fc.boolean(), (expenses, smallBusiness) => {
        const data = input({ expenses, smallBusiness });
        const report = expensesByCategory(data);
        expect(sumOf(report.rows.map((r) => r.total))).toBe(report.total);
        for (let m = 0; m < 12; m++) expect(sumOf(report.rows.map((r) => r.months[m] ?? 0))).toBe(report.months[m]);
        for (const r of report.rows) expect(sumOf(r.months)).toBe(r.total);
        expect(report.total).toBe(overview(data).expenses);
      }),
    );
  });

  it('open items: the customers add up to the totals, and the totals are the open receivables of the overview', () => {
    fc.assert(
      fc.property(
        invoicesArb.chain((invoices) => paymentsArb(invoices.length).map((payments) => ({ invoices, payments }))),
        ({ invoices, payments }) => {
          const data = input({ invoices, payments });
          const report = openItems(data);
          const o = overview(data);
          expect(sumOf(report.customers.map((c) => c.open))).toBe(report.open);
          expect(sumOf(report.customers.map((c) => c.overdue))).toBe(report.overdue);
          expect(sumOf(report.customers.map((c) => c.overdueCount))).toBe(report.overdueCount);
          expect(sumOf(report.customers.map((c) => c.count))).toBe(report.items.length);
          expect(sumOf(report.items.map((i) => i.open))).toBe(report.open);
          expect(report.open).toBe(o.openReceivables);
          expect(report.overdue).toBe(o.overdueReceivables);
          expect(report.overdueCount).toBe(o.overdueCount);
        },
      ),
    );
  });

  it('comparison: the months add up to the totals of both years', () => {
    fc.assert(
      fc.property(
        invoicesArb.chain((invoices) => paymentsArb(invoices.length).chain((payments) => expensesArb.map((expenses) => ({ invoices, payments, expenses })))),
        ({ invoices, payments, expenses }) => {
          const c = yearComparison(input({ invoices, payments, expenses }));
          expect(sumOf(c.months.map((m) => m.income))).toBe(c.current.income);
          expect(sumOf(c.months.map((m) => m.expenses))).toBe(c.current.expenses);
          expect(sumOf(c.months.map((m) => m.profit))).toBe(c.current.profit);
          expect(sumOf(c.months.map((m) => m.previousIncome))).toBe(c.previous.income);
          expect(sumOf(c.months.map((m) => m.previousExpenses))).toBe(c.previous.expenses);
          expect(sumOf(c.months.map((m) => m.previousProfit))).toBe(c.previous.profit);
          expect(c.change.profit).toBe(c.current.profit - c.previous.profit);
        },
      ),
    );
  });
});
