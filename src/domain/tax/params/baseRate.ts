// Basiszinssatz nach § 247 BGB: the reference rate of the default interest (§ 288 BGB). It changes on 1 January and 1 July
// by the Deutsche Bundesbank's announcement and applies until the next one. Values in basis points (1 point = 0.01 %).
// Sources: https://www.gesetze-im-internet.de/bgb/__247.html and the Bundesbank announcements of
// 1 January 2024 (3,62 %), 1 July 2024 (3,37 %), 1 January 2025 (2,27 %), 1 July 2025 (1,27 %), 1 January 2026
// (1,27 %, unchanged) and 1 July 2026 (1,52 %): https://www.bundesbank.de/de/presse/pressemitteilungen
// Checked against the Bundesbank's table "Basiszinssatz" on 7 November 2026, which lists exactly these values and dates:
// https://www.bundesbank.de/de/bundesbank/organisation/agb-und-regelungen/basiszinssatz-607820
// The table has to be extended with every announcement (twice a year). A date before its first entry has no known rate,
// and neither has a date after the half year of the last entry (baseRatesKnownUntil): a rate is never carried on past
// the half year it was announced for, so a missing announcement shows up as "rate unknown" instead of a wrong amount.

import { basisPoints, type BasisPoints } from '../../money';

export interface BaseRateStep {
  /** The first day this rate applies (YYYY-MM-DD) */
  from: string;
  rate: BasisPoints;
}

export const BASE_RATES: readonly BaseRateStep[] = [
  { from: '2024-01-01', rate: basisPoints(362) },
  { from: '2024-07-01', rate: basisPoints(337) },
  { from: '2025-01-01', rate: basisPoints(227) },
  { from: '2025-07-01', rate: basisPoints(127) },
  { from: '2026-01-01', rate: basisPoints(127) },
  { from: '2026-07-01', rate: basisPoints(152) },
];

/**
 * The last day the table knows a rate for: the end of the half year of its last entry (30 June or 31 December). The
 * next announcement is made for the day after; until the table has it, the rate of that day is unknown.
 */
export function baseRatesKnownUntil(): string {
  const last = BASE_RATES[BASE_RATES.length - 1];
  if (!last) throw new Error('The base rate table is empty');
  const year = last.from.slice(0, 4);
  switch (last.from.slice(5)) {
    case '01-01':
      return `${year}-06-30`;
    case '07-01':
      return `${year}-12-31`;
    default:
      throw new Error(`A base rate starts on 1 January or 1 July, not on ${last.from}`);
  }
}

/** The base rate that applies on a day, or null before the first published one and after the half year of the last one */
export function baseRateOn(date: string): BasisPoints | null {
  if (date > baseRatesKnownUntil()) return null;
  let rate: BasisPoints | null = null;
  for (const step of BASE_RATES) if (step.from <= date) rate = step.rate;
  return rate;
}
