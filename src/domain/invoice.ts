// Invoices (Rechnungen): to whom, when, for which period of service, when they are due, to which account they are
// paid, how VAT applies, and the lines. An invoice is a draft for now; issuing assigns the number, writes the PDF
// and makes it immutable (ADR 0004). The invoice form edits a draft of plain strings; `readInvoice` checks it.
// A draft may be saved incomplete; `issueProblems` lists what still keeps it from being issued.

import type { Result } from '../data/result';
import { Checker, TEXT_LIMITS, type FieldError } from './check';
import { CONTACT_LIMITS, type ContactProfile } from './contact';
import { addDays, isIsoDate } from './dates';
import { documentTotals, draftFromLine, readLines, type DocumentLine, type LineDraft, type LineFieldPath } from './document';
import { cents, type Cents, type MoneyLocale, type TaxTotals } from './money';
import type { QuoteContent } from './quote';
import { isPlausibleEuVatId, isPlausibleLeitwegId, normalizeVatId } from './taxIds';
import { isEuMemberState } from './vat';

/**
 * How VAT applies to the invoice of a company with regular VAT:
 * - `standard`: VAT at the rate of each line.
 * - `reverseCharge`: the customer owes the VAT (§ 13b UStG). The invoice shows no VAT and says
 *   "Steuerschuldnerschaft des Leistungsempfängers" (§ 14a Abs. 5 UStG). For a customer in another EU state both
 *   VAT IDs are required (§ 14a Abs. 1 UStG).
 * - `intraCommunitySupply`: a tax-free supply of goods to a business in another EU state (§ 4 Nr. 1 Buchst. b,
 *   § 6a UStG). The invoice says that it is tax-free and shows both VAT IDs (§ 14a Abs. 3 UStG).
 * A small business (§ 19 UStG) charges no VAT at all; its invoices are always `standard`.
 * Source: https://www.gesetze-im-internet.de/ustg_1980/__14a.html
 */
export type TaxTreatment = 'standard' | 'reverseCharge' | 'intraCommunitySupply';
export const TAX_TREATMENTS: readonly TaxTreatment[] = ['standard', 'reverseCharge', 'intraCommunitySupply'];

/** Date or period of the service (§ 14 Abs. 4 Nr. 6 UStG; EN 16931 BT-72, or BT-73 and BT-74) */
export type ServicePeriod = { kind: 'date'; date: string } | { kind: 'period'; start: string; end: string };

export interface InvoiceContent {
  /** Date of the invoice, YYYY-MM-DD */
  date: string;
  service: ServicePeriod;
  /** Days from the date of the invoice to its due date; 0 means due at once */
  paymentTermDays: number;
  taxTreatment: TaxTreatment;
  /** Order or PO number of the customer (BT-13); empty when not given */
  orderReference: string;
  /** Leitweg-ID of a public buyer (BT-10); empty when not given */
  leitwegId: string;
  /** Subject line; empty when not given */
  subject: string;
  /** Text above the lines; empty when not given */
  introText: string;
  /** Text below the lines; empty when not given */
  closingText: string;
  lines: DocumentLine[];
}

export const INVOICE_LIMITS = { subject: 200, text: 4000, orderReference: CONTACT_LIMITS.orderReference, leitwegId: 46 } as const;

/**
 * Small amount invoices (§ 33 UStDV): up to 250 € gross, the name and address of the customer are not required.
 * The limit has applied since 1 January 2017. It does not apply to reverse charge and intra-community supplies
 * (§ 33 Satz 3 UStDV). Source: https://www.gesetze-im-internet.de/ustdv_1980/__33.html
 */
export const SMALL_AMOUNT_LIMIT: Cents = cents(25_000);

/** Why a document shows no VAT; the document has to say so */
export type VatNote = 'smallBusiness' | 'reverseCharge' | 'intraCommunitySupply';

/** The note a document needs, or null when it charges VAT */
export function vatNote(treatment: TaxTreatment, smallBusiness: boolean): VatNote | null {
  if (smallBusiness) return 'smallBusiness';
  switch (treatment) {
    case 'standard':
      return null;
    case 'reverseCharge':
    case 'intraCommunitySupply':
      return treatment;
  }
}

/** Does the invoice show VAT? Not for a small business, and not when the customer owes it or the supply is tax-free. */
export const chargesVat = (treatment: TaxTreatment, smallBusiness: boolean): boolean => vatNote(treatment, smallBusiness) === null;

/** Net, VAT per rate and gross of an invoice */
export const invoiceTotals = (inv: Pick<InvoiceContent, 'lines' | 'taxTreatment'>, smallBusiness: boolean): TaxTotals =>
  documentTotals(inv.lines, !chargesVat(inv.taxTreatment, smallBusiness));

export const dueDate = (inv: Pick<InvoiceContent, 'date' | 'paymentTermDays'>): string => addDays(inv.date, inv.paymentTermDays);

/* ---------- Draft ---------- */

export interface InvoiceDraft {
  /** The chosen customer; empty when none is chosen yet */
  customerId: string;
  date: string;
  serviceKind: ServicePeriod['kind'];
  /** Both kinds stay in the draft, so that switching between them keeps what was typed */
  serviceDate: string;
  serviceStart: string;
  serviceEnd: string;
  paymentTermDays: string;
  /** The account the invoice is paid to */
  accountId: string;
  taxTreatment: TaxTreatment;
  orderReference: string;
  leitwegId: string;
  subject: string;
  introText: string;
  closingText: string;
  lines: LineDraft[];
}

export type InvoiceField = Exclude<keyof InvoiceDraft, 'lines'> | 'lines' | LineFieldPath;
export type InvoiceFieldError = FieldError<InvoiceField>;

/** What a new invoice starts with: the date of today as the date of service, the company's term and default account */
export const emptyInvoiceDraft = (today: string, accountId: string, paymentTermDays: number): InvoiceDraft => ({
  customerId: '',
  date: today,
  serviceKind: 'date',
  serviceDate: today,
  serviceStart: '',
  serviceEnd: '',
  paymentTermDays: String(paymentTermDays),
  accountId,
  taxTreatment: 'standard',
  orderReference: '',
  leitwegId: '',
  subject: '',
  introText: '',
  closingText: '',
  lines: [],
});

/** What the draft takes over from a customer when it is chosen: payment term, order number and Leitweg-ID */
export const customerDefaults = (
  customer: Pick<ContactProfile, 'paymentTermDays' | 'orderReference' | 'leitwegId'>,
  companyTermDays: number,
): Pick<InvoiceDraft, 'paymentTermDays' | 'orderReference' | 'leitwegId'> => ({
  paymentTermDays: String(customer.paymentTermDays ?? companyTermDays),
  orderReference: customer.orderReference,
  leitwegId: customer.leitwegId,
});

/** `newKey` gives every line a key for the editor */
export function draftFromInvoice(customerId: string, accountId: string, inv: InvoiceContent, locale: MoneyLocale, newKey: () => string): InvoiceDraft {
  return {
    customerId,
    date: inv.date,
    serviceKind: inv.service.kind,
    serviceDate: inv.service.kind === 'date' ? inv.service.date : '',
    serviceStart: inv.service.kind === 'period' ? inv.service.start : '',
    serviceEnd: inv.service.kind === 'period' ? inv.service.end : '',
    paymentTermDays: String(inv.paymentTermDays),
    accountId,
    taxTreatment: inv.taxTreatment,
    orderReference: inv.orderReference,
    leitwegId: inv.leitwegId,
    subject: inv.subject,
    introText: inv.introText,
    closingText: inv.closingText,
    lines: inv.lines.map((l) => draftFromLine(newKey(), l, locale)),
  };
}

/**
 * A new invoice for the customer of a quote, with its subject and lines. The texts of a quote (offer, validity)
 * do not fit an invoice and are not taken over. `base` is the new invoice with the customer's defaults.
 */
export const invoiceDraftFromQuote = (base: InvoiceDraft, quote: QuoteContent, locale: MoneyLocale, newKey: () => string): InvoiceDraft => ({
  ...base,
  subject: quote.subject,
  lines: quote.lines.map((l) => draftFromLine(newKey(), l, locale)),
});

/** The due date while the draft is typed, or null as long as the date or the term cannot be read */
export function draftDueDate(d: Pick<InvoiceDraft, 'date' | 'paymentTermDays'>): string | null {
  const term = d.paymentTermDays.trim();
  if (!isIsoDate(d.date) || !/^\d+$/.test(term) || Number(term) > TEXT_LIMITS.maxPaymentTermDays) return null;
  return addDays(d.date, Number(term));
}

/* ---------- Checks ---------- */

/**
 * Checks an invoice draft. A draft may have no lines yet; every line it has must be complete, and their sums must
 * not be negative. A small business has no tax treatment to choose: its invoices are `standard`.
 */
export function readInvoice(
  d: InvoiceDraft,
  locale: MoneyLocale,
  smallBusiness: boolean,
): Result<{ customerId: string; accountId: string; content: InvoiceContent }, InvoiceFieldError[]> {
  const c = new Checker<InvoiceField>();
  if (!d.customerId) c.add('customerId', 'required');
  if (!d.accountId) c.add('accountId', 'required');
  if (!isIsoDate(d.date)) c.add('date', 'date');
  let service: ServicePeriod;
  if (d.serviceKind === 'date') {
    if (!isIsoDate(d.serviceDate)) c.add('serviceDate', 'date');
    service = { kind: 'date', date: d.serviceDate };
  } else {
    if (!isIsoDate(d.serviceStart)) c.add('serviceStart', 'date');
    if (!isIsoDate(d.serviceEnd)) c.add('serviceEnd', 'date');
    else if (c.passed('serviceStart') && d.serviceEnd < d.serviceStart) c.add('serviceEnd', 'periodEnd');
    service = { kind: 'period', start: d.serviceStart, end: d.serviceEnd };
  }
  const paymentTermDays = c.paymentTerm('paymentTermDays', d.paymentTermDays);
  const taxTreatment = smallBusiness ? 'standard' : d.taxTreatment;
  const orderReference = c.optionalText('orderReference', d.orderReference, INVOICE_LIMITS.orderReference);
  const leitwegId = d.leitwegId.trim();
  if (leitwegId && !isPlausibleLeitwegId(leitwegId)) c.add('leitwegId', 'leitwegId');
  const subject = c.optionalText('subject', d.subject, INVOICE_LIMITS.subject);
  const introText = c.optionalText('introText', d.introText, INVOICE_LIMITS.text);
  const closingText = c.optionalText('closingText', d.closingText, INVOICE_LIMITS.text);
  const lines = readLines(c, d.lines, locale, !chargesVat(taxTreatment, smallBusiness));
  return c.done(() => ({
    customerId: d.customerId,
    accountId: d.accountId,
    content: { date: d.date, service, paymentTermDays, taxTreatment, orderReference, leitwegId, subject, introText, closingText, lines },
  }));
}

/* ---------- Ready to issue ---------- */

/**
 * What keeps a saved draft from being issued:
 * - `noCustomer`: no customer is chosen yet.
 * - `noLines`: an invoice needs at least one line.
 * - `customerAddress`: the name and address of the customer (§ 14 Abs. 4 Nr. 1 UStG), not needed for a small amount
 *   invoice (`SMALL_AMOUNT_LIMIT`).
 * - `customerVatId`: the VAT ID of the customer from another EU state, for an intra-community supply and for
 *   reverse charge with a customer in another EU state (§ 14a Abs. 1 and 3 UStG).
 * - `ownVatId`: the company's own VAT ID, in the same cases.
 * - `accountRemoved`: the account the invoice is paid to was removed in the settings.
 */
export type IssueProblem = 'noCustomer' | 'noLines' | 'customerAddress' | 'customerVatId' | 'ownVatId' | 'accountRemoved';

export interface IssueFacts {
  lineCount: number;
  gross: Cents;
  taxTreatment: TaxTreatment;
  /** null when no customer is chosen yet */
  customer: Pick<ContactProfile, 'address' | 'vatId'> | null;
  /** The company's USt-IdNr.; empty when it has none */
  ownVatId: string;
  accountActive: boolean;
}

/** Is the VAT ID one of another EU state than Germany? */
const isForeignEuVatId = (vatId: string): boolean => isPlausibleEuVatId(vatId) && !normalizeVatId(vatId).startsWith('DE');

/** The problems in the order of the form; none means the draft can be issued */
export function issueProblems(f: IssueFacts): IssueProblem[] {
  const { customer } = f;
  const country = customer?.address?.country ?? '';
  const smallAmount = f.taxTreatment === 'standard' && f.gross <= SMALL_AMOUNT_LIMIT;
  const bothVatIds = f.taxTreatment === 'intraCommunitySupply' || (f.taxTreatment === 'reverseCharge' && country !== 'DE' && isEuMemberState(country));
  const problems: IssueProblem[] = [];
  if (!customer) problems.push('noCustomer');
  if (f.lineCount === 0) problems.push('noLines');
  if (customer && !customer.address && !smallAmount) problems.push('customerAddress');
  if (customer && bothVatIds && !isForeignEuVatId(customer.vatId)) problems.push('customerVatId');
  if (bothVatIds && !f.ownVatId) problems.push('ownVatId');
  if (!f.accountActive) problems.push('accountRemoved');
  return problems;
}

/* ---------- Lists ---------- */

/** Does the invoice match a search text? The customer name and the subject are searched. */
export function invoiceMatches(inv: InvoiceContent, customerName: string, query: string): boolean {
  const s = query.trim().toLocaleLowerCase('de');
  if (!s) return true;
  return [customerName, inv.subject].some((v) => v.toLocaleLowerCase('de').includes(s));
}

/** Newest first; the same day by subject */
export const byInvoiceDate = (a: InvoiceContent, b: InvoiceContent): number => b.date.localeCompare(a.date) || a.subject.localeCompare(b.subject, 'de');
