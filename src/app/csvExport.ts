// The lists as CSV for spreadsheets (F35). Each list is one table: a header line and the rows of its active records.
// Contacts and items are sorted by name; documents and expenses by date, oldest first, the way an accountant reads
// them. Amounts are numbers with a decimal comma and no grouping ("1250,00"), rates are plain numbers ("19"), dates are
// ISO dates. Text cells are protected against formulas by the encoder (src/data/export/csv.ts).

import { date, encodeCsv, num, type Cell, type NumberCell } from '../data/export/csv';
import { tableToXlsx } from '../data/export/xlsx';
import { cancelledIds, isInvoice, isQuote, type BankAccount, type ContactFile, type DocumentFile, type ExpenseFile, type ItemFile, type PayoutFile } from '../data/types';
import type { ContactRoles } from '../domain/contact';
import type { ContactId, AccountId } from '../data/ids';
import { isoDateOf } from '../domain/dates';
import { byItemName } from '../domain/item';
import { toDecimalString, type BasisPoints, type Cents } from '../domain/money';
import { dueDate, invoiceTotals } from '../domain/invoice';
import { documentTotals } from '../domain/document';
import { expenseVat } from '../domain/expense';
import { payoutNet, payoutVat } from '../domain/payout';
import { t } from '../i18n';
import { accountName, expenseTreatmentText, payoutTreatmentText, unitText } from '../lib/labels';
import { saveFile } from '../lib/browser';
import { useApp } from '../store/appStore';

/** One list as a table: the header line and the rows */
export interface Table {
  header: string[];
  rows: Cell[][];
}

export type ExportKind = 'contacts' | 'items' | 'quotes' | 'invoices' | 'expenses' | 'payouts';

/** An amount in euros as a spreadsheet reads it: a decimal comma, no grouping, "-12,50" for a negative amount */
export const amount = (c: Cents): NumberCell => num(toDecimalString(c).replace('.', ','));

/** A rate in percent: 1900 → "19" */
const percent = (r: BasisPoints): NumberCell => num(String(r / 100));

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
const byDate = (a: { date: string }, b: { date: string }): number => a.date.localeCompare(b.date);

const rolesText = (r: ContactRoles): string => {
  if (r.customer && r.supplier) return t('contacts.roleBoth');
  if (r.customer) return t('contacts.roleCustomer');
  if (r.supplier) return t('contacts.roleSupplier');
  return '';
};

export function contactsTable(contacts: readonly ContactFile[]): Table {
  return {
    header: [
      t('csv.contact.number'),
      t('contacts.kind'),
      t('csv.contact.roles'),
      t('csv.contact.name'),
      t('csv.contact.nameLine2'),
      t('csv.contact.contactPerson'),
      t('csv.contact.street'),
      t('csv.contact.postalCode'),
      t('csv.contact.city'),
      t('csv.contact.country'),
      t('csv.contact.email'),
      t('csv.contact.phone'),
      t('csv.contact.vatId'),
      t('csv.contact.leitwegId'),
      t('csv.contact.orderReference'),
      t('csv.contact.paymentTerm'),
      t('csv.contact.language'),
      t('csv.contact.notes'),
    ],
    rows: contacts
      .filter((c) => !c.deletedAt)
      .sort(byName)
      .map((c) => [
        c.customerNumber,
        t(c.kind === 'company' ? 'contacts.kindCompany' : 'contacts.kindPerson'),
        rolesText(c.roles),
        c.name,
        c.nameLine2,
        c.contactPerson,
        c.address?.street ?? '',
        c.address?.postalCode ?? '',
        c.address?.city ?? '',
        c.address?.country ?? '',
        c.contact.email,
        c.contact.phone,
        c.vatId,
        c.leitwegId,
        c.orderReference,
        c.paymentTermDays === null ? '' : String(c.paymentTermDays),
        c.language,
        c.notes,
      ]),
  };
}

export function itemsTable(items: readonly ItemFile[]): Table {
  return {
    header: [t('csv.item.number'), t('csv.item.name'), t('csv.item.description'), t('csv.item.unit'), t('csv.item.netPrice'), t('csv.item.vatRate')],
    rows: items.filter((i) => !i.deletedAt).sort(byItemName).map((i) => [i.number, i.name, i.description, unitText(i.unit), amount(i.netPrice), percent(i.vatRate)]),
  };
}

export function expensesTable(expenses: readonly ExpenseFile[], accounts: readonly BankAccount[]): Table {
  const accountText = (id: AccountId | null): string => {
    const account = accounts.find((a) => a.id === id);
    return account ? accountName(account) : '';
  };
  return {
    header: [
      t('csv.expense.date'),
      t('csv.expense.supplier'),
      t('csv.expense.reference'),
      t('csv.expense.category'),
      t('csv.expense.gross'),
      t('csv.expense.treatment'),
      t('csv.expense.vatRate'),
      t('csv.expense.vat'),
      t('csv.expense.account'),
      t('csv.expense.note'),
    ],
    rows: expenses
      .filter((e) => !e.deletedAt)
      .sort((a, b) => byDate(a, b) || a.supplier.localeCompare(b.supplier, 'de', { sensitivity: 'base' }))
      .map((e) => [date(e.date), e.supplier, e.reference, e.category, amount(e.gross), expenseTreatmentText(e.taxTreatment), percent(e.vatRate), amount(expenseVat(e)), accountText(e.accountId), e.note]),
  };
}

export function payoutsTable(payouts: readonly PayoutFile[], contacts: ReadonlyMap<ContactId, ContactFile>, accounts: readonly BankAccount[]): Table {
  const accountText = (id: AccountId): string => {
    const account = accounts.find((a) => a.id === id);
    return account ? accountName(account) : '';
  };
  const payerName = (p: PayoutFile): string => contacts.get(p.payerId)?.name ?? '';
  return {
    header: [
      t('payouts.csvDate'),
      t('payouts.csvPayer'),
      t('payouts.csvPeriod'),
      t('payouts.csvAmount'),
      t('payouts.csvTreatment'),
      t('payouts.csvVatRate'),
      t('payouts.csvVat'),
      t('payouts.csvIncome'),
      t('payouts.csvAccount'),
      t('payouts.csvStatement'),
      t('payouts.csvNote'),
    ],
    rows: payouts
      .filter((p) => !p.deletedAt)
      .sort((a, b) => byDate(a, b) || payerName(a).localeCompare(payerName(b), 'de', { sensitivity: 'base' }))
      .map((p) => [date(p.date), payerName(p), p.period, amount(p.amount), payoutTreatmentText(p.taxTreatment), percent(p.vatRate), amount(payoutVat(p)), amount(payoutNet(p)), accountText(p.accountId), p.statementUrl, p.note]),
  };
}

/** The contact's name as the document says it: the snapshot of an issued document, the current contact otherwise */
const customerName = (d: DocumentFile, contacts: ReadonlyMap<ContactId, ContactFile>): string => (d.issued ? d.issued.snapshot.customer.name : (contacts.get(d.customerId)?.name ?? ''));

/** Does the company count as a small business for this document? An issued one says so in its snapshot. */
const smallBusinessFor = (d: DocumentFile, current: boolean): boolean => (d.issued ? d.issued.snapshot.company.tax.vat.kind === 'smallBusiness' : current);

export function quotesTable(documents: readonly DocumentFile[], smallBusiness: boolean, contacts: ReadonlyMap<ContactId, ContactFile>): Table {
  const quotes = documents.filter(isQuote).filter((q) => !q.deletedAt).sort(byDate);
  return {
    header: [t('csv.quote.number'), t('csv.quote.date'), t('csv.quote.validUntil'), t('csv.quote.customer'), t('csv.quote.subject'), t('csv.quote.status'), t('csv.quote.net'), t('csv.quote.gross')],
    rows: quotes.map((q) => {
      const totals = documentTotals(q.lines, smallBusinessFor(q, smallBusiness), q.discount);
      return [q.issued?.number ?? '', date(q.date), date(q.validUntil), customerName(q, contacts), q.subject, q.issued ? t('csv.status.final') : t('quotes.draft'), amount(totals.net), amount(totals.gross)];
    }),
  };
}

export function invoicesTable(documents: readonly DocumentFile[], smallBusiness: boolean, contacts: ReadonlyMap<ContactId, ContactFile>): Table {
  const cancelledSet = cancelledIds(documents);
  const invoices = documents.filter(isInvoice).filter((i) => !i.deletedAt).sort((a, b) => byDate(a, b) || (a.issued?.number ?? '').localeCompare(b.issued?.number ?? ''));
  return {
    header: [
      t('csv.invoice.number'),
      t('csv.invoice.date'),
      t('csv.invoice.customer'),
      t('csv.invoice.subject'),
      t('csv.invoice.status'),
      t('csv.invoice.dueDate'),
      t('csv.invoice.net'),
      t('csv.invoice.vat'),
      t('csv.invoice.gross'),
      t('csv.invoice.cancels'),
    ],
    rows: invoices.map((inv) => {
      const issued = inv.issued;
      const totals = invoiceTotals(inv, smallBusinessFor(inv, smallBusiness));
      const cancelled = issued !== null && cancelledSet.has(inv.id);
      const status = inv.cancels ? t('csv.status.cancellation') : !issued ? t('invoices.draft') : cancelled ? t('invoices.cancelled') : t('invoices.issued');
      return [
        issued?.number ?? '',
        date(inv.date),
        customerName(inv, contacts),
        inv.subject,
        status,
        inv.cancels ? '' : date(dueDate(inv)),
        amount(totals.net),
        amount(totals.tax),
        amount(totals.gross),
        inv.cancels?.number ?? '',
      ];
    }),
  };
}

/** The table of one list, from the state of the open company */
function tableOf(kind: ExportKind): Table | null {
  const { company, contacts, items, documents, expenses, payouts } = useApp.getState();
  if (!company) return null;
  const smallBusiness = company.tax.vat.kind === 'smallBusiness';
  switch (kind) {
    case 'contacts':
      return contactsTable([...contacts.values()]);
    case 'items':
      return itemsTable([...items.values()]);
    case 'quotes':
      return quotesTable([...documents.values()], smallBusiness, contacts);
    case 'invoices':
      return invoicesTable([...documents.values()], smallBusiness, contacts);
    case 'expenses':
      return expensesTable([...expenses.values()], company.bank.accounts);
    case 'payouts':
      return payoutsTable([...payouts.values()], contacts, company.bank.accounts);
  }
}

/** Every list as a table, for the exit archive (F12): the name of the list is the kind, without .csv */
export function allListTables(): { name: string; header: string[]; rows: Cell[][] }[] {
  const kinds: ExportKind[] = ['contacts', 'items', 'quotes', 'invoices', 'expenses', 'payouts'];
  return kinds.flatMap((kind) => {
    const table = tableOf(kind);
    return table ? [{ name: kind, header: table.header, rows: table.rows }] : [];
  });
}

/** Saves one list as an Excel file (.xlsx) through the browser's download (F37). */
export async function exportXlsx(kind: ExportKind): Promise<void> {
  const table = tableOf(kind);
  if (!table) return;
  saveFile(await tableToXlsx(table), `kontor-${kind}-${isoDateOf(new Date())}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/** Saves one list as a CSV file through the browser's download. The name says the list and the day. */
export function exportCsv(kind: ExportKind): void {
  const table = tableOf(kind);
  if (!table) return;
  saveFile(encodeCsv(table.header, table.rows), `kontor-${kind}-${isoDateOf(new Date())}.csv`, 'text/csv');
}
