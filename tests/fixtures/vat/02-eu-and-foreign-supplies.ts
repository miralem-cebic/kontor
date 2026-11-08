// Scenario 2: supplies without German VAT, and where each of them goes on the advance return (#37).
//
// Which field takes which supply (the Kz numbers are those of src/domain/tax/params/2026.ts, which cites the form USt 1 A
// of the BMF; the wording of each field on the form is UNVERIFIED by this scenario, the sections of the law are):
// - Kz 41, intra-community supply: § 4 Nr. 1 Buchst. b and § 6a UStG; the base is declared separately, § 18b Satz 1 Nr. 1 UStG.
//   https://www.gesetze-im-internet.de/ustg_1980/__6a.html, https://www.gesetze-im-internet.de/ustg_1980/__18b.html
// - Kz 21, service to a business in another EU state, place of supply there (§ 3a Abs. 2 UStG), the recipient owes the
//   tax: § 18b Satz 1 Nr. 2 UStG. https://www.gesetze-im-internet.de/ustg_1980/__3a.html
// - Kz 45, other supplies not taxable in Germany (place of supply abroad, for example § 3a Abs. 2 for a customer outside the EU).
// - Kz 60, domestic supply where the customer owes the tax: § 13b Abs. 5 UStG. https://www.gesetze-im-internet.de/ustg_1980/__13b.html
// A supply that kontor cannot place (reverse charge, customer's country unknown or outside the EU) is not put in a field but
// reported as a notice, instead of guessing.

import type { VatScenario } from './helpers';
import { invoiceOf } from './helpers';

const Q3 = { year: 2026, kind: 'quarter', index: 3 } as const;

// 5,000.00 € of goods to a business in France with a VAT ID. § 6a Abs. 1 Nr. 2 Buchst. a: the buyer is a business in another member state.
const supplyFr = invoiceOf({ id: 'fr', date: '2026-08-10', treatment: 'intraCommunitySupply', country: 'FR' }, [{ net: 500_000 }]);
// 1,234.56 € of consulting for a business in Ireland: not taxable in Germany, the recipient owes the tax in Ireland (§ 3a Abs. 2, § 18b Satz 1 Nr. 2)
const serviceIe = invoiceOf({ id: 'ie', date: '2026-08-20', treatment: 'reverseCharge', country: 'IE' }, [{ net: 123_456 }]);
// 800.00 € of consulting for a business in the USA: place of supply abroad (§ 3a Abs. 2), no recipient's tax in the EU
const serviceUs = invoiceOf({ id: 'us', date: '2026-09-01', treatment: 'notTaxable', country: 'US' }, [{ net: 80_000 }]);
// 2,000.00 € where the German customer owes the tax (§ 13b Abs. 5)
const reverseDe = invoiceOf({ id: 'de-13b', date: '2026-09-15', treatment: 'reverseCharge', country: 'DE' }, [{ net: 200_000 }]);
// reverse charge to a customer outside the EU, and one without a country: kontor cannot place them
const reverseUs = invoiceOf({ id: 'us-rc', date: '2026-09-16', treatment: 'reverseCharge', country: 'US' }, [{ net: 30_000 }]);
const reverseNone = invoiceOf({ id: 'none-rc', date: '2026-09-17', treatment: 'reverseCharge', country: null }, [{ net: 10_000 }]);

export const scenarios: VatScenario[] = [
  {
    id: '02-eu-and-foreign-supplies',
    title: 'intra-community supply, EU service, place of supply abroad, § 13b domestic: Kz 41, 21, 45, 60',
    reasoning:
      'None of these invoices carries German VAT, so the prepayment (Kz 83) stays 0. The bases go to the whole-euro fields: 1,234.56 € is entered as 1,234 € in Kz 21. ' +
      'The two invoices kontor cannot place are reported with their sum (300.00 € + 100.00 €), not added to a field.',
    sources: [
      'https://www.gesetze-im-internet.de/ustg_1980/__18b.html (Satz 1 Nr. 1 and 2)',
      'https://www.gesetze-im-internet.de/ustg_1980/__6a.html',
      'https://www.gesetze-im-internet.de/ustg_1980/__3a.html (Abs. 2)',
      'https://www.gesetze-im-internet.de/ustg_1980/__13b.html (Abs. 5)',
    ],
    input: { period: Q3, method: 'accrual', permanentExtension: false, payments: [], expenses: [], invoices: [supplyFr, serviceIe, serviceUs, reverseDe, reverseUs, reverseNone] },
    expected: {
      intraCommunitySupply: { base: 500_000, shown: true },
      euServices: { base: 123_456, shown: true },
      otherNotTaxable: { base: 80_000, shown: true },
      reverseChargeSupplied: { base: 200_000, shown: true },
      taxable19: { base: 0, tax: 0 },
      remainingPrepayment: { tax: 0 },
    },
    notices: [{ code: 'supplyUnplaced', count: 2, amount: 40_000 }],
  },
];
