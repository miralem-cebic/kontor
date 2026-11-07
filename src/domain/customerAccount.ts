// The account of a customer (Kundenkonto): the invoices and cancellations issued to them and the payments received for
// them, in date order, with the balance after each entry. An invoice is owed by the customer, a payment is credited to
// them. The balance is what the customer owes (positive) or what is to be credited to them (negative): a payment above
// what is owed, or a payment on an invoice that was cancelled later, leaves a credit that is to be refunded.
//
// Payouts of the customer (money received without an invoice of kontor) are listed beside the account and add up to what
// they brought in; they are no payment of an invoice and do not change the balance.
//
// The functions take plain values. The caller (features/contacts) takes the issued documents and the active payments of
// one customer and passes them in, with the gross amounts as the invoices show them.

import { cents, sum, type Cents } from './money';
import { openAmount } from './payment';

/** An issued invoice or cancellation of the customer. A cancellation has a negative gross amount, as issued. */
export interface AccountInvoice {
  id: string;
  kind: 'invoice' | 'cancellation';
  number: string;
  date: string;
  subject: string;
  gross: Cents;
  /** Due date (YYYY-MM-DD); not used for a cancellation */
  due: string;
  /** A cancellation of this invoice exists */
  cancelled: boolean;
}

/** An active payment for one of the invoices of the customer */
export interface AccountPayment {
  id: string;
  invoiceId: string;
  /** Number of the invoice it pays */
  invoiceNumber: string;
  date: string;
  amount: Cents;
  note: string;
}

/** A payout of the customer without an invoice of kontor: money received, shown beside the account but not part of the balance */
export interface AccountPayout {
  id: string;
  date: string;
  /** The month it covers (YYYY-MM); empty when not given */
  period: string;
  /** What arrived */
  amount: Cents;
  /** What counts as income: the amount without the VAT inside it */
  income: Cents;
}

export type AccountEntryKind = 'invoice' | 'cancellation' | 'payment';

export interface AccountEntry {
  kind: AccountEntryKind;
  /** The document ID of an invoice or cancellation; the payment ID of a payment */
  id: string;
  date: string;
  /** The number of the invoice or cancellation; for a payment, the number of the invoice it pays */
  number: string;
  /** The subject of an invoice or cancellation, the note of a payment */
  text: string;
  /** Positive: the customer owes it; negative: it was paid or credited */
  amount: Cents;
  /** The balance after this entry */
  balance: Cents;
}

export interface CustomerAccount {
  /** Date order; on the same day an invoice comes before its payments */
  entries: AccountEntry[];
  /** Invoices and cancellations together: the net amount invoiced */
  invoiced: Cents;
  /** Payments received */
  paid: Cents;
  /** What the customer owes (positive) or is to be credited (negative) */
  balance: Cents;
  /** The open amounts of invoices past their due date, cancelled invoices excluded */
  overdue: Cents;
  /** The payouts without an invoice, in date order. They are income, not payments of an invoice, so they are not in `entries`. */
  payouts: AccountPayout[];
  /** What the payouts brought in, as it arrived */
  payoutsReceived: Cents;
  /** Of that, what counts as income */
  payoutsIncome: Cents;
}

const KIND_ORDER: Record<AccountEntryKind, number> = { invoice: 0, cancellation: 1, payment: 2 };

/** The account of a customer as of `today` (YYYY-MM-DD, for what is overdue) */
export function customerAccount(invoices: readonly AccountInvoice[], payments: readonly AccountPayment[], today: string, payouts: readonly AccountPayout[] = []): CustomerAccount {
  const paidOf = (invoiceId: string): Cents => sum(payments.filter((p) => p.invoiceId === invoiceId).map((p) => p.amount));

  const unsorted: AccountEntry[] = [
    ...invoices.map((inv): AccountEntry => ({ kind: inv.kind, id: inv.id, date: inv.date, number: inv.number, text: inv.subject, amount: inv.gross, balance: cents(0) })),
    ...payments.map((p): AccountEntry => ({ kind: 'payment', id: p.id, date: p.date, number: p.invoiceNumber, text: p.note, amount: cents(-p.amount), balance: cents(0) })),
  ];
  const entries = unsorted.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.number.localeCompare(b.number));
  let running = 0;
  for (const e of entries) {
    running += e.amount;
    e.balance = cents(running);
  }

  const invoiced = sum(invoices.map((inv) => inv.gross));
  const paid = sum(payments.map((p) => p.amount));
  const overdue = sum(
    invoices.filter((inv) => inv.kind === 'invoice' && !inv.cancelled && inv.due < today).map((inv) => openAmount(inv.gross, paidOf(inv.id))),
  );
  const sortedPayouts = [...payouts].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return {
    entries,
    invoiced,
    paid,
    balance: cents(running),
    overdue,
    payouts: sortedPayouts,
    payoutsReceived: sum(sortedPayouts.map((p) => p.amount)),
    payoutsIncome: sum(sortedPayouts.map((p) => p.income)),
  };
}
