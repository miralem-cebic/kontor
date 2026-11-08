// The overview ("Wo stehe ich?", Phase 4 of the roadmap): the records of the open company, mapped into the rows the
// domain figures are computed from. Invoices count with the VAT status the document was issued with (its snapshot), so
// that a change of the company later does not change a figure of an issued invoice.

import type { DocumentId } from '../data/ids';
import type { CompanyFile, DocumentFile, ExpenseFile, PaymentFile, PayoutFile } from '../data/types';
import { cancelledIds, isInvoice } from '../data/types';
import { expenseVat } from '../domain/expense';
import { isoDateOf } from '../domain/dates';
import { dueDate, invoiceTotals } from '../domain/invoice';
import { payoutVat } from '../domain/payout';
import { overview as computeOverview, smallBusinessLimitState, turnoverEntries, type Overview, type OverviewExpense, type OverviewInvoice, type OverviewPayment, type OverviewPayout } from '../domain/overview';
import { limitWarning, reverseChargeExpenseCount, type LimitWarning, type TurnoverEntry } from '../domain/smallBusiness';
import { smallBusinessOn } from './vatStatus';

export interface OverviewView {
  figures: Overview;
  /** The net turnover of the previous calendar year: the small business limit of the previous year is compared with it */
  previousTurnover: Overview['turnover'];
  limits: ReturnType<typeof smallBusinessLimitState>;
  /** The limit is close or crossed, or the previous year was above its limit; null for a regular business or while all is well */
  warning: LimitWarning | null;
  /** How many expenses of the year have reverse charge or come from outside the EU, for a small business (§ 13b UStG); 0 for a regular business */
  reverseChargeExpenses: number;
}

/** The invoices of the company as the overview counts them, each with the VAT status it was issued with */
function overviewInvoices(company: CompanyFile, docs: readonly DocumentFile[]): OverviewInvoice[] {
  const smallBusiness = company.tax.vat.kind === 'smallBusiness';
  const cancelled = cancelledIds(docs);
  return docs
    .filter(isInvoice)
    .filter((inv) => !inv.deletedAt)
    .map((inv) => {
      const issued = inv.issued !== null;
      const withoutVat = inv.issued ? inv.issued.snapshot.company.tax.vat.kind === 'smallBusiness' : smallBusiness;
      const totals = invoiceTotals(inv, withoutVat);
      return {
        id: inv.id,
        date: inv.date,
        issued,
        isCancellation: inv.cancels !== null,
        cancelled: issued && cancelled.has(inv.id),
        net: totals.net,
        gross: totals.gross,
        dueDate: inv.cancels ? '' : dueDate(inv),
        taxableInGermany: inv.taxTreatment !== 'notTaxable',
      };
    });
}

const overviewPayments = (payments: ReadonlyMap<string, PaymentFile>): OverviewPayment[] =>
  [...payments.values()].filter((p) => p.deletedAt === null).map((p) => ({ id: p.id, invoiceId: p.invoiceId, date: p.date, amount: p.amount }));

/**
 * The parts of the Gesamtumsatz of this company (§ 19 Abs. 2 UStG): the net part of each payment on the day it arrived.
 * Other companies of the same person and payments that kontor does not know are not in it.
 */
export function companyTurnoverEntries(company: CompanyFile, documents: ReadonlyMap<string, DocumentFile>, payments: ReadonlyMap<string, PaymentFile>): TurnoverEntry[] {
  return turnoverEntries(overviewInvoices(company, [...documents.values()]), overviewPayments(payments));
}

/** The overview of the calendar year of `now`, from the records of the open company; null without a company */
export function buildOverview(company: CompanyFile | null, documents: ReadonlyMap<DocumentId, DocumentFile>, payments: ReadonlyMap<string, PaymentFile>, expenses: ReadonlyMap<string, ExpenseFile>, payouts: ReadonlyMap<string, PayoutFile>, now: Date): OverviewView | null {
  if (!company) return null;
  const today = isoDateOf(now);
  const year = now.getFullYear();
  const smallBusiness = company.tax.vat.kind === 'smallBusiness';
  const docs = [...documents.values()];
  const invoices = overviewInvoices(company, docs);
  const paymentRows = overviewPayments(payments);
  const activeExpenses = [...expenses.values()].filter((e) => e.deletedAt === null);
  // an expense counts with the VAT status of its day: it has no snapshot, so the status comes from the invoices around it
  const smallOn = smallBusinessOn(company, docs);
  const expenseRows: OverviewExpense[] = activeExpenses.map((e) => ({ date: e.date, gross: e.gross, vat: expenseVat(e), smallBusiness: smallOn(e.date) }));
  const payoutRows: OverviewPayout[] = [...payouts.values()].filter((p) => p.deletedAt === null).map((p) => ({ date: p.date, amount: p.amount, vat: payoutVat(p) }));
  const input = (y: number) => ({ year: y, today, smallBusiness, invoices, payments: paymentRows, expenses: expenseRows, payouts: payoutRows });

  const figures = computeOverview(input(year));
  const previous = computeOverview(input(year - 1));
  const entries = turnoverEntries(invoices, paymentRows);
  return {
    figures,
    previousTurnover: previous.turnover,
    limits: smallBusinessLimitState(year, previous.turnover, figures.turnover),
    // the warnings are about the exemption, so only a small business gets them
    warning: smallBusiness ? limitWarning(entries, year) : null,
    reverseChargeExpenses: smallBusiness ? reverseChargeExpenseCount(activeExpenses, year) : 0,
  };
}
