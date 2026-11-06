// The overview ("Wo stehe ich?", Phase 4 of the roadmap): the records of the open company, mapped into the rows the
// domain figures are computed from. Invoices count with the VAT status the document was issued with (its snapshot), so
// that a change of the company later does not change a figure of an issued invoice.

import type { DocumentId } from '../data/ids';
import type { CompanyFile, DocumentFile, ExpenseFile, PaymentFile } from '../data/types';
import { cancellationOf, isInvoice } from '../data/types';
import { expenseVat } from '../domain/expense';
import { isoDateOf } from '../domain/dates';
import { dueDate, invoiceTotals } from '../domain/invoice';
import { overview as computeOverview, smallBusinessLimitState, type Overview, type OverviewExpense, type OverviewInvoice, type OverviewPayment } from '../domain/overview';

export interface OverviewView {
  figures: Overview;
  /** The net turnover of the previous calendar year: the small business limit of the previous year is compared with it */
  previousTurnover: Overview['turnover'];
  limits: ReturnType<typeof smallBusinessLimitState>;
}

/** The overview of the calendar year of `now`, from the records of the open company; null without a company */
export function buildOverview(company: CompanyFile | null, documents: ReadonlyMap<DocumentId, DocumentFile>, payments: ReadonlyMap<string, PaymentFile>, expenses: ReadonlyMap<string, ExpenseFile>, now: Date): OverviewView | null {
  if (!company) return null;
  const today = isoDateOf(now);
  const year = now.getFullYear();
  const smallBusiness = company.tax.vat.kind === 'smallBusiness';
  const docs = [...documents.values()];

  const invoices: OverviewInvoice[] = docs
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
        cancelled: issued && cancellationOf(docs, inv.id) !== undefined,
        net: totals.net,
        gross: totals.gross,
        dueDate: inv.cancels ? '' : dueDate(inv),
      };
    });
  const paymentRows: OverviewPayment[] = [...payments.values()].filter((p) => p.deletedAt === null).map((p) => ({ invoiceId: p.invoiceId, date: p.date, amount: p.amount }));
  const expenseRows: OverviewExpense[] = [...expenses.values()].filter((e) => e.deletedAt === null).map((e) => ({ date: e.date, gross: e.gross, vat: expenseVat(e) }));
  const input = (y: number) => ({ year: y, today, smallBusiness, invoices, payments: paymentRows, expenses: expenseRows });

  const figures = computeOverview(input(year));
  const previous = computeOverview(input(year - 1));
  return { figures, previousTurnover: previous.turnover, limits: smallBusinessLimitState(year, previous.turnover, figures.turnover) };
}
