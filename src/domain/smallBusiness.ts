// The small business scheme (Kleinunternehmerregelung, § 19 UStG): when the limits are crossed, what is warned about,
// and which invoices may still be written without VAT. Pure: the caller maps the payments into the entries below.
// Every result is an orientation, not tax advice.
//
// What the law text says (gesetze-im-internet.de, § 19 UStG in the version since 1 January 2025, checked on 7 November 2026):
// - Abs. 1 Satz 1: a domestic supply is exempt if the Gesamtumsatz was at most 25,000 € in the previous calendar year
//   and is at most 100,000 € in the current year.
// - Abs. 2 Satz 1: the Gesamtumsatz is "die nach vereinnahmten Entgelten berechnete Summe der vom Unternehmer ausgeführten
//   steuerbaren Umsätze im Sinne des § 1 Absatz 1 Nummer 1" (domestic supplies), less some exempt supplies (§ 4 Nr. 8, 9 and
//   11 to 29 UStG, which kontor does not record); sales of fixed assets stay out (Satz 2). So it is counted on the day the money
//   arrived, net, and a service whose place of supply is abroad is not part of it.
// - Abs. 3: the waiver (Option zur Regelbesteuerung), see `taxParams(year).smallBusiness.waiverBindingYears`.
// The issue text of the roadmap numbers the waiver as Abs. 3 and the definition as Abs. 2, which is what the law says.
//
// Abschnitt 19.1 Abs. 2 Satz 4 UStAE (seen in a secondary source, not the original): "Bereits der Umsatz, mit dem diese
// Grenze überschritten wird, ist nicht mehr nach § 19 Abs. 1 UStG steuerfrei." Regular taxation therefore starts with the
// turnover that crosses 100,000 €, not at the end of the year.
//
// NOT VERIFIED (kontor does not guess, so these are stated as simplifications):
// - Which date decides for a supply whose payment and invoice fall on different days. The crossing day is the day the
//   money arrived (Abs. 2: vereinnahmte Entgelte), and an invoice is judged by its own date. An invoice dated before the
//   crossing but paid after it, or one dated on the crossing day, is not refused.
// - Advance payments, and whether the crossing turnover is taxed by the date of the service or of the payment.
// - Turnover that no payment in kontor shows (platform payouts), and the other companies of the same person (one single
//   business for VAT, § 2 Abs. 1 UStG): only what this company recorded is counted, so the real day can be earlier.

import { sum, type Cents } from './money';
import { KNOWN_TAX_YEARS, taxParams } from './tax/params';

/** A part of the Gesamtumsatz: net, on the day the money arrived, from a supply taxable in Germany */
export interface TurnoverEntry {
  /** YYYY-MM-DD */
  date: string;
  /** Net amount in cents */
  amount: Cents;
}

/** From this share of the limit of the current year the overview warns (a hint of kontor, not a legal value) */
export const WARNING_PERCENT = 80;

const inYear = (date: string, year: number): boolean => date.startsWith(`${year}-`);

/** The Gesamtumsatz of a calendar year (§ 19 Abs. 2 UStG) */
export const turnoverOfYear = (entries: readonly TurnoverEntry[], year: number): Cents => sum(entries.filter((x) => inYear(x.date, year)).map((x) => x.amount));

/**
 * The day on which the sum of the year first goes above `limit`, or null. Entries of one day count together, so the
 * result is the day of the entry that crosses, whatever the order. A later entry that lowers the sum does not undo it.
 */
export function crossingDay(entries: readonly TurnoverEntry[], year: number, limit: Cents): string | null {
  const days = new Map<string, number>();
  for (const x of entries) if (inYear(x.date, year)) days.set(x.date, (days.get(x.date) ?? 0) + x.amount);
  let total = 0;
  for (const day of [...days.keys()].sort()) {
    total += days.get(day) ?? 0;
    if (total > limit) return day;
  }
  return null;
}

/**
 * When the exemption of a year ends: `previousYear` (the Gesamtumsatz of the year before was above 25,000 €: it never
 * applies in the year, from 1 January), or `currentYear` (100,000 € crossed: from that day on). null while it holds.
 * Years before the first with known limits are not judged: the limits and the rule of the crossing day were different.
 */
export type ExemptionEnd = { reason: 'previousYear' | 'currentYear'; from: string };

export function exemptionEnd(entries: readonly TurnoverEntry[], year: number): ExemptionEnd | null {
  const first = KNOWN_TAX_YEARS[0].year;
  if (year < first) return null;
  const limits = taxParams(year).smallBusiness;
  if (turnoverOfYear(entries, year - 1) > limits.previousYearLimit) return { reason: 'previousYear', from: `${year}-01-01` };
  const day = crossingDay(entries, year, limits.currentYearLimit);
  return day ? { reason: 'currentYear', from: day } : null;
}

/**
 * Why an invoice dated `invoiceDate` may not be written without VAT as a small business, or null. After a crossing the
 * invoices dated after the crossing day are refused; the day itself and earlier dates are not, so an older invoice that
 * is issued late stays possible. When the previous year was above 25,000 €, every invoice of the year is refused.
 */
export function smallBusinessRefusal(invoiceDate: string, entries: readonly TurnoverEntry[]): ExemptionEnd | null {
  const end = exemptionEnd(entries, Number(invoiceDate.slice(0, 4)));
  if (!end) return null;
  return end.reason === 'previousYear' || invoiceDate > end.from ? end : null;
}

/** What the overview warns about, for a small business: the previous year above the limit, the limit crossed, or close to it */
export type LimitWarning = { kind: 'previousYear' } | { kind: 'crossed'; day: string } | { kind: 'close'; percent: number };

export function limitWarning(entries: readonly TurnoverEntry[], year: number): LimitWarning | null {
  const end = exemptionEnd(entries, year);
  if (end?.reason === 'previousYear') return { kind: 'previousYear' };
  if (end) return { kind: 'crossed', day: end.from };
  const limit = taxParams(year).smallBusiness.currentYearLimit;
  const total = turnoverOfYear(entries, year);
  return total * 100 >= limit * WARNING_PERCENT ? { kind: 'close', percent: Math.floor((total * 100) / limit) } : null;
}

/**
 * The expenses of the year the recipient owes the VAT for (§ 13b Abs. 1 and 2 Nr. 1 UStG): a service of a supplier in
 * another EU state, or of one outside the EU, without VAT. The recipient owes it if he is an entrepreneur (Abs. 5), a
 * small business too, and must then file an advance return for the period (§ 18 Abs. 4a UStG, which § 19 Abs. 1 Satz 2
 * keeps). The treatment is what the user chose from the receipt; kontor does not check the kind of service.
 */
export const reverseChargeExpenseCount = (expenses: readonly { date: string; taxTreatment: string }[], year: number): number =>
  expenses.filter((x) => inYear(x.date, year) && (x.taxTreatment === 'euReverseCharge' || x.taxTreatment === 'thirdCountry')).length;
