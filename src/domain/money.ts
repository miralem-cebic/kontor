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
// A discount of a whole document is shared between the tax rates by `allocate` (largest remainders), which adds up
// to the discount exactly.

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

/** The largest dunning fee: 999,999.99 € */
export const MAX_FEE: Cents = cents(99_999_999);

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

const floorDivide = (n: bigint, d: bigint): bigint => {
  const q = n / d;
  return n % d !== 0n && n < 0n ? q - 1n : q;
};

/**
 * Splits `total` in proportion to `weights`, which must add up to a positive sum (F23: a discount of the whole document
 * is shared between the tax rates). Every part is rounded down, and the cents left over go to the parts with the
 * largest remainders (a tie goes to the earlier part). The parts add up to `total` exactly, and each is less than a
 * cent away from its exact share. The rounding of a share is therefore not half away from zero, by design.
 */
export function allocate(total: Cents, weights: readonly Cents[]): Cents[] {
  const weightSum = BigInt(sum(weights));
  if (weightSum <= 0n) throw new MoneyRangeError(`The weights must add up to a positive sum, got ${weightSum}`);
  // A negative total is split as the positive one and negated, so the cents go the same way for both (0 - x: no −0)
  if (total < 0) return allocate(cents(-total), weights).map((part) => cents(0 - part));
  const t = BigInt(total);
  const floors = weights.map((w) => floorDivide(t * BigInt(w), weightSum));
  // The remainder of each part over the common denominator: t·w − floor·W, in [0, W)
  const remainders = weights.map((w, i) => t * BigInt(w) - (floors[i] ?? 0n) * weightSum);
  const remainder = (i: number) => remainders[i] ?? 0n;
  const order = weights.map((_, i) => i).sort((a, b) => (remainder(b) > remainder(a) ? 1 : remainder(b) < remainder(a) ? -1 : a - b));
  const parts = [...floors];
  let left = t - floors.reduce((a, b) => a + b, 0n);
  for (const i of order) {
    if (left <= 0n) break;
    parts[i] = (parts[i] ?? 0n) + 1n;
    left -= 1n;
  }
  return parts.map(fromBig);
}

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

/** The amount without currency, as a person would type it: "1.234,56" (de) or "1,234.56" (en). `parseCents` reads it back. */
export function formatDecimal(amount: Cents, locale: MoneyLocale): string {
  const nf = new Intl.NumberFormat(SEPARATORS[locale].intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return nf.format(toDecimalString(amount) as `${number}`);
}

/** A rate as a percentage: 1900 → "19 %" (de) or "19%" (en), 750 → "7,5 %". */
export function formatRate(rate: BasisPoints, locale: MoneyLocale): string {
  const digits = String(rate).padStart(5, '0');
  const nf = new Intl.NumberFormat(SEPARATORS[locale].intl, { style: 'percent', maximumFractionDigits: 2 });
  return nf.format(`${digits.slice(0, -4)}.${digits.slice(-4)}` as `${number}`);
}

/** A quantity as a person would type it: 1500 → "1,5" (de) or "1.5" (en), 1000 → "1". `parseQuantity` reads it back. */
export function formatQuantity(qty: Quantity, locale: MoneyLocale): string {
  const abs = Math.abs(qty);
  const decimal = `${qty < 0 ? '-' : ''}${Math.trunc(abs / QUANTITY_SCALE)}.${String(abs % QUANTITY_SCALE).padStart(3, '0')}`;
  return new Intl.NumberFormat(SEPARATORS[locale].intl, { maximumFractionDigits: 3 }).format(decimal as `${number}`);
}

/**
 * Reads a decimal number with at most `decimals` places as an integer scaled by 10^decimals: "1.234,5" → 123450
 * for two places (de). Group separators are optional, but when present every group after the first has three digits.
 */
function parseScaled(text: string, locale: MoneyLocale, decimals: number): number | null {
  const { decimal, group } = SEPARATORS[locale];
  const match = /^([+-]?)(\d+(?:[.,]\d+)*)$/.exec(text);
  if (!match) return null;
  const [, sign = '', body = ''] = match;
  const decimalAt = body.lastIndexOf(decimal);
  const intPart = decimalAt >= 0 ? body.slice(0, decimalAt) : body;
  const fraction = decimalAt >= 0 ? body.slice(decimalAt + 1) : '';
  if (fraction.length === 0 && decimalAt >= 0) return null;
  if (fraction.length > decimals || /\D/.test(fraction)) return null;
  const groups = intPart.split(group);
  if (groups.some((g) => /\D/.test(g) || g === '')) return null;
  if (groups.length > 1 && groups.slice(1).some((g) => g.length !== 3)) return null;
  if (groups.length > 1 && (groups[0]?.length ?? 0) > 3) return null;
  const value = Number(groups.join('') + fraction.padEnd(decimals, '0'));
  if (!Number.isSafeInteger(value)) return null;
  return sign === '-' ? -value : value;
}

/**
 * Reads an amount typed by a person: "1.234,56", "1234,5", "-12", "12,00 €" (de) or "1,234.56" (en).
 * At most two decimal places. Returns null for anything else.
 */
export function parseCents(input: string, locale: MoneyLocale): Cents | null {
  const value = parseScaled(input.replace(/\s|€/g, '').replace(/^EUR|EUR$/i, ''), locale, 2);
  return value === null ? null : cents(value);
}

/** A rate as a person types it in a field, without the % sign: 750 → "7,5" (de), 1000 → "10", 1225 → "12,25". `parsePercent` reads it back. */
export function formatPercent(rate: BasisPoints, locale: MoneyLocale): string {
  const decimal = `${Math.trunc(rate / 100)}.${String(rate % 100).padStart(2, '0')}`;
  return new Intl.NumberFormat(SEPARATORS[locale].intl, { maximumFractionDigits: 2 }).format(decimal as `${number}`);
}

/**
 * Reads a percentage typed by a person: "7,5", "10", "12,25 %" (de) or "7.5" (en). At most two decimal places, as
 * basis points: "7,5" → 750. Returns null for anything else and for a negative value.
 */
export function parsePercent(input: string, locale: MoneyLocale): BasisPoints | null {
  const value = parseScaled(input.replace(/\s|%/g, ''), locale, 2);
  return value === null || value < 0 ? null : basisPoints(value);
}

/** Reads a quantity typed by a person: "2", "1,5", "0,25", "1.000" (de) or "1.5" (en). At most three decimal places. */
export function parseQuantity(input: string, locale: MoneyLocale): Quantity | null {
  const value = parseScaled(input.replace(/\s/g, ''), locale, 3);
  return value === null ? null : quantity(value);
}
