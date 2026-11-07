import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cents } from '../../src/domain/money';
import {
  crossingDay,
  exemptionEnd,
  limitWarning,
  reverseChargeExpenseCount,
  smallBusinessRefusal,
  turnoverOfYear,
  WARNING_PERCENT,
  type TurnoverEntry,
} from '../../src/domain/smallBusiness';
import { taxParams } from '../../src/domain/tax/params';
import { fcParams } from './fixtures';

// § 19 Abs. 1 UStG: a domestic supply is exempt if the total turnover (Gesamtumsatz, Abs. 2) was at most 25,000 € in the
// previous year and is at most 100,000 € in the current year. The Gesamtumsatz is the sum of the taxable supplies
// "nach vereinnahmten Entgelten", so it is counted on the day the money arrived, net. The turnover that crosses the
// limit is already taxable (Abschnitt 19.1 Abs. 2 UStAE).

const LIMIT = cents(10_000_000);
const e = (date: string, amount: number): TurnoverEntry => ({ date, amount: cents(amount) });

describe('the turnover of a year (§ 19 Abs. 2 UStG)', () => {
  it('adds up the entries of the calendar year and leaves the other years out', () => {
    const entries = [e('2025-12-31', 500_000), e('2026-01-01', 100_000), e('2026-12-31', 250_000), e('2027-01-01', 900_000)];
    expect(turnoverOfYear(entries, 2026)).toBe(350_000);
    expect(turnoverOfYear(entries, 2025)).toBe(500_000);
    expect(turnoverOfYear([], 2026)).toBe(0);
  });
});

describe('the day the limit of the current year is crossed', () => {
  it('is the day of the entry that takes the sum of the year above 100,000 €, not the day it reaches it', () => {
    const upToLimit = [e('2026-03-01', 6_000_000), e('2026-05-10', 4_000_000)];
    expect(crossingDay(upToLimit, 2026, LIMIT)).toBeNull();
    expect(crossingDay([...upToLimit, e('2026-06-02', 1)], 2026, LIMIT)).toBe('2026-06-02');
  });

  it('does not depend on the order of the entries, and counts the entries of one day together', () => {
    const entries = [e('2026-06-02', 3_000_000), e('2026-03-01', 6_000_000), e('2026-06-02', 1_000_001), e('2026-09-01', 5_000_000)];
    expect(crossingDay(entries, 2026, LIMIT)).toBe('2026-06-02');
    expect(crossingDay([...entries].reverse(), 2026, LIMIT)).toBe('2026-06-02');
  });

  it('ignores the other years, so the turnover of the year before does not count', () => {
    expect(crossingDay([e('2025-12-30', 20_000_000), e('2026-02-01', 10_000)], 2026, LIMIT)).toBeNull();
    expect(crossingDay([e('2026-12-31', 20_000_000), e('2027-01-02', 10_000)], 2026, LIMIT)).toBe('2026-12-31');
  });

  it('stays the day of the crossing when later entries lower the sum again', () => {
    expect(crossingDay([e('2026-03-01', 10_000_100), e('2026-04-01', -500_000)], 2026, LIMIT)).toBe('2026-03-01');
  });

  it('property: the sum up to the day before is at most the limit and the sum up to the day is above it', () => {
    const entry = fc.record({ day: fc.integer({ min: 1, max: 28 }), month: fc.integer({ min: 1, max: 12 }), amount: fc.integer({ min: 0, max: 4_000_000 }) });
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 40 }), (rows) => {
        const entries = rows.map((r) => e(`2026-${String(r.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`, r.amount));
        const day = crossingDay(entries, 2026, LIMIT);
        const upTo = (before: boolean) => entries.filter((x) => (before ? x.date < (day ?? '') : x.date <= (day ?? ''))).reduce((s, x) => s + x.amount, 0);
        if (day === null) expect(turnoverOfYear(entries, 2026)).toBeLessThanOrEqual(LIMIT);
        else {
          expect(upTo(true)).toBeLessThanOrEqual(LIMIT);
          expect(upTo(false)).toBeGreaterThan(LIMIT);
        }
      }),
      fcParams,
    );
  });
});

describe('when the exemption ends', () => {
  it('previous year above 25,000 €: it does not apply in the whole current year', () => {
    expect(exemptionEnd([e('2025-06-01', 2_500_001)], 2026)).toEqual({ reason: 'previousYear', from: '2026-01-01' });
    expect(exemptionEnd([e('2025-06-01', 2_500_000)], 2026)).toBeNull();
  });

  it('the limit of the current year crossed: it ends on that day', () => {
    expect(exemptionEnd([e('2026-03-01', 10_000_001)], 2026)).toEqual({ reason: 'currentYear', from: '2026-03-01' });
    expect(exemptionEnd([e('2026-03-01', 10_000_000)], 2026)).toBeNull();
  });

  it('the previous year decides first', () => {
    expect(exemptionEnd([e('2025-06-01', 2_600_000), e('2026-03-01', 10_000_001)], 2026)?.reason).toBe('previousYear');
  });

  it('uses the limits of the tax parameters of the year', () => {
    expect(taxParams(2027).smallBusiness.currentYearLimit).toBe(LIMIT);
    expect(exemptionEnd([e('2027-02-01', 10_000_001)], 2027)).toEqual({ reason: 'currentYear', from: '2027-02-01' });
  });

  it('is not judged for a year before the first with known limits (earlier years had other limits)', () => {
    expect(exemptionEnd([e('2024-02-01', 90_000_000)], 2024)).toBeNull();
    expect(exemptionEnd([e('2024-02-01', 90_000_000)], 2025)).toBeNull();
  });
});

describe('the small business treatment of an invoice (refusal by invoice date)', () => {
  const crossed = [e('2026-03-01', 6_000_000), e('2026-06-02', 4_000_001)];

  it('refuses an invoice dated after the crossing', () => {
    expect(smallBusinessRefusal('2026-06-03', crossed)).toEqual({ reason: 'currentYear', from: '2026-06-02' });
    expect(smallBusinessRefusal('2026-12-31', crossed)).toEqual({ reason: 'currentYear', from: '2026-06-02' });
  });

  it('does not refuse an invoice dated on the day of the crossing or before it, also when it is issued late', () => {
    expect(smallBusinessRefusal('2026-06-02', crossed)).toBeNull();
    expect(smallBusinessRefusal('2026-06-01', crossed)).toBeNull();
    expect(smallBusinessRefusal('2026-01-15', crossed)).toBeNull();
  });

  it('does not refuse an invoice of an earlier year because of a crossing in a later one', () => {
    expect(smallBusinessRefusal('2025-12-31', crossed)).toBeNull();
  });

  it('refuses every invoice of the year after a crossing: the previous year is then above 25,000 €', () => {
    expect(smallBusinessRefusal('2027-01-02', crossed)).toEqual({ reason: 'previousYear', from: '2027-01-01' });
  });

  it('refuses nothing without turnover, and nothing for a year before the known limits', () => {
    expect(smallBusinessRefusal('2026-06-03', [])).toBeNull();
    expect(smallBusinessRefusal('2024-06-03', [e('2024-03-01', 90_000_000)])).toBeNull();
  });
});

describe('the warning on the overview', () => {
  it('stays quiet below the warning share of the limit and starts at it', () => {
    const share = (LIMIT * WARNING_PERCENT) / 100;
    expect(WARNING_PERCENT).toBe(80);
    expect(limitWarning([e('2026-03-01', share - 1)], 2026)).toBeNull();
    expect(limitWarning([e('2026-03-01', share)], 2026)).toEqual({ kind: 'close', percent: 80 });
  });

  it('says that the limit is crossed, and when', () => {
    expect(limitWarning([e('2026-03-01', 10_000_000), e('2026-04-01', 1)], 2026)).toEqual({ kind: 'crossed', day: '2026-04-01' });
  });

  it('says that the previous year was above 25,000 €, before anything else', () => {
    expect(limitWarning([e('2025-03-01', 2_500_001), e('2026-03-01', 9_000_000)], 2026)).toEqual({ kind: 'previousYear' });
  });
});

describe('expenses with reverse charge (§ 13b UStG) for a small business', () => {
  const x = (date: string, taxTreatment: 'domestic' | 'euReverseCharge' | 'thirdCountry' | 'noVat') => ({ date, taxTreatment });

  it('counts the expenses of the year from an EU supplier without VAT or a supplier outside the EU', () => {
    const expenses = [x('2026-02-01', 'euReverseCharge'), x('2026-03-01', 'thirdCountry'), x('2026-03-02', 'domestic'), x('2026-03-03', 'noVat'), x('2025-12-31', 'euReverseCharge')];
    expect(reverseChargeExpenseCount(expenses, 2026)).toBe(2);
    expect(reverseChargeExpenseCount(expenses, 2025)).toBe(1);
    expect(reverseChargeExpenseCount([], 2026)).toBe(0);
  });
});
