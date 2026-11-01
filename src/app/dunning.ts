import { isIsoDate, addDays, isoDateOf } from '../domain/dates';
import { dueDate, invoiceTotals } from '../domain/invoice';
import { DUNNING_PAY_DAYS, planDunning, type Debtor, type DunningProblem, type PriorDunning } from '../domain/dunning';
import { cents, MAX_FEE, type Cents } from '../domain/money';
import { openAmount, paidAmount } from '../domain/payment';
import type { DocumentId, DunningId, PaymentId } from '../data/ids';
import type { Repository, StorageErrorKind } from '../data/repository';
import { makeDunning } from '../data/schema';
import { cancellationOf, type AuditEntry, type CompanyFile, type DocumentFile, type DunningFile, type PaymentFile } from '../data/types';
import { putWrittenDunning, useApp } from '../store/appStore';
import { deviceId } from './issue';
import { flushWrites, openRepository } from './session';

// Dunning an overdue invoice (domain/dunning.ts): the next level, the interest since the last dunning and the flat fee
// are planned from the invoice as it is now, the dunning is written to dunnings/ first and then appended to the audit
// log as `dunning`. A dunning is never changed afterwards. The letter itself and its sending come later.

/** What a dunning can fail on: the invoice takes none (not issued, a cancellation, a bad date or fee), the plan refuses it with its reasons, or storage */
export type DunningResult =
  | { ok: true; dunning: DunningFile; auditWritten: boolean }
  | { ok: false; failure: 'notReady' }
  | { ok: false; failure: 'planning'; problems: DunningProblem[] }
  | { ok: false; failure: StorageErrorKind };

export interface DunningContext {
  repo: Repository;
  company: CompanyFile;
  documents: ReadonlyMap<DocumentId, DocumentFile>;
  payments: ReadonlyMap<PaymentId, PaymentFile>;
  dunnings: ReadonlyMap<DunningId, DunningFile>;
  /** The browser that issues the dunning, for the audit log */
  device: string;
  now: Date;
}

/** The dunnings of one invoice, in the order they were issued */
const dunningsOf = (dunnings: ReadonlyMap<DunningId, DunningFile>, invoiceId: DocumentId): DunningFile[] =>
  [...dunnings.values()].filter((d) => d.invoiceId === invoiceId).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

/** Issues a dunning of an issued invoice on `content.date` with the fee typed in */
export async function issueDunning(invoiceId: DocumentId, content: { date: string; fee: Cents }, ctx: DunningContext): Promise<DunningResult> {
  const invoice = ctx.documents.get(invoiceId);
  if (!invoice || invoice.kind !== 'invoice' || !invoice.issued || invoice.deletedAt || invoice.cancels) return { ok: false, failure: 'notReady' };
  if (!isIsoDate(content.date) || content.fee < 0 || content.fee > MAX_FEE) return { ok: false, failure: 'notReady' };

  const smallBusiness = invoice.issued.snapshot.company.tax.vat.kind === 'smallBusiness';
  const gross = invoiceTotals(invoice, smallBusiness).gross;
  const paid = paidAmount([...ctx.payments.values()].filter((p) => p.invoiceId === invoice.id));
  const open = openAmount(gross, paid);
  const prior: PriorDunning[] = dunningsOf(ctx.dunnings, invoice.id).map((d) => ({ level: d.level, date: d.date, flatFee: d.flatFee }));
  const debtor: Debtor = invoice.issued.snapshot.customer.kind === 'company' ? 'business' : 'consumer';
  const planned = planDunning({
    open,
    due: dueDate(invoice),
    date: content.date,
    today: isoDateOf(ctx.now),
    debtor,
    cancelled: cancellationOf(ctx.documents.values(), invoice.id) !== undefined,
    prior,
  });
  if (!planned.ok) return { ok: false, failure: 'planning', problems: planned.error };

  const plan = planned.value;
  const saved = await ctx.repo.saveDunning(
    makeDunning(invoice.id, {
      level: plan.level,
      date: content.date,
      debtor,
      open,
      interestFrom: plan.interestFrom,
      interest: plan.interest,
      flatFee: plan.flatFee,
      fee: content.fee,
      payBy: addDays(content.date, DUNNING_PAY_DAYS),
    }),
  );
  if (!saved.ok) return { ok: false, failure: saved.error.kind };

  const at = ctx.now.toISOString();
  const audit = await ctx.repo.appendAudit(at.slice(0, 7), {
    at,
    action: 'dunning',
    documentId: invoice.id,
    number: invoice.issued.number,
    files: [],
    device: ctx.device,
    dunning: { id: saved.value.id, level: saved.value.level, date: saved.value.date, amount: cents(plan.interest + content.fee + plan.flatFee) },
  } satisfies AuditEntry);
  return { ok: true, dunning: saved.value, auditWritten: audit.ok };
}

/** Issues a dunning of the open company: what is pending is written first; the result goes into the store */
export async function issueDunningOf(invoiceId: DocumentId, content: { date: string; fee: Cents }): Promise<DunningResult> {
  const repo = openRepository();
  if (!repo) return { ok: false, failure: 'notFound' };
  if (!(await flushWrites())) return { ok: false, failure: 'other' };
  const { company, documents, payments, dunnings } = useApp.getState();
  if (!company) return { ok: false, failure: 'notFound' };
  let result: DunningResult;
  try {
    result = await issueDunning(invoiceId, content, { repo, company, documents, payments, dunnings, device: deviceId(), now: new Date() });
  } catch (e) {
    console.error('Could not write the dunning', e);
    return { ok: false, failure: 'other' };
  }
  if (result.ok) putWrittenDunning(result.dunning);
  return result;
}
