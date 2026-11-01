import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cents } from '../../src/domain/money';
import { customerAccount, type AccountInvoice, type AccountPayment } from '../../src/domain/customerAccount';
import { fcParams as params } from './fixtures';

const TODAY = '2026-10-31';

/** An issued invoice; a cancellation has a negative gross amount, as issued */
const invoice = (over: Partial<AccountInvoice> = {}): AccountInvoice => ({
  id: 'inv-1',
  kind: 'invoice',
  number: 'RE-2026-0001',
  date: '2026-10-01',
  subject: 'Beratung',
  gross: cents(100_000),
  due: '2026-10-15',
  cancelled: false,
  ...over,
});

const payment = (over: Partial<AccountPayment> = {}): AccountPayment => ({
  id: 'pay-1',
  invoiceId: 'inv-1',
  invoiceNumber: 'RE-2026-0001',
  date: '2026-10-10',
  amount: cents(30_000),
  note: '',
  ...over,
});

describe('customer account: entries and balance', () => {
  it('an invoice is owed, a payment is credited; the balance is what the customer owes', () => {
    const account = customerAccount([invoice()], [payment()], TODAY);
    expect(account.invoiced).toBe(100_000);
    expect(account.paid).toBe(30_000);
    expect(account.balance).toBe(70_000);
    expect(account.entries).toEqual([
      { kind: 'invoice', id: 'inv-1', date: '2026-10-01', number: 'RE-2026-0001', text: 'Beratung', amount: 100_000, balance: 100_000 },
      { kind: 'payment', id: 'pay-1', date: '2026-10-10', number: 'RE-2026-0001', text: '', amount: -30_000, balance: 70_000 },
    ]);
  });

  it('entries are in date order with the balance after each of them', () => {
    const second = invoice({ id: 'inv-2', number: 'RE-2026-0002', date: '2026-10-15', due: '2026-10-29', gross: cents(20_000) });
    const account = customerAccount([second, invoice()], [payment()], TODAY);
    expect(account.entries.map((e) => [e.date, e.kind])).toEqual([
      ['2026-10-01', 'invoice'],
      ['2026-10-10', 'payment'],
      ['2026-10-15', 'invoice'],
    ]);
    expect(account.entries.map((e) => e.balance)).toEqual([100_000, 70_000, 90_000]);
  });

  it('on the same day an invoice comes before its payment', () => {
    const account = customerAccount([invoice({ date: '2026-10-10' })], [payment({ date: '2026-10-10' })], TODAY);
    expect(account.entries.map((e) => e.kind)).toEqual(['invoice', 'payment']);
  });

  it('a cancelled invoice is owed and credited back, so only the payments remain: a credit', () => {
    const cancelledInvoice = invoice({ cancelled: true, due: '2026-10-15' });
    const credit = invoice({ id: 'storno-1', kind: 'cancellation', number: 'RE-2026-0002', date: '2026-10-20', gross: cents(-100_000), due: '' });
    const account = customerAccount([cancelledInvoice, credit], [payment()], TODAY);
    expect(account.invoiced).toBe(0);
    expect(account.balance).toBe(-30_000);
    expect(account.entries.map((e) => [e.kind, e.balance])).toEqual([
      ['invoice', 100_000],
      ['payment', 70_000],
      ['cancellation', -30_000],
    ]);
  });

  it('a payment above what is owed is a credit of the customer', () => {
    const account = customerAccount([invoice({ gross: cents(10_000) })], [payment({ amount: cents(12_000) })], TODAY);
    expect(account.balance).toBe(-2_000);
  });

  it('nothing to show: an empty account with a balance of 0', () => {
    expect(customerAccount([], [], TODAY)).toEqual({ entries: [], invoiced: 0, paid: 0, balance: 0, overdue: 0 });
  });
});

describe('customer account: overdue', () => {
  it('the open amount of an invoice past its due date is overdue', () => {
    const account = customerAccount([invoice()], [payment()], TODAY);
    expect(account.overdue).toBe(70_000);
  });

  it('the due date itself is not overdue, and a paid invoice is not overdue', () => {
    expect(customerAccount([invoice({ due: TODAY })], [], TODAY).overdue).toBe(0);
    expect(customerAccount([invoice({ gross: cents(30_000) })], [payment()], TODAY).overdue).toBe(0);
  });

  it('a cancelled invoice is never overdue', () => {
    expect(customerAccount([invoice({ cancelled: true })], [], TODAY).overdue).toBe(0);
  });
});

describe('customer account: invariants', () => {
  const amount = fc.integer({ min: 1, max: 1_000_000 });

  it('the last balance is the balance, and the balance is the open amounts of the invoices when no invoice is overpaid (property)', () => {
    fc.assert(
      fc.property(
        fc.array(amount, { minLength: 1, maxLength: 6 }),
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 6 }),
        (grosses, shares) => {
          const invoices = grosses.map((g, i) => invoice({ id: `inv-${i}`, number: `RE-${i}`, gross: cents(g), date: '2026-10-01', due: '2026-10-15' }));
          const payments: AccountPayment[] = invoices.flatMap((inv, i) => {
            const share = shares[i % shares.length] ?? 0;
            const amountPaid = Math.floor((inv.gross * share) / 100);
            return amountPaid > 0 ? [payment({ id: `pay-${i}`, invoiceId: inv.id, invoiceNumber: inv.number, amount: cents(amountPaid) })] : [];
          });
          const account = customerAccount(invoices, payments, TODAY);
          const open = invoices.reduce((sum, inv) => sum + (inv.gross - payments.filter((p) => p.invoiceId === inv.id).reduce((s, p) => s + p.amount, 0)), 0);
          expect(account.balance).toBe(open);
          expect(account.entries[account.entries.length - 1]?.balance ?? 0).toBe(account.balance);
          expect(account.overdue).toBe(open);
        },
      ),
      params,
    );
  });
});
