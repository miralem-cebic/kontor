/** The values of one tax year that kontor needs. Each value names its source in the file of its year. */
export interface TaxYearParams {
  year: number;
  tradeTax: {
    /** Lowest multiplier (Hebesatz) of the trade tax, in percent; a municipality may not set less (§ 16 Abs. 4 Satz 2 GewStG) */
    minMultiplierPercent: number;
  };
}
