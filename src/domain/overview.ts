// The overview ("Wo stehe ich?", Phase 4 of the roadmap): what came in and went out in a calendar year on the cash basis
// (EÜR, § 11 EStG), what is still open, and the turnover the small business limits are compared with. Pure: the caller
// maps the records of the folder into the rows below. Every figure is an estimate for orientation, not tax advice.

import { taxParams } from './tax/params';
import { cents, subtract, sum, type Cents } from './money';
import { netPartsOf, netShareOf } from './payment';
import { turnoverOfYear, type TurnoverEntry } from './smallBusiness';

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
  /**
   * A supply taxable in Germany (§ 1 Abs. 1 Nr. 1 UStG). False for a service whose place of supply is abroad
   * (`notTaxable`): it is no part of the Gesamtumsatz of the small business limits (§ 19 Abs. 2 UStG).
   */
  taxableInGermany: boolean;
}

/** A payment of an invoice, on the day the money arrived */
export interface OverviewPayment {
  /** Decides the order of two payments of one day; the net parts of an invoice follow that order (see `netPartsOf`) */
  id?: string;
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

/**
 * A payout: income without an invoice of kontor, on the day the money arrived. `vat` is the German VAT inside the amount
 * (0 for every treatment but `domesticTaxed`); the rest is income. A payout is not turnover of an invoice and not an open
 * item: whether it counts toward the small business limits is an open question (epic #30, question 2).
 */
export interface OverviewPayout {
  date: string;
  amount: Cents;
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
  /** The net part of the payments of the year, and of the payouts without an invoice */
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
  /** The Gesamtumsatz of the year for the small business limits (§ 19 Abs. 2 UStG): see `turnoverEntries` */
  turnover: Cents;
}

export { netShareOf };

/**
 * The parts of the Gesamtumsatz (§ 19 Abs. 2 UStG): "nach vereinnahmten Entgelten", so each payment counts on the day the
 * money arrived, with its net part, whatever the invoice date or the way VAT is accounted for. Payments of a supply that
 * is not taxable in Germany are left out. A payment of an invoice that is not in the list counts with its whole amount,
 * like in the income.
 */
export function turnoverEntries(invoices: readonly OverviewInvoice[], payments: readonly OverviewPayment[], netParts?: readonly Cents[]): TurnoverEntry[] {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  // the net part of a payment comes from the cumulative amount paid per invoice (netPartsOf), as in the income
  const parts = netParts ?? netPartsOf(byId, payments);
  const entries: TurnoverEntry[] = [];
  payments.forEach((p, i) => {
    const inv = byId.get(p.invoiceId);
    if (inv && !inv.taxableInGermany) return;
    entries.push({ date: p.date, amount: parts[i] as Cents });
  });
  return entries;
}

/** What an expense counts: its gross amount for a small business, otherwise without the VAT that comes back */
export const expenseNet = (e: OverviewExpense, smallBusiness: boolean): Cents => (smallBusiness ? e.gross : subtract(e.gross, e.vat));

/** What a payout counts as income: its amount without the VAT inside it */
export const payoutIncome = (p: OverviewPayout): Cents => subtract(p.amount, p.vat);

const inYear = (date: string, year: number): boolean => date.startsWith(`${year}-`);
const monthOf = (date: string): number => Number(date.slice(5, 7));

/** The overview of a calendar year. `today` decides what is overdue; `smallBusiness` decides what an expense counts. */
export function overview(input: { year: number; today: string; smallBusiness: boolean; invoices: readonly OverviewInvoice[]; payments: readonly OverviewPayment[]; expenses: readonly OverviewExpense[]; payouts: readonly OverviewPayout[] }): Overview {
  const { year, today, smallBusiness, invoices, payments, expenses, payouts } = input;
  const byId = new Map(invoices.map((i) => [i.id, i]));

  // the net part of each payment, from the cumulative amount paid per invoice, so that the parts add up to the net amount
  const netParts = netPartsOf(byId, payments);
  const yearIncomes: { date: string; income: Cents }[] = [];
  payments.forEach((p, i) => {
    if (inYear(p.date, year)) yearIncomes.push({ date: p.date, income: netParts[i] as Cents });
  });
  const expenseOf = (e: OverviewExpense): Cents => expenseNet(e, smallBusiness);

  const yearExpenses = expenses.filter((e) => inYear(e.date, year));
  const yearPayouts = payouts.filter((p) => inYear(p.date, year));
  const months: MonthFigures[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, income: cents(0), expenses: cents(0), profit: cents(0) }));
  for (const p of yearIncomes) {
    const m = months[monthOf(p.date) - 1];
    if (m) m.income = cents(m.income + p.income);
  }
  for (const p of yearPayouts) {
    const m = months[monthOf(p.date) - 1];
    if (m) m.income = cents(m.income + payoutIncome(p));
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

  const income = cents(sum(yearIncomes.map((p) => p.income)) + sum(yearPayouts.map(payoutIncome)));
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
    turnover: turnoverOfYear(turnoverEntries(invoices, payments, netParts), year),
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
