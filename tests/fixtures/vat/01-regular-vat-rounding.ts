// Scenario 1: regular VAT at 19 % and 7 %, where the rounding of the cent matters (#37).
//
// The law fixes the rate, not the rounding: "Die Steuer beträgt für jeden steuerpflichtigen Umsatz 19 Prozent der
// Bemessungsgrundlage" (§ 12 Abs. 1 UStG, https://www.gesetze-im-internet.de/ustg_1980/__12.html), and the invoice shows
// "den auf das Entgelt entfallenden Steuerbetrag" (§ 14 Abs. 4 Satz 1 Nr. 8 UStG, https://www.gesetze-im-internet.de/ustg_1980/__14.html).
// UNVERIFIED: no paragraph of the UStG tells how to round a fraction of a cent. kontor rounds half away from zero, once
// per rate and document (ADR 0003, docs/adr/0003-money-as-integer-cents.md; EN 16931 BR-CO-17). A tax advisor should
// confirm this if a cent ever decides a case.
//
// Accrual basis (Sollversteuerung): the tax arises at the end of the period in which the service was performed,
// § 13 Abs. 1 Nr. 1 Buchst. a UStG, https://www.gesetze-im-internet.de/ustg_1980/__13.html. All bookings are in October 2026.

import type { VatScenario } from './helpers';
import { R7, domesticExpense, invoiceOf } from './helpers';

const base = { method: 'accrual', permanentExtension: false, payments: [] } as const;
const OCT = { year: 2026, kind: 'month', index: 10 } as const;
const NOV = { year: 2026, kind: 'month', index: 11 } as const;

// 1,000.50 € at 19 % = 190.095 € exactly: the half cent goes up, 190.10 €
const a = invoiceOf({ id: 'a', date: '2026-10-05' }, [{ net: 100_050 }]);
// 0.50 € at 19 % = 0.095 €: 0.10 €
const b = invoiceOf({ id: 'b', date: '2026-10-06' }, [{ net: 50 }]);
// two lines of 10.00 € and 0.50 €: one document of 10.50 € net, 10.50 € × 19 % = 1.995 €: 2.00 €
const c = invoiceOf({ id: 'c', date: '2026-10-07' }, [{ net: 1_000 }, { net: 50 }]);
// two lines of 0.03 €: per document 0.06 € × 19 % = 0.0114 € -> 0.01 € (per line it would be 0.0057 € -> 0.01 € twice = 0.02 €)
const d = invoiceOf({ id: 'd', date: '2026-10-08' }, [{ net: 3 }, { net: 3 }]);
// 150.00 € at 7 % = 10.50 €
const e = invoiceOf({ id: 'e', date: '2026-10-09' }, [{ net: 15_000, rate: R7 }]);
// 0.50 € at 7 % = 0.035 €: 0.04 €
const f = invoiceOf({ id: 'f', date: '2026-10-10' }, [{ net: 50, rate: R7 }]);
// 0.07 € at 7 % = 0.0049 €: 0.00 €
const g = invoiceOf({ id: 'g', date: '2026-10-11' }, [{ net: 7, rate: R7 }]);

export const scenarios: VatScenario[] = [
  {
    id: '01-regular-vat-rounding',
    title: 'regular VAT: 19 % and 7 % invoices with half cents, input tax, remaining prepayment',
    reasoning:
      'Each invoice is rounded on its own (the tax on an invoice is what the customer is shown, § 14 Abs. 4 Satz 1 Nr. 8 UStG), then the invoices are added. ' +
      'The exact sum of the 19 % bases would give 192.20 € (101,156 cents × 19 % = 19,219.64 cents), the sum of the invoices gives 192.21 €: the cents come from the invoices. ' +
      'ELSTER works out the tax of Kz 81 and 86 itself from the whole-euro base (UNVERIFIED here, stated in the interface of kontor); the figure below is the invoiced tax.',
    sources: [
      'https://www.gesetze-im-internet.de/ustg_1980/__12.html (§ 12 Abs. 1 and 2)',
      'https://www.gesetze-im-internet.de/ustg_1980/__14.html (§ 14 Abs. 4 Satz 1 Nr. 8)',
      'https://www.gesetze-im-internet.de/ustg_1980/__13.html (§ 13 Abs. 1 Nr. 1 Buchst. a)',
      'https://www.gesetze-im-internet.de/ustg_1980/__15.html (§ 15 Abs. 1 Satz 1 Nr. 1)',
    ],
    input: { ...base, period: OCT, invoices: [a, b, c, d, e, f, g], expenses: [domesticExpense('2026-10-20', 11_900, 1_900)] },
    expected: {
      // Net: 100,050 + 50 + 1,050 + 6 = 101,156 cents. The form takes 1,011 € (cents dropped, towards zero).
      // Tax: 19,010 (a) + 10 (b) + 200 (c) + 1 (d) = 19,221 cents.
      // Kz numbers as in src/domain/tax/params/2026.ts (form USt 1 A). UNVERIFIED by this scenario: the wording of each Kz on the form.
      taxable19: { base: 101_156, tax: 19_221, shown: true },
      // Net: 15,000 + 50 + 7 = 15,057 cents. Tax: 1,050 (e) + 4 (f) + 0 (g) = 1,054 cents.
      taxable7: { base: 15_057, tax: 1_054, shown: true },
      // Input tax: § 15 Abs. 1 Satz 1 Nr. 1 UStG, the VAT of a domestic expense of 119.00 € at 19 %.
      inputTax: { tax: 1_900, shown: true },
      // Remaining prepayment: 19,221 + 1,054 - 1,900 = 18,375 cents (§ 16 Abs. 2 UStG, https://www.gesetze-im-internet.de/ustg_1980/__16.html).
      remainingPrepayment: { tax: 18_375, shown: true },
    },
    dueDate: '2026-11-10',
  },
  {
    id: '01-cancellation-rounds-symmetric',
    title: 'a cancellation of a half-cent invoice takes back exactly the tax of the invoice',
    reasoning:
      'The cancellation of invoice a (1,000.50 € net, 190.10 € VAT) counts on its own date, negative (§ 17 Abs. 1 UStG: the tax is corrected for the period of the change). ' +
      'Half away from zero makes -190.095 € round to -190.10 €, so invoice and cancellation add up to zero over the two months.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__17.html (§ 17 Abs. 1 Satz 1 and 7)', 'docs/adr/0003-money-as-integer-cents.md'],
    input: { ...base, period: NOV, invoices: [a, invoiceOf({ id: 'a-cancel', date: '2026-11-02', cancellation: true }, [{ net: 100_050 }])], expenses: [] },
    expected: {
      // -100,050 cents net: the form takes -1,000 € (towards zero); -19,010 cents tax
      taxable19: { base: -100_050, tax: -19_010 },
      remainingPrepayment: { tax: -19_010 },
    },
  },
];
