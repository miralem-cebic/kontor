// The summary report (R8): the records of the open company, mapped into the rows the domain computes the lines from
// (src/domain/zm.ts), the values as they are typed into the BZSt online portal, and the CSV file.
// Invoices count with the VAT status and the customer they were issued with (their snapshot), so that a later change of
// the company or of the customer does not change the report of an earlier period.

import { encodeCsv, num } from '../data/export/csv';
import type { DocumentId } from '../data/ids';
import type { CompanyFile, ContactFile, DocumentFile, ExpenseFile, PaymentFile, PayoutFile } from '../data/types';
import { isInvoice } from '../data/types';
import { invoiceTotals } from '../domain/invoice';
import { cents, toDecimalString } from '../domain/money';
import { periodEnd, periodOfDate, periodStart, type UstvaPeriod } from '../domain/ustva';
import { zm, zmUstvaCheck, zmWholeEuros, type ZmConsistency, type ZmInvoice, type ZmKind, type ZmLine, type ZmNoticeCode, type ZmProblemCode, type ZmResult } from '../domain/zm';
import { t, type MessageKey } from '../i18n';
import { saveFile } from '../lib/browser';
import { payoutNet } from '../domain/payout';
import { buildUstva, payerCountry, ustvaPeriodSlug, type UstvaRecords } from './ustva';
import { smallBusinessOn } from './vatStatus';
import type { Table } from './csvExport';

const coveredMonthEnd = (month: string): string => periodEnd({ year: Number(month.slice(0, 4)), kind: 'month', index: Number(month.slice(5)) });

export interface ZmView {
  zm: ZmResult;
  /** Kz 21 of the advance return against the report; null where the report holds no services (a month that is not the last of its quarter) */
  check: ZmConsistency | null;
  /** How the advance return counts, because Kz 21 of a cash-basis company follows the payments */
  method: 'cash' | 'accrual';
}

/**
 * The report of a period for the open company, from its records. Null without a company and for a small business,
 * which files no summary report (§ 18a Abs. 4 UStG).
 */
export function buildZm(
  company: CompanyFile | null,
  documents: ReadonlyMap<DocumentId, DocumentFile>,
  payments: ReadonlyMap<string, PaymentFile>,
  expenses: ReadonlyMap<string, ExpenseFile>,
  period: UstvaPeriod,
  records: UstvaRecords = {},
): ZmView | null {
  if (!company || company.tax.vat.kind !== 'regular') return null;

  const invoices: ZmInvoice[] = [...documents.values()]
    .filter(isInvoice)
    .filter((inv) => !inv.deletedAt && inv.issued !== null)
    .map((inv) => {
      const issued = inv.issued;
      const smallBusiness = issued?.snapshot.company.tax.vat.kind === 'smallBusiness';
      return {
        id: inv.id,
        number: issued?.number ?? '',
        date: inv.date,
        serviceEnd: inv.service.kind === 'date' ? inv.service.date : inv.service.end,
        treatment: inv.taxTreatment,
        customerCountry: issued?.snapshot.customer.address?.country ?? null,
        customerVatId: issued?.snapshot.customer.vatId ?? '',
        isCancellation: inv.cancels !== null,
        smallBusiness,
        net: invoiceTotals(inv, smallBusiness).net,
      };
    });
  const result = zm({ period, invoices: [...invoices, ...payoutZmRows(records.payouts ?? new Map(), records.contacts ?? new Map(), smallBusinessOn(company, documents.values()))] });

  // the services of a quarter are reported in a quarter, or in the last month of it
  const span = period.kind === 'quarter' ? period : period.index % 3 === 0 ? periodOfDate(periodStart(period), 'quarter') : null;
  const kz21 = span ? buildUstva(company, documents, payments, expenses, span, records)?.fields.find((f) => f.id === 'euServices')?.base : undefined;
  const check = span ? zmUstvaCheck(result, cents(kz21 ?? 0)) : null;
  return { zm: result, check, method: company.tax.vat.method };
}

/**
 * The payouts of a payer in another EU state as rows of the report: a service not taxable in Germany (§ 3a Abs. 2 UStG) is reported
 * with the VAT ID of the payer (§ 18a Abs. 2 UStG), like the same service with an invoice. They are the same payouts that
 * go to Kz 21 of the advance return (`payoutReturnRows`), so the check of the two agrees.
 */
export function payoutZmRows(payouts: ReadonlyMap<string, PayoutFile>, contacts: ReadonlyMap<string, ContactFile>, smallOn: (date: string) => boolean): ZmInvoice[] {
  return [...payouts.values()]
    .filter((p) => p.deletedAt === null && p.taxTreatment === 'euB2bNotTaxable')
    .map((p) => {
      const payer = contacts.get(p.payerId);
      return {
        id: p.id,
        number: `${payer?.name ?? '?'}, ${p.date}`,
        source: 'payout' as const,
        date: p.date,
        serviceEnd: /^\d{4}-\d{2}$/.test(p.period) ? coveredMonthEnd(p.period) : p.date,
        treatment: 'reverseCharge' as const,
        customerCountry: payerCountry(payer),
        customerVatId: payer?.vatId ?? '',
        isCancellation: false,
        smallBusiness: smallOn(p.date),
        net: payoutNet(p),
      };
    });
}

/** The value of a line as it is typed into the portal: the country code, the number of the VAT ID without it, the amount in whole euros */
export const zmCopyValue = (what: 'country' | 'idNumber' | 'amount', line: ZmLine): string =>
  what === 'country' ? line.country : what === 'idNumber' ? line.idNumber : String(zmWholeEuros(line.base));

const KIND_TEXT: Record<ZmKind, MessageKey> = { service: 'zm.kind.service', supply: 'zm.kind.supply' };
export const zmKindText = (kind: ZmKind): string => t(KIND_TEXT[kind]);

const PROBLEM_TEXT: Record<ZmProblemCode, MessageKey> = {
  vatIdMissing: 'zm.problem.vatIdMissing',
  vatIdInvalid: 'zm.problem.vatIdInvalid',
  vatIdGerman: 'zm.problem.vatIdGerman',
  vatIdCountry: 'zm.problem.vatIdCountry',
};
export const zmProblemText = (code: ZmProblemCode): string => t(PROBLEM_TEXT[code]);

export const ZM_NOTICE_TEXT: Record<ZmNoticeCode, MessageKey> = {
  servicesInLastMonth: 'zm.notice.servicesInLastMonth',
  notTaxableEu: 'zm.notice.notTaxableEu',
  placeUnknown: 'zm.notice.placeUnknown',
  supplyMonthly: 'zm.notice.supplyMonthly',
};

/** The lines as a table for a spreadsheet. Not the import format of the portal (whether it takes a file is open, see the roadmap). */
export function zmTable(result: ZmResult): Table {
  return {
    header: [t('zm.csv.country'), t('zm.csv.vatId'), t('zm.csv.kind'), t('zm.csv.baseForm'), t('zm.csv.baseExact')],
    rows: result.lines.map((l) => [l.country, l.vatId, zmKindText(l.kind), num(String(zmWholeEuros(l.base))), num(toDecimalString(l.base).replace('.', ','))]),
  };
}

/** Saves the lines as a CSV file through the browser's download */
export function exportZmCsv(result: ZmResult): void {
  const table = zmTable(result);
  saveFile(encodeCsv(table.header, table.rows), `kontor-zm-${ustvaPeriodSlug(result.period)}.csv`, 'text/csv');
}
