import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  basisPoints,
  cents,
  divideRounded,
  formatCents,
  lineNet,
  MoneyRangeError,
  parseCents,
  percentOf,
  quantity,
  splitGross,
  sum,
  taxTotals,
} from '../../src/domain/money';
import { fcParams as params } from './fixtures';

const amount = fc.integer({ min: -100_000_000, max: 100_000_000 }).map(cents);
const rate = fc.constantFrom(0, 700, 1900).map(basisPoints);

describe('integer types', () => {
  it('accept only safe integers', () => {
    expect(() => cents(1.5)).toThrow(MoneyRangeError);
    expect(() => cents(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyRangeError);
    expect(() => basisPoints(-1)).toThrow(MoneyRangeError);
    expect(() => quantity(0.1)).toThrow(MoneyRangeError);
  });
});

describe('rounding (half away from zero)', () => {
  it.each([
    [5n, 10n, 1n],
    [4n, 10n, 0n],
    [15n, 10n, 2n],
    [-5n, 10n, -1n],
    [-15n, 10n, -2n],
    [-4n, 10n, 0n],
  ])('%s / %s = %s', (n, d, q) => expect(divideRounded(n, d)).toBe(q));

  it('19 % of 0,05 € is 0,01 € (0,0095 rounds up)', () => expect(percentOf(cents(5), basisPoints(1900))).toBe(1));
  it('19 % of 0,02 € is 0,00 € (0,0038 rounds down)', () => expect(percentOf(cents(2), basisPoints(1900))).toBe(0));
  it('7 % of 1,50 € is 0,11 € (0,105 rounds half up)', () => expect(percentOf(cents(150), basisPoints(700))).toBe(11));
  it('negative amounts round symmetrically', () => expect(percentOf(cents(-150), basisPoints(700))).toBe(-11));

  it('is symmetric for negative numerators', () =>
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), fc.bigInt({ min: 1n, max: 10n ** 6n }), (n, d) => divideRounded(-n, d) === -divideRounded(n, d)),
      params,
    ));

  it('is never off by more than half', () =>
    fc.assert(
      fc.property(amount, fc.integer({ min: 0, max: 100_000 }).map(basisPoints), (a, r) => {
        const exact = a * r; // fits: |a| ≤ 1e8, r ≤ 1e5
        return Math.abs(percentOf(a, r) * 10_000 - exact) <= 5_000;
      }),
      params,
    ));
});

describe('line net', () => {
  it('1,5 h × 80,00 € = 120,00 €', () => expect(lineNet(cents(8000), quantity(1500))).toBe(12000));
  it('0,333 × 10,00 € = 3,33 €', () => expect(lineNet(cents(1000), quantity(333))).toBe(333));
  it('3 × 0,335 € = 1,005 → 1,01 €', () => expect(lineNet(cents(67), quantity(1500))).toBe(101));
});

describe('splitGross', () => {
  it('119,00 € at 19 % = 100,00 € + 19,00 €', () => expect(splitGross(cents(11900), basisPoints(1900))).toEqual({ net: 10000, tax: 1900 }));
  it('net and tax always add up to the gross amount', () =>
    fc.assert(
      fc.property(amount, rate, (g, r) => {
        const { net, tax } = splitGross(g, r);
        return net + tax === g;
      }),
      params,
    ));
});

describe('taxTotals', () => {
  const lines = [
    { net: cents(1), rate: basisPoints(1900) },
    { net: cents(1), rate: basisPoints(1900) },
    { net: cents(1), rate: basisPoints(1900) },
  ];

  it('per document: tax once per rate (3 × 0,01 € → 0,03 € × 19 % = 0,01 €)', () => {
    const t = taxTotals(lines, 'perDocument');
    expect(t).toMatchObject({ net: 3, tax: 1, gross: 4 });
  });

  it('per line: every line rounded (3 × 0,0019 € → 0,00 €)', () => {
    expect(taxTotals(lines, 'perLine')).toMatchObject({ net: 3, tax: 0, gross: 3 });
  });

  it('groups by rate, ascending', () => {
    const t = taxTotals([
      { net: cents(10000), rate: basisPoints(1900) },
      { net: cents(5000), rate: basisPoints(700) },
      { net: cents(2000), rate: basisPoints(0) },
      { net: cents(10000), rate: basisPoints(1900) },
    ]);
    expect(t.byRate).toEqual([
      { rate: 0, net: 2000, tax: 0 },
      { rate: 700, net: 5000, tax: 350 },
      { rate: 1900, net: 20000, tax: 3800 },
    ]);
    expect(t.gross).toBe(31150);
  });

  const lineList = fc.array(fc.record({ net: amount, rate }), { maxLength: 40 });

  it('gross = net + tax and net = sum of lines, in both modes', () =>
    fc.assert(
      fc.property(lineList, fc.constantFrom('perDocument' as const, 'perLine' as const), (ls, mode) => {
        const t = taxTotals(ls, mode);
        return t.gross === t.net + t.tax && t.net === sum(ls.map((l) => l.net)) && t.tax === sum(t.byRate.map((r) => r.tax));
      }),
      params,
    ));

  it('the two modes differ by at most half a cent per line', () =>
    fc.assert(
      fc.property(lineList, (ls) => Math.abs(taxTotals(ls, 'perDocument').tax - taxTotals(ls, 'perLine').tax) * 2 <= Math.max(ls.length, 1)),
      params,
    ));

  it('does not depend on the order of the lines', () =>
    fc.assert(
      fc.property(lineList, (ls) => JSON.stringify(taxTotals(ls)) === JSON.stringify(taxTotals([...ls].reverse()))),
      params,
    ));
});

describe('text', () => {
  it('formats in German and English without float conversion', () => {
    expect(formatCents(cents(123456), 'de')).toBe('1.234,56 €');
    expect(formatCents(cents(-5), 'de')).toBe('-0,05 €');
    expect(formatCents(cents(123456), 'en')).toBe('€1,234.56');
    expect(formatCents(cents(900719925474099), 'de')).toBe('9.007.199.254.740,99 €');
  });

  it.each([
    ['1.234,56', 123456],
    ['1234,5', 123450],
    ['12', 1200],
    ['-0,99', -99],
    ['12,00 €', 1200],
    ['EUR 3,10', 310],
  ])('parses "%s" (de)', (input, expected) => expect(parseCents(input, 'de')).toBe(expected));

  it.each(['', '1,234', '1.5', '12,', ',5', '1.23.456', 'abc', '1e3', '12345.678,00'])('rejects "%s" (de)', (input) => expect(parseCents(input, 'de')).toBeNull());

  it('parses English input', () => {
    expect(parseCents('1,234.56', 'en')).toBe(123456);
    expect(parseCents('1.234,56', 'en')).toBeNull();
  });

  it('reads back what it formats', () =>
    fc.assert(
      fc.property(amount, fc.constantFrom('de' as const, 'en' as const), (a, locale) => parseCents(formatCents(a, locale), locale) === a),
      params,
    ));
});
