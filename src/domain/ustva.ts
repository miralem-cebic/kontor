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
// - Input tax (Vorsteuer, § 15 Abs. 1 Satz 1 Nr. 1 UStG): the VAT inside the domestic expenses, by the date of the expense.
// - The Kennzahlen come from `tax/params/<year>.ts`. Bases are entered in whole euros (`wholeEuros`), taxes in euros and cents.
// https://www.gesetze-im-internet.de/ustg_1980/__13.html, https://www.gesetze-im-internet.de/ustg_1980/__20.html

import { cents, subtract, sum, type BasisPoints, type Cents } from './money';
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
  lines: UstvaInvoiceLine[];
}

export interface UstvaPayment {
  id: string;
  invoiceId: string;
  date: string;
  amount: Cents;
}

export interface UstvaExpense {
  date: string;
  taxTreatment: ExpenseTaxTreatment;
  gross: Cents;
  /** The German VAT inside the gross amount; 0 without it */
  vat: Cents;
}

export interface UstvaInput {
  period: UstvaPeriod;
  /** `cash`: Istversteuerung, `accrual`: Sollversteuerung */
  method: 'cash' | 'accrual';
  permanentExtension: boolean;
  invoices: readonly UstvaInvoice[];
  payments: readonly UstvaPayment[];
  expenses: readonly UstvaExpense[];
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
  | 'remainingPrepayment';

/** A line of the form. `base` and `tax` are null where the form has no such column for the field. */
export interface UstvaField {
  id: UstvaFieldId;
  /** The number of the base column, or of the tax column for a field that has only a tax */
  kz: string;
  /** The exact base in cents; the form takes `wholeEuros` of it */
  base: Cents | null;
  tax: Cents | null;
  /** Shown always (the main fields) or because it has an amount */
  shown: boolean;
}

/** Something in the period that is in the data but that kontor does not put into a field */
export type UstvaNoticeCode = 'supplyUnplaced' | 'expenseReverseCharge' | 'expenseThirdCountry';

export interface UstvaNotice {
  code: UstvaNoticeCode;
  count: number;
  /** The net amount of the supplies, or the gross amount of the expenses */
  amount: Cents;
}

export interface UstvaResult {
  period: UstvaPeriod;
  method: 'cash' | 'accrual';
  /** The due date, with the permanent extension if the company has it */
  dueDate: string;
  fields: UstvaField[];
  notices: UstvaNotice[];
}

/* ---------- Computation ---------- */

type Target = Exclude<UstvaFieldId, 'inputTax' | 'remainingPrepayment'> | 'unplaced';

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

/** The advance return of one period */
export function ustva(input: UstvaInput): UstvaResult {
  const { period, method, permanentExtension } = input;
  const kz = taxParams(period.year).vatReturn.kz;
  const parts = recognized(input);
  const total = (target: Target, what: 'net' | 'tax'): Cents => sum(parts.filter((p) => p.target === target).map((p) => p[what]));

  const expenses = input.expenses.filter((e) => inPeriod(e.date, period));
  const inputTax = sum(expenses.filter((e) => e.taxTreatment === 'domestic').map((e) => e.vat));
  const tax19 = total('taxable19', 'tax');
  const tax7 = total('taxable7', 'tax');
  const remaining = subtract(cents(tax19 + tax7), inputTax);

  const field = (id: UstvaFieldId, number: string, base: Cents | null, tax: Cents | null, always: boolean): UstvaField => ({
    id,
    kz: number,
    base,
    tax,
    shown: always || (base ?? 0) !== 0 || (tax ?? 0) !== 0,
  });
  const fields: UstvaField[] = [
    field('taxable19', kz.taxable19, total('taxable19', 'net'), tax19, true),
    field('taxable7', kz.taxable7, total('taxable7', 'net'), tax7, true),
    field('intraCommunitySupply', kz.intraCommunitySupply, total('intraCommunitySupply', 'net'), null, false),
    field('euServices', kz.euServices, total('euServices', 'net'), null, false),
    field('reverseChargeSupplied', kz.reverseChargeSupplied, total('reverseChargeSupplied', 'net'), null, false),
    field('otherNotTaxable', kz.otherNotTaxable, total('otherNotTaxable', 'net'), null, false),
    field('inputTax', kz.inputTax, null, inputTax, true),
    field('remainingPrepayment', kz.remainingPrepayment, null, remaining, true),
  ];

  const notices: UstvaNotice[] = [];
  const unplaced = parts.filter((p) => p.target === 'unplaced');
  if (unplaced.length > 0) notices.push({ code: 'supplyUnplaced', count: new Set(unplaced.map((p) => p.invoiceId)).size, amount: sum(unplaced.map((p) => p.net)) });
  for (const [code, treatment] of [['expenseReverseCharge', 'euReverseCharge'], ['expenseThirdCountry', 'thirdCountry']] as const) {
    const rows = expenses.filter((e) => e.taxTreatment === treatment);
    if (rows.length > 0) notices.push({ code, count: rows.length, amount: sum(rows.map((e) => e.gross)) });
  }
  return { period, method, dueDate: ustvaDueDate(period, permanentExtension), fields, notices };
}
