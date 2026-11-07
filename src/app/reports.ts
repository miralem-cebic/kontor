// Reports (Auswertungen, F11): the records of the open company, mapped into the rows the domain figures are computed
// from (src/domain/reports.ts). Like the overview, an invoice counts with the VAT status it was issued with (its
// snapshot), and a deleted record is not counted. Customers are named by their contact; a contact that is gone is named
// by the snapshot of one of its invoices.

import type { ContactId, DocumentId } from '../data/ids';
import type { CompanyFile, ContactFile, DocumentFile, ExpenseFile, PaymentFile } from '../data/types';
import { cancellationOf, isInvoice } from '../data/types';
import { isoDateOf } from '../domain/dates';
import { expenseVat } from '../domain/expense';
import { dueDate, invoiceTotals } from '../domain/invoice';
import {
  availableYears,
  expensesByCategory,
  openItems,
  turnoverByCustomer,
  yearComparison,
  type ComparisonReport,
  type GroupReport,
  type GroupRow,
  type OpenCustomerRow,
  type OpenItem,
  type OpenItemsReport,
  type ReportExpense,
  type ReportInput,
  type ReportInvoice,
} from '../domain/reports';
import type { OverviewPayment } from '../domain/overview';

/** A row of a group report with the name to show; empty when there is none (no known customer, no category) */
export type NamedGroupRow = GroupRow & { name: string };
export type NamedGroupReport = Omit<GroupReport, 'rows'> & { rows: NamedGroupRow[] };
export type NamedOpenItem = OpenItem & { customerName: string };
export type NamedOpenCustomer = OpenCustomerRow & { name: string };
export type NamedOpenItemsReport = Omit<OpenItemsReport, 'items' | 'customers'> & { items: NamedOpenItem[]; customers: NamedOpenCustomer[] };

export interface ReportsView {
  year: number;
  /** The year selector: every year with records, and this one; newest first */
  years: number[];
  /** The day the open items are counted on */
  today: string;
  turnover: NamedGroupReport;
  expenses: NamedGroupReport;
  open: NamedOpenItemsReport;
  comparison: ComparisonReport;
}

/** The rows of the open company the reports are computed from */
export function reportInput(company: CompanyFile, docs: readonly DocumentFile[], payments: ReadonlyMap<string, PaymentFile>, expenses: ReadonlyMap<string, ExpenseFile>, year: number, today: string): ReportInput {
  const smallBusiness = company.tax.vat.kind === 'smallBusiness';
  const invoices: ReportInvoice[] = docs
    .filter(isInvoice)
    .filter((inv) => !inv.deletedAt)
    .map((inv) => {
      const issued = inv.issued !== null;
      const withoutVat = inv.issued ? inv.issued.snapshot.company.tax.vat.kind === 'smallBusiness' : smallBusiness;
      const totals = invoiceTotals(inv, withoutVat);
      return {
        id: inv.id,
        number: inv.issued?.number ?? '',
        customerId: inv.customerId,
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
  const expenseRows: ReportExpense[] = [...expenses.values()].filter((e) => e.deletedAt === null).map((e) => ({ date: e.date, gross: e.gross, vat: expenseVat(e), category: e.category }));
  return { year, today, smallBusiness, invoices, payments: paymentRows, expenses: expenseRows };
}

/** The four reports of a calendar year, from the records of the open company; null without a company */
export function buildReports(
  company: CompanyFile | null,
  contacts: ReadonlyMap<ContactId, ContactFile>,
  documents: ReadonlyMap<DocumentId, DocumentFile>,
  payments: ReadonlyMap<string, PaymentFile>,
  expenses: ReadonlyMap<string, ExpenseFile>,
  year: number,
  now: Date,
): ReportsView | null {
  if (!company) return null;
  const today = isoDateOf(now);
  const docs = [...documents.values()];
  const input = reportInput(company, docs, payments, expenses, year, today);

  // the name of a customer: the contact as it is now, else the customer in the snapshot of an issued invoice
  const snapshotNames = new Map<string, string>();
  for (const d of docs) if (d.issued && !snapshotNames.has(d.customerId)) snapshotNames.set(d.customerId, d.issued.snapshot.customer.name);
  const customerName = (id: string): string => (id ? (contacts.get(id as ContactId)?.name ?? snapshotNames.get(id) ?? '') : '');

  const turnover = turnoverByCustomer(input);
  const spent = expensesByCategory(input);
  const open = openItems(input);
  const dates = [...input.invoices.map((i) => i.date), ...input.payments.map((p) => p.date), ...input.expenses.map((e) => e.date)];
  return {
    year,
    years: availableYears(dates, now.getFullYear()),
    today,
    turnover: { ...turnover, rows: turnover.rows.map((r) => ({ ...r, name: customerName(r.key) })) },
    expenses: { ...spent, rows: spent.rows.map((r) => ({ ...r, name: r.key })) },
    open: {
      ...open,
      items: open.items.map((i) => ({ ...i, customerName: customerName(i.customerId) })),
      customers: open.customers.map((c) => ({ ...c, name: customerName(c.key) })),
    },
    comparison: yearComparison(input),
  };
}
