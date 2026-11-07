// Reports (Auswertungen, F11): the figures of the overview split up in four ways: the income per customer, the
// expenses per category, the open items, and the year against the year before. Like the overview they are on the cash
// basis (EÜR, § 11 EStG): income is the net part of the payments on the day they arrived, expenses count on the day they
// were paid, without the VAT that comes back. Pure: the caller maps the records of the folder into the rows below.
// Every figure is an estimate for orientation, not tax advice.

import { daysBetween } from './dates';
import { cents, subtract, sum, type Cents } from './money';
import { expenseNet, netShareOf, overview, payoutIncome, type OverviewExpense, type OverviewInvoice, type OverviewPayment, type OverviewPayout } from './overview';

/** An invoice as the reports need it: the overview's row, with its number and its customer */
export interface ReportInvoice extends OverviewInvoice {
  /** The number it was issued with; empty for a draft */
  number: string;
  /** The contact; the reports group by it */
  customerId: string;
}

/** An expense as the reports need it: the overview's row, with its category */
export interface ReportExpense extends OverviewExpense {
  /** Free text; empty for none */
  category: string;
}

/** A payout as the reports need it: the overview's row, with the contact that paid; the income report groups by it */
export interface ReportPayout extends OverviewPayout {
  payerId: string;
}

export interface ReportInput {
  year: number;
  /** The day that decides what is overdue (YYYY-MM-DD) */
  today: string;
  /** A small business has no VAT to take off an expense */
  smallBusiness: boolean;
  invoices: readonly ReportInvoice[];
  payments: readonly OverviewPayment[];
  expenses: readonly ReportExpense[];
  payouts: readonly ReportPayout[];
}

const inYear = (date: string, year: number): boolean => date.startsWith(`${year}-`);
/** 0 for January; the dates are checked at the boundary, so the month is valid */
const monthIndex = (date: string): number => Number(date.slice(5, 7)) - 1;

/* ---------- Income per customer, expenses per category ---------- */

/** One customer or one category: the twelve months of the year and their sum */
export interface GroupRow {
  /** The customer ID or the category; empty for a payment without a known invoice, or an expense without a category */
  key: string;
  /** January to December */
  months: Cents[];
  total: Cents;
}

export interface GroupReport {
  /** The biggest total first, the same total by key */
  rows: GroupRow[];
  /** The twelve months over all rows, summed on their own, so that the rows can be checked against them */
  months: Cents[];
  total: Cents;
}

/** Adds amounts to the months of the group they belong to, and to the months of the whole report */
function group(items: readonly { key: string; month: number; amount: Cents }[]): GroupReport {
  const rows = new Map<string, Cents[]>();
  const months: number[] = new Array<number>(12).fill(0);
  for (const { key, month, amount } of items) {
    let row = rows.get(key);
    if (!row) {
      row = new Array<Cents>(12).fill(cents(0));
      rows.set(key, row);
    }
    row[month] = cents((row[month] ?? 0) + amount);
    months[month] = (months[month] ?? 0) + amount;
  }
  const list = [...rows].map(([key, m]): GroupRow => ({ key, months: m, total: sum(m) }));
  list.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key, 'de'));
  return { rows: list, months: months.map(cents), total: sum(months.map(cents)) };
}

/** The income of the year per customer: the net part of each payment and the income of each payout, in the month the money arrived */
export function turnoverByCustomer(input: ReportInput): GroupReport {
  const byId = new Map(input.invoices.map((i) => [i.id, i]));
  const paid = input.payments
    .filter((p) => inYear(p.date, input.year))
    .map((p) => {
      const inv = byId.get(p.invoiceId);
      return { key: inv?.customerId ?? '', month: monthIndex(p.date), amount: inv ? netShareOf(p.amount, inv.net, inv.gross) : p.amount };
    });
  const paidOut = input.payouts.filter((p) => inYear(p.date, input.year)).map((p) => ({ key: p.payerId, month: monthIndex(p.date), amount: payoutIncome(p) }));
  return group([...paid, ...paidOut]);
}

/** The expenses of the year per category (the text trimmed), in the month they were paid */
export function expensesByCategory(input: ReportInput): GroupReport {
  return group(
    input.expenses
      .filter((e) => inYear(e.date, input.year))
      .map((e) => ({ key: e.category.trim(), month: monthIndex(e.date), amount: expenseNet(e, input.smallBusiness) })),
  );
}

/* ---------- Open items ---------- */

/** An issued invoice with something still to pay */
export interface OpenItem {
  id: string;
  number: string;
  customerId: string;
  date: string;
  dueDate: string;
  gross: Cents;
  /** What was paid on it so far */
  paid: Cents;
  /** What is still to pay: the gross amount less what was paid, more than 0 */
  open: Cents;
  /** Days after the due date; 0 when it is not yet overdue (the due date itself is not overdue) */
  daysOverdue: number;
}

export interface OpenCustomerRow {
  key: string;
  count: number;
  open: Cents;
  overdue: Cents;
  overdueCount: number;
}

export interface OpenItemsReport {
  /** The oldest due date first, the same day by number */
  items: OpenItem[];
  /** The biggest open amount first, the same amount by key */
  customers: OpenCustomerRow[];
  open: Cents;
  overdue: Cents;
  overdueCount: number;
}

/**
 * The open items as of `today`, whatever the year of the invoice: every issued invoice that is not a cancellation and
 * was not cancelled, less what was paid on it. A draft is not an open item.
 */
export function openItems(input: ReportInput): OpenItemsReport {
  const paidBy = new Map<string, number>();
  for (const p of input.payments) paidBy.set(p.invoiceId, (paidBy.get(p.invoiceId) ?? 0) + p.amount);

  const items: OpenItem[] = [];
  for (const inv of input.invoices) {
    if (!inv.issued || inv.isCancellation || inv.cancelled) continue;
    const paid = cents(paidBy.get(inv.id) ?? 0);
    const open = cents(Math.max(0, inv.gross - paid));
    if (open === 0) continue;
    const overdue = inv.dueDate < input.today;
    items.push({
      id: inv.id,
      number: inv.number,
      customerId: inv.customerId,
      date: inv.date,
      dueDate: inv.dueDate,
      gross: inv.gross,
      paid,
      open,
      daysOverdue: overdue ? daysBetween(inv.dueDate, input.today) : 0,
    });
  }
  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number, 'de'));

  const customers = new Map<string, OpenCustomerRow>();
  for (const item of items) {
    const row = customers.get(item.customerId) ?? { key: item.customerId, count: 0, open: cents(0), overdue: cents(0), overdueCount: 0 };
    row.count += 1;
    row.open = cents(row.open + item.open);
    if (item.daysOverdue > 0) {
      row.overdue = cents(row.overdue + item.open);
      row.overdueCount += 1;
    }
    customers.set(item.customerId, row);
  }
  const rows = [...customers.values()].sort((a, b) => b.open - a.open || a.key.localeCompare(b.key, 'de'));
  return {
    items,
    customers: rows,
    open: sum(items.map((i) => i.open)),
    overdue: sum(rows.map((r) => r.overdue)),
    overdueCount: rows.reduce((n, r) => n + r.overdueCount, 0),
  };
}

/* ---------- The year against the year before ---------- */

export interface ComparisonMonth {
  /** 1 for January */
  month: number;
  income: Cents;
  expenses: Cents;
  profit: Cents;
  previousIncome: Cents;
  previousExpenses: Cents;
  previousProfit: Cents;
}

export interface ComparisonTotals {
  income: Cents;
  expenses: Cents;
  profit: Cents;
}

export interface ComparisonReport {
  year: number;
  previousYear: number;
  months: ComparisonMonth[];
  current: ComparisonTotals;
  previous: ComparisonTotals;
  /** current − previous */
  change: ComparisonTotals;
}

/** Income, expenses and the surplus of the year and of the year before, month by month and in total */
export function yearComparison(input: ReportInput): ComparisonReport {
  const rows = { invoices: input.invoices, payments: input.payments, expenses: input.expenses, payouts: input.payouts, today: input.today, smallBusiness: input.smallBusiness };
  const current = overview({ ...rows, year: input.year });
  const previous = overview({ ...rows, year: input.year - 1 });
  const totals = (o: { income: Cents; expenses: Cents; profit: Cents }): ComparisonTotals => ({ income: o.income, expenses: o.expenses, profit: o.profit });
  const a = totals(current);
  const b = totals(previous);
  return {
    year: input.year,
    previousYear: input.year - 1,
    months: current.months.map((m, i) => {
      const p = previous.months[i];
      return {
        month: m.month,
        income: m.income,
        expenses: m.expenses,
        profit: m.profit,
        previousIncome: p?.income ?? cents(0),
        previousExpenses: p?.expenses ?? cents(0),
        previousProfit: p?.profit ?? cents(0),
      };
    }),
    current: a,
    previous: b,
    change: { income: subtract(a.income, b.income), expenses: subtract(a.expenses, b.expenses), profit: subtract(a.profit, b.profit) },
  };
}

/* ---------- Year selector ---------- */

/** The years the selector offers: every year that a date belongs to, and the current year; the newest first */
export function availableYears(dates: Iterable<string>, currentYear: number): number[] {
  const years = new Set<number>([currentYear]);
  for (const d of dates) if (/^\d{4}-\d{2}-\d{2}$/.test(d)) years.add(Number(d.slice(0, 4)));
  return [...years].sort((a, b) => b - a);
}
