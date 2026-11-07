import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { basisPoints, cents } from '../../src/domain/money';
import { overview } from '../../src/domain/overview';
import { turnoverByCustomer } from '../../src/domain/reports';
import { ustva, type UstvaResult } from '../../src/domain/ustva';
import { fcParams } from './fixtures';

// The overview, the reports and the advance VAT return (cash basis) take the net part of a payment from the cumulative
// amount paid, so that for the same payments they show the same figure, and a fully paid invoice shows its net amount.

describe('overview, reports and UStVA agree on the net part of part payments (#68)', () => {
  it('property: for any split of the payments of an invoice, all three show the same sum and the part sums are exact', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5_000_000 }),
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 10 }),
        fc.array(fc.integer({ min: 1, max: 28 }), { minLength: 10, maxLength: 10 }),
        fc.integer({ min: 0, max: 3 }),
        (net, weights, days, extra) => {
          const tax = Math.round((net * 1900) / 10_000);
          const gross = net + tax;
          const total = weights.reduce((a, b) => a + b, 0);
          let given = 0;
          const amounts = weights.map((w, i) => {
            const part = i === weights.length - 1 ? gross - given : Math.floor((gross * w) / total);
            given += part;
            return part;
          });
          const payments = amounts.flatMap((amount, i) => (amount > 0 ? [{ id: `p${i}`, invoiceId: 'r1', date: `2026-10-${String(days[i]).padStart(2, '0')}`, amount: cents(amount) }] : []));
          // `extra` payments above the gross amount do not add anything to the net
          const over = Array.from({ length: extra }, (_, i) => ({ id: `z${i}`, invoiceId: 'r1', date: '2026-10-29', amount: cents(1 + i) }));
          const all = [...payments, ...over];

          const o = overview({
            year: 2026,
            today: '2026-12-01',
            smallBusiness: false,
            invoices: [{ id: 'r1', date: '2026-10-01', issued: true, isCancellation: false, cancelled: false, net: cents(net), gross: cents(gross), dueDate: '2026-10-15', taxableInGermany: true }],
            payments: all,
            expenses: [],
            payouts: [],
          });
          const report = turnoverByCustomer({
            year: 2026,
            today: '2026-12-01',
            smallBusiness: false,
            invoices: [{ id: 'r1', number: 'RE-1', customerId: 'k1', date: '2026-10-01', issued: true, isCancellation: false, cancelled: false, net: cents(net), gross: cents(gross), dueDate: '2026-10-15', taxableInGermany: true }],
            payments: all,
            expenses: [],
            payouts: [],
          });
          const vat: UstvaResult = ustva({
            period: { year: 2026, kind: 'quarter', index: 4 },
            method: 'cash',
            permanentExtension: false,
            invoices: [
              {
                id: 'r1',
                date: '2026-10-01',
                serviceEnd: '2026-10-01',
                treatment: 'standard',
                customerCountry: 'DE',
                isCancellation: false,
                smallBusiness: false,
                lines: [{ rate: basisPoints(1900), net: cents(net), tax: cents(tax) }],
              },
            ],
            payments: all,
            expenses: [],
          });
          expect(o.income).toBe(net);
          // the payment-based turnover of the small business scheme counts the same cumulative parts
          expect(o.turnover).toBe(net);
          expect(report.total).toBe(net);
          expect(vat.fields.find((f) => f.id === 'taxable19')?.base).toBe(net);
        },
      ),
      fcParams,
    );
  });
});
