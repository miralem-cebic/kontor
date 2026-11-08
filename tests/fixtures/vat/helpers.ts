// Shared building blocks of the VAT reference scenarios (#37). A scenario file holds the bookings, the expected values and,
// for every expected value, its reasoning with the paragraph and the URL. kontor gives no tax advice: a value that could
// not be checked against the law text is marked "UNVERIFIED" in its comment and listed in the pull request notes.

import { basisPoints, cents, taxTotals, type BasisPoints, type Cents } from '../../../src/domain/money';
import type { UstvaExpense, UstvaFieldId, UstvaInput, UstvaInvoice, UstvaNoticeCode, UstvaPayment } from '../../../src/domain/ustva';

export const R19 = basisPoints(1900);
export const R7 = basisPoints(700);
export const R0 = basisPoints(0);

/** What a scenario expects of one form field. A missing side is not checked; `shown` is the visibility of the line. */
export interface ExpectedField {
  base?: number;
  tax?: number;
  shown?: boolean;
}

export interface VatScenario {
  id: string;
  title: string;
  /** Why the numbers are what they are, in prose */
  reasoning: string;
  /** Paragraphs and URLs behind the scenario as a whole; every single value has its own source in a comment below */
  sources: readonly string[];
  input: UstvaInput;
  expected: Partial<Record<UstvaFieldId, ExpectedField>>;
  /** The notices expected, by code; `undefined` means "not checked", `[]` means "none" */
  notices?: readonly { code: UstvaNoticeCode; count: number; amount: number }[];
  /** The due date expected, when the scenario is about it */
  dueDate?: string;
}

/** A scenario that cannot run yet, because the feature it needs is not built. The runner lists it as `todo`. */
export interface PendingScenario {
  id: string;
  title: string;
  /** The issue or roadmap row that builds what the scenario needs */
  needs: string;
  reasoning: string;
  sources: readonly string[];
  /** What could not be verified from the law text and has to be confirmed before code is written */
  unverified: readonly string[];
}

/** The net amount of a line in cents, with the rate of its VAT */
export interface NetLine {
  net: number;
  rate?: BasisPoints;
}

export interface InvoiceOptions {
  id: string;
  date: string;
  /** Defaults to `date` */
  serviceEnd?: string;
  treatment?: UstvaInvoice['treatment'];
  country?: string | null;
  cancellation?: boolean;
  smallBusiness?: boolean;
}

/**
 * An issued invoice made from its net lines: the VAT per rate is computed by `taxTotals` as an invoice computes it (per
 * document, half away from zero), and is zero where the invoice charges none (reverse charge, tax-free supply, place of
 * supply abroad, small business). A cancellation has the negative amounts.
 */
export function invoiceOf(opts: InvoiceOptions, lines: readonly NetLine[]): UstvaInvoice {
  const treatment = opts.treatment ?? 'standard';
  const smallBusiness = opts.smallBusiness ?? false;
  const charges = treatment === 'standard' && !smallBusiness;
  const sign = opts.cancellation ? -1 : 1;
  const totals = taxTotals(lines.map((l) => ({ net: cents(sign * l.net), rate: charges ? (l.rate ?? R19) : R0 })));
  return {
    id: opts.id,
    date: opts.date,
    serviceEnd: opts.serviceEnd ?? opts.date,
    treatment,
    customerCountry: opts.country === undefined ? 'DE' : opts.country,
    isCancellation: opts.cancellation ?? false,
    smallBusiness,
    lines: totals.byRate.map(({ rate, net, tax }) => ({ rate, net, tax })),
  };
}

export const gross = (inv: UstvaInvoice): Cents => cents(inv.lines.reduce((s, l) => s + l.net + l.tax, 0));

export const paymentOf = (id: string, invoiceId: string, date: string, amount: number): UstvaPayment => ({ id, invoiceId, date, amount: cents(amount) });

export const domesticExpense = (date: string, grossAmount: number, vat: number): UstvaExpense => ({ date, taxTreatment: 'domestic', gross: cents(grossAmount), vat: cents(vat) });
