// Scenario 5: a small business, and expenses without German input tax (#37).
//
// Small business (Kleinunternehmer, § 19 Abs. 1 UStG, https://www.gesetze-im-internet.de/ustg_1980/__19.html): the turnover is
// tax-free, and "die Vorschriften ... über die Erklärungspflichten (§ 18 Absatz 1 bis 4) finden keine Anwendung" (Satz 2),
// so such an invoice is not part of an advance return. kontor decides by the status the invoice was issued with.
//
// Expenses: only the German VAT of a domestic expense is input tax, and only when an invoice with VAT shown exists
// (§ 15 Abs. 1 Satz 1 Nr. 1 UStG, https://www.gesetze-im-internet.de/ustg_1980/__15.html). If a foreign supplier charged the VAT
// of its own country, that VAT is no German input tax: it stays inside the gross expense (the "no VAT" treatment). An
// expense with reverse charge (§ 13b UStG) would need Kz 46/47 and 67, which kontor does not compute yet: it reports it.

import type { VatScenario } from './helpers';
import { cents } from '../../../src/domain/money';
import { domesticExpense, invoiceOf } from './helpers';

const OCT = { year: 2026, kind: 'month', index: 10 } as const;
const base = { method: 'accrual', permanentExtension: false, payments: [] } as const;

export const scenarios: VatScenario[] = [
  {
    id: '05-small-business-invoice',
    title: 'an invoice issued as a small business is not part of the return; a regular one beside it is',
    reasoning: 'A small business shows no VAT (a "§ 19" note). If it showed any it would owe it (§ 14c Abs. 2 UStG, as the issue #30 says; § 14c was not re-read for this scenario), which is why the invoice has no rate at all.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__19.html (Abs. 1 Satz 1 and 2)', 'https://www.gesetze-im-internet.de/ustg_1980/__18a.html (Abs. 4, for the summary report)'],
    input: {
      ...base,
      period: OCT,
      invoices: [invoiceOf({ id: 'small', date: '2026-10-03', smallBusiness: true }, [{ net: 500_000 }]), invoiceOf({ id: 'regular', date: '2026-10-04' }, [{ net: 10_000 }])],
      expenses: [],
    },
    expected: { taxable19: { base: 10_000, tax: 1_900 }, otherNotTaxable: { base: 0 } },
  },
  {
    id: '05-small-business-only',
    title: 'only small business invoices: every field is 0',
    reasoning: 'See above. The fields that are always shown stay on the form with 0.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__19.html (Abs. 1 Satz 2)'],
    input: { ...base, period: OCT, invoices: [invoiceOf({ id: 'small', date: '2026-10-03', smallBusiness: true }, [{ net: 500_000 }])], expenses: [] },
    expected: { taxable19: { base: 0, tax: 0, shown: true }, taxable7: { base: 0, tax: 0, shown: true }, inputTax: { tax: 0 }, remainingPrepayment: { tax: 0 }, euServices: { shown: false } },
  },
  {
    id: '05-expenses-input-tax',
    title: 'input tax only from domestic expenses with VAT; foreign VAT stays in the expense; reverse charge is reported',
    reasoning:
      'Domestic: 119.00 € (19.00 € VAT) and 107.00 € (7.00 € VAT) in October give 26.00 € in Kz 66; 30 September and 1 November are other periods. ' +
      'The "no VAT" expense of 119.00 € (a foreign supplier charged its own VAT) gives no German input tax. The EU reverse charge expense (99.00 €) and the third country expense (50.00 €) are in the notices.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__15.html (Abs. 1 Satz 1 Nr. 1)', 'https://www.gesetze-im-internet.de/ustg_1980/__13b.html', 'https://www.gesetze-im-internet.de/ustg_1980/__16.html (Abs. 2)'],
    input: {
      ...base,
      period: OCT,
      invoices: [],
      expenses: [
        domesticExpense('2026-10-01', 11_900, 1_900),
        domesticExpense('2026-10-31', 10_700, 700),
        domesticExpense('2026-09-30', 11_900, 1_900),
        domesticExpense('2026-11-01', 11_900, 1_900),
        { date: '2026-10-15', taxTreatment: 'noVat', gross: cents(11_900), vat: cents(0) },
        { date: '2026-10-16', taxTreatment: 'euReverseCharge', gross: cents(9_900), vat: cents(0) },
        { date: '2026-10-17', taxTreatment: 'thirdCountry', gross: cents(5_000), vat: cents(0) },
      ],
    },
    expected: { inputTax: { tax: 2_600, shown: true }, remainingPrepayment: { tax: -2_600 } },
    notices: [
      { code: 'expenseReverseCharge', count: 1, amount: 9_900 },
      { code: 'expenseThirdCountry', count: 1, amount: 5_000 },
    ],
  },
];
