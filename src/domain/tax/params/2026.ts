// Tax parameters for 2026.

import { cents } from '../../money';
import type { TaxYearParams } from './types';

export const PARAMS_2026: TaxYearParams = {
  year: 2026,
  // § 19 Abs. 1 Satz 1 UStG: the turnover of the previous year is at most 25,000 €, and of the current year it is expected
  // to be at most 100,000 €. https://www.gesetze-im-internet.de/ustg_1980/__19.html
  smallBusiness: { previousYearLimit: cents(2_500_000), currentYearLimit: cents(10_000_000) },
  vatReturn: {
    // § 18 Abs. 1 Satz 1 UStG: the return is due on the 10th day after the end of the period.
    // https://www.gesetze-im-internet.de/ustg_1980/__18.html
    dueDay: 10,
    // § 46 UStDV: the permanent extension (Dauerfristverlängerung) moves the date by one month; § 47 UStDV: for monthly
    // returns it comes with a special prepayment of 1/11 (Kz 39, not covered). https://www.gesetze-im-internet.de/ustdv_1980/__46.html
    extensionMonths: 1,
    // The form "USt 1 A" (Umsatzsteuer-Voranmeldung 2026, BMF-Schreiben of 29 December 2025) and its instructions "USt 1 E":
    // https://www.bundesfinanzministerium.de/Content/DE/Standardartikel/Themen/Steuern/Steuerarten/Umsatzsteuer/umsatzsteuer.html
    // Bases (Bemessungsgrundlagen) are entered in whole euros, taxes in euros and cents.
    kz: {
      taxable19: '81', // supplies and other services at 19 % (§ 12 Abs. 1 UStG)
      taxable7: '86', // the same at 7 % (§ 12 Abs. 2 UStG)
      intraCommunitySupply: '41', // § 4 Nr. 1 Buchst. b, § 6a UStG
      euServices: '21', // § 18b Satz 1 Nr. 2 UStG
      reverseChargeSupplied: '60', // § 13b Abs. 5 UStG
      otherNotTaxable: '45', // place of supply abroad (§§ 3a ff. UStG)
      inputTax: '66', // § 15 Abs. 1 Satz 1 Nr. 1 UStG
      remainingPrepayment: '83', // advance payment, calculated from the lines above
    },
  },
  tradeTax: {
    // § 16 Abs. 4 Satz 2 GewStG in the version that applies up to the Erhebungszeitraum 2026: 200 %.
    // https://www.gesetze-im-internet.de/gewstg/__16.html (§ 36 Abs. 5b GewStG for the change in 2027)
    minMultiplierPercent: 200,
  },
};
