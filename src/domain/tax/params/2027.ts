// Tax parameters for 2027.

import type { TaxYearParams } from './types';

export const PARAMS_2027: TaxYearParams = {
  year: 2027,
  tradeTax: {
    // § 16 Abs. 4 Satz 2 GewStG as amended by Article 7 of the law of 29 June 2026 (BGBl. 2026 I Nr. 197): 280 %, for
    // the first time for the Erhebungszeitraum 2027 (§ 36 Abs. 5b GewStG). A municipality with a lower multiplier
    // levies 280 % without a decision of its own. https://www.gesetze-im-internet.de/gewstg/__16.html
    minMultiplierPercent: 280,
  },
};
