// Payments (Zahlungseingänge) of issued invoices: how much of an invoice is paid, what is still open, and whether it is
// overdue. A payment is a fact: a date, an amount and the bank account it arrived on. It never changes; a wrong one is
// removed (soft delete, audit entry). kontor works on the cash basis (EÜR, § 11 EStG): the date of the payment is the
// date the money came in, and it does not have to match the date of the invoice.

import type { Result } from '../data/result';
import { Checker, type FieldError } from './check';
import { isIsoDate } from './dates';
import { cents, formatDecimal, parseCents, sum, type Cents, type MoneyLocale } from './money';

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
