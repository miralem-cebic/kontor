// Scenario 6: the limits of the small business scheme (#37).
//
// § 19 Abs. 1 Satz 1 UStG (https://www.gesetze-im-internet.de/ustg_1980/__19.html, version in force since 1 January 2025):
// the turnover is tax-free "wenn der Gesamtumsatz nach Absatz 2 im vorangegangenen Kalenderjahr 25 000 Euro nicht überschritten
// hat und im laufenden Kalenderjahr 100 000 Euro nicht überschreitet". "Nicht überschritten" means that exactly 25,000.00 € is
// still inside, 25,000.01 € is outside. The same holds for 100,000.00 €.
//
// What kontor compares today is only the two thresholds (`smallBusinessLimitState`). Two things are NOT covered by the data
// kontor has today and are listed as pending scenarios, not tested here:
// - Gesamtumsatz (§ 19 Abs. 2 Satz 1) is "nach vereinnahmten Entgelten" (what was received) and counts only "steuerbare Umsätze
//   im Sinne des § 1 Absatz 1 Nummer 1", so a service with its place of supply abroad (not taxable in Germany) is not part of it.
//   The overview of kontor sums the net amounts of the invoices of the year by invoice date. See `pendingScenarios` (#36).
// - When the 100,000 € are crossed during the year: the law text says the exemption applies while the current year's turnover
//   "nicht überschreitet". That the regular VAT then applies from the supply that crosses the limit, not from the start of
//   the year, comes from the BMF letter on the reform of 2025 and was NOT verified here.

export interface LimitCase {
  title: string;
  year: number;
  /** The Gesamtumsatz of the previous and of the current year in cents */
  previous: number;
  current: number;
  previousAbove: boolean;
  currentAbove: boolean;
}

export const limitCases: LimitCase[] = [
  { title: '24,900.00 € in the previous year: inside', year: 2026, previous: 2_490_000, current: 0, previousAbove: false, currentAbove: false },
  { title: 'exactly 25,000.00 €: still not exceeded', year: 2026, previous: 2_500_000, current: 0, previousAbove: false, currentAbove: false },
  { title: '25,000.01 €: exceeded', year: 2026, previous: 2_500_001, current: 0, previousAbove: true, currentAbove: false },
  { title: 'exactly 100,000.00 € in the current year: still not exceeded', year: 2026, previous: 0, current: 10_000_000, previousAbove: false, currentAbove: false },
  { title: '100,000.01 € in the current year: exceeded', year: 2026, previous: 0, current: 10_000_001, previousAbove: false, currentAbove: true },
  { title: 'the same limits in 2027 (§ 19 Abs. 1 Satz 1 names no year)', year: 2027, previous: 2_500_001, current: 10_000_001, previousAbove: true, currentAbove: true },
];
