import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cents, type Cents } from '../../src/domain/money';
import {
  activePayments,
  emptyPaymentDraft,
  isOverdue,
  MAX_PAYMENT_AMOUNT,
  openAmount,
  paidAmount,
  paymentStateOf,
  readPayment,
  type PaymentDraft,
} from '../../src/domain/payment';
import { fcParams as params } from './fixtures';

const TODAY = '2026-10-31';
const ACCOUNTS = ['account-bank', 'account-paypal'];
const open = cents(11_900);

/** A draft that passes every check against `open` and ACCOUNTS */
const draft = (over: Partial<PaymentDraft> = {}): PaymentDraft => ({
  date: TODAY,
  amount: '119,00',
  accountId: 'account-bank',
  note: '',
  ...over,
});

const checkWith = (d: PaymentDraft, locale: 'de' | 'en' = 'de', amountOpen: Cents = open) => readPayment(d, locale, { open: amountOpen, accounts: ACCOUNTS });

describe('paidAmount and openAmount', () => {
  it('counts the active payments only; a deleted payment is no payment', () => {
    const payments = [
      { amount: cents(5_000), deletedAt: null },
      { amount: cents(2_000), deletedAt: '2026-10-20T10:00:00.000Z' },
      { amount: cents(1_000), deletedAt: null },
    ];
    expect(paidAmount(payments)).toBe(6_000);
    expect(activePayments(payments)).toHaveLength(2);
  });

  it('the open amount is what is left, never negative', () => {
    expect(openAmount(cents(11_900), cents(5_000))).toBe(6_900);
    expect(openAmount(cents(11_900), cents(11_900))).toBe(0);
    expect(openAmount(cents(11_900), cents(12_500))).toBe(0);
  });

  it('partial payments add up to the gross amount exactly (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.array(fc.integer({ min: 1, max: 50_000 }), { maxLength: 10 }), (gross, parts) => {
        const paid = cents(parts.reduce((a, b) => a + b, 0));
        const total = cents(gross);
        const rest = openAmount(total, paid);
        expect(rest + Math.min(paid, total)).toBe(total);
        expect(rest).toBeGreaterThanOrEqual(0);
      }),
      params,
    );
  });
});

describe('paymentStateOf', () => {
  it('open, partly paid, paid and cancelled', () => {
    expect(paymentStateOf({ gross: cents(11_900), paid: cents(0), cancelled: false })).toBe('open');
    expect(paymentStateOf({ gross: cents(11_900), paid: cents(5_000), cancelled: false })).toBe('partlyPaid');
    expect(paymentStateOf({ gross: cents(11_900), paid: cents(11_900), cancelled: false })).toBe('paid');
    expect(paymentStateOf({ gross: cents(11_900), paid: cents(0), cancelled: true })).toBe('cancelled');
  });

  it('an invoice without an amount to pay is paid', () => {
    expect(paymentStateOf({ gross: cents(0), paid: cents(0), cancelled: false })).toBe('paid');
  });
});

describe('isOverdue', () => {
  const base = { gross: cents(11_900), paid: cents(0), due: '2026-10-30', today: TODAY, cancelled: false };

  it('an invoice past its due date with an open amount is overdue', () => {
    expect(isOverdue(base)).toBe(true);
    expect(isOverdue({ ...base, paid: cents(5_000) })).toBe(true);
  });

  it('the due date itself is not yet overdue', () => {
    expect(isOverdue({ ...base, due: TODAY })).toBe(false);
  });

  it('a paid, cancelled or zero invoice is never overdue', () => {
    expect(isOverdue({ ...base, paid: cents(11_900) })).toBe(false);
    expect(isOverdue({ ...base, cancelled: true })).toBe(false);
    expect(isOverdue({ ...base, gross: cents(0) })).toBe(false);
  });
});

describe('readPayment', () => {
  it('a complete draft gives the payment', () => {
    const r = checkWith(draft({ note: 'Überweisung 4711' }));
    expect(r).toEqual({ ok: true, value: { date: TODAY, amount: 11_900, accountId: 'account-bank', note: 'Überweisung 4711' } });
  });

  it('reads the amount in the language of the interface: 1.234,56 (de) and 1,234.56 (en)', () => {
    expect(checkWith(draft({ amount: '1.234,56' }), 'de', cents(200_000))).toMatchObject({ ok: true, value: { amount: 123_456 } });
    expect(checkWith(draft({ amount: '1,234.56' }), 'en', cents(200_000))).toMatchObject({ ok: true, value: { amount: 123_456 } });
  });

  it('the amount is required, a number and more than 0', () => {
    expect(checkWith(draft({ amount: '' }))).toEqual({ ok: false, error: [{ field: 'amount', problem: 'required' }] });
    expect(checkWith(draft({ amount: 'zwölf' }))).toEqual({ ok: false, error: [{ field: 'amount', problem: 'amount' }] });
    expect(checkWith(draft({ amount: '0,00' }))).toEqual({ ok: false, error: [{ field: 'amount', problem: 'amountNotPositive' }] });
    expect(checkWith(draft({ amount: '-10,00' }))).toEqual({ ok: false, error: [{ field: 'amount', problem: 'amountNotPositive' }] });
  });

  it('a payment is never more than the open amount', () => {
    expect(checkWith(draft({ amount: '119,01' }))).toEqual({ ok: false, error: [{ field: 'amount', problem: 'amountTooHigh' }] });
    expect(checkWith(draft({ amount: '50,00' }), 'de', cents(5_000))).toMatchObject({ ok: true, value: { amount: 5_000 } });
  });

  it('the amount has a limit that a file can hold', () => {
    const tooLarge = `${Math.floor(MAX_PAYMENT_AMOUNT / 100) + 1},00`;
    expect(checkWith(draft({ amount: tooLarge }), 'de', cents(MAX_PAYMENT_AMOUNT))).toEqual({ ok: false, error: [{ field: 'amount', problem: 'amount' }] });
  });

  it('the date must be a date', () => {
    expect(checkWith(draft({ date: '31.10.2026' }))).toEqual({ ok: false, error: [{ field: 'date', problem: 'date' }] });
  });

  it('the account must be an active account of the company', () => {
    expect(checkWith(draft({ accountId: '' }))).toEqual({ ok: false, error: [{ field: 'accountId', problem: 'required' }] });
    expect(checkWith(draft({ accountId: 'removed' }))).toEqual({ ok: false, error: [{ field: 'accountId', problem: 'accountRemoved' }] });
  });

  it('a note may not be longer than the limit', () => {
    expect(checkWith(draft({ note: 'x'.repeat(201) }))).toEqual({ ok: false, error: [{ field: 'note', problem: 'tooLong' }] });
  });

  it('every problem is reported at once', () => {
    const r = checkWith(draft({ date: 'x', amount: '', accountId: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.map((e) => e.field)).toEqual(['date', 'amount', 'accountId']);
  });
});

describe('emptyPaymentDraft', () => {
  it('starts with today, the open amount typed in the language of the interface and the account', () => {
    expect(emptyPaymentDraft(TODAY, 'account-bank', cents(11_900), 'de')).toEqual({ date: TODAY, amount: '119,00', accountId: 'account-bank', note: '' });
    expect(emptyPaymentDraft(TODAY, 'account-bank', cents(11_900), 'en')).toMatchObject({ amount: '119.00' });
  });
});
