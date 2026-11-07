// The advance VAT return (R1): the records of the open company, mapped into the rows the domain computes the form
// fields from (src/domain/ustva.ts), the values as they are copied into "Mein ELSTER", and the CSV file.
// Invoices count with the VAT status they were issued with (their snapshot), so that a later change of the company does
// not change the return of an earlier period.

import { encodeCsv, num } from '../data/export/csv';
import type { DocumentId } from '../data/ids';
import type { CompanyFile, DocumentFile, ExpenseFile, PaymentFile } from '../data/types';
import { isInvoice } from '../data/types';
import { expenseVat } from '../domain/expense';
import { invoiceTotals } from '../domain/invoice';
import { toDecimalString, type Cents } from '../domain/money';
import { ustva, wholeEuros, type UstvaExpense, type UstvaFieldId, type UstvaInvoice, type UstvaPayment, type UstvaPeriod, type UstvaResult } from '../domain/ustva';
import { t, type MessageKey } from '../i18n';
import { saveFile } from '../lib/browser';
import type { Table } from './csvExport';

/**
 * The advance return of a period for the open company, from its records. Null without a company and for a small
 * business, which files no advance return (§ 19 UStG).
 */
export function buildUstva(
  company: CompanyFile | null,
  documents: ReadonlyMap<DocumentId, DocumentFile>,
  payments: ReadonlyMap<string, PaymentFile>,
  expenses: ReadonlyMap<string, ExpenseFile>,
  period: UstvaPeriod,
): UstvaResult | null {
  if (!company || company.tax.vat.kind !== 'regular') return null;
  const { method, permanentExtension } = company.tax.vat;

  const invoices: UstvaInvoice[] = [...documents.values()]
    .filter(isInvoice)
    .filter((inv) => !inv.deletedAt && inv.issued !== null)
    .map((inv) => {
      const issued = inv.issued;
      const smallBusiness = issued?.snapshot.company.tax.vat.kind === 'smallBusiness';
      const totals = invoiceTotals(inv, smallBusiness);
      return {
        id: inv.id,
        date: inv.date,
        serviceEnd: inv.service.kind === 'date' ? inv.service.date : inv.service.end,
        treatment: inv.taxTreatment,
        customerCountry: issued?.snapshot.customer.address?.country ?? null,
        isCancellation: inv.cancels !== null,
        smallBusiness,
        lines: totals.byRate.map(({ rate, net, tax }) => ({ rate, net, tax })),
      };
    });
  const paymentRows: UstvaPayment[] = [...payments.values()].filter((p) => p.deletedAt === null).map((p) => ({ id: p.id, invoiceId: p.invoiceId, date: p.date, amount: p.amount }));
  const expenseRows: UstvaExpense[] = [...expenses.values()].filter((e) => e.deletedAt === null).map((e) => ({ date: e.date, taxTreatment: e.taxTreatment, gross: e.gross, vat: expenseVat(e) }));

  return ustva({ period, method, permanentExtension, invoices, payments: paymentRows, expenses: expenseRows });
}

/**
 * The value of a field as it is typed into the form: a base in whole euros, a tax in euros and cents with a decimal
 * comma and no grouping ("201,88"), which is what ELSTER takes.
 */
export const ustvaCopyValue = (what: 'base' | 'tax', amount: Cents): string => (what === 'base' ? String(wholeEuros(amount)) : toDecimalString(amount).replace('.', ','));

/** The description of a field of the form in the interface language */
const FIELD_TEXT: Record<UstvaFieldId, MessageKey> = {
  taxable19: 'ustva.field.taxable19',
  taxable7: 'ustva.field.taxable7',
  intraCommunitySupply: 'ustva.field.intraCommunitySupply',
  euServices: 'ustva.field.euServices',
  reverseChargeSupplied: 'ustva.field.reverseChargeSupplied',
  otherNotTaxable: 'ustva.field.otherNotTaxable',
  inputTax: 'ustva.field.inputTax',
  remainingPrepayment: 'ustva.field.remainingPrepayment',
};
export const ustvaFieldText = (id: UstvaFieldId): string => t(FIELD_TEXT[id]);

/** The shown fields as a table for a spreadsheet */
export function ustvaTable(result: UstvaResult): Table {
  const amount = (c: Cents) => num(toDecimalString(c).replace('.', ','));
  return {
    header: [t('ustva.csv.kz'), t('ustva.csv.description'), t('ustva.csv.baseForm'), t('ustva.csv.baseExact'), t('ustva.csv.tax')],
    rows: result.fields
      .filter((f) => f.shown)
      .map((f) => [f.kz, ustvaFieldText(f.id), f.base === null ? '' : num(ustvaCopyValue('base', f.base)), f.base === null ? '' : amount(f.base), f.tax === null ? '' : amount(f.tax)]),
  };
}

/** The name of the period for a file name: 2026-10 or 2026-Q3 */
export const ustvaPeriodSlug = (p: UstvaPeriod): string => (p.kind === 'month' ? `${p.year}-${String(p.index).padStart(2, '0')}` : `${p.year}-Q${p.index}`);

/** Saves the result as a CSV file through the browser's download */
export function exportUstvaCsv(result: UstvaResult): void {
  const table = ustvaTable(result);
  saveFile(encodeCsv(table.header, table.rows), `kontor-ustva-${ustvaPeriodSlug(result.period)}.csv`, 'text/csv');
}
