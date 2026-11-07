import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { baseRateOn, baseRatesKnownUntil, BASE_RATES } from '../../src/domain/tax/params/baseRate';
import { cents } from '../../src/domain/money';
import { claimTotal, interestOn, nextLevel, planDunning, type DunningFacts, type PriorDunning } from '../../src/domain/dunning';
import { fcParams as params } from './fixtures';

// Base rate (§ 247 BGB) as published by the Deutsche Bundesbank; the values are in basis points (hundredths of a percent).
describe('base rate (§ 247 BGB)', () => {
  it.each([
    ['2023-12-31', null],
    ['2024-01-01', 362],
    ['2024-06-30', 362],
    ['2024-07-01', 337],
    ['2025-01-01', 227],
    ['2025-06-30', 227],
    ['2025-07-01', 127],
    ['2026-01-01', 127],
    ['2026-06-30', 127],
    ['2026-07-01', 152],
    ['2026-12-31', 152],
    // the table ends with the half year of its last announcement: later days have no known rate
    ['2027-01-01', null],
    ['2030-01-01', null],
  ])('on %s the rate is %s basis points', (date, rate) => {
    expect(baseRateOn(date) ?? null).toBe(rate);
  });
});

describe('the end of the base rate table', () => {
  it('is the last day of the half year of the last known rate, derived from the table so that it cannot be forgotten', () => {
    expect(BASE_RATES[BASE_RATES.length - 1]?.from).toBe('2026-07-01');
    expect(baseRatesKnownUntil()).toBe('2026-12-31');
  });

  it('interest over days after it is not stated: no stale rate is carried on', () => {
    expect(interestOn(cents(100_000), '2026-12-31', '2026-12-31', 900)).toEqual({ amount: 29, days: 1 });
    expect(interestOn(cents(100_000), '2026-12-31', '2027-01-01', 900)).toBeNull();
    expect(interestOn(cents(100_000), '2027-02-01', '2027-02-10', 900)).toBeNull();
  });
});

describe('interest on an open amount', () => {
  it('one period: 1000 € at 10.27 % (base rate 1.27 % plus 9 points) for 30 days', () => {
    // 100000 × 1027 × 30 / (10000 × 365) = 844.1 → 844 cents
    expect(interestOn(cents(100_000), '2026-01-02', '2026-01-31', 900)).toEqual({ amount: 844, days: 30 });
  });

  it('across the change of the base rate on 1 July 2026: each part at its own rate, rounded once per part', () => {
    // 30 June at 10.27 % (1 day): 28.14 → 28; 1 and 2 July at 10.52 % (2 days): 57.64 → 58
    expect(interestOn(cents(100_000), '2026-06-30', '2026-07-02', 900)).toEqual({ amount: 86, days: 3 });
  });

  it('nothing accrues for an empty range, and no rate is needed for it', () => {
    expect(interestOn(cents(100_000), '2026-07-02', '2026-07-01', 900)).toEqual({ amount: 0, days: 0 });
  });

  it('a period before the first published base rate has no interest we can state: null', () => {
    expect(interestOn(cents(100_000), '2023-12-30', '2024-01-02', 900)).toBeNull();
  });

  it('the interest is the same whichever way a period is split in two (property within the table, up to the rounding of the parts)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 0, max: 600 }),
        fc.integer({ min: 2, max: 490 }),
        fc.integer({ min: 0, max: 488 }),
        (open, startOffset, length, splitAt) => {
          const start = new Date(Date.UTC(2024, 0, 1) + startOffset * 86_400_000).toISOString().slice(0, 10);
          const endMs = Date.UTC(2024, 0, 1) + (startOffset + length - 1) * 86_400_000;
          const end = new Date(endMs).toISOString().slice(0, 10);
          const mid = new Date(Date.UTC(2024, 0, 1) + (startOffset + Math.min(splitAt, length - 2)) * 86_400_000).toISOString().slice(0, 10);
          const after = new Date(Date.UTC(2024, 0, 1) + (startOffset + Math.min(splitAt, length - 2) + 1) * 86_400_000).toISOString().slice(0, 10);
          const whole = interestOn(cents(open), start, end, 900);
          const first = interestOn(cents(open), start, mid, 900);
          const second = interestOn(cents(open), after, end, 900);
          expect(whole && first && second).toBeTruthy();
          if (whole && first && second) {
            expect(Math.abs(whole.amount - (first.amount + second.amount))).toBeLessThanOrEqual(8);
            expect(whole.days).toBe(first.days + second.days);
          }
        },
      ),
      params,
    );
  });
});

const facts = (over: Partial<DunningFacts> = {}): DunningFacts => ({
  open: cents(100_000),
  due: '2026-10-15',
  date: '2026-10-20',
  today: '2026-10-20',
  debtor: 'business',
  cancelled: false,
  prior: [],
  ...over,
});

describe('dunning levels', () => {
  it('the first dunning is the payment reminder, then level 1, 2 and 3; there is no level after 3', () => {
    expect(nextLevel([])).toBe('reminder');
    const after = (level: PriorDunning['level']): PriorDunning => ({ level, date: '2026-10-20', flatFee: cents(0) });
    expect(nextLevel([after('reminder')])).toBe('level1');
    expect(nextLevel([after('reminder'), after('level1')])).toBe('level2');
    expect(nextLevel([after('reminder'), after('level1'), after('level2')])).toBe('level3');
    expect(nextLevel([after('reminder'), after('level1'), after('level2'), after('level3')])).toBeNull();
  });
});

describe('planning a dunning', () => {
  it('a business customer: the interest of the days after the due date, and the flat fee of 40 € once', () => {
    // 1000 € from 16 to 20 October 2026 at 10.52 % (base rate 1.52 % plus 9 points): 144.1 → 144 cents
    expect(planDunning(facts())).toEqual({
      ok: true,
      value: { level: 'reminder', interestFrom: '2026-10-16', interest: 144, flatFee: 4_000 },
    });
  });

  it('a consumer: no interest before the reminder itself, and no flat fee', () => {
    expect(planDunning(facts({ debtor: 'consumer' }))).toEqual({
      ok: true,
      value: { level: 'reminder', interestFrom: '2026-10-21', interest: 0, flatFee: 0 },
    });
  });

  it('the next dunning counts the interest from the day after the last one, and the flat fee is not charged again', () => {
    const prior: PriorDunning[] = [{ level: 'reminder', date: '2026-10-20', flatFee: cents(4_000) }];
    // 21 to 27 October at 10.52 %: 7 days, 201.75 → 202 cents
    expect(planDunning(facts({ date: '2026-10-27', today: '2026-10-27', prior }))).toEqual({
      ok: true,
      value: { level: 'level1', interestFrom: '2026-10-21', interest: 202, flatFee: 0 },
    });
  });

  it('it is refused with every reason at once: a cancelled or paid invoice, a date not overdue, before the last dunning or in the future', () => {
    expect(planDunning(facts({ cancelled: true, open: cents(0) }))).toEqual({ ok: false, error: ['cancelled', 'notOpen'] });
    expect(planDunning(facts({ date: '2026-10-15' }))).toEqual({ ok: false, error: ['notOverdue'] });
    expect(planDunning(facts({ date: '2026-10-25', today: '2026-10-24' }))).toEqual({ ok: false, error: ['dateInFuture'] });
    const prior: PriorDunning[] = [{ level: 'reminder', date: '2026-10-22', flatFee: cents(4_000) }];
    expect(planDunning(facts({ date: '2026-10-20', prior }))).toEqual({ ok: false, error: ['dateBeforePrevious'] });
  });

  it('after level 3 no further dunning is planned', () => {
    const prior: PriorDunning[] = [
      { level: 'reminder', date: '2026-10-20', flatFee: cents(4_000) },
      { level: 'level1', date: '2026-10-25', flatFee: cents(0) },
      { level: 'level2', date: '2026-10-30', flatFee: cents(0) },
      { level: 'level3', date: '2026-11-05', flatFee: cents(0) },
    ];
    expect(planDunning(facts({ date: '2026-11-10', today: '2026-11-10', prior }))).toEqual({ ok: false, error: ['noNextLevel'] });
  });

  it('a period without a known base rate is refused, so that no interest is stated that cannot be checked', () => {
    expect(planDunning(facts({ due: '2023-12-01', date: '2023-12-20', today: '2023-12-20' }))).toEqual({ ok: false, error: ['rateUnknown'] });
  });
});

describe('a dunning after the last known base rate', () => {
  it('is refused with rateUnknown: an invoice due 2026-12-15 dunned on 2027-02-01', () => {
    expect(planDunning(facts({ due: '2026-12-15', date: '2027-02-01', today: '2027-02-01' }))).toEqual({ ok: false, error: ['rateUnknown'] });
  });

  it('is planned as long as every day of its interest has a known rate', () => {
    const plan = planDunning(facts({ due: '2026-12-15', date: '2026-12-31', today: '2026-12-31' }));
    expect(plan.ok).toBe(true);
  });
});

describe('the claim', () => {
  it('the open amount plus the interest, fees and flat fees of every dunning', () => {
    expect(
      claimTotal(cents(100_000), [
        { interest: cents(144), fee: cents(0), flatFee: cents(4_000) },
        { interest: cents(202), fee: cents(500), flatFee: cents(0) },
      ]),
    ).toBe(104_846);
  });

  it('without a dunning the claim is the open amount', () => {
    expect(claimTotal(cents(100_000), [])).toBe(100_000);
  });
});
