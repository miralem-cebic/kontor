// Scenario 3: where the day decides the period (#37). Accrual basis, regular VAT at 19 %.
//
// - The tax arises at the end of the Voranmeldungszeitraum in which the service was performed (§ 13 Abs. 1 Nr. 1
//   Buchst. a UStG, https://www.gesetze-im-internet.de/ustg_1980/__13.html), not when the invoice is written.
// - A cancellation corrects the tax for the period in which the change happened (§ 17 Abs. 1 Satz 7 UStG,
//   https://www.gesetze-im-internet.de/ustg_1980/__17.html): it counts on its own date, and the original stays where it was.
// - The return is due on the 10th day after the end of the period (§ 18 Abs. 1 Satz 1 UStG,
//   https://www.gesetze-im-internet.de/ustg_1980/__18.html). A Saturday, Sunday or public holiday moves it to the next working day
//   (§ 108 Abs. 3 AO, https://www.gesetze-im-internet.de/ao_1977/__108.html; the paragraph was not re-read for this scenario,
//   it is the one the code of kontor cites). kontor does not know public holidays.
// - The Voranmeldungszeitraum is the calendar quarter, or the calendar month when the tax of the previous year was above
//   9,000 € (§ 18 Abs. 2 Satz 1 and 2 UStG, https://www.gesetze-im-internet.de/ustg_1980/__18.html).

import type { VatScenario } from './helpers';
import { invoiceOf } from './helpers';

const base = { method: 'accrual', permanentExtension: false, payments: [], expenses: [] } as const;

const p1 = invoiceOf({ id: 'p1', date: '2026-09-30' }, [{ net: 100_000 }]); // last day of Q3 / September
const p2 = invoiceOf({ id: 'p2', date: '2026-10-01' }, [{ net: 200_000 }]); // first day of Q4 / October
const p3 = invoiceOf({ id: 'p3', date: '2026-10-02', serviceEnd: '2026-09-30' }, [{ net: 50_000 }]); // written in Oct, performed in Sep
const p4 = invoiceOf({ id: 'p4', date: '2026-09-29', serviceEnd: '2026-10-01' }, [{ net: 30_000 }]); // written in Sep, performed in Oct
const p6 = invoiceOf({ id: 'p6', date: '2027-01-02', serviceEnd: '2026-12-31' }, [{ net: 40_000 }]); // written next year, performed 31 December
const c1 = invoiceOf({ id: 'c1', date: '2026-10-05', cancellation: true }, [{ net: 100_000 }]); // cancels p1 in October
const all = [p1, p2, p3, p4, p6, c1];

const leap1 = invoiceOf({ id: 'l1', date: '2028-02-29' }, [{ net: 10_000 }]);
const leap2 = invoiceOf({ id: 'l2', date: '2028-03-01' }, [{ net: 20_000 }]);

export const scenarios: VatScenario[] = [
  {
    id: '03-q3-2026',
    title: 'quarter 3 2026: p1 and p3 (performed by 30 September); the cancellation of p1 does not reach back',
    reasoning: 'p3 was written on 2 October but performed on 30 September, so it belongs to Q3. p1 stays in Q3 although it is cancelled in October.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__13.html (Abs. 1 Nr. 1 Buchst. a)', 'https://www.gesetze-im-internet.de/ustg_1980/__17.html (Abs. 1 Satz 7)'],
    input: { ...base, period: { year: 2026, kind: 'quarter', index: 3 }, invoices: all },
    // 100,000 + 50,000 = 150,000 net; 19,000 + 9,500 = 28,500 tax
    expected: { taxable19: { base: 150_000, tax: 28_500 }, remainingPrepayment: { tax: 28_500 } },
    // 10 October 2026 is a Saturday, so Monday 12 October (§ 18 Abs. 1 Satz 1 UStG, § 108 Abs. 3 AO)
    dueDate: '2026-10-12',
  },
  {
    id: '03-q4-2026',
    title: 'quarter 4 2026: p2, p4 (performed 1 October), p6 (performed 31 December) and the cancellation of p1',
    reasoning: 'p6 is written in January 2027 but performed on 31 December 2026: Q4 2026. The cancellation counts negative on 5 October.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__13.html (Abs. 1 Nr. 1 Buchst. a)', 'https://www.gesetze-im-internet.de/ustg_1980/__17.html (Abs. 1 Satz 7)'],
    input: { ...base, period: { year: 2026, kind: 'quarter', index: 4 }, invoices: all },
    // 200,000 + 30,000 + 40,000 - 100,000 = 170,000 net; 38,000 + 5,700 + 7,600 - 19,000 = 32,300 tax
    expected: { taxable19: { base: 170_000, tax: 32_300 } },
    // 10 January 2027 is a Sunday, so Monday 11 January
    dueDate: '2027-01-11',
  },
  {
    id: '03-sep-2026',
    title: 'month September 2026: the last day belongs to the month',
    reasoning: 'p1 (30 September) and p3 (performed 30 September).',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__13.html (Abs. 1 Nr. 1 Buchst. a)'],
    input: { ...base, period: { year: 2026, kind: 'month', index: 9 }, invoices: all },
    expected: { taxable19: { base: 150_000, tax: 28_500 } },
  },
  {
    id: '03-oct-2026',
    title: 'month October 2026: the first day belongs to the month, the cancellation is negative',
    reasoning: 'p2 (1 October), p4 (performed 1 October), minus p1 cancelled on 5 October.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__13.html (Abs. 1 Nr. 1 Buchst. a)', 'https://www.gesetze-im-internet.de/ustg_1980/__17.html (Abs. 1 Satz 7)'],
    input: { ...base, period: { year: 2026, kind: 'month', index: 10 }, invoices: all },
    // 200,000 + 30,000 - 100,000 = 130,000 net; 38,000 + 5,700 - 19,000 = 24,700 tax
    expected: { taxable19: { base: 130_000, tax: 24_700 } },
    dueDate: '2026-11-10',
  },
  {
    id: '03-nov-2026',
    title: 'month November 2026: nothing happened',
    reasoning: 'No service was performed and nothing was cancelled in November.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__13.html (Abs. 1 Nr. 1 Buchst. a)'],
    input: { ...base, period: { year: 2026, kind: 'month', index: 11 }, invoices: all },
    expected: { taxable19: { base: 0, tax: 0 }, remainingPrepayment: { tax: 0 } },
  },
  {
    id: '03-dec-2026',
    title: 'month December 2026: an invoice of the next year for a service of 31 December; due in the next year, on a Monday',
    reasoning: 'p6 is performed on 31 December 2026. The return is due on 10 January 2027, a Sunday, so on Monday 11 January 2027.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__13.html (Abs. 1 Nr. 1 Buchst. a)', 'https://www.gesetze-im-internet.de/ustg_1980/__18.html (Abs. 1 Satz 1)', 'https://www.gesetze-im-internet.de/ao_1977/__108.html (Abs. 3), not re-read'],
    input: { ...base, period: { year: 2026, kind: 'month', index: 12 }, invoices: all },
    expected: { taxable19: { base: 40_000, tax: 7_600 } },
    dueDate: '2027-01-11',
  },
  {
    id: '03-feb-2028',
    title: 'month February 2028 (leap year): 29 February is the last day',
    reasoning: '2028 is a leap year. l1 (29 February) belongs to February, l2 (1 March) to March. kontor uses the parameters of 2027 for 2028 (no own file yet).',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__13.html (Abs. 1 Nr. 1 Buchst. a)'],
    input: { ...base, period: { year: 2028, kind: 'month', index: 2 }, invoices: [leap1, leap2] },
    expected: { taxable19: { base: 10_000, tax: 1_900 } },
  },
  {
    id: '03-mar-2028',
    title: 'month March 2028: 1 March',
    reasoning: 'See February 2028.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__13.html (Abs. 1 Nr. 1 Buchst. a)'],
    input: { ...base, period: { year: 2028, kind: 'month', index: 3 }, invoices: [leap1, leap2] },
    expected: { taxable19: { base: 20_000, tax: 3_800 } },
  },
];
