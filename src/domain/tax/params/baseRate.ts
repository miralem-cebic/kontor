// Basiszinssatz nach § 247 BGB: the reference rate of the default interest (§ 288 BGB). It changes on 1 January and 1 July
// by the Deutsche Bundesbank's announcement and applies until the next one. Values in basis points (1 point = 0.01 %).
// Sources: https://www.gesetze-im-internet.de/bgb/__247.html and the Bundesbank announcements of
// 1 January 2024 (3,62 %), 1 July 2024 (3,37 %), 1 January 2025 (2,27 %), 1 July 2025 (1,27 %), 1 January 2026
// (1,27 %, unchanged) and 1 July 2026 (1,52 %): https://www.bundesbank.de/de/presse/pressemitteilungen
// The table has to be extended with every announcement (twice a year). A date before its first entry has no known rate.

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

/** The base rate that applies on a day, or null before the first published one */
export function baseRateOn(date: string): BasisPoints | null {
  let rate: BasisPoints | null = null;
  for (const step of BASE_RATES) if (step.from <= date) rate = step.rate;
  return rate;
}
