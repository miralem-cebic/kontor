// Scenarios of #37 that the code cannot express yet (#37; the ones built with #31, #32 and #34 are in 08-reverse-charge-and-payouts.ts). Each is a documented `it.todo` in tests/unit/vatScenarios.test.ts;
// the feature that builds what it needs fills it in. Nothing here is a rule of kontor: every line says what the law text says
// and what could not be checked. kontor gives no tax advice; anything under `unverified` has to be confirmed from the law
// text or with a tax advisor before code is written for it (the acceptance criteria of #30).

import type { PendingScenario } from './helpers';

export const pendingScenarios: PendingScenario[] = [
  {
    id: '10-small-business-payout',
    title: 'small business: a monthly payout from an EU entity without an own invoice is income and needs no ZM',
    needs: '#31 (income without an own invoice)',
    reasoning:
      'The payout is income for the EÜR on the day it is received. The business has no ZM duty: "Die Absätze 1 bis 3 gelten nicht für Unternehmer, die § 19 Absatz 1 anwenden" (§ 18a Abs. 4 UStG). ' +
      'The ZM filling aid of kontor already returns "no ZM" for a small business; the payout record is what is missing.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__18a.html (Abs. 4)', 'https://www.gesetze-im-internet.de/ustg_1980/__19.html (Abs. 1)'],
    unverified: ['Whether such a payout counts toward the € 25,000 / € 100,000 limits: § 19 Abs. 2 counts only taxable turnover (§ 1 Abs. 1 Nr. 1); a service with its place abroad is not taxable in Germany. Not confirmed with an advisor.'],
  },
  {
    id: '13-agency-model-payout',
    title: 'platform that collects the VAT from the consumers (agency model): NOT to be coded',
    needs: 'answer of a tax advisor (#30, open question 1)',
    reasoning: 'Who supplies the consumer, and whether the commission is a reverse-charge service for the developer, is not stated in Apple\'s terms and not decided here.',
    sources: ['https://developer.apple.com/support/downloads/terms/exhibits/Exhibits-to-Schedule-2-and-3-20250821-German.pdf (cited in #30; not read)'],
    unverified: ['Everything. Until answered the case is a manual booking with a warning.'],
  },
  {
    id: '16-13b-month-boundary',
    title: '§ 13b tax: the EU case follows the period of the performance, the non-EU case the invoice, at the latest the next month',
    needs: 'fields for the day of the performance and the day of the invoice on an expense (the expense has only the day of the payment)',
    reasoning:
      'EU supplier: "entsteht die Steuer mit Ablauf des Voranmeldungszeitraums, in dem die Leistungen ausgeführt worden sind" (§ 13b Abs. 1). ' +
      'Supplier abroad: "mit Ausstellung der Rechnung, spätestens jedoch mit Ablauf des der Ausführung der Leistung folgenden Kalendermonats" (§ 13b Abs. 2). ' +
      'Example for the test: performed 20 September, invoice 5 October: EU -> September (Q3); non-EU -> October. Performed 20 September, no invoice until 15 November: non-EU -> October (end of the following month).',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__13b.html (Abs. 1 and Abs. 2 Eingangssatz)'],
    unverified: [],
  },
  {
    id: '17-cash-basis-kz41-kz21',
    title: 'cash basis: Kz 41 and Kz 21 follow the performance, not the payment (§ 18b Satz 2)',
    needs: 'a decision on R1: ustva() puts every invoice of a cash-basis company into the period of its payments, Kz 41 and 21 included',
    reasoning:
      '§ 18b Satz 2 UStG: Kz 41 (Satz 1 Nr. 1) is declared for the period in which the invoice is issued, at the latest for the period in which the month after the supply ends; Kz 21 (Satz 1 Nr. 2) for the period in which the service was performed. Satz 6 says this holds for the annual return too. ' +
      'Nothing in the text ties these two fields to the payment. The current code does, for a cash-basis company. The ZM (src/domain/zm.ts) follows the law text, and its consistency check shows the difference.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__18b.html (Satz 2)', 'https://www.gesetze-im-internet.de/ustg_1980/__18a.html (Abs. 8)'],
    unverified: ['Whether the Finanzverwaltung reads § 18b differently for § 20 users (the UStAE was not reachable). Raise it on #34 before changing ustva().'],
  },
  {
    id: '18-kz41-invoice-date-rule',
    title: 'Kz 41 is declared for the period of the invoice, at the latest for the period after the supply (§ 18b Satz 2)',
    needs: 'a decision on R1 (ustva() uses the end of the service for Kz 41)',
    reasoning:
      'Example, quarterly: delivery on 28 September. Invoice written on 5 September (before the delivery): Q3 by the invoice. Invoice written on 3 October: Q4 by the invoice. Invoice not written until 20 January: the cap applies, the month after the delivery ends on 31 October, so Q4. The current code puts all three in Q3, the quarter of the delivery.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__18b.html (Satz 2)'],
    unverified: ['The reading of "spätestens ... in dem der auf die Ausführung ... folgende Monat endet" as a cap on the invoice date (also used by src/domain/zm.ts for supplies).'],
  },
  {
    id: '19-limit-crossed-in-october',
    title: 'small business: 24,900 € in the previous year, the 100,000 € passed in October: from which supply the VAT applies',
    needs: '#36',
    reasoning: 'Needs a running Gesamtumsatz by receipt (§ 19 Abs. 2 Satz 1: "nach vereinnahmten Entgelten") and the rule for the crossing supply.',
    sources: ['https://www.gesetze-im-internet.de/ustg_1980/__19.html (Abs. 1 Satz 1, Abs. 2 Satz 1)'],
    unverified: ['That the crossing supply and all later ones are taxable and the earlier ones stay tax-free (BMF letter on the 2025 reform; not read).'],
  },
  {
    id: '20-eur-totals',
    title: 'EÜR totals of the scenarios (income by receipt, expenses by payment, reverse-charge VAT)',
    needs: 'R3 (Anlage EÜR)',
    reasoning: 'Which Anlage EÜR lines take the reverse-charge VAT of a small business and the income from EU platforms is #30 open question 3: forum answers disagree, the official instructions decide.',
    sources: ['https://www.gesetze-im-internet.de/estg/__4.html (Abs. 3, not re-read)'],
    unverified: ['The lines of the form; all of it.'],
  },
];
