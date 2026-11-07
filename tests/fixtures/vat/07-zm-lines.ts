// Scenario 7: the summary report (Zusammenfassende Meldung, ZM) built from invoices (#37, #35).
//
// Law text read at https://www.gesetze-im-internet.de/ustg_1980/__18a.html:
// - Services under § 3a Abs. 2 UStG to a recipient in another member state who owes the tax there: reported by quarter
//   (Abs. 2), per recipient VAT ID with the sum of the bases (Abs. 7 Satz 1 Nr. 3), for the period in which the service was
//   performed (Abs. 8 Satz 2).
// - Intra-community supplies of goods: Abs. 7 Satz 1 Nr. 1; period of the invoice, at the latest the one in which the month
//   after the supply ends (Abs. 8 Satz 1).
// - Not for a business that applies § 19 Abs. 1 UStG (Abs. 4).
// - The total of the services is the base of Kz 21 of the advance return (§ 18b Satz 1 Nr. 2 UStG,
//   https://www.gesetze-im-internet.de/ustg_1980/__18b.html).
// UNVERIFIED: the rounding of cents to whole euros (the portal takes whole euros; the BZSt names no rule); the VAT IDs below are
// examples that pass kontor's check of the form, not numbers that were looked up.

import type { UstvaPeriod } from '../../../src/domain/ustva';
import type { ZmInvoice, ZmKind } from '../../../src/domain/zm';
import { cents } from '../../../src/domain/money';

export interface ZmScenario {
  id: string;
  title: string;
  reasoning: string;
  sources: readonly string[];
  period: UstvaPeriod;
  invoices: readonly ZmInvoice[];
  /** The lines expected: recipient, kind and the sum of the bases in cents */
  lines: readonly { vatId: string; kind: ZmKind; base: number }[];
  /** The total of the services, which must equal Kz 21 of the advance return (accrual basis) */
  services: number;
}

const inv = (over: Partial<ZmInvoice> & Pick<ZmInvoice, 'id' | 'date' | 'net'>): ZmInvoice => ({
  number: `RE-${over.id}`,
  serviceEnd: over.date,
  treatment: 'reverseCharge',
  customerCountry: 'IE',
  customerVatId: 'IE6388047V',
  isCancellation: false,
  smallBusiness: false,
  ...over,
  net: cents(over.net),
});

const Q3 = { year: 2026, kind: 'quarter', index: 3 } as const;

export const zmScenarios: ZmScenario[] = [
  {
    id: '07-zm-quarter-two-recipients',
    title: 'quarter 3: two recipients, the last day of the quarter is in, the first day of the next is out',
    reasoning:
      'Ireland: 1,234.56 € + 100.00 € = 1,334.56 €, entered as 1,335 € (UNVERIFIED rounding); Luxembourg: 2,000.00 €. The service of 1 October is Q4. ' +
      'The two recipients add up to 3,334.56 €, which is Kz 21 of the advance return for Q3.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__18a.html (Abs. 2, Abs. 7 Satz 1 Nr. 3, Abs. 8 Satz 2)', 'https://www.gesetze-im-internet.de/ustg_1980/__18b.html (Satz 1 Nr. 2)'],
    period: Q3,
    invoices: [
      inv({ id: 'a', date: '2026-08-20', net: 123_456 }),
      inv({ id: 'b', date: '2026-09-30', net: 10_000 }),
      inv({ id: 'c', date: '2026-07-01', net: 200_000, customerCountry: 'LU', customerVatId: 'LU12345678' }),
      inv({ id: 'd', date: '2026-10-01', net: 99_900 }),
    ],
    lines: [
      { vatId: 'IE6388047V', kind: 'service', base: 133_456 },
      { vatId: 'LU12345678', kind: 'service', base: 200_000 },
    ],
    services: 333_456,
  },
  {
    id: '07-zm-small-business',
    title: 'a small business has nothing to report',
    reasoning: '"Die Absätze 1 bis 3 gelten nicht für Unternehmer, die § 19 Absatz 1 anwenden" (§ 18a Abs. 4 UStG).',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__18a.html (Abs. 4)'],
    period: Q3,
    invoices: [inv({ id: 'a', date: '2026-08-20', net: 123_456, smallBusiness: true })],
    lines: [],
    services: 0,
  },
  {
    id: '07-zm-cancellation',
    title: 'a cancellation in the same quarter removes the line, one in a later quarter is negative there',
    reasoning: 'Both cancellations take back exactly the base of the invoice (§ 18a Abs. 7 Satz 2 with § 17 Abs. 1 Satz 7 UStG; UNVERIFIED how the BZSt wants a later cancellation reported).',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__18a.html (Abs. 7 Satz 2)', 'https://www.gesetze-im-internet.de/ustg_1980/__17.html (Abs. 1 Satz 7)'],
    period: Q3,
    invoices: [
      inv({ id: 'a', date: '2026-08-20', net: 50_000 }),
      inv({ id: 'a-cancel', date: '2026-09-02', net: -50_000, isCancellation: true }),
      inv({ id: 'b', date: '2026-08-21', net: 70_000, customerVatId: 'IE1234567T' }),
      inv({ id: 'b-cancel', date: '2026-10-02', net: -70_000, isCancellation: true, customerVatId: 'IE1234567T' }),
    ],
    lines: [{ vatId: 'IE1234567T', kind: 'service', base: 70_000 }],
    services: 70_000,
  },
  {
    id: '07-zm-goods-and-services',
    title: 'goods and a service to the same recipient are two lines, kind "supply" and kind "service"',
    reasoning: 'Abs. 7 Satz 1 Nr. 1 (goods) and Nr. 3 (services) are different entries of the report, so the kinds are not mixed. Goods do not count towards Kz 21 (they are Kz 41).',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__18a.html (Abs. 7 Satz 1 Nr. 1 and 3)'],
    period: Q3,
    invoices: [
      inv({ id: 'g', date: '2026-08-05', net: 500_000, treatment: 'intraCommunitySupply', customerCountry: 'FR', customerVatId: 'FR40303265045' }),
      inv({ id: 's', date: '2026-08-06', net: 25_000, customerCountry: 'FR', customerVatId: 'FR40303265045' }),
    ],
    lines: [
      { vatId: 'FR40303265045', kind: 'service', base: 25_000 },
      { vatId: 'FR40303265045', kind: 'supply', base: 500_000 },
    ],
    services: 25_000,
  },
];
