import { isoDateOf } from '../domain/dates';
import { invoiceTotals } from '../domain/invoice';
import { openAmount, paidAmount, type PaymentContent } from '../domain/payment';
import type { DocumentId, PaymentId } from '../data/ids';
import type { Repository, StorageErrorKind } from '../data/repository';
import { makePayment } from '../data/schema';
import { cancellationOf, type AuditEntry, type CompanyFile, type DocumentFile, type InvoiceFile, type PaymentFile } from '../data/types';
import { putWrittenPayment, useApp } from '../store/appStore';
import { deviceId } from './issue';
import { flushWrites, openRepository } from './session';

// Payments of issued invoices (see domain/payment.ts). A payment is written to payments/<id>.json first and then
// appended to the audit log as `recordPayment`; removing one is a soft delete, written the same way and logged as
// `deletePayment`. Both are checked against the invoice as it is now: a payment needs an issued invoice that is not
// cancelled, and its amount may not exceed what is still open. The form checks the draft first (readPayment); these
// checks are the last word, because another device may have recorded a payment in the meantime.

/**
 * `notReady`: the invoice takes no payment (a draft, a cancelled invoice, a cancellation) or the account is not one of
 * the company; `tooHigh`: more than the open amount; `notPositive`: not more than 0; `dateInFuture`: dated after the
 * day of the recording; `gone`: no such payment, or it is removed already. The others are storage failures
 * (StorageErrorKind).
 */
export type PaymentFailure = 'notReady' | 'tooHigh' | 'notPositive' | 'dateInFuture' | 'gone' | StorageErrorKind;

type Failed = { ok: false; failure: PaymentFailure };

/** The payment as written, and whether the audit line was written as well */
export type PaymentResult = { ok: true; payment: PaymentFile; auditWritten: boolean } | Failed;

export interface PaymentContext {
  repo: Repository;
  company: CompanyFile;
  documents: ReadonlyMap<DocumentId, DocumentFile>;
  payments: ReadonlyMap<PaymentId, PaymentFile>;
  /** The browser that records the payment, for the audit log */
  device: string;
  now: Date;
}

const fail = (failure: PaymentFailure): Failed => ({ ok: false, failure });

/** The payments of one invoice, deleted ones included */
const paymentsOf = (payments: ReadonlyMap<PaymentId, PaymentFile>, invoiceId: DocumentId): PaymentFile[] =>
  [...payments.values()].filter((p) => p.invoiceId === invoiceId);

/** The issued invoice a payment may be recorded on, or null: it must be issued, not cancelled and not a cancellation */
function payableInvoice(documents: ReadonlyMap<DocumentId, DocumentFile>, id: DocumentId): (InvoiceFile & { issued: NonNullable<InvoiceFile['issued']> }) | null {
  const doc = documents.get(id);
  if (!doc || doc.kind !== 'invoice' || !doc.issued || doc.deletedAt || doc.cancels) return null;
  if (cancellationOf(documents.values(), doc.id)) return null;
  return { ...doc, issued: doc.issued };
}

/** Records a payment on an issued invoice: the file first, then the audit line */
export async function recordPayment(invoiceId: DocumentId, content: PaymentContent, ctx: PaymentContext): Promise<PaymentResult> {
  const invoice = payableInvoice(ctx.documents, invoiceId);
  if (!invoice) return fail('notReady');
  const account = ctx.company.bank.accounts.find((a) => a.id === content.accountId && !a.deletedAt);
  if (!account) return fail('notReady');

  const smallBusiness = invoice.issued.snapshot.company.tax.vat.kind === 'smallBusiness';
  const gross = invoiceTotals(invoice, smallBusiness).gross;
  const open = openAmount(gross, paidAmount(paymentsOf(ctx.payments, invoice.id)));
  if (content.amount <= 0) return fail('notPositive');
  if (content.amount > open) return fail('tooHigh');
  if (content.date > isoDateOf(ctx.now)) return fail('dateInFuture');

  const payment = makePayment(invoice.id, { ...content, accountId: account.id });
  const saved = await ctx.repo.savePayment(payment);
  if (!saved.ok) return fail(saved.error.kind);

  const at = ctx.now.toISOString();
  const audit = await ctx.repo.appendAudit(at.slice(0, 7), {
    at,
    action: 'recordPayment',
    documentId: invoice.id,
    number: invoice.issued.number,
    files: [],
    device: ctx.device,
    payment: { id: saved.value.id, date: saved.value.date, amount: saved.value.amount },
  });
  return { ok: true, payment: saved.value, auditWritten: audit.ok };
}

/** Removes a payment: a soft delete, so the file stays; the open amount of the invoice grows by its amount again */
export async function removePayment(id: PaymentId, ctx: PaymentContext): Promise<PaymentResult> {
  const payment = ctx.payments.get(id);
  if (!payment || payment.deletedAt) return fail('gone');
  const invoice = ctx.documents.get(payment.invoiceId);
  if (!invoice || invoice.kind !== 'invoice' || !invoice.issued) return fail('notReady');

  const at = ctx.now.toISOString();
  const removed = { ...payment, deletedAt: at, fieldUpdatedAt: { ...payment.fieldUpdatedAt, deletedAt: at } };
  const saved = await ctx.repo.savePayment(removed);
  if (!saved.ok) return fail(saved.error.kind);

  const audit = await ctx.repo.appendAudit(at.slice(0, 7), {
    at,
    action: 'deletePayment',
    documentId: invoice.id,
    number: invoice.issued.number,
    files: [],
    device: ctx.device,
    payment: { id: saved.value.id, date: saved.value.date, amount: saved.value.amount },
  } satisfies AuditEntry);
  return { ok: true, payment: saved.value, auditWritten: audit.ok };
}

/** Runs `step` on the open company: what is pending is written first; the result goes into the store */
async function inOpenCompany(step: (ctx: PaymentContext) => Promise<PaymentResult>): Promise<PaymentResult> {
  const repo = openRepository();
  if (!repo) return fail('notFound');
  if (!(await flushWrites())) return fail('other');
  const { company, documents, payments } = useApp.getState();
  if (!company) return fail('notFound');
  let result: PaymentResult;
  try {
    result = await step({ repo, company, documents, payments, device: deviceId(), now: new Date() });
  } catch (e) {
    console.error('Could not write the payment', e);
    return fail('other');
  }
  if (result.ok) putWrittenPayment(result.payment);
  return result;
}

/** Records a payment on an invoice of the open company */
export const recordPaymentOf = (invoiceId: DocumentId, content: PaymentContent): Promise<PaymentResult> => inOpenCompany((ctx) => recordPayment(invoiceId, content, ctx));

/** Removes a payment of the open company */
export const removePaymentOf = (id: PaymentId): Promise<PaymentResult> => inOpenCompany((ctx) => removePayment(id, ctx));
