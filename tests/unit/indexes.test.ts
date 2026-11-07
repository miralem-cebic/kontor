import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cancelledIds, cancellationOf, type DocumentFile } from '../../src/data/types';
import type { DocumentId } from '../../src/data/ids';
import { customerAccount, type AccountInvoice, type AccountPayment } from '../../src/domain/customerAccount';
import { cents } from '../../src/domain/money';
import { overview, type OverviewInvoice, type OverviewPayment } from '../../src/domain/overview';
import { openAmount } from '../../src/domain/payment';
import { openItems } from '../../src/domain/reports';
import { fcParams } from './fixtures';

// #85: the lookups "is this invoice cancelled?" and "what was paid on it?" are built once per computation (a Set and a
// Map) instead of scanning every document and payment per invoice. The results must stay what the scans gave.

describe('cancelledIds equals asking cancellationOf for every document', () => {
  const doc = (id: string, cancels: string | null, kind: 'invoice' | 'quote' = 'invoice'): DocumentFile =>
    ({ id: id as DocumentId, kind, cancels: cancels === null ? null : { id: cancels as DocumentId, number: 'x', date: '2026-01-01' } }) as unknown as DocumentFile;

  it('property: on random documents', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 9 }), fc.option(fc.integer({ min: 0, max: 9 }), { nil: null }), fc.boolean()), { maxLength: 30 }), (list) => {
        const docs = list.map(([id, cancels, quote], i) => doc(`d${id}-${i}`, cancels === null ? null : `d${cancels}-${i % 3}`, quote ? 'quote' : 'invoice'));
        const ids = cancelledIds(docs);
        for (const d of docs) expect(ids.has(d.id)).toBe(cancellationOf(docs, d.id) !== undefined);
        for (let i = 0; i < 10; i++) for (let j = 0; j < 3; j++) expect(ids.has(`d${i}-${j}` as DocumentId)).toBe(cancellationOf(docs, `d${i}-${j}` as DocumentId) !== undefined);
      }),
      fcParams,
    );
  });

  it('a quote never cancels anything', () => {
    expect(cancelledIds([doc('q1', 'a', 'quote')]).size).toBe(0);
    expect(cancelledIds([doc('s1', 'a')]).has('a' as DocumentId)).toBe(true);
    expect(cancellationOf([doc('s1', 'a')], 'a' as DocumentId)).toBeDefined();
  });
});

const amountArb = fc.integer({ min: 1, max: 500_000 });

describe('the indexed open amounts equal the scans', () => {
  it('property: overview and open items agree with a scan of the payments per invoice', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ gross: amountArb, issued: fc.boolean(), cancellation: fc.boolean(), cancelled: fc.boolean(), due: fc.integer({ min: 1, max: 28 }) }), { minLength: 1, maxLength: 8 }),
        fc.array(fc.record({ invoice: fc.integer({ min: 0, max: 9 }), amount: amountArb, day: fc.integer({ min: 1, max: 28 }) }), { maxLength: 15 }),
        (list, pays) => {
          const invoices: OverviewInvoice[] = list.map((x, i) => ({
            id: `i${i}`,
            date: '2026-01-10',
            issued: x.issued,
            isCancellation: x.cancellation,
            cancelled: x.cancelled,
            net: cents(x.gross),
            gross: cents(x.gross),
            dueDate: `2026-03-${String(x.due).padStart(2, '0')}`,
            taxableInGermany: true,
          }));
          const payments: OverviewPayment[] = pays.map((p, i) => ({ id: `p${i}`, invoiceId: `i${p.invoice}`, date: `2026-02-${String(p.day).padStart(2, '0')}`, amount: cents(p.amount) }));
          const today = '2026-03-15';

          let open = 0;
          let overdue = 0;
          let overdueCount = 0;
          for (const inv of invoices) {
            if (!inv.issued || inv.isCancellation || inv.cancelled) continue;
            const paid = payments.filter((p) => p.invoiceId === inv.id).reduce((a, p) => a + p.amount, 0);
            const left = Math.max(0, inv.gross - paid);
            open += left;
            if (left > 0 && inv.dueDate < today) {
              overdue += left;
              overdueCount += 1;
            }
          }
          const o = overview({ year: 2026, today, smallBusiness: false, invoices, payments, expenses: [], payouts: [] });
          expect(o).toMatchObject({ openReceivables: open, overdueReceivables: overdue, overdueCount });
          const report = openItems({ year: 2026, today, smallBusiness: false, invoices: invoices.map((i) => ({ ...i, number: i.id, customerId: 'k' })), payments, expenses: [], payouts: [] });
          expect(report.open).toBe(open);
        },
      ),
      fcParams,
    );
  });

  it('property: the overdue amount of a customer account agrees with a scan of the payments per invoice', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ gross: amountArb, cancelled: fc.boolean(), cancellation: fc.boolean(), due: fc.integer({ min: 1, max: 28 }) }), { minLength: 1, maxLength: 8 }),
        fc.array(fc.record({ invoice: fc.integer({ min: 0, max: 7 }), amount: amountArb }), { maxLength: 15 }),
        (list, pays) => {
          const invoices: AccountInvoice[] = list.map((x, i) => ({
            id: `i${i}`,
            kind: x.cancellation ? 'cancellation' : 'invoice',
            number: `RE-${i}`,
            date: '2026-01-10',
            subject: '',
            gross: cents(x.cancellation ? -x.gross : x.gross),
            due: `2026-03-${String(x.due).padStart(2, '0')}`,
            cancelled: x.cancelled,
          }));
          const payments: AccountPayment[] = pays.map((p, i) => ({ id: `p${i}`, invoiceId: `i${p.invoice}`, invoiceNumber: `RE-${p.invoice}`, date: '2026-02-01', amount: cents(p.amount), note: '' }));
          const today = '2026-03-15';
          let overdue = 0;
          for (const inv of invoices) {
            if (inv.kind !== 'invoice' || inv.cancelled || inv.due >= today) continue;
            overdue += openAmount(inv.gross, cents(payments.filter((p) => p.invoiceId === inv.id).reduce((a, p) => a + p.amount, 0)));
          }
          expect(customerAccount(invoices, payments, today).overdue).toBe(overdue);
        },
      ),
      fcParams,
    );
  });
});
