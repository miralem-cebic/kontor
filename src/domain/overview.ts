// The overview ("Wo stehe ich?", Phase 4 of the roadmap): what came in and went out in a calendar year on the cash basis
// (EÜR, § 11 EStG), what is still open, and the turnover the small business limits are compared with. Pure: the caller
// maps the records of the folder into the rows below. Every figure is an estimate for orientation, not tax advice.

import { taxParams } from './tax/params';
import { cents, divideRounded, subtract, sum, type Cents } from './money';

/** An invoice as the overview needs it: a draft is not counted; a cancellation counts with its negative amounts */
export interface OverviewInvoice {
  id: string;
  date: string;
  issued: boolean;
  isCancellation: boolean;
  /** A cancellation was issued for this invoice: it is no longer due */
  cancelled: boolean;
  net: Cents;
  gross: Cents;
  /** The day the invoice is due (YYYY-MM-DD); empty for a cancellation */
  dueDate: string;
}

/** A payment of an invoice, on the day the money arrived */
export interface OverviewPayment {
  invoiceId: string;
  date: string;
  amount: Cents;
}

/** An expense: its gross amount and the VAT inside it that can be claimed back (0 without such VAT) */
export interface OverviewExpense {
  date: string;
  gross: Cents;
  vat: Cents;
}

export interface MonthFigures {
  /** 1 for January */
  month: number;
  income: Cents;
  expenses: Cents;
  profit: Cents;
}

export interface Overview {
  year: number;
  /** The net part of the payments of the year */
  income: Cents;
  /** The expenses of the year, without the VAT that comes back (a small business has none to take off) */
  expenses: Cents;
  /** income − expenses: an estimate of the profit of the year on the cash basis */
  profit: Cents;
  /** What is still to pay on issued invoices, gross */
  openReceivables: Cents;
  /** Of that, what is past its due date */
  overdueReceivables: Cents;
  overdueCount: number;
  months: MonthFigures[];
  /** The net turnover of the issued invoices of the year (cancellations count negative) */
  turnover: Cents;
}

/**
 * The net part of a payment: the share of its invoice that the amount pays, amount × net ÷ gross, rounded once. A payment
 * on an invoice without VAT counts with its whole amount. The sums of a cancellation are negative: the fraction is
 * expanded by −1, so the share stays the same and the divisor positive.
 */
export function netShareOf(amount: Cents, net: Cents, gross: Cents): Cents {
  if (gross === 0) return amount;
  const product = BigInt(amount) * BigInt(net);
  const share = gross > 0 ? divideRounded(product, BigInt(gross)) : divideRounded(-product, -BigInt(gross));
  return cents(Number(share));
}

const inYear = (date: string, year: number): boolean => date.startsWith(`${year}-`);
const monthOf = (date: string): number => Number(date.slice(5, 7));

/** The overview of a calendar year. `today` decides what is overdue; `smallBusiness` decides what an expense counts. */
export function overview(input: { year: number; today: string; smallBusiness: boolean; invoices: readonly OverviewInvoice[]; payments: readonly OverviewPayment[]; expenses: readonly OverviewExpense[] }): Overview {
  const { year, today, smallBusiness, invoices, payments, expenses } = input;
  const byId = new Map(invoices.map((i) => [i.id, i]));

  const incomeOf = (p: OverviewPayment): Cents => {
    const inv = byId.get(p.invoiceId);
    return inv ? netShareOf(p.amount, inv.net, inv.gross) : p.amount;
  };
  const expenseOf = (e: OverviewExpense): Cents => (smallBusiness ? e.gross : subtract(e.gross, e.vat));

  const yearPayments = payments.filter((p) => inYear(p.date, year));
  const yearExpenses = expenses.filter((e) => inYear(e.date, year));
  const months: MonthFigures[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, income: cents(0), expenses: cents(0), profit: cents(0) }));
  for (const p of yearPayments) {
    const m = months[monthOf(p.date) - 1];
    if (m) m.income = cents(m.income + incomeOf(p));
  }
  for (const e of yearExpenses) {
    const m = months[monthOf(e.date) - 1];
    if (m) m.expenses = cents(m.expenses + expenseOf(e));
  }
  for (const m of months) m.profit = subtract(m.income, m.expenses);

  // what is open: every issued invoice that is not a cancellation and was not cancelled, less what was paid on it
  let openReceivables = 0;
  let overdueReceivables = 0;
  let overdueCount = 0;
  for (const inv of invoices) {
    if (!inv.issued || inv.isCancellation || inv.cancelled) continue;
    const paid = sum(payments.filter((p) => p.invoiceId === inv.id).map((p) => p.amount));
    const open = Math.max(0, inv.gross - paid);
    openReceivables += open;
    if (open > 0 && inv.dueDate < today) {
      overdueReceivables += open;
      overdueCount += 1;
    }
  }

  const turnover = invoices.filter((i) => i.issued && inYear(i.date, year)).reduce((total, i) => total + i.net, 0);
  const income = sum(yearPayments.map(incomeOf));
  const expenseSum = sum(yearExpenses.map(expenseOf));
  return {
    year,
    income,
    expenses: expenseSum,
    profit: subtract(income, expenseSum),
    openReceivables: cents(openReceivables),
    overdueReceivables: cents(overdueReceivables),
    overdueCount,
    months,
    turnover: cents(turnover),
  };
}

/** The turnover of the year against the small business limits of its tax parameters (an orientation, not a decision) */
export function smallBusinessLimitState(year: number, previousTurnover: Cents, currentTurnover: Cents) {
  const limits = taxParams(year).smallBusiness;
  return {
    previousLimit: limits.previousYearLimit,
    currentLimit: limits.currentYearLimit,
    previousAbove: previousTurnover > limits.previousYearLimit,
    currentAbove: currentTurnover > limits.currentYearLimit,
  };
}
