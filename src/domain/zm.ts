// The summary report (Zusammenfassende Meldung, ZM) as a filling aid (R8): from the issued invoices of one reporting period,
// the sums per recipient VAT ID that go into the form of the BZSt online portal. Pure: the caller maps the records of the
// folder into the rows below. Every figure is an estimate and a filling aid, not tax advice.
//
// The rules, and where they come from (the text of the law was read at https://www.gesetze-im-internet.de/ustg_1980/__18a.html):
// - Who reports: a business that supplies goods to a business in another EU state with an intra-community supply (§ 18a
//   Abs. 1, 6 UStG), or services under § 3a Abs. 2 UStG for which the recipient in another member state owes the tax
//   (§ 18a Abs. 2 UStG). Not a business that applies § 19 Abs. 1 UStG, the small business scheme (§ 18a Abs. 4 UStG).
// - What is reported: the VAT ID of each recipient and the sum of the bases (Bemessungsgrundlagen) of the supplies to it
//   (§ 18a Abs. 7 Satz 1 Nr. 1 and 3 UStG). The base is the net amount. Changes of the base, such as a cancellation, are
//   treated as in § 17 UStG (§ 18a Abs. 7 Satz 2): in the period of the change, negative.
// - Period of a service: the one in which it was performed (§ 18a Abs. 8 Satz 2). Period of a supply of goods: the one in
//   which the invoice is issued, at the latest the one in which the month after the supply ends (Abs. 8 Satz 1).
// - Reporting period: the quarter for services (Abs. 2); for goods the month, or the quarter while the bases of the goods
//   were not more than 50,000 € in this quarter nor in any of the four before (Abs. 1 Satz 1 and 2). A business that reports
//   monthly for goods reports its services of the quarter in the report for the last month of the quarter (Abs. 2 Satz 2).
//   The option of Abs. 3 (services in the monthly report of their month) and the annual report of Abs. 9 are not covered.
// - Due: by the 25th day after the period (Abs. 1 Satz 1, `tax/params`). The permanent extension of the advance returns does
//   not apply to it (BZSt, https://www.bzst.de/EN/Businesses/VAT/Recapitulative_statement/Deadlines/deadlines_node.html).
//
// UNVERIFIED (not found in the law text; to confirm with the BZSt or a tax advisor):
// - How cents are treated: the portal takes whole euros (the CSV import description of the BZSt, version of 2015, says "ganze
//   Zahl"). kontor rounds the sum per recipient half away from zero (`zmWholeEuros`); the BZSt names no rule for it.
// - That a cancellation in a later period is reported negative in that period, and not by correcting the earlier report
//   (§ 18a Abs. 10 UStG: an incorrect report is to be corrected within one month). The law text says only "sinngemäß § 17".
// - That the zero line of a recipient (a service and its cancellation in one period) can be left out.
//
// Consequence worth knowing: an intra-community supply is tax-free only if the report was handed in correctly (§ 4 Nr. 1
// Buchst. b UStG, https://www.gesetze-im-internet.de/ustg_1980/__4.html), which is why the VAT IDs are checked here.

import { cents, divideRounded, sum, type Cents } from './money';
import { addDays, endOfNextMonth } from './dates';
import type { TaxTreatment } from './invoice';
import { isPlausibleEuVatId, normalizeVatId } from './taxIds';
import { taxParams } from './tax/params';
import { periodEnd, periodOfDate, periodStart, type UstvaPeriod } from './ustva';
import { isEuMemberState } from './vat';

/** The page of the BZSt where the report is filled in (log-in needed). Checked on 7 November 2026. */
export const ZM_PORTAL_URL = 'https://online.portal.bzst.de';

/* ---------- Input ---------- */

/** What a line of the report is: a service (§ 18a Abs. 7 Nr. 3) or a supply of goods (Nr. 1) */
export type ZmKind = 'service' | 'supply';

/** An issued invoice (a draft is not passed), with the customer as it was when the invoice was issued */
export interface ZmInvoice {
  id: string;
  /** The invoice number, to name the invoice in a problem */
  number: string;
  /** The date of the invoice; a cancellation counts on this date */
  date: string;
  /** The last day of the service or the supply */
  serviceEnd: string;
  treatment: TaxTreatment;
  /** The country (ISO code) of the customer's address when it was issued; null without an address */
  customerCountry: string | null;
  /** The VAT ID of the customer as typed on the invoice; empty if there is none */
  customerVatId: string;
  isCancellation: boolean;
  /** Issued by a small business (§ 19 Abs. 1 UStG): it is not part of a report */
  smallBusiness: boolean;
  /** The net amount of the invoice; negative for a cancellation */
  net: Cents;
}

export interface ZmInput {
  /** A quarter, or a month (supplies of the month; the services of the quarter in its last month) */
  period: UstvaPeriod;
  invoices: readonly ZmInvoice[];
}

/* ---------- Result ---------- */

/** What is wrong with the VAT ID of a recipient */
export type ZmProblemCode = 'vatIdMissing' | 'vatIdInvalid' | 'vatIdGerman' | 'vatIdCountry';

export interface ZmProblem {
  invoiceId: string;
  number: string;
  /** The VAT ID as normalized; empty if missing */
  vatId: string;
  code: ZmProblemCode;
}

/** The sum for one recipient and kind: a line of the report */
export interface ZmLine {
  /** The country code of the line: the start of the VAT ID (EL for Greece), or of the address if the ID is not usable */
  country: string;
  /** The VAT ID of the recipient as normalized (no spaces, capitals), with the country code; empty if missing */
  vatId: string;
  /** The VAT ID without the country code, as the portal asks for it beside the country */
  idNumber: string;
  kind: ZmKind;
  /** The sum of the bases in cents; the portal takes `zmWholeEuros` of it */
  base: Cents;
  invoiceIds: string[];
  /** The first problem with the VAT ID of this line, or null */
  problem: ZmProblemCode | null;
}

/** Something in the period that is not a line but that the person should know */
export type ZmNoticeCode = 'servicesInLastMonth' | 'notTaxableEu' | 'placeUnknown' | 'supplyMonthly';

export interface ZmNotice {
  code: ZmNoticeCode;
  /** Invoices (or quarters, for `supplyMonthly`) */
  count: number;
  /** The net amount, or for `supplyMonthly` the largest quarterly sum of the supplies */
  amount: Cents;
}

export interface ZmResult {
  period: UstvaPeriod;
  /** The day the report is due */
  dueDate: string;
  lines: ZmLine[];
  total: { service: Cents; supply: Cents };
  problems: ZmProblem[];
  notices: ZmNotice[];
}

/* ---------- Dates ---------- */

const pad = (n: number): string => String(n).padStart(2, '0');
const isoOf = (d: Date): string => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const lastMonthOf = (p: UstvaPeriod): number => (p.kind === 'month' ? p.index : p.index * 3);

/**
 * The day the report is due: the `dueDay` of the month after the period (§ 18a Abs. 1 Satz 1 UStG). A Saturday or Sunday
 * moves to the Monday (§ 108 Abs. 3 AO); public holidays are not known to kontor, so a due date on a holiday is not moved.
 */
export function zmDueDate(p: UstvaPeriod): string {
  const due = new Date(Date.UTC(p.year, lastMonthOf(p), taxParams(p.year).summaryReport.dueDay));
  const weekday = due.getUTCDay();
  return addDays(isoOf(due), weekday === 6 ? 2 : weekday === 0 ? 1 : 0);
}

/** A base as the portal takes it: whole euros, half away from zero (UNVERIFIED, see the top of the file) */
export const zmWholeEuros = (amount: Cents): number => Number(divideRounded(BigInt(Math.abs(amount)), 100n)) * (amount < 0 ? -1 : 1) + 0;

/* ---------- Classification ---------- */

type Class = ZmKind | 'notTaxableEu' | 'placeUnknown' | null;

/** What an invoice is for the report. Mirrors where `ustva` puts it: Kz 21 for a service, Kz 41 for a supply. */
function classify(inv: ZmInvoice): Class {
  if (inv.smallBusiness) return null;
  const country = inv.customerCountry;
  const otherEu = country !== null && country !== 'DE' && isEuMemberState(country);
  switch (inv.treatment) {
    case 'standard':
      return null;
    case 'notTaxable':
      // Kz 45 in the advance return; for a customer in another EU state the usual case is the reverse charge instead
      return otherEu ? 'notTaxableEu' : null;
    case 'reverseCharge':
      if (country === 'DE') return null;
      return otherEu ? 'service' : 'placeUnknown';
    case 'intraCommunitySupply':
      // the country of the VAT ID decides if the invoice has none
      return country === null || otherEu ? 'supply' : 'placeUnknown';
  }
}

/** The date by which an invoice is assigned to a reporting period (§ 18a Abs. 8) */
function reportDate(inv: ZmInvoice, kind: ZmKind): string {
  if (inv.isCancellation) return inv.date;
  if (kind === 'supply') {
    const cap = endOfNextMonth(inv.serviceEnd);
    return inv.date < cap ? inv.date : cap;
  }
  return inv.serviceEnd;
}

/** The country code a VAT ID starts with for a country of an address: Greece is GR in an address and EL in a VAT ID */
const vatPrefixOf = (country: string): string => (country === 'GR' ? 'EL' : country);

function problemOf(inv: ZmInvoice, vatId: string): ZmProblemCode | null {
  if (vatId === '') return 'vatIdMissing';
  if (vatId.startsWith('DE')) return 'vatIdGerman';
  if (!isPlausibleEuVatId(vatId)) return 'vatIdInvalid';
  if (inv.customerCountry !== null && !vatId.startsWith(vatPrefixOf(inv.customerCountry))) return 'vatIdCountry';
  return null;
}

/* ---------- Computation ---------- */

const inRange = (date: string, from: string, to: string): boolean => from <= date && date <= to;

const NOTICE_ORDER: readonly ZmNoticeCode[] = ['servicesInLastMonth', 'notTaxableEu', 'placeUnknown', 'supplyMonthly'];

/** The report of one period */
export function zm(input: ZmInput): ZmResult {
  const { period } = input;
  const quarter = period.kind === 'quarter' ? period : periodOfDate(periodStart(period), 'quarter');
  // supplies: the own period; services: the quarter, in a month only in the last one of its quarter (Abs. 2 Satz 2)
  const supplySpan: [string, string] = [periodStart(period), periodEnd(period)];
  const servicesHere = period.kind === 'quarter' || period.index % 3 === 0;
  const serviceSpan: [string, string] = [periodStart(quarter), periodEnd(quarter)];

  type Entry = { inv: ZmInvoice; kind: ZmKind; date: string };
  const entries: Entry[] = [];
  const noticed = { notTaxableEu: [] as ZmInvoice[], placeUnknown: [] as ZmInvoice[] };
  for (const inv of input.invoices) {
    const cls = classify(inv);
    if (cls === null) continue;
    if (cls === 'notTaxableEu' || cls === 'placeUnknown') {
      if (servicesHere && inRange(reportDate(inv, 'service'), ...serviceSpan)) noticed[cls].push(inv);
      continue;
    }
    const date = reportDate(inv, cls);
    if (cls === 'supply' ? inRange(date, ...supplySpan) : servicesHere && inRange(date, ...serviceSpan)) entries.push({ inv, kind: cls, date });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));

  const groups = new Map<string, { kind: ZmKind; vatId: string; entries: Entry[] }>();
  for (const e of entries) {
    const vatId = normalizeVatId(e.inv.customerVatId);
    const key = `${vatId}|${e.kind}`;
    const group = groups.get(key) ?? { kind: e.kind, vatId, entries: [] };
    group.entries.push(e);
    groups.set(key, group);
  }

  const lines: ZmLine[] = [];
  const lineProblems = new Map<ZmLine, ZmProblem[]>();
  for (const g of groups.values()) {
    const base = sum(g.entries.map((e) => e.inv.net));
    // a recipient whose supplies cancel out in the period has nothing to report
    if (base === 0) continue;
    const found = g.entries.flatMap((e) => {
      const code = problemOf(e.inv, g.vatId);
      return code ? [{ invoiceId: e.inv.id, number: e.inv.number, vatId: g.vatId, code }] : [];
    });
    const first = g.entries[0]?.inv;
    const usable = found.length === 0 || found.every((p) => p.code === 'vatIdCountry');
    const country = usable && g.vatId !== '' ? g.vatId.slice(0, 2) : first?.customerCountry ? vatPrefixOf(first.customerCountry) : '';
    const line: ZmLine = {
      country,
      vatId: g.vatId,
      idNumber: /^[A-Z]{2}/.test(g.vatId) ? g.vatId.slice(2) : g.vatId,
      kind: g.kind,
      base,
      invoiceIds: g.entries.map((e) => e.inv.id),
      problem: found[0]?.code ?? null,
    };
    lines.push(line);
    lineProblems.set(line, found);
  }
  lines.sort((a, b) => a.vatId.localeCompare(b.vatId) || a.kind.localeCompare(b.kind));
  const problems = lines.flatMap((l) => lineProblems.get(l) ?? []);

  const total = (kind: ZmKind): Cents => sum(lines.filter((l) => l.kind === kind).map((l) => l.base));

  const notices: ZmNotice[] = [];
  const services = entries.filter((e) => e.kind === 'service');
  if (period.kind === 'month' && servicesHere && services.length > 0) notices.push({ code: 'servicesInLastMonth', count: services.length, amount: sum(services.map((e) => e.inv.net)) });
  for (const code of ['notTaxableEu', 'placeUnknown'] as const) {
    if (noticed[code].length > 0) notices.push({ code, count: noticed[code].length, amount: sum(noticed[code].map((i) => i.net)) });
  }
  if (period.kind === 'quarter') {
    // goods: monthly while one of the five quarters (this one and four before) is above the limit (§ 18a Abs. 1 Satz 2)
    const limit = taxParams(period.year).summaryReport.monthlySupplyLimit;
    const ordinal = (p: UstvaPeriod): number => p.year * 4 + p.index;
    const sums = new Map<number, number>();
    for (const inv of input.invoices) {
      if (classify(inv) !== 'supply') continue;
      const o = ordinal(periodOfDate(reportDate(inv, 'supply'), 'quarter'));
      if (o <= ordinal(period) && o >= ordinal(period) - 4) sums.set(o, (sums.get(o) ?? 0) + inv.net);
    }
    const above = [...sums.values()].filter((v) => v > limit);
    if (above.length > 0) notices.push({ code: 'supplyMonthly', count: above.length, amount: cents(Math.max(...above)) });
  }
  notices.sort((a, b) => NOTICE_ORDER.indexOf(a.code) - NOTICE_ORDER.indexOf(b.code));

  return { period, dueDate: zmDueDate(period), lines, total: { service: total('service'), supply: total('supply') }, problems, notices };
}

/* ---------- Consistency with the advance return ---------- */

/** The total of the services in the report against Kz 21 of the advance return for the same span */
export interface ZmConsistency {
  zm: Cents;
  ustva: Cents;
  /** ZM minus Kz 21 */
  difference: Cents;
  consistent: boolean;
}

/** Kz 21 is the base of the services to a business in another EU state (§ 18b Satz 1 Nr. 2 UStG): the same services as the report's */
export function zmUstvaCheck(result: ZmResult, kz21Base: Cents): ZmConsistency {
  const diff = result.total.service - kz21Base;
  return { zm: result.total.service, ustva: kz21Base, difference: cents(diff), consistent: diff === 0 };
}
