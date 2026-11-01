import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isIsoDate, isoDateOf, toLocalDate } from '../../src/domain/dates';
import { fcParams } from './fixtures';

describe('ISO dates', () => {
  it.each(['2026-10-22', '2024-02-29', '1900-01-01', '9999-12-31'])('accepts %s', (d) => expect(isIsoDate(d)).toBe(true));
  it.each(['2026-02-29', '2026-13-01', '2026-04-31', '26-10-22', '2026-1-5', '1899-12-31', '2026-10-22T00:00', ''])('rejects %s', (d) => expect(isIsoDate(d)).toBe(false));

  it('adds days across months, years and leap days', () => {
    expect(addDays('2026-10-22', 30)).toBe('2026-11-21');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('adding days is independent of the time zone and keeps the order of the text', () =>
    fc.assert(
      fc.property(fc.date({ min: new Date(1950, 0, 1), max: new Date(2090, 11, 31), noInvalidDate: true }), fc.integer({ min: 0, max: 400 }), (d, n) => {
        const iso = isoDateOf(d);
        const later = addDays(iso, n);
        return isIsoDate(later) && later >= iso && addDays(later, -n) === iso;
      }),
      fcParams,
    ));

  it('a local day survives the way through Date', () => {
    expect(isoDateOf(toLocalDate('2026-10-22'))).toBe('2026-10-22');
    expect(isoDateOf(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('days between dates', () => {
  it('counts the days from the first date to the second, negative when the second comes first', () => {
    expect(daysBetween('2026-10-22', '2026-10-22')).toBe(0);
    expect(daysBetween('2026-10-22', '2026-11-21')).toBe(30);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2026-11-21', '2026-10-22')).toBe(-30);
  });

  it('is the inverse of adding days (property)', () => {
    fc.assert(
      fc.property(fc.date({ min: new Date('1990-01-01T00:00:00Z'), max: new Date('2090-12-31T00:00:00Z'), noInvalidDate: true }), fc.integer({ min: -4000, max: 4000 }), (d, n) => {
        const iso = d.toISOString().slice(0, 10);
        expect(daysBetween(iso, addDays(iso, n))).toBe(n);
      }),
      fcParams,
    );
  });
});
