// The advance VAT return (Umsatzsteuer-Voranmeldung, UStVA) as a filling aid (R1): from the issued invoices, their
// payments and the expenses of one period, the amounts for the fields of the form that kontor can derive from its data.
// Pure: the caller maps the records of the folder into the rows below. Every figure is an estimate and a filling aid, not
// tax advice; what is not covered is listed in the interface (`ustva.notCovered.*`) and reported as notices below.
//
// The rules, and where they come from:
// - Accrual basis (Sollversteuerung, § 13 Abs. 1 Nr. 1 Buchst. a UStG): the tax arises at the end of the period in which the
//   service was performed. A service over a period counts when it ends. A cancellation invoice is a correction of the
//   tax (§ 17 UStG) and counts on its own date, negative.
// - Cash basis (Istversteuerung, § 20 UStG): the tax arises at the end of the period in which the payment came in. A part
//   payment counts its share of every rate. The shares are computed from the sum paid so far, so that the payments of one
//   invoice add up to the invoice exactly, in whatever periods they fall. A cancellation takes no payment and counts
//   nothing; kontor records no refunds, so a refund is not deducted.
// - Kz 41 and Kz 21, on both bases (§ 18b UStG, #75): the base of an intra-community supply is declared in the period in
//   which the invoice is issued, at the latest in the one in which the month after the supply ends (Satz 2); the base of
//   a service under § 3a Abs. 2 for which the recipient in another EU state owes the tax in the period in which it was
//   performed (Satz 3). Neither depends on a payment. A change of the base (a cancellation) counts in the period of the
//   change (Satz 4 with § 17 Abs. 1 Satz 8 UStG). The same dates as the summary report (zm.ts). Read at
//   https://dejure.org/gesetze/UStG/18b.html and https://dejure.org/gesetze/UStG/17.html on 8 November 2026.
// UNVERIFIED: on the cash basis, Kz 60 (§ 13b Abs. 5 UStG, the customer owes the tax) and Kz 45 (place of supply abroad)
//   follow the payments like taxed supplies. § 13b Abs. 2 says when the tax arises for the recipient (with the invoice, at
//   the latest at the end of the month after the service), not when the supplier declares the base; the instructions of
//   the form (USt 1 E) could not be read. The interface says so (`ustva.notCovered.cashBases`).
// - Reverse charge on expenses (§ 13b UStG, #34; the field numbers and the rules below are from the official form USt 1 A 2026 and
//   its instructions, tests/fixtures/vat/form-2026.ts): an expense of the treatment "supplier in another EU state" is a service
//   under § 3a Abs. 2 UStG (line 30: Kz 46 base, Kz 47 tax; the tax arises at the end of the period of the performance, § 13b Abs. 1),
//   one of the treatment "supplier outside the EU" a service of a supplier established abroad (line 32: Kz 84 and 85; the tax arises
//   with the invoice, at the latest at the end of the month after the performance, § 13b Abs. 2 Nr. 1). The recipient owes the tax
//   (§ 13b Abs. 5 Satz 1) at the standard rate on the amount paid, and deducts it as input tax (line 41: Kz 67, § 15 Abs. 1 Satz 1
//   Nr. 4). Line 37 (the tax) includes lines 30 and 32, line 45 takes the input tax from it, so the prepayment of a business with
//   regular VAT does not change. The date of the expense stands for the day of the performance and of the invoice.
//   A small business owes the same tax and files for the periods in which it is to be declared (§ 18 Abs. 4a UStG, `mode:
//   'smallBusiness'`: only lines 30 and 32), but may not deduct input tax ("Für den Zeitraum der Anwendung der Kleinunternehmer-
//   Regelung sind Sie nicht berechtigt, ... Vorsteuern nach § 15 UStG abzuziehen", instructions of the form): Kz 67 is 0.
//   UNVERIFIED: the 19 % is the standard rate on the amount paid; kontor does not know if the service is taxed at 7 % or if the amount
//   paid is the net amount. Cases of § 13b Abs. 2 Nr. 2 to 12 (lines 31 and 32 for construction services, gold, scrap) are not covered.
// - Payouts without an invoice of kontor count like an invoice that was paid at once (`source: 'payout'`, src/app/ustva.ts):
//   a payer in another EU state is Kz 21, a payer outside the EU Kz 45, a German payer with VAT inside Kz 81 or 86.
// - Every field lists the records behind it (`bookings`); their bases and taxes add up to the field.
// - Input tax (Vorsteuer, § 15 Abs. 1 Satz 1 Nr. 1 UStG): the VAT inside the domestic expenses, by the date of the expense.
// - The Kennzahlen come from `tax/params/<year>.ts`. Bases are entered in whole euros (`wholeEuros`), taxes in euros and cents.
// https://www.gesetze-im-internet.de/ustg_1980/__13.html, https://www.gesetze-im-internet.de/ustg_1980/__20.html

import { cents, percentOf, subtract, sum, type BasisPoints, type Cents } from './money';
import { comparePayments, proportion } from './payment';
import type { ExpenseTaxTreatment } from './expense';
import type { TaxTreatment } from './invoice';
import { addDays, endOfNextMonth } from './dates';
import { taxParams } from './tax/params';
import { REDUCED_RATE, STANDARD_RATE, isEuMemberState } from './vat';

/* ---------- Periods ---------- */

export type UstvaPeriodKind = 'month' | 'quarter';

/** A calendar month (`index` 1 to 12) or quarter (`index` 1 to 4) */
export interface UstvaPeriod {
  year: number;
  kind: UstvaPeriodKind;
  index: number;
}

const MONTHS_PER_QUARTER = 3;
const pad = (n: number): string => String(n).padStart(2, '0');

const firstMonth = (p: UstvaPeriod): number => (p.kind === 'month' ? p.index : (p.index - 1) * MONTHS_PER_QUARTER + 1);
const lastMonth = (p: UstvaPeriod): number => (p.kind === 'month' ? p.index : p.index * MONTHS_PER_QUARTER);

/** The first day of the period (YYYY-MM-DD) */
export const periodStart = (p: UstvaPeriod): string => `${p.year}-${pad(firstMonth(p))}-01`;

/** The last day of the period (YYYY-MM-DD) */
export function periodEnd(p: UstvaPeriod): string {
  const last = new Date(Date.UTC(p.year, lastMonth(p), 0));
  return `${last.getUTCFullYear()}-${pad(last.getUTCMonth() + 1)}-${pad(last.getUTCDate())}`;
}

/** The period of a kind that holds an ISO date */
export function periodOfDate(iso: string, kind: UstvaPeriodKind): UstvaPeriod {
  const [year = 0, month = 1] = iso.split('-').map(Number);
  return { year, kind, index: kind === 'month' ? month : Math.ceil(month / MONTHS_PER_QUARTER) };
}

/** The last period of a kind that is over on `today`: the one whose return is due next */
export function lastCompletedPeriod(today: string, kind: UstvaPeriodKind): UstvaPeriod {
  const current = periodOfDate(today, kind);
  if (current.index > 1) return { ...current, index: current.index - 1 };
  return { year: current.year - 1, kind, index: kind === 'month' ? 12 : 4 };
}

const isoOf = (d: Date): string => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * The day the return is due: the `dueDay` of the month after the period (§ 18 Abs. 1 UStG), one month later with the
 * permanent extension (§ 46 UStDV). A Saturday or Sunday moves to the Monday (§ 108 Abs. 3 AO); public holidays are not
 * known to kontor, so a due date on a holiday is not moved.
 */
export function ustvaDueDate(p: UstvaPeriod, permanentExtension: boolean): string {
  const { dueDay, extensionMonths } = taxParams(p.year).vatReturn;
  const months = 1 + (permanentExtension ? extensionMonths : 0);
  const due = new Date(Date.UTC(p.year, lastMonth(p) - 1 + months, dueDay));
  const weekday = due.getUTCDay();
  const shift = weekday === 6 ? 2 : weekday === 0 ? 1 : 0;
  return addDays(isoOf(due), shift);
}

/** A base as the form takes it: whole euros, the cents dropped (towards zero) */
export const wholeEuros = (amount: Cents): number => Math.trunc(amount / 100) + 0;

/* ---------- Input ---------- */

/** One tax rate of an invoice: the net amount and the VAT on it. A cancellation has negative amounts. */
export interface UstvaInvoiceLine {
  rate: BasisPoints;
  net: Cents;
  tax: Cents;
}

/** An issued invoice (a draft is not passed) */
export interface UstvaInvoice {
  id: string;
  /** The date of the invoice; a cancellation counts on this date */
  date: string;
  /** The last day of the service (the day, or the end of the period) */
  serviceEnd: string;
  treatment: TaxTreatment;
  /** The country (ISO code) of the customer's address when it was issued; null without an address */
  customerCountry: string | null;
  isCancellation: boolean;
  /** Issued by a small business (§ 19 UStG): it charged no VAT and is not part of an advance return */
  smallBusiness: boolean;
  /** What the row stands for: an invoice, or a payout without an invoice of kontor (it counts like one; the list of bookings names it). Default: an invoice. */
  source?: 'invoice' | 'payout';
  lines: UstvaInvoiceLine[];
}

export interface UstvaPayment {
  id: string;
  invoiceId: string;
  date: string;
  amount: Cents;
}

export interface UstvaExpense {
  id: string;
  /** The day of the payment, which stands for the day of the performance and of the invoice (kontor stores no other date) */
  date: string;
  taxTreatment: ExpenseTaxTreatment;
  gross: Cents;
  /** The German VAT inside the gross amount; 0 without it */
  vat: Cents;
  /** Paid on a day on which the business was a small business: no input tax (§ 15 UStG); a tax it owes under § 13b UStG is still declared */
  smallBusiness: boolean;
}

export interface UstvaInput {
  period: UstvaPeriod;
  /** `cash`: Istversteuerung, `accrual`: Sollversteuerung */
  method: 'cash' | 'accrual';
  permanentExtension: boolean;
  invoices: readonly UstvaInvoice[];
  payments: readonly UstvaPayment[];
  expenses: readonly UstvaExpense[];
  /**
   * `regular` (default): the whole return. `smallBusiness`: a business that is a small business for the whole period, which
   * files only for the tax it owes under § 13b Abs. 5 UStG (§ 18 Abs. 4a UStG): no supplies, no input tax.
   */
  mode?: 'regular' | 'smallBusiness';
  /** Notices of the caller about records it did not pass (for example payouts that kontor cannot place), appended to the result's */
  extraNotices?: readonly UstvaNotice[];
}

/* ---------- Result ---------- */

export type UstvaFieldId =
  | 'taxable19'
  | 'taxable7'
  | 'intraCommunitySupply'
  | 'euServices'
  | 'reverseChargeSupplied'
  | 'otherNotTaxable'
  | 'inputTax'
  | 'remainingPrepayment'
  | 'euReverseCharge'
  | 'otherReverseCharge'
  | 'inputTaxReverseCharge';

/** One record behind the number of a field: an invoice, a payout or an expense, with the amounts it adds to the field (#34) */
export interface UstvaBooking {
  kind: 'invoice' | 'payout' | 'expense';
  id: string;
  /** What it adds to the base column; null where the field has none */
  base: Cents | null;
  /** What it adds to the tax column; null where the field has none */
  tax: Cents | null;
}

/** A line of the form. `base` and `tax` are null where the form has no such column for the field. */
export interface UstvaField {
  id: UstvaFieldId;
  /** The number of the base column, or of the tax column for a field that has only a tax */
  kz: string;
  /** The exact base in cents; the form takes `wholeEuros` of it */
  base: Cents | null;
  tax: Cents | null;
  /** The number of the tax column where it has one of its own (47 beside 46, 85 beside 84), else null */
  taxKz: string | null;
  /** Shown always (the main fields) or because it has an amount */
  shown: boolean;
  /** The records behind the numbers, one entry per record; their bases and taxes add up to the field. Empty for the calculated Kz 83. */
  bookings: UstvaBooking[];
}

/** Something in the period that is in the data but that kontor does not put into a field */
export type UstvaNoticeCode = 'supplyUnplaced' | 'payoutPlatformVat';

export interface UstvaNotice {
  code: UstvaNoticeCode;
  count: number;
  /** The net amount of the supplies, or the amount of the payouts */
  amount: Cents;
}

export interface UstvaResult {
  period: UstvaPeriod;
  mode: 'regular' | 'smallBusiness';
  method: 'cash' | 'accrual';
  /** The due date, with the permanent extension if the company has it */
  dueDate: string;
  fields: UstvaField[];
  notices: UstvaNotice[];
}

/* ---------- Computation ---------- */

type Target = 'taxable19' | 'taxable7' | 'intraCommunitySupply' | 'euServices' | 'reverseChargeSupplied' | 'otherNotTaxable' | 'unplaced';

interface Part {
  invoiceId: string;
  target: Target;
  net: Cents;
  tax: Cents;
}

/** Where the amounts of an invoice go: per rate for a taxed invoice, as one base for the others */
function partsOf(inv: UstvaInvoice): Part[] {
  const whole = (target: Target): Part[] => [{ invoiceId: inv.id, target, net: sum(inv.lines.map((l) => l.net)), tax: sum(inv.lines.map((l) => l.tax)) }];
  switch (inv.treatment) {
    case 'standard':
      return inv.lines.map((l) => ({ invoiceId: inv.id, target: l.rate === STANDARD_RATE ? 'taxable19' : l.rate === REDUCED_RATE ? 'taxable7' : 'unplaced', net: l.net, tax: l.tax }));
    case 'intraCommunitySupply':
      return whole('intraCommunitySupply');
    case 'notTaxable':
      return whole('otherNotTaxable');
    case 'reverseCharge':
      if (inv.customerCountry === 'DE') return whole('reverseChargeSupplied');
      return whole(inv.customerCountry !== null && isEuMemberState(inv.customerCountry) ? 'euServices' : 'unplaced');
  }
}

/** `amount` × `paid` ÷ `gross`, rounded once; `gross` is positive (the same cumulative rule as `netPartsOf` in payment.ts) */
const shareOf = proportion;

const inPeriod = (date: string, p: UstvaPeriod): boolean => periodStart(p) <= date && date <= periodEnd(p);

/** The bases declared by the invoice and the service on both bases (§ 18b UStG): Kz 41 and Kz 21 */
const BY_SECTION_18B: readonly Target[] = ['intraCommunitySupply', 'euServices'];

/**
 * The day by which an invoice counts when the payments do not decide: the end of the service (accrual), and for Kz 41
 * the invoice date, at the latest the end of the month after the supply (§ 18b Satz 2). A cancellation on its own date.
 */
function declarationDate(inv: UstvaInvoice, target: Target | undefined): string {
  if (inv.isCancellation) return inv.date;
  if (target !== 'intraCommunitySupply') return inv.serviceEnd;
  const latest = endOfNextMonth(inv.serviceEnd);
  return inv.date < latest ? inv.date : latest;
}

/** The amounts of the invoices that fall into the period */
function recognized(input: UstvaInput): Part[] {
  const { period, method, payments } = input;
  const invoices = input.invoices.filter((i) => !i.smallBusiness);
  const byDate = (inv: UstvaInvoice, parts: Part[]): Part[] => (inPeriod(declarationDate(inv, parts[0]?.target), period) ? parts : []);
  if (method === 'accrual') return invoices.flatMap((i) => byDate(i, partsOf(i)));
  const result: Part[] = [];
  const byInvoice = new Map<string, UstvaPayment[]>();
  for (const p of payments) {
    const list = byInvoice.get(p.invoiceId);
    if (list) list.push(p);
    else byInvoice.set(p.invoiceId, [p]);
  }
  for (const inv of invoices) {
    const parts = partsOf(inv);
    // § 18b UStG: Kz 41 and Kz 21 by the invoice and the service, whatever was paid
    if (parts.length && parts.every((p) => BY_SECTION_18B.includes(p.target))) {
      result.push(...byDate(inv, parts));
      continue;
    }
    if (inv.isCancellation) continue;
    const gross = sum(parts.flatMap((p) => [p.net, p.tax]));
    if (gross <= 0) continue;
    const mine = [...(byInvoice.get(inv.id) ?? [])].sort(comparePayments);
    let paid = 0;
    for (const payment of mine) {
      const before = Math.min(paid, gross);
      paid += payment.amount;
      const after = Math.min(paid, gross);
      if (!inPeriod(payment.date, period)) continue;
      for (const part of parts) {
        result.push({
          invoiceId: inv.id,
          target: part.target,
          net: subtract(shareOf(part.net, cents(after), gross), shareOf(part.net, cents(before), gross)),
          tax: subtract(shareOf(part.tax, cents(after), gross), shareOf(part.tax, cents(before), gross)),
        });
      }
    }
  }
  return result;
}

/** The German tax a service of a foreign supplier is subject to when the recipient owes it (§ 13b Abs. 5 UStG): the standard rate on the amount paid */
const reverseChargeTax = (e: UstvaExpense): Cents => percentOf(e.gross, STANDARD_RATE);

/** Adds up the amounts of a record per ID, in the order the records first appear */
function bookingsOf(kind: UstvaBooking['kind'], rows: readonly { id: string; base: Cents | null; tax: Cents | null }[]): UstvaBooking[] {
  const byId = new Map<string, UstvaBooking>();
  for (const r of rows) {
    const b = byId.get(r.id);
    if (!b) byId.set(r.id, { kind, id: r.id, base: r.base, tax: r.tax });
    else {
      b.base = b.base === null || r.base === null ? (b.base ?? r.base) : cents(b.base + r.base);
      b.tax = b.tax === null || r.tax === null ? (b.tax ?? r.tax) : cents(b.tax + r.tax);
    }
  }
  return [...byId.values()];
}

/** The advance return of one period */
export function ustva(input: UstvaInput): UstvaResult {
  const { period, method, permanentExtension } = input;
  const mode = input.mode ?? 'regular';
  const kz = taxParams(period.year).vatReturn.kz;
  // a small business that files only for § 13b has no supplies on the return
  const parts = mode === 'smallBusiness' ? [] : recognized(input);
  const kindOf = new Map(input.invoices.map((i) => [i.id, i.source ?? 'invoice'] as const));
  const partBookings = (target: Target): UstvaBooking[] => {
    const rows = parts.filter((p) => p.target === target).map((p) => ({ id: p.invoiceId, base: p.net, tax: p.tax }));
    // one booking per record, named by what it is (an invoice or a payout)
    return (['invoice', 'payout'] as const).flatMap((kind) => bookingsOf(kind, rows.filter((r) => (kindOf.get(r.id) ?? 'invoice') === kind)));
  };
  const total = (target: Target, what: 'net' | 'tax'): Cents => sum(parts.filter((p) => p.target === target).map((p) => p[what]));

  const expenses = input.expenses.filter((e) => inPeriod(e.date, period));
  // input tax: the VAT of a domestic expense (66) and the tax owed under § 13b (67), both only while the business is no small business
  const domestic = mode === 'smallBusiness' ? [] : expenses.filter((e) => e.taxTreatment === 'domestic' && !e.smallBusiness);
  const inputTax = sum(domestic.map((e) => e.vat));
  // § 13b UStG: the recipient owes the tax: a service of a supplier in another EU state (46/47), of a supplier established abroad (84/85)
  const euOwed = expenses.filter((e) => e.taxTreatment === 'euReverseCharge');
  const otherOwed = expenses.filter((e) => e.taxTreatment === 'thirdCountry');
  const euBase = sum(euOwed.map((e) => e.gross));
  const euTax = sum(euOwed.map(reverseChargeTax));
  const otherBase = sum(otherOwed.map((e) => e.gross));
  const otherTax = sum(otherOwed.map(reverseChargeTax));
  const deductible = [...euOwed, ...otherOwed].filter((e) => mode !== 'smallBusiness' && !e.smallBusiness);
  const inputTaxOwed = sum(deductible.map(reverseChargeTax));

  const tax19 = total('taxable19', 'tax');
  const tax7 = total('taxable7', 'tax');
  // line 37 is the sum of the tax of lines 13 to 18 and 25 to 32; line 45 takes the input tax (lines 38 to 44) from it
  const remaining = subtract(cents(tax19 + tax7 + euTax + otherTax), cents(inputTax + inputTaxOwed));
  const expenseBookings = (rows: readonly UstvaExpense[], base: (e: UstvaExpense) => Cents | null, tax: (e: UstvaExpense) => Cents | null) => bookingsOf('expense', rows.map((e) => ({ id: e.id, base: base(e), tax: tax(e) })));

  const small = mode === 'smallBusiness';
  const field = (id: UstvaFieldId, number: string, taxKz: string | null, base: Cents | null, tax: Cents | null, always: boolean, bookings: UstvaBooking[], hidden = false): UstvaField => ({
    id,
    kz: number,
    taxKz,
    base,
    tax,
    shown: !hidden && (always || (base ?? 0) !== 0 || (tax ?? 0) !== 0),
    bookings,
  });
  const fields: UstvaField[] = [
    field('taxable19', kz.taxable19, null, total('taxable19', 'net'), tax19, true, partBookings('taxable19'), small),
    field('taxable7', kz.taxable7, null, total('taxable7', 'net'), tax7, true, partBookings('taxable7'), small),
    field('intraCommunitySupply', kz.intraCommunitySupply, null, total('intraCommunitySupply', 'net'), null, false, partBookings('intraCommunitySupply')),
    field('euServices', kz.euServices, null, total('euServices', 'net'), null, false, partBookings('euServices')),
    field('reverseChargeSupplied', kz.reverseChargeSupplied, null, total('reverseChargeSupplied', 'net'), null, false, partBookings('reverseChargeSupplied')),
    field('otherNotTaxable', kz.otherNotTaxable, null, total('otherNotTaxable', 'net'), null, false, partBookings('otherNotTaxable')),
    field('euReverseCharge', kz.euReverseCharge, kz.euReverseChargeTax, euBase, euTax, false, expenseBookings(euOwed, (e) => e.gross, reverseChargeTax)),
    field('otherReverseCharge', kz.otherReverseCharge, kz.otherReverseChargeTax, otherBase, otherTax, false, expenseBookings(otherOwed, (e) => e.gross, reverseChargeTax)),
    field('inputTax', kz.inputTax, null, null, inputTax, true, expenseBookings(domestic, () => null, (e) => e.vat), small),
    field('inputTaxReverseCharge', kz.inputTaxReverseCharge, null, null, inputTaxOwed, false, expenseBookings(deductible, () => null, reverseChargeTax)),
    field('remainingPrepayment', kz.remainingPrepayment, null, null, remaining, true, []),
  ];

  const notices: UstvaNotice[] = [];
  const unplaced = parts.filter((p) => p.target === 'unplaced');
  if (unplaced.length > 0) notices.push({ code: 'supplyUnplaced', count: new Set(unplaced.map((p) => p.invoiceId)).size, amount: sum(unplaced.map((p) => p.net)) });
  notices.push(...(input.extraNotices ?? []));
  return { period, mode, method, dueDate: ustvaDueDate(period, permanentExtension), fields, notices };
}
