// The account of a customer (Kundenkonto): the issued invoices and cancellations of one customer and their active
// payments, mapped into the rows the domain computes the account from (src/domain/customerAccount.ts).

import type { ContactId, DocumentId, PaymentId, PayoutId } from '../data/ids';
import { cancelledIds, isInvoice, type DocumentFile, type InvoiceFile, type PaymentFile, type PayoutFile } from '../data/types';
import type { AccountInvoice, AccountPayment, AccountPayout } from '../domain/customerAccount';
import { dueDate, invoiceTotals, type IssuedInfo } from '../domain/invoice';
import { activePayments } from '../domain/payment';
import { payoutNet } from '../domain/payout';

type IssuedInvoice = InvoiceFile & { issued: IssuedInfo };

/** The invoices, cancellations, active payments and active payouts of one customer, as the account reads them */
export function accountInputs(contactId: ContactId, documents: ReadonlyMap<DocumentId, DocumentFile>, payments: ReadonlyMap<PaymentId, PaymentFile>, payouts: ReadonlyMap<PayoutId, PayoutFile>) {
  const cancelled = cancelledIds(documents.values());
  const issued = [...documents.values()].filter((d): d is IssuedInvoice => isInvoice(d) && d.issued !== null && !d.deletedAt && d.customerId === contactId);
  const numberOf = new Map<string, string>(issued.map((d): [string, string] => [d.id, d.issued.number]));
  const invoices: AccountInvoice[] = issued.map((d) => {
    // an issued invoice keeps the VAT scheme it was issued with
    const smallBusiness = d.issued.snapshot.company.tax.vat.kind === 'smallBusiness';
    return {
      id: d.id,
      kind: d.cancels ? 'cancellation' : 'invoice',
      number: d.issued.number,
      date: d.date,
      subject: d.subject,
      gross: invoiceTotals(d, smallBusiness).gross,
      due: dueDate(d),
      cancelled: cancelled.has(d.id),
    };
  });
  const paymentsOf = activePayments([...payments.values()]).flatMap((p): AccountPayment[] => {
    const number = numberOf.get(p.invoiceId);
    return number ? [{ id: p.id, invoiceId: p.invoiceId, invoiceNumber: number, date: p.date, amount: p.amount, note: p.note }] : [];
  });
  const payoutsOf = [...payouts.values()]
    .filter((p) => p.payerId === contactId && !p.deletedAt)
    .map((p): AccountPayout => ({ id: p.id, date: p.date, period: p.period, amount: p.amount, income: payoutNet(p) }));
  return { invoices, payments: paymentsOf, payouts: payoutsOf };
}
