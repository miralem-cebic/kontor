// Tax parameters for 2027.

import { cents } from '../../money';
import type { TaxYearParams } from './types';

export const PARAMS_2027: TaxYearParams = {
  year: 2027,
  // § 19 Abs. 1 Satz 1 UStG, unchanged from 2026 (the limits of 2025 onward). https://www.gesetze-im-internet.de/ustg_1980/__19.html
  smallBusiness: { previousYearLimit: cents(2_500_000), currentYearLimit: cents(10_000_000) },
  tradeTax: {
    // § 16 Abs. 4 Satz 2 GewStG as amended by Article 7 of the law of 29 June 2026 (BGBl. 2026 I Nr. 197): 280 %, for
    // the first time for the Erhebungszeitraum 2027 (§ 36 Abs. 5b GewStG). A municipality with a lower multiplier
    // levies 280 % without a decision of its own. https://www.gesetze-im-internet.de/gewstg/__16.html
    minMultiplierPercent: 280,
  },
};
