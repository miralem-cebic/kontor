// The advance VAT return (R1): the records of the open company, mapped into the rows the domain computes the form
// fields from (src/domain/ustva.ts), the values as they are copied into "Mein ELSTER", and the CSV file.
// Invoices count with the VAT status they were issued with (their snapshot), so that a later change of the company does
// not change the return of an earlier period.

import { encodeCsv, num } from '../data/export/csv';
import type { DocumentId } from '../data/ids';
import type { CompanyFile, ContactFile, DocumentFile, ExpenseFile, PaymentFile, PayoutFile } from '../data/types';
import type { VatScheme } from '../domain/company';
import { isInvoice } from '../data/types';
import { expenseVat } from '../domain/expense';
import { invoiceTotals } from '../domain/invoice';
import { payoutNet, payoutVat } from '../domain/payout';
import { cents, sum, toDecimalString, type Cents } from '../domain/money';
import { ZERO_RATE } from '../domain/vat';
import { periodEnd, periodStart, ustva, wholeEuros, type UstvaExpense, type UstvaFieldId, type UstvaBooking, type UstvaInvoice, type UstvaNotice, type UstvaPayment, type UstvaPeriod, type UstvaResult } from '../domain/ustva';
import { t, type MessageKey } from '../i18n';
import { saveFile } from '../lib/browser';
import { smallBusinessOn } from './vatStatus';
import type { Table } from './csvExport';

/** The terms of an advance return: how VAT is accounted for, how often it is returned and whether the due date is extended */
export type UstvaTerms = Extract<VatScheme, { kind: 'regular' }>;

/**
 * The terms the advance returns are filed with: those of the company if it has regular VAT, otherwise (a small business
 * today) those of its latest regular invoice, whose snapshot kept them. Null for a business that never had regular VAT,
 * which has no advance return to file (§ 19 UStG).
 */
export function ustvaTerms(company: CompanyFile | null, documents: ReadonlyMap<DocumentId, DocumentFile>): UstvaTerms | null {
  if (!company) return null;
  if (company.tax.vat.kind === 'regular') return company.tax.vat;
  let latest: { date: string; issuedAt: string; vat: UstvaTerms } | null = null;
  for (const d of documents.values()) {
    if (!isInvoice(d) || d.issued === null || d.cancels !== null || d.deletedAt) continue;
    const vat = d.issued.snapshot.company.tax.vat;
    if (vat.kind !== 'regular') continue;
    if (!latest || d.date > latest.date || (d.date === latest.date && d.issued.issuedAt > latest.issuedAt)) latest = { date: d.date, issuedAt: d.issued.issuedAt, vat };
  }
  return latest?.vat ?? null;
}

/** The records besides invoices, payments and expenses that the return reads: the payouts and the contacts that paid them */
export interface UstvaRecords {
  payouts?: ReadonlyMap<string, PayoutFile>;
  contacts?: ReadonlyMap<string, ContactFile>;
}

/** The country of the payer of a payout: the country of its address, else the one its VAT ID starts with (EL is Greece); null when neither is known */
export function payerCountry(payer: ContactFile | undefined): string | null {
  if (!payer) return null;
  if (payer.address?.country) return payer.address.country;
  const prefix = payer.vatId.replace(/\s/g, '').slice(0, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(prefix) ? (prefix === 'EL' ? 'GR' : prefix) : null;
}

/** The last day of the month a payout covers (YYYY-MM), or the day the money arrived when none is given: the day of the service */
const coveredEnd = (p: PayoutFile): string => (/^\d{4}-\d{2}$/.test(p.period) ? periodEnd({ year: Number(p.period.slice(0, 4)), kind: 'month', index: Number(p.period.slice(5)) }) : p.date);

/**
 * The payouts of the company as rows of the return: an invoice-like row without an invoice of kontor (`source: 'payout'`) and the
 * payment of the day the money arrived that settles it, so the payout counts like an invoice that was paid at once. The treatment
 * the person chose decides where it goes (#34, from the official form): a payer in another EU state is a service not taxable in
 * Germany (Kz 21), a payer outside the EU a service with its place abroad (Kz 45), a German payer a taxed supply (Kz 81 or 86). A
 * payout of the small business scheme is no part of a return, and one where the platform collects the VAT is not placed: it
 * becomes a notice (an open question of the epic #30).
 */
export function payoutReturnRows(payouts: ReadonlyMap<string, PayoutFile>, contacts: ReadonlyMap<string, ContactFile>, smallOn: (date: string) => boolean, period: UstvaPeriod): { invoices: UstvaInvoice[]; payments: UstvaPayment[]; notices: UstvaNotice[] } {
  const invoices: UstvaInvoice[] = [];
  const payments: UstvaPayment[] = [];
  let platform: PayoutFile[] = [];
  for (const p of payouts.values()) {
    if (p.deletedAt !== null || p.taxTreatment === 'smallBusiness') continue;
    if (p.taxTreatment === 'platformCollectsVat') {
      if (periodStart(period) <= p.date && p.date <= periodEnd(period)) platform = [...platform, p];
      continue;
    }
    const country = payerCountry(contacts.get(p.payerId));
    const net = payoutNet(p);
    const row = { id: p.id, date: p.date, serviceEnd: coveredEnd(p), customerCountry: country, isCancellation: false, smallBusiness: smallOn(p.date), source: 'payout' as const };
    if (p.taxTreatment === 'domesticTaxed') invoices.push({ ...row, treatment: 'standard', customerCountry: 'DE', lines: [{ rate: p.vatRate, net, tax: payoutVat(p) }] });
    else invoices.push({ ...row, treatment: p.taxTreatment === 'euB2bNotTaxable' ? 'reverseCharge' : 'notTaxable', lines: [{ rate: ZERO_RATE, net, tax: cents(0) }] });
    payments.push({ id: `payout-${p.id}`, invoiceId: p.id, date: p.date, amount: p.amount });
  }
  const notices: UstvaNotice[] = platform.length > 0 ? [{ code: 'payoutPlatformVat', count: platform.length, amount: sum(platform.map((p) => p.amount)) }] : [];
  return { invoices, payments, notices };
}

/** Does the company have an expense in the period for which it owes the tax under § 13b UStG? (a small business then files a return, § 18 Abs. 4a UStG) */
export const owesReverseChargeTax = (expenses: ReadonlyMap<string, ExpenseFile>, period?: UstvaPeriod): boolean =>
  [...expenses.values()].some((e) => e.deletedAt === null && (e.taxTreatment === 'euReverseCharge' || e.taxTreatment === 'thirdCountry') && (!period || (periodStart(period) <= e.date && e.date <= periodEnd(period))));

/**
 * The advance return of a period for the open company, from its records. Null without a company. A business with regular VAT
 * gets the whole return. A business that was a small business throughout the period gets none (§ 19 UStG), unless it owes the
 * tax of an expense under § 13b Abs. 5 UStG: then it gets a return with only that tax, due for the periods in which it is to be
 * declared (§ 18 Abs. 4a UStG). The status of a day comes from the issued invoices (`smallBusinessOn`), so the last periods of
 * a business that has become a small business since still get their return, and the expenses of the days of a small business
 * owe their tax but have no input tax (#77).
 */
export function buildUstva(
  company: CompanyFile | null,
  documents: ReadonlyMap<DocumentId, DocumentFile>,
  payments: ReadonlyMap<string, PaymentFile>,
  expenses: ReadonlyMap<string, ExpenseFile>,
  period: UstvaPeriod,
  records: UstvaRecords = {},
): UstvaResult | null {
  if (!company) return null;
  const smallOn = smallBusinessOn(company, documents.values());
  // A business with regular VAT today always gets its return. A small business today gets the return of a regular period
  // (the last ones before the change) with the terms of its last regular invoice, and for a period of the small business
  // scheme only the tax it owes under § 13b.
  const smallThroughout = company.tax.vat.kind !== 'regular' && smallOn(periodStart(period)) && smallOn(periodEnd(period));
  const terms = ustvaTerms(company, documents);
  const mode = smallThroughout ? 'smallBusiness' : 'regular';
  if (mode === 'smallBusiness' ? !owesReverseChargeTax(expenses, period) : !terms) return null;
  // the terms of a small business that never had regular VAT: the quarter is the usual period and no permanent extension
  const { method, permanentExtension } = mode === 'regular' && terms ? terms : { method: 'accrual' as const, permanentExtension: false };

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
  const paymentRows: UstvaPayment[] = [...payments.values()]
    .filter((p) => p.deletedAt === null)
    .map((p) => ({ id: p.id, invoiceId: p.invoiceId, date: p.date, amount: p.amount }));
  const expenseRows: UstvaExpense[] = [...expenses.values()]
    .filter((e) => e.deletedAt === null)
    .map((e) => ({ id: e.id, date: e.date, taxTreatment: e.taxTreatment, gross: e.gross, vat: expenseVat(e), smallBusiness: mode === 'smallBusiness' || smallOn(e.date) }));
  const payouts = payoutReturnRows(records.payouts ?? new Map(), records.contacts ?? new Map(), smallOn, period);

  return ustva({
    period,
    mode,
    method,
    permanentExtension,
    invoices: [...invoices, ...payouts.invoices],
    payments: [...paymentRows, ...payouts.payments],
    expenses: expenseRows,
    extraNotices: payouts.notices,
  });
}

/** The records a booking of the return points to, to name them for the person */
export interface UstvaBookingSources {
  documents: ReadonlyMap<DocumentId, DocumentFile>;
  expenses: ReadonlyMap<string, ExpenseFile>;
  payouts: ReadonlyMap<string, PayoutFile>;
  contacts: ReadonlyMap<string, ContactFile>;
}

/** What a booking is called in the list behind a number: the invoice number, the payer and day of a payout, the supplier of an expense */
export function ustvaBookingLabel(b: UstvaBooking, src: UstvaBookingSources): string {
  if (b.kind === 'invoice') {
    const d = [...src.documents.values()].find((x) => x.id === b.id);
    return d && isInvoice(d) ? (d.issued?.number ?? d.id) : b.id;
  }
  if (b.kind === 'payout') {
    const p = src.payouts.get(b.id);
    return p ? `${src.contacts.get(p.payerId)?.name ?? '?'}, ${p.date}` : b.id;
  }
  const e = src.expenses.get(b.id);
  return e ? `${e.supplier}, ${e.date}` : b.id;
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
  euReverseCharge: 'ustva.field.euReverseCharge',
  otherReverseCharge: 'ustva.field.otherReverseCharge',
  inputTaxReverseCharge: 'ustva.field.inputTaxReverseCharge',
};
export const ustvaFieldText = (id: UstvaFieldId): string => t(FIELD_TEXT[id]);

/** The shown fields as a table for a spreadsheet */
export function ustvaTable(result: UstvaResult): Table {
  const amount = (c: Cents) => num(toDecimalString(c).replace('.', ','));
  return {
    header: [t('ustva.csv.kz'), t('ustva.csv.description'), t('ustva.csv.baseForm'), t('ustva.csv.baseExact'), t('ustva.csv.tax')],
    rows: result.fields
      .filter((f) => f.shown)
      .map((f) => [f.taxKz ? `${f.kz} / ${f.taxKz}` : f.kz, ustvaFieldText(f.id), f.base === null ? '' : num(ustvaCopyValue('base', f.base)), f.base === null ? '' : amount(f.base), f.tax === null ? '' : amount(f.tax)]),
  };
}

/** The name of the period for a file name: 2026-10 or 2026-Q3 */
export const ustvaPeriodSlug = (p: UstvaPeriod): string => (p.kind === 'month' ? `${p.year}-${String(p.index).padStart(2, '0')}` : `${p.year}-Q${p.index}`);

/** Saves the result as a CSV file through the browser's download */
export function exportUstvaCsv(result: UstvaResult): void {
  const table = ustvaTable(result);
  saveFile(encodeCsv(table.header, table.rows), `kontor-ustva-${ustvaPeriodSlug(result.period)}.csv`, 'text/csv');
}
