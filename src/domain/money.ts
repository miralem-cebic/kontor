// Money as integer cents, tax rates as basis points (1900 = 19 %), quantities as thousandths (1500 = 1.5).
// No floating point number is ever used to compute an amount. Products and quotients go through BigInt and are
// rounded exactly once, half away from zero ("kaufmännisch runden").
//
// Rounding of value added tax on a document (see ADR 0003):
// - 'perDocument' (default): the net amounts are summed per tax rate, and the tax is computed once per rate.
//   EN 16931 requires this for e-invoices (BR-CO-17: VAT category tax amount = taxable amount × rate, rounded).
// - 'perLine': the tax is computed and rounded for every line, then summed. Only for documents that are not
//   e-invoices and whose amounts were agreed per line; the totals may differ from 'perDocument' by up to half a
//   cent per line.

declare const brand: unique symbol;

/** An amount of money in euro cents (integer, may be negative). */
export type Cents = number & { readonly [brand]: 'Cents' };
/** A rate in hundredths of a percent: 1900 = 19 %, 700 = 7 %. Non-negative integer. */
export type BasisPoints = number & { readonly [brand]: 'BasisPoints' };
/** A quantity in thousandths: 1000 = 1, 1500 = 1.5, 250 = 0.25. Integer, may be negative (credit lines). */
export type Quantity = number & { readonly [brand]: 'Quantity' };

export type TaxRounding = 'perDocument' | 'perLine';

export const BASIS_POINTS_PER_UNIT = 10_000;
export const QUANTITY_SCALE = 1_000;
const CENTS_PER_EURO = 100;

export class MoneyRangeError extends RangeError {
  override name = 'MoneyRangeError';
}

const checkInteger = (value: number, what: string): number => {
  if (!Number.isSafeInteger(value)) throw new MoneyRangeError(`${what} must be a safe integer, got ${value}`);
  return value;
};

export const cents = (value: number): Cents => checkInteger(value, 'Cents') as Cents;
export const quantity = (thousandths: number): Quantity => checkInteger(thousandths, 'Quantity') as Quantity;
export function basisPoints(value: number): BasisPoints {
  checkInteger(value, 'BasisPoints');
  if (value < 0) throw new MoneyRangeError(`BasisPoints must not be negative, got ${value}`);
  return value as BasisPoints;
}

export const ZERO: Cents = cents(0);

const fromBig = (value: bigint): Cents => cents(Number(value));

/** n / d rounded to the nearest integer; a half is rounded away from zero. d must be positive. */
export function divideRounded(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new MoneyRangeError('The divisor must be positive');
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const q = (abs * 2n + d) / (2n * d);
  return negative ? -q : q;
}

export const add = (a: Cents, b: Cents): Cents => cents(a + b);
export const subtract = (a: Cents, b: Cents): Cents => cents(a - b);
export const negate = (a: Cents): Cents => cents(-a);

export function sum(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total = checkInteger(total + v, 'Sum');
  return cents(total);
}

/** `rate` of `amount`, rounded half away from zero: percentOf(1000, 1900) = 190. */
export const percentOf = (amount: Cents, rate: BasisPoints): Cents =>
  fromBig(divideRounded(BigInt(amount) * BigInt(rate), BigInt(BASIS_POINTS_PER_UNIT)));

/** Net amount of a line: unit price × quantity, rounded once. */
export const lineNet = (unitPrice: Cents, qty: Quantity): Cents =>
  fromBig(divideRounded(BigInt(unitPrice) * BigInt(qty), BigInt(QUANTITY_SCALE)));

/** Splits a gross amount into net and tax for one rate. net + tax is always exactly `gross`. */
export function splitGross(gross: Cents, rate: BasisPoints): { net: Cents; tax: Cents } {
  const net = fromBig(divideRounded(BigInt(gross) * BigInt(BASIS_POINTS_PER_UNIT), BigInt(BASIS_POINTS_PER_UNIT + rate)));
  return { net, tax: subtract(gross, net) };
}

export interface TaxLine {
  net: Cents;
  rate: BasisPoints;
}

export interface TaxTotals {
  /** Per tax rate, ascending by rate */
  byRate: { rate: BasisPoints; net: Cents; tax: Cents }[];
  net: Cents;
  tax: Cents;
  gross: Cents;
}

/** Net, tax and gross of a document. See the comment at the top of this file for the two rounding modes. */
export function taxTotals(lines: readonly TaxLine[], rounding: TaxRounding = 'perDocument'): TaxTotals {
  const groups = new Map<BasisPoints, { net: Cents[]; tax: Cents[] }>();
  for (const line of lines) {
    const g = groups.get(line.rate) ?? { net: [], tax: [] };
    g.net.push(line.net);
    if (rounding === 'perLine') g.tax.push(percentOf(line.net, line.rate));
    groups.set(line.rate, g);
  }
  const byRate = [...groups]
    .sort(([a], [b]) => a - b)
    .map(([rate, g]) => {
      const net = sum(g.net);
      return { rate, net, tax: rounding === 'perLine' ? sum(g.tax) : percentOf(net, rate) };
    });
  const net = sum(byRate.map((r) => r.net));
  const tax = sum(byRate.map((r) => r.tax));
  return { byRate, net, tax, gross: add(net, tax) };
}

/* ---------- Text ---------- */

export type MoneyLocale = 'de' | 'en';

const SEPARATORS: Record<MoneyLocale, { decimal: string; group: string; intl: string }> = {
  de: { decimal: ',', group: '.', intl: 'de-DE' },
  en: { decimal: '.', group: ',', intl: 'en-GB' },
};

/** The amount as an exact decimal string for Intl (no float conversion): -12345 → "-123.45". */
export function toDecimalString(amount: Cents): string {
  const abs = Math.abs(amount);
  const euros = Math.trunc(abs / CENTS_PER_EURO);
  const rest = abs % CENTS_PER_EURO;
  return `${amount < 0 ? '-' : ''}${euros}.${String(rest).padStart(2, '0')}`;
}

/** "1.234,56 €" (de) or "€1,234.56" (en). */
export function formatCents(amount: Cents, locale: MoneyLocale): string {
  const nf = new Intl.NumberFormat(SEPARATORS[locale].intl, { style: 'currency', currency: 'EUR' });
  return nf.format(toDecimalString(amount) as `${number}`);
}

/**
 * Reads an amount typed by a person: "1.234,56", "1234,5", "-12", "12,00 €" (de) or "1,234.56" (en).
 * Group separators are optional, but when present every group after the first has three digits.
 * At most two decimal places. Returns null for anything else.
 */
export function parseCents(input: string, locale: MoneyLocale): Cents | null {
  const { decimal, group } = SEPARATORS[locale];
  const text = input.replace(/\s|€/g, '').replace(/^EUR|EUR$/i, '');
  const match = /^([+-]?)(\d+(?:[.,]\d+)*)$/.exec(text);
  if (!match) return null;
  const [, sign = '', body = ''] = match;
  const decimalAt = body.lastIndexOf(decimal);
  const intPart = decimalAt >= 0 ? body.slice(0, decimalAt) : body;
  const fraction = decimalAt >= 0 ? body.slice(decimalAt + 1) : '';
  if (fraction.length === 0 && decimalAt >= 0) return null;
  if (fraction.length > 2 || /\D/.test(fraction)) return null;
  const groups = intPart.split(group);
  if (groups.some((g) => /\D/.test(g) || g === '')) return null;
  if (groups.length > 1 && groups.slice(1).some((g) => g.length !== 3)) return null;
  if (groups.length > 1 && (groups[0]?.length ?? 0) > 3) return null;
  const digits = groups.join('') + fraction.padEnd(2, '0');
  const value = Number(digits);
  if (!Number.isSafeInteger(value)) return null;
  return cents(sign === '-' ? -value : value);
}
