// Payments (Zahlungseingänge) of issued invoices: how much of an invoice is paid, what is still open, and whether it is
// overdue. A payment is a fact: a date, an amount and the bank account it arrived on. It never changes; a wrong one is
// removed (soft delete, audit entry). kontor works on the cash basis (EÜR, § 11 EStG): the date of the payment is the
// date the money came in, and it does not have to match the date of the invoice.

import type { Result } from '../data/result';
import { Checker, type FieldError } from './check';
import { isIsoDate } from './dates';
import { cents, divideRounded, formatDecimal, parseCents, sum, type Cents, type MoneyLocale } from './money';

/** The longest note of a payment */
export const PAYMENT_NOTE_LIMIT = 200;

/** The largest amount a payment file may hold: 99,999,999.99 €. Far above any invoice the forms accept. */
export const MAX_PAYMENT_AMOUNT: Cents = cents(99_999_999_999);

/** What a payment is: the content as the form checks it; the record adds its ID, its invoice and its deletion */
export interface PaymentContent {
  /** Date the money arrived, YYYY-MM-DD */
  date: string;
  /** More than 0 and at most the open amount of the invoice when it was recorded */
  amount: Cents;
  /** An active account of the company; a payment keeps it even when the account is removed later */
  accountId: string;
  /** Free text, empty when not given (for example the reference of the bank transfer) */
  note: string;
}

/** The fields a payment record has to have for the calculations here */
export interface PaymentAmount {
  amount: Cents;
  deletedAt: string | null;
}

/** The payments that count: a deleted payment is no payment */
export function activePayments<T extends PaymentAmount>(payments: Iterable<T>): T[] {
  return [...payments].filter((p) => p.deletedAt === null);
}

/** The sum of the active payments of an invoice */
export function paidAmount(payments: Iterable<PaymentAmount>): Cents {
  return sum(activePayments(payments).map((p) => p.amount));
}

/** What is still to pay: the gross amount less what was paid, never below 0 (an overpayment is not an open amount) */
export function openAmount(gross: Cents, paid: Cents): Cents {
  return cents(Math.max(0, gross - paid));
}

/** `a` × `b` ÷ `d`, rounded once (half away from zero); `d` may be negative, but not 0. An exact integer, whatever the size. */
export function proportion(a: Cents, b: Cents, d: Cents): Cents {
  const product = BigInt(a) * BigInt(b);
  const share = d > 0 ? divideRounded(product, BigInt(d)) : divideRounded(-product, -BigInt(d));
  return cents(Number(share));
}

/**
 * The net part of one payment taken on its own: the share of its invoice that the amount pays, amount × net ÷ gross,
 * rounded once. A payment on an invoice without VAT sums (gross 0) counts with its whole amount. The sums of a
 * cancellation are negative: the fraction is expanded by −1, so the share stays the same and the divisor positive.
 * Parts of one invoice must not be added up from this: use `netPartsOf`, which makes them add up to the net amount.
 */
export function netShareOf(amount: Cents, net: Cents, gross: Cents): Cents {
  return gross === 0 ? amount : proportion(amount, net, gross);
}

/** A payment as the shares are computed from it; the ID decides the order of two payments of one day (optional in tests) */
export interface ShareablePayment {
  id?: string;
  invoiceId: string;
  date: string;
  amount: Cents;
}

/** The order the payments of an invoice are taken in: the day, then the ID */
export const comparePayments = (a: { date: string; id?: string }, b: { date: string; id?: string }): number =>
  a.date.localeCompare(b.date) || (a.id ?? '').localeCompare(b.id ?? '');

/**
 * The net part of every payment, in the order of the list. The parts of one invoice are taken from the cumulative amount
 * paid in the order of the payments (day, then ID): the share of the sum paid after a payment less the share of the
 * sum paid before it, with the sum capped at the gross amount. So the parts of an invoice add up to its net amount
 * exactly (never 1 cent more or less, as the shares of single payments would), also over several years, and whoever
 * looks at only one year gets the cents of the payments of that year. A payment on an invoice that is not in `invoices`
 * counts with its whole amount. This is the rule of the advance VAT return as well (`ustva.ts`).
 */
export function netPartsOf(invoices: ReadonlyMap<string, { net: Cents; gross: Cents }>, payments: readonly ShareablePayment[]): Cents[] {
  const parts: Cents[] = new Array<Cents>(payments.length);
  const byInvoice = new Map<string, number[]>();
  payments.forEach((p, i) => {
    if (!invoices.has(p.invoiceId)) {
      parts[i] = p.amount;
      return;
    }
    const list = byInvoice.get(p.invoiceId);
    if (list) list.push(i);
    else byInvoice.set(p.invoiceId, [i]);
  });
  for (const [invoiceId, indexes] of byInvoice) {
    const inv = invoices.get(invoiceId);
    if (!inv) continue;
    indexes.sort((x, y) => comparePayments(payments[x] as ShareablePayment, payments[y] as ShareablePayment) || x - y);
    const limit = Math.abs(inv.gross);
    const shareAt = (paid: number): Cents => netShareOf(cents(inv.gross === 0 ? paid : Math.min(paid, limit)), inv.net, inv.gross);
    let paid = 0;
    for (const i of indexes) {
      const before = shareAt(paid);
      paid += (payments[i] as ShareablePayment).amount;
      parts[i] = cents(shareAt(paid) - before);
    }
  }
  return parts;
}

/**
 * The state of an issued invoice. `cancelled` when a cancellation invoice exists: a cancelled invoice is no longer due,
 * whatever was paid. An invoice with nothing to pay (a gross amount of 0) counts as paid.
 */
export type PaymentState = 'open' | 'partlyPaid' | 'paid' | 'cancelled';

export function paymentStateOf({ gross, paid, cancelled }: { gross: Cents; paid: Cents; cancelled: boolean }): PaymentState {
  if (cancelled) return 'cancelled';
  if (openAmount(gross, paid) === 0) return 'paid';
  return paid > 0 ? 'partlyPaid' : 'open';
}

/**
 * Overdue: something is still open after the due date. The due date itself is not yet overdue; the dates are ISO
 * dates, so they compare as text.
 */
export function isOverdue({ gross, paid, due, today, cancelled }: { gross: Cents; paid: Cents; due: string; today: string; cancelled: boolean }): boolean {
  return !cancelled && openAmount(gross, paid) > 0 && due < today;
}

/* ---------- Draft and checks ---------- */

/** A payment as the form edits it: strings as typed */
export interface PaymentDraft {
  date: string;
  amount: string;
  accountId: string;
  note: string;
}

export type PaymentField = keyof PaymentDraft;
export type PaymentFieldError = FieldError<PaymentField>;

/** A new payment starts with today, the open amount (so that paying in full is one click) and the account of the invoice */
export const emptyPaymentDraft = (today: string, accountId: string, open: Cents, locale: MoneyLocale): PaymentDraft => ({
  date: today,
  amount: formatDecimal(open, locale),
  accountId,
  note: '',
});

/**
 * Checks a payment draft against the open amount of its invoice and the active accounts of the company. Every problem
 * is reported at once, so that the form can show all of them.
 */
export function readPayment(d: PaymentDraft, locale: MoneyLocale, against: { open: Cents; accounts: readonly string[] }): Result<PaymentContent, PaymentFieldError[]> {
  const c = new Checker<PaymentField>();
  if (!isIsoDate(d.date)) c.add('date', 'date');

  let amount = cents(0);
  const typed = d.amount.trim();
  if (!typed) c.add('amount', 'required');
  else {
    const parsed = parseCents(typed, locale);
    if (parsed === null || parsed > MAX_PAYMENT_AMOUNT) c.add('amount', 'amount');
    else if (parsed <= 0) c.add('amount', 'amountNotPositive');
    else if (parsed > against.open) c.add('amount', 'amountTooHigh');
    else amount = parsed;
  }

  if (!d.accountId) c.add('accountId', 'required');
  else if (!against.accounts.includes(d.accountId)) c.add('accountId', 'accountRemoved');

  const note = c.optionalText('note', d.note, PAYMENT_NOTE_LIMIT);
  return c.done(() => ({ date: d.date, amount, accountId: d.accountId, note }));
}
