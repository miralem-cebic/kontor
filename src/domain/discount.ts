// Discounts (F23) of a line and of a whole quote or invoice. A discount takes off a percentage or an amount, and it
// always reduces the amount in absolute terms: on a deduction line (negative quantity) and on the cancellation of an
// invoice, whose quantities are negated, it lowers the negative amount. So a cancellation reverses the discounts of the
// invoice to the cent, without a special case. The discount of the whole document is shared between the tax rates
// (documentDiscountPerRate); the VAT is then rounded per rate as before (ADR 0003).

import { Checker } from './check';
import { BASIS_POINTS_PER_UNIT, allocate, cents, formatDecimal, formatPercent, negate, parseCents, parsePercent, percentOf, sum, type BasisPoints, type Cents, type MoneyLocale } from './money';

export type Discount = { kind: 'none' } | { kind: 'percent'; rate: BasisPoints } | { kind: 'amount'; amount: Cents };
export type DiscountKind = Discount['kind'];
export const DISCOUNT_KINDS: readonly DiscountKind[] = ['none', 'percent', 'amount'];

export const NO_DISCOUNT: Discount = { kind: 'none' };

/** The discount of a form: its kind, and the value as typed. Empty for no discount. */
export interface DiscountDraft {
  discountKind: DiscountKind;
  discountValue: string;
}
export const NO_DISCOUNT_DRAFT: DiscountDraft = { discountKind: 'none', discountValue: '' };

/** A percentage discount is at most 100 % */
const MAX_RATE = BASIS_POINTS_PER_UNIT;

/** A cent amount, never −0 (so that two totals compare equal) */
const signed = (sign: number, value: number): Cents => cents(sign * value + 0);

/** The amount taken off `net`: a percentage of it, rounded like VAT, or the amount, with the sign of `net` */
export function discountOff(net: Cents, d: Discount): Cents {
  switch (d.kind) {
    case 'none':
      return cents(0);
    case 'percent':
      return percentOf(net, d.rate);
    case 'amount':
      return net < 0 ? negate(d.amount) : d.amount;
  }
}

/**
 * The part of a whole document's discount that falls on each tax rate. `rates` are the net amounts per rate after the
 * discounts of the lines, in the order of the result. A percentage applies to every rate. An amount is shared in
 * proportion to the rates' amounts (`allocate`) and taken in the direction of the document's total, so the parts add
 * up to the amount. Negating every amount negates every part, which is what a cancellation needs.
 */
export function documentDiscountPerRate(rates: readonly Cents[], d: Discount): Cents[] {
  switch (d.kind) {
    case 'none':
      return rates.map(() => cents(0));
    case 'percent':
      return rates.map((net) => percentOf(net, d.rate));
    case 'amount': {
      const total = sum(rates);
      if (total === 0 || d.amount === 0) return rates.map(() => cents(0));
      const direction = total < 0 ? -1 : 1;
      const shares = allocate(
        d.amount,
        rates.map((net) => signed(direction, net)),
      );
      return shares.map((share) => signed(direction, share));
    }
  }
}

/**
 * Reads a discount typed in a form: its kind, and the value as typed (a percentage, or an amount in the interface
 * language). `limit` is the most it may take off, in cents: the amount of the line or of the document before the
 * discount, or null for no limit. Problems go to `field`; the result is only used when there are none.
 */
export function readDiscount<F extends string>(c: Checker<F>, field: F, kind: DiscountKind, value: string, locale: MoneyLocale, limit: Cents | null): Discount {
  if (kind === 'none') return NO_DISCOUNT;
  if (kind === 'percent') {
    const rate = parsePercent(value, locale);
    if (rate === null || rate === 0 || rate > MAX_RATE) {
      c.add(field, 'percent');
      return NO_DISCOUNT;
    }
    return { kind, rate };
  }
  if (!value.trim()) {
    c.add(field, 'required');
    return NO_DISCOUNT;
  }
  const amount = parseCents(value, locale);
  if (amount === null) {
    c.add(field, 'price');
    return NO_DISCOUNT;
  }
  if (amount < 0) {
    c.add(field, 'priceNegative');
    return NO_DISCOUNT;
  }
  if (amount === 0) {
    c.add(field, 'amountNotPositive');
    return NO_DISCOUNT;
  }
  if (limit !== null && amount > limit) {
    c.add(field, 'discountTooLarge');
    return NO_DISCOUNT;
  }
  return { kind, amount };
}

/** A discount typed in a form, or null while it cannot be read or does not fit: for the totals the editor shows as it is typed */
export function readableDiscount(kind: DiscountKind, value: string, locale: MoneyLocale, limit: Cents | null): Discount | null {
  const c = new Checker<'discount'>();
  const d = readDiscount(c, 'discount', kind, value, locale, limit);
  return c.errors.length > 0 ? null : d;
}

/** The form values of a discount: its kind, and the value as typed (empty for none) */
export function discountDraft(d: Discount, locale: MoneyLocale): DiscountDraft {
  switch (d.kind) {
    case 'none':
      return NO_DISCOUNT_DRAFT;
    case 'percent':
      return { discountKind: 'percent', discountValue: formatPercent(d.rate, locale) };
    case 'amount':
      return { discountKind: 'amount', discountValue: formatDecimal(d.amount, locale) };
  }
}

/** Do two discounts have the same kind and value? */
export function sameDiscount(a: Discount, b: Discount): boolean {
  if (a.kind === 'none' || b.kind === 'none') return a.kind === b.kind;
  if (a.kind === 'percent' && b.kind === 'percent') return a.rate === b.rate;
  if (a.kind === 'amount' && b.kind === 'amount') return a.amount === b.amount;
  return false;
}
