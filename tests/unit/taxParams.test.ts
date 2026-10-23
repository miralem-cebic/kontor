import { describe, expect, it } from 'vitest';
import { KNOWN_TAX_YEARS, taxParams } from '../../src/domain/tax/params';
import { LOWEST_MIN_MULTIPLIER_PERCENT, minMultiplierPercent, upcomingMinimum } from '../../src/domain/tax/tradeTax';

describe('tax parameters per year', () => {
  it('the known years are in order and complete', () => {
    const years = KNOWN_TAX_YEARS.map((p) => p.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    years.forEach((y, i) => i > 0 && expect(y).toBe(years[i - 1]! + 1));
  });

  it('an earlier year gets the first known year, a later one the last known year', () => {
    expect(taxParams(2020).year).toBe(2026);
    expect(taxParams(2026).year).toBe(2026);
    expect(taxParams(2027).year).toBe(2027);
    expect(taxParams(2035).year).toBe(2027);
  });
});

describe('minimum trade tax multiplier (§ 16 Abs. 4 Satz 2 GewStG)', () => {
  it('200 % up to 2026, 280 % from the Erhebungszeitraum 2027', () => {
    expect([2025, 2026, 2027, 2028].map(minMultiplierPercent)).toEqual([200, 200, 280, 280]);
  });

  it('files may hold the lowest minimum of all years', () => {
    expect(LOWEST_MIN_MULTIPLIER_PERCENT).toBe(200);
  });

  it('a multiplier allowed now but below a later minimum: the year from which the minimum applies', () => {
    // a municipality with 250 % in 2026 levies 280 % from 2027
    expect(upcomingMinimum(250, 2026)).toEqual({ year: 2027, percent: 280 });
    expect(upcomingMinimum(280, 2026)).toBeNull();
    expect(upcomingMinimum(400, 2026)).toBeNull();
    expect(upcomingMinimum(250, 2027)).toBeNull();
  });
});
