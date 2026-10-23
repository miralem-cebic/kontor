// Tax parameters for 2026.

import type { TaxYearParams } from './types';

export const PARAMS_2026: TaxYearParams = {
  year: 2026,
  tradeTax: {
    // § 16 Abs. 4 Satz 2 GewStG in the version that applies up to the Erhebungszeitraum 2026: 200 %.
    // https://www.gesetze-im-internet.de/gewstg/__16.html (§ 36 Abs. 5b GewStG for the change in 2027)
    minMultiplierPercent: 200,
  },
};
