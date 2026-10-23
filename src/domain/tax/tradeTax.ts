// Trade tax (Gewerbesteuer): the multiplier of the municipality and its legal minimum, which changes with the year.

import { KNOWN_TAX_YEARS, taxParams } from './params';

/** The lowest multiplier a municipality may set in the given year, in percent */
export const minMultiplierPercent = (year: number): number => taxParams(year).tradeTax.minMultiplierPercent;

/**
 * The lowest minimum of all known years. A company file may hold such a multiplier, entered in a year when it was
 * allowed, so the file is still read in a later year.
 */
export const LOWEST_MIN_MULTIPLIER_PERCENT = Math.min(...KNOWN_TAX_YEARS.map((p) => p.tradeTax.minMultiplierPercent));

/**
 * The first later year whose minimum is above the multiplier, or null. From that year on the municipality levies the
 * minimum instead, so the form says so while the lower multiplier still applies.
 */
export function upcomingMinimum(multiplierPercent: number, year: number): { year: number; percent: number } | null {
  const later = KNOWN_TAX_YEARS.find((p) => p.year > year && p.tradeTax.minMultiplierPercent > multiplierPercent);
  return later ? { year: later.year, percent: later.tradeTax.minMultiplierPercent } : null;
}
