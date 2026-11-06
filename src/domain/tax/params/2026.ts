// Tax parameters for 2026.

import { cents } from '../../money';
import type { TaxYearParams } from './types';

export const PARAMS_2026: TaxYearParams = {
  year: 2026,
  // § 19 Abs. 1 Satz 1 UStG: the turnover of the previous year is at most 25,000 €, and of the current year it is expected
  // to be at most 100,000 €. https://www.gesetze-im-internet.de/ustg_1980/__19.html
  smallBusiness: { previousYearLimit: cents(2_500_000), currentYearLimit: cents(10_000_000) },
  tradeTax: {
    // § 16 Abs. 4 Satz 2 GewStG in the version that applies up to the Erhebungszeitraum 2026: 200 %.
    // https://www.gesetze-im-internet.de/gewstg/__16.html (§ 36 Abs. 5b GewStG for the change in 2027)
    minMultiplierPercent: 200,
  },
};
