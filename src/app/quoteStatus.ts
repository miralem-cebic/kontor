import { decisionProblems, activeDecision, readDecisionDate, type DecisionProblem, type QuoteDecision } from '../domain/quoteStatus';
import { isoDateOf } from '../domain/dates';
import type { DocumentId, QuoteStatusId } from '../data/ids';
import type { Repository, StorageErrorKind } from '../data/repository';
import { makeQuoteStatus } from '../data/schema';
import type { AuditEntry, DocumentFile, QuoteStatusFile } from '../data/types';
import { putWrittenQuoteStatus, useApp } from '../store/appStore';
import { deviceId } from './issue';
import { flushWrites, openRepository } from './session';

// The customer's decisions on a finalized quote (domain/quoteStatus.ts, F21). A decision is written to quoteStatus/<id>.json
// first and then appended to the audit log as `quoteDecision`; removing one is a soft delete, written the same way and logged
// as `deleteQuoteDecision`. Both are checked against the quote as it is now: another device may have decided meanwhile.

/**
 * `notReady`: no such quote or decision, or it is removed; `planning`: the rules refuse it, with their reasons; `date`: the
 * date is not one; the others are storage failures
 */
export type DecisionResult =
  | { ok: true; status: QuoteStatusFile; auditWritten: boolean }
  | { ok: false; failure: 'notReady' | 'date' | StorageErrorKind }
  | { ok: false; failure: 'planning'; problems: DecisionProblem[] };

export interface DecisionContext {
  repo: Repository;
  documents: ReadonlyMap<DocumentId, DocumentFile>;
  quoteStatuses: ReadonlyMap<QuoteStatusId, QuoteStatusFile>;
  /** The browser that records the decision, for the audit log */
  device: string;
  now: Date;
}

/** The decisions of one quote, removed ones included */
const decisionsOf = (statuses: ReadonlyMap<QuoteStatusId, QuoteStatusFile>, quoteId: DocumentId): QuoteStatusFile[] =>
  [...statuses.values()].filter((s) => s.quoteId === quoteId);

/** A later version of the quote is finalized: the customer decides on that one */
const replacedBy = (documents: ReadonlyMap<DocumentId, DocumentFile>, quoteId: DocumentId): boolean =>
  [...documents.values()].some((d) => d.kind === 'quote' && !d.deletedAt && !!d.issued && d.revises?.id === quoteId);

/** Records the decision of the customer on a finalized quote: the file first, then the audit line */
export async function decideQuote(quoteId: DocumentId, content: { decision: QuoteDecision; date: string }, ctx: DecisionContext): Promise<DecisionResult> {
  const quote = ctx.documents.get(quoteId);
  if (!quote || quote.kind !== 'quote' || quote.deletedAt) return { ok: false, failure: 'notReady' };
  const date = readDecisionDate(content.date);
  if (!date.ok) return { ok: false, failure: 'date' };
  const problems = decisionProblems({
    finalized: !!quote.issued,
    replaced: replacedBy(ctx.documents, quote.id),
    decided: activeDecision(decisionsOf(ctx.quoteStatuses, quote.id)) !== null,
    quoteDate: quote.date,
    date: date.value,
    today: isoDateOf(ctx.now),
  });
  if (problems.length > 0) return { ok: false, failure: 'planning', problems };

  const status = makeQuoteStatus(quote.id, { decision: content.decision, date: date.value });
  const saved = await ctx.repo.saveQuoteStatus(status);
  if (!saved.ok) return { ok: false, failure: saved.error.kind };

  const at = ctx.now.toISOString();
  const audit = await ctx.repo.appendAudit(at.slice(0, 7), {
    at,
    action: 'quoteDecision',
    documentId: quote.id,
    number: quote.issued?.number ?? '',
    files: [],
    device: ctx.device,
    quoteStatus: { id: saved.value.id, decision: saved.value.decision, date: saved.value.date },
  } satisfies AuditEntry);
  return { ok: true, status: saved.value, auditWritten: audit.ok };
}

/** Removes a decision: a soft delete, so the file stays; the quote counts as undecided again when no other decision counts */
export async function removeQuoteDecision(id: QuoteStatusId, ctx: DecisionContext): Promise<DecisionResult> {
  const status = ctx.quoteStatuses.get(id);
  if (!status || status.deletedAt) return { ok: false, failure: 'notReady' };
  const quote = ctx.documents.get(status.quoteId);

  const at = ctx.now.toISOString();
  const removed = { ...status, deletedAt: at, fieldUpdatedAt: { ...status.fieldUpdatedAt, deletedAt: at } };
  const saved = await ctx.repo.saveQuoteStatus(removed);
  if (!saved.ok) return { ok: false, failure: saved.error.kind };

  const audit = await ctx.repo.appendAudit(at.slice(0, 7), {
    at,
    action: 'deleteQuoteDecision',
    documentId: status.quoteId,
    number: quote?.issued?.number ?? '',
    files: [],
    device: ctx.device,
    quoteStatus: { id: saved.value.id, decision: saved.value.decision, date: saved.value.date },
  } satisfies AuditEntry);
  return { ok: true, status: saved.value, auditWritten: audit.ok };
}

/** Runs `step` on the open company: what is pending is written first; the result goes into the store */
async function inOpenCompany(step: (ctx: DecisionContext) => Promise<DecisionResult>): Promise<DecisionResult> {
  const repo = openRepository();
  if (!repo) return { ok: false, failure: 'notReady' };
  if (!(await flushWrites())) return { ok: false, failure: 'other' };
  const { company, documents, quoteStatuses } = useApp.getState();
  if (!company) return { ok: false, failure: 'notReady' };
  let result: DecisionResult;
  try {
    result = await step({ repo, documents, quoteStatuses, device: deviceId(), now: new Date() });
  } catch (e) {
    console.error('Could not write the decision', e);
    return { ok: false, failure: 'other' };
  }
  if (result.ok) putWrittenQuoteStatus(result.status);
  return result;
}

/** Records a decision on a quote of the open company */
export const decideQuoteOf = (quoteId: DocumentId, content: { decision: QuoteDecision; date: string }): Promise<DecisionResult> =>
  inOpenCompany((ctx) => decideQuote(quoteId, content, ctx));

/** Removes a decision of the open company */
export const removeQuoteDecisionOf = (id: QuoteStatusId): Promise<DecisionResult> => inOpenCompany((ctx) => removeQuoteDecision(id, ctx));
