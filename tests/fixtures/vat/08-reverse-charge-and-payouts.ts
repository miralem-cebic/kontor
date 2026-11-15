// Scenarios 11, 12, 14, 14b and 15 of #37, built with #34: expenses for which the recipient owes the tax (§ 13b UStG) and
// payouts without an own invoice. The field numbers and the rules on when the tax arises are from the official form
// "USt 1 A" 2026 and its instructions (tests/fixtures/vat/form-2026.ts); the law text was read at gesetze-im-internet.de
// and dejure.org on 15 November 2026. kontor gives no tax advice; what could not be verified is marked UNVERIFIED.

import type { VatScenario } from './helpers';
import { foreignExpense, invoiceOf, payoutRows } from './helpers';

const OCT = { year: 2026, kind: 'month', index: 10 } as const;
const SEP = { year: 2026, kind: 'month', index: 9 } as const;
const base = { method: 'accrual', permanentExtension: false } as const;
const none = { invoices: [], payments: [], expenses: [] } as const;

const euPayout = payoutRows({ id: 'p-eu', received: '2026-10-05', coveredEnd: '2026-09-30', amount: 123_456, treatment: 'reverseCharge', country: 'IE' });
const usPayout = payoutRows({ id: 'p-us', received: '2026-10-05', coveredEnd: '2026-09-30', amount: 123_456, treatment: 'notTaxable', country: 'US' });

export const scenarios: VatScenario[] = [
  {
    id: '11-regular-payout-eu',
    title: 'regular VAT: a payout of 1,234.56 € from a business in another EU state for September is a service not taxable in Germany: Kz 21 of September',
    reasoning:
      'The place of supply is where the recipient has its business (§ 3a Abs. 2 UStG), so the service is not taxable in Germany and the recipient owes the tax. The base goes to Kz 21 (line 35 of the form, § 18b Satz 1 Nr. 2) in the period of the performance (§ 18b Satz 3), ' +
      'here the month the payout covers, not the month the money arrived (October). The payout is the whole amount: no VAT inside.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__3a.html (Abs. 2)', 'https://www.gesetze-im-internet.de/ustg_1980/__18b.html (Satz 1 Nr. 2, Satz 3)', 'USt 1 A 2026, line 35'],
    input: { ...base, period: SEP, invoices: [euPayout.invoice], payments: [euPayout.payment], expenses: [] },
    expected: { euServices: { base: 123_456, shown: true }, taxable19: { base: 0 }, remainingPrepayment: { tax: 0 } },
  },
  {
    id: '11b-regular-payout-eu-month-received',
    title: 'the same payout is not in October, the month the money arrived',
    reasoning: 'See 11: § 18b Satz 3 UStG follows the performance, the instructions of the form for lines 35 say the same for payments on account ("im Voranmeldungszeitraum der Leistungsausführung").',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__18b.html (Satz 3)', 'USt 1 A 2026, instructions for line 35'],
    input: { ...base, period: OCT, invoices: [euPayout.invoice], payments: [euPayout.payment], expenses: [] },
    expected: { euServices: { base: 0 } },
  },
  {
    id: '12-non-eu-payout',
    title: 'regular VAT: a payout of 1,234.56 € from a business outside the EU for September: Kz 45 of September, no Kz 21',
    reasoning:
      'The place of supply is outside Germany (§ 3a Abs. 2 UStG): not taxable. It is no service for which a recipient in another member state owes the tax, so not Kz 21 (line 35) but "Übrige nicht steuerbare Umsätze (Leistungsort nicht im Inland)" in Kz 45 (line 36). ' +
      'Accrual basis: the month of the performance. UNVERIFIED: on the cash basis the code follows the payment for Kz 45, as it does for invoices (see src/domain/ustva.ts).',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__3a.html (Abs. 2)', 'USt 1 A 2026, line 36 and its instructions'],
    input: { ...base, period: SEP, invoices: [usPayout.invoice], payments: [usPayout.payment], expenses: [] },
    expected: { otherNotTaxable: { base: 123_456, shown: true }, euServices: { base: 0 }, remainingPrepayment: { tax: 0 } },
  },
  {
    id: '14-eu-reverse-charge-expense',
    title: 'regular VAT: a service from an EU supplier without VAT (99 € Developer Program): Kz 46/47 owed, Kz 67 deducted, net zero',
    reasoning:
      'For a service taxable in Germany under § 3a Abs. 2 UStG from a supplier in another EU state the recipient owes the tax (§ 13b Abs. 1 and Abs. 5 Satz 1). It arises at the end of the period of the performance (§ 13b Abs. 1; instructions for lines 30 to 32). ' +
      'The same tax is deductible (§ 15 Abs. 1 Satz 1 Nr. 4; line 41, Kz 67). 99.00 € at 19 % = 18.81 €: Kz 46 shows the base 99 €, Kz 47 the tax 18.81 €, Kz 67 the same 18.81 €, so line 37 and 41 cancel and the prepayment (Kz 83) is 0. ' +
      'The expense date stands for the day of the performance, because kontor stores only the day of the payment.',
    sources: [
      'https://www.gesetze-im-internet.de/ustg_1980/__13b.html (Abs. 1 and Abs. 5 Satz 1)',
      'https://www.gesetze-im-internet.de/ustg_1980/__15.html (Abs. 1 Satz 1 Nr. 4)',
      'USt 1 A 2026, lines 30, 37 and 41',
    ],
    input: { ...base, period: OCT, ...none, expenses: [foreignExpense('2026-10-16', 'euReverseCharge', 9_900)] },
    expected: {
      euReverseCharge: { base: 9_900, tax: 1_881, shown: true },
      inputTaxReverseCharge: { tax: 1_881, shown: true },
      inputTax: { tax: 0 },
      remainingPrepayment: { tax: 0 },
    },
    notices: [],
  },
  {
    id: '14b-small-business-reverse-charge-expense',
    title: 'small business: the same 99 € fee: the tax is owed, no input tax, an advance return for that period',
    reasoning:
      'A small business that owes tax under § 13b Abs. 5 has to file: "Voranmeldungen ... haben auch die Unternehmer ... abzugeben, die ausschließlich Steuer für Umsätze nach ... § 13b Absatz 5 ... zu entrichten haben" (§ 18 Abs. 4a Satz 1 UStG), only for the periods in which this tax is to be declared (Satz 2). ' +
      'The tax goes to lines 30 to 32 (instructions of the form). For the period of the small business scheme the business may not deduct input tax under § 15 (instructions, section on small businesses), so Kz 67 is 0 and Kz 83 is the 18.81 € to pay.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__18.html (Abs. 4a)', 'https://www.gesetze-im-internet.de/ustg_1980/__19.html (Abs. 1)', 'USt 1 A 2026, instructions for lines 30 to 32 and for the small business scheme'],
    input: { ...base, mode: 'smallBusiness', period: OCT, ...none, expenses: [foreignExpense('2026-10-16', 'euReverseCharge', 9_900, { smallBusiness: true })] },
    expected: {
      euReverseCharge: { base: 9_900, tax: 1_881, shown: true },
      inputTaxReverseCharge: { tax: 0, shown: false },
      taxable19: { shown: false },
      taxable7: { shown: false },
      inputTax: { shown: false },
      remainingPrepayment: { tax: 1_881, shown: true },
    },
    notices: [],
  },
  {
    id: '14c-small-business-days-in-a-regular-period',
    title: 'regular VAT today: the fee was paid on a day of the small business scheme: the tax is owed, no Kz 67',
    reasoning: 'Same rule as 14b for an expense of a day on which the business was a small business, inside a period that is declared with regular VAT (the quarter of the change).',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__18.html (Abs. 4a)', 'USt 1 A 2026, instructions for the small business scheme'],
    input: { ...base, period: OCT, ...none, expenses: [foreignExpense('2026-10-16', 'euReverseCharge', 9_900, { smallBusiness: true })] },
    expected: { euReverseCharge: { base: 9_900, tax: 1_881 }, inputTaxReverseCharge: { tax: 0 }, remainingPrepayment: { tax: 1_881 } },
  },
  {
    id: '15-non-eu-supplier-expense',
    title: 'regular VAT: a service of 50.00 € from a supplier outside the EU, no VAT: Kz 84/85 owed and Kz 67 deducted',
    reasoning:
      'A service of a supplier established abroad that does not fall under § 13b Abs. 1: § 13b Abs. 2 Nr. 1 UStG, which is line 32 of the form ("Andere Leistungen", Kz 84 and 85). The recipient owes the tax (Abs. 5 Satz 1), deductible under § 15 Abs. 1 Satz 1 Nr. 4 (Kz 67). 50.00 € at 19 % = 9.50 €. ' +
      'The tax arises with the invoice, at the latest with the end of the month after the performance (§ 13b Abs. 2); the expense date stands for both.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__13b.html (Abs. 2 Nr. 1, Abs. 5)', 'https://www.gesetze-im-internet.de/ustg_1980/__15.html (Abs. 1 Satz 1 Nr. 4)', 'USt 1 A 2026, lines 32, 37 and 41'],
    input: { ...base, period: OCT, ...none, expenses: [foreignExpense('2026-10-17', 'thirdCountry', 5_000)] },
    expected: { otherReverseCharge: { base: 5_000, tax: 950, shown: true }, euReverseCharge: { shown: false }, inputTaxReverseCharge: { tax: 950 }, remainingPrepayment: { tax: 0 } },
  },
  {
    id: '15b-domestic-payout-with-vat',
    title: 'regular VAT: a payout of 119.00 € from a German payer with 19 % inside is taxed: Kz 81 base 100.00 €, tax 19.00 €',
    reasoning: 'The VAT inside is owed (§ 13 Abs. 1 Nr. 1 UStG; line 13 of the form). The treatment is chosen by the person from the statement, never guessed. UNVERIFIED: that a payout from a German payer has no invoice of kontor behind it that would count twice.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__13.html (Abs. 1 Nr. 1)', 'USt 1 A 2026, line 13'],
    input: {
      ...base,
      period: OCT,
      invoices: [{ ...invoiceOf({ id: 'p-de', date: '2026-10-05' }, [{ net: 10_000 }]), source: 'payout' }],
      payments: [],
      expenses: [],
    },
    expected: { taxable19: { base: 10_000, tax: 1_900 }, remainingPrepayment: { tax: 1_900 } },
  },
];
