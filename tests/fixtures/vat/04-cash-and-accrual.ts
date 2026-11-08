// Scenario 4: the same invoice on the accrual and on the cash basis (#37).
//
// - Accrual (Sollversteuerung, "nach vereinbarten Entgelten"): the tax arises at the end of the period in which the service
//   was performed (§ 13 Abs. 1 Nr. 1 Buchst. a UStG, https://www.gesetze-im-internet.de/ustg_1980/__13.html).
// - Cash (Istversteuerung, "nach vereinnahmten Entgelten"): at the end of the period in which the payment came in
//   (§ 13 Abs. 1 Nr. 1 Buchst. b, § 20 UStG, https://www.gesetze-im-internet.de/ustg_1980/__20.html). § 20 needs the tax
//   office's permission, for example for a total turnover of the previous year up to 800,000 €.
// UNVERIFIED: how a part payment is split. The law says "die Entgelte" that came in; kontor takes every payment's share
// of every rate from the sum paid so far, so that the payments of one invoice add up to the invoice exactly (a rule of
// kontor, not a paragraph). A tax advisor should confirm it for part payments across a period boundary.

import type { VatScenario } from './helpers';
import { invoiceOf, paymentOf } from './helpers';

const Q3 = { year: 2026, kind: 'quarter', index: 3 } as const;
const Q4 = { year: 2026, kind: 'quarter', index: 4 } as const;

// 1,000.00 € net + 190.00 € VAT = 1,190.00 €, paid half on 28 September and half on 5 October
const q1 = invoiceOf({ id: 'q1', date: '2026-09-20' }, [{ net: 100_000 }]);
// 0.50 € net + 0.10 € VAT = 0.60 €, paid 0.25 € and 0.35 €: the shares have to be rounded
const q2 = invoiceOf({ id: 'q2', date: '2026-09-21' }, [{ net: 50 }]);
const payments = [
  paymentOf('pay1', 'q1', '2026-09-28', 59_500),
  paymentOf('pay2', 'q1', '2026-10-05', 59_500),
  paymentOf('pay3', 'q2', '2026-09-28', 25),
  paymentOf('pay4', 'q2', '2026-10-05', 35),
];
const common = { permanentExtension: false, expenses: [], invoices: [q1, q2], payments } as const;

// #75: on the cash basis too, Kz 41 and Kz 21 follow § 18b UStG, not the payment. Read at https://dejure.org/gesetze/UStG/18b.html
// (gesetze-im-internet.de did not answer on 8 November 2026). An intra-community supply of 3,000.00 € on 28 September,
// invoiced on 2 October, and a service of 2,000.00 € to a business in Austria on 29 September; both paid in November.
const euSupply = invoiceOf({ id: 'eu1', date: '2026-10-02', serviceEnd: '2026-09-28', treatment: 'intraCommunitySupply', country: 'FR' }, [{ net: 300_000 }]);
const euService = invoiceOf({ id: 'eu2', date: '2026-09-29', treatment: 'reverseCharge', country: 'AT' }, [{ net: 200_000 }]);
const euPayments = [paymentOf('pay5', 'eu1', '2026-11-10', 300_000), paymentOf('pay6', 'eu2', '2026-11-10', 200_000)];
const eu = { method: 'cash', permanentExtension: false, expenses: [], invoices: [euSupply, euService], payments: euPayments } as const;
// UNVERIFIED: Kz 60 and Kz 45 on the cash basis still follow the payment; § 13b Abs. 2 UStG says when the tax arises for the
// recipient, not when the supplier declares the base, and the instructions of the form could not be read.

export const scenarios: VatScenario[] = [
  {
    id: '04-cash-eu-q3',
    title: 'cash basis, Q3: the EU service by the day it was performed, the supply not yet (invoiced in October)',
    reasoning: 'Kz 21 in the period of the service (§ 18b Satz 3), Kz 41 in the period of the invoice (§ 18b Satz 2); the payments of November do not matter.',
    sources: ['https://dejure.org/gesetze/UStG/18b.html (Satz 2 and 3)'],
    input: { ...eu, period: Q3 },
    expected: { euServices: { base: 200_000, shown: true }, intraCommunitySupply: { base: 0 } },
  },
  {
    id: '04-cash-eu-q4',
    title: 'cash basis, Q4: the supply by its invoice of 2 October; the EU service is not counted again',
    reasoning: 'The invoice of 2 October lies before the end of the month after the supply (31 October), so it decides (§ 18b Satz 2).',
    sources: ['https://dejure.org/gesetze/UStG/18b.html (Satz 2)'],
    input: { ...eu, period: Q4 },
    expected: { intraCommunitySupply: { base: 300_000, shown: true }, euServices: { base: 0 } },
  },
  {
    id: '04-accrual-q3',
    title: 'accrual basis, Q3: both invoices count in full, whatever was paid',
    reasoning: 'Both services were performed in September.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__13.html (Abs. 1 Nr. 1 Buchst. a)'],
    input: { ...common, method: 'accrual', period: Q3 },
    expected: { taxable19: { base: 100_050, tax: 19_010 } },
  },
  {
    id: '04-accrual-q4',
    title: 'accrual basis, Q4: nothing, the payment in October changes nothing',
    reasoning: 'The payments of October do not matter on the accrual basis.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__13.html (Abs. 1 Nr. 1 Buchst. a)'],
    input: { ...common, method: 'accrual', period: Q4 },
    expected: { taxable19: { base: 0, tax: 0 } },
  },
  {
    id: '04-cash-q3',
    title: 'cash basis, Q3: the payments of September, each with its share',
    reasoning:
      'q1: 59,500 of 119,000 is half: 50,000 net and 9,500 tax. q2: after 25 of 60 cents the share is 50 × 25 / 60 = 20.83 -> 21 net and 10 × 25 / 60 = 4.17 -> 4 tax.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__13.html (Abs. 1 Nr. 1 Buchst. b)', 'https://www.gesetze-im-internet.de/ustg_1980/__20.html'],
    input: { ...common, method: 'cash', period: Q3 },
    expected: { taxable19: { base: 50_021, tax: 9_504 } },
  },
  {
    id: '04-cash-q4',
    title: 'cash basis, Q4: the rest, so that both quarters add up to the invoices exactly',
    reasoning: 'q2 after 60 of 60 cents: 50 and 10, minus 21 and 4 already counted: 29 and 6. 50,021 + 50,029 = 100,050 and 9,504 + 9,506 = 19,010.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__13.html (Abs. 1 Nr. 1 Buchst. b)', 'https://www.gesetze-im-internet.de/ustg_1980/__20.html'],
    input: { ...common, method: 'cash', period: Q4 },
    expected: { taxable19: { base: 50_029, tax: 9_506 } },
  },
];
