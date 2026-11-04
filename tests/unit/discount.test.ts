import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Checker } from '../../src/domain/check';
import { discountOff, documentDiscountPerRate, NO_DISCOUNT, readableDiscount, readDiscount, sameDiscount, type Discount } from '../../src/domain/discount';
import { basisPoints, cents, sum, type Cents } from '../../src/domain/money';
import { fcParams as params } from './fixtures';

const percent = (rate: number): Discount => ({ kind: 'percent', rate: basisPoints(rate) });
const amount = (value: number): Discount => ({ kind: 'amount', amount: cents(value) });
const nets = fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }).map(cents), { minLength: 1, maxLength: 4 });

describe('discountOff', () => {
  it('a percentage takes off that share of the amount, rounded like VAT', () => {
    expect(discountOff(cents(10000), percent(1000))).toBe(1000);
    expect(discountOff(cents(150), percent(700))).toBe(11);
  });

  it('a percentage of a deduction is symmetric: it takes off the same share of the negative amount', () => {
    expect(discountOff(cents(-150), percent(700))).toBe(-11);
  });

  it('an amount takes off that much, in the direction of the amount', () => {
    expect(discountOff(cents(10000), amount(1000))).toBe(1000);
    expect(discountOff(cents(-10000), amount(1000))).toBe(-1000);
  });

  it('no discount takes off nothing', () => expect(discountOff(cents(10000), NO_DISCOUNT)).toBe(0));
});

describe('documentDiscountPerRate', () => {
  it('a percentage applies to the net amount of every rate', () => {
    expect(documentDiscountPerRate([cents(30000), cents(106250)], percent(1000))).toEqual([3000, 10625]);
  });

  it('an amount is shared between the rates in proportion to their amounts', () => {
    expect(documentDiscountPerRate([cents(10000), cents(30000)], amount(1000))).toEqual([250, 750]);
  });

  it('the cents that are left over go to the largest remainders', () => {
    expect(documentDiscountPerRate([cents(1), cents(1), cents(1)], amount(10))).toEqual([4, 3, 3]);
  });

  it('no discount takes nothing from any rate', () => {
    expect(documentDiscountPerRate([cents(500), cents(-200)], NO_DISCOUNT)).toEqual([0, 0]);
  });

  it('the shares of an amount add up to the amount, in the direction of the total', () =>
    fc.assert(
      fc.property(nets, fc.integer({ min: 1, max: 1_000_000 }), (ns, a) => {
        const total = sum(ns);
        fc.pre(total !== 0 && a <= Math.abs(total));
        return sum(documentDiscountPerRate(ns, amount(a))) === (total < 0 ? -a : a);
      }),
      params,
    ));

  it('a cancellation takes off exactly what the invoice took off: the negated amounts get the negated shares', () =>
    fc.assert(
      fc.property(nets, fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 1, max: 1_000_000 }), (ns, rate, a) => {
        const total = sum(ns);
        fc.pre(total !== 0 && a <= Math.abs(total));
        const negated = ns.map((n) => cents(-n));
        const pct = documentDiscountPerRate(ns, percent(rate));
        const pctBack = documentDiscountPerRate(negated, percent(rate));
        const amt = documentDiscountPerRate(ns, amount(a));
        const amtBack = documentDiscountPerRate(negated, amount(a));
        return pctBack.every((d, i) => d === -(pct[i] ?? 0)) && amtBack.every((d, i) => d === -(amt[i] ?? 0));
      }),
      params,
    ));
});

describe('readableDiscount', () => {
  it('a percentage from 0,01 to 100 %', () => {
    expect(readableDiscount('percent', '7,5', 'de', null)).toEqual({ kind: 'percent', rate: 750 });
    expect(readableDiscount('percent', '100', 'de', null)).toEqual({ kind: 'percent', rate: 10000 });
    expect(readableDiscount('percent', '0', 'de', null)).toBeNull();
    expect(readableDiscount('percent', '100,01', 'de', null)).toBeNull();
    expect(readableDiscount('percent', 'abc', 'de', null)).toBeNull();
  });

  it('an amount is more than 0 and at most the amount it is taken from', () => {
    expect(readableDiscount('amount', '10,00', 'de', cents(1000))).toEqual({ kind: 'amount', amount: 1000 });
    expect(readableDiscount('amount', '10,01', 'de', cents(1000))).toBeNull();
    expect(readableDiscount('amount', '0', 'de', cents(1000))).toBeNull();
    expect(readableDiscount('amount', '-5', 'de', cents(1000))).toBeNull();
  });

  it('no discount needs no value', () => expect(readableDiscount('none', 'anything', 'de', null)).toEqual(NO_DISCOUNT));
});

describe('readDiscount', () => {
  const problems = (kind: 'none' | 'percent' | 'amount', value: string, limit: Cents | null) => {
    const c = new Checker<'d'>();
    readDiscount(c, 'd', kind, value, 'de', limit);
    return c.errors.map((e) => `${e.field}:${e.problem}`);
  };

  it('reports why a value is not a discount', () => {
    expect(problems('percent', 'abc', null)).toEqual(['d:percent']);
    expect(problems('percent', '0', null)).toEqual(['d:percent']);
    expect(problems('percent', '101', null)).toEqual(['d:percent']);
    expect(problems('amount', '', null)).toEqual(['d:required']);
    expect(problems('amount', 'abc', null)).toEqual(['d:price']);
    expect(problems('amount', '-5', null)).toEqual(['d:priceNegative']);
    expect(problems('amount', '0', null)).toEqual(['d:amountNotPositive']);
    expect(problems('amount', '20', cents(1000))).toEqual(['d:discountTooLarge']);
  });

  it('accepts a discount that fits', () => {
    expect(problems('amount', '10', cents(1000))).toEqual([]);
    expect(problems('percent', '10', null)).toEqual([]);
  });
});

describe('sameDiscount', () => {
  it('compares kind and value', () => {
    expect(sameDiscount(NO_DISCOUNT, NO_DISCOUNT)).toBe(true);
    expect(sameDiscount(percent(1000), percent(1000))).toBe(true);
    expect(sameDiscount(percent(1000), percent(500))).toBe(false);
    expect(sameDiscount(amount(1000), amount(1001))).toBe(false);
    expect(sameDiscount(amount(1000), percent(1000))).toBe(false);
    expect(sameDiscount(NO_DISCOUNT, percent(1000))).toBe(false);
  });
});
