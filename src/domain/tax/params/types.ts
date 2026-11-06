/** The values of one tax year that kontor needs. Each value names its source in the file of its year. */
import type { Cents } from '../../money';

export interface TaxYearParams {
  year: number;
  /** The turnover limits of the small business scheme (§ 19 Abs. 1 UStG), net turnover in cents */
  smallBusiness: {
    /** The turnover of the previous calendar year may not exceed this */
    previousYearLimit: Cents;
    /** The turnover of the current calendar year is expected not to exceed this */
    currentYearLimit: Cents;
  };
  tradeTax: {
    /** Lowest multiplier (Hebesatz) of the trade tax, in percent; a municipality may not set less (§ 16 Abs. 4 Satz 2 GewStG) */
    minMultiplierPercent: number;
  };
}
