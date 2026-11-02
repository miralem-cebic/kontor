// Decisions of the customer on a finalized quote (F21). A quote is finalized when it is sent (F29: its number and its final
// PDF); the customer then accepts or declines it. Each decision is a file of its own (quoteStatus/<id>.json), as a payment
// is: it never changes, a wrong one is removed (soft delete), and both are logged. The quote itself stays as it was
// finalized (ADR 0004). Two devices can record different decisions for one quote; the later one counts.

import { Checker, type FieldError } from './check';
import { isIsoDate } from './dates';

export const QUOTE_DECISIONS = ['accepted', 'declined'] as const;
export type QuoteDecision = (typeof QUOTE_DECISIONS)[number];

/** The fields of a decision the rules look at */
export interface DecisionRecord {
  decision: QuoteDecision;
  createdAt: string;
  deletedAt: string | null;
}

/** The decision that counts: the latest one not removed, by its creation time; null when none counts */
export function activeDecision<T extends DecisionRecord>(decisions: Iterable<T>): T | null {
  let best: T | null = null;
  for (const d of decisions) {
    if (d.deletedAt !== null) continue;
    if (!best || d.createdAt > best.createdAt) best = d;
  }
  return best;
}

/** The state of a quote as the list shows it: a draft, a finalized quote that is open, or one the customer decided on */
export type QuoteState = 'draft' | 'open' | 'accepted' | 'declined';

export function quoteStateOf({ finalized, decision }: { finalized: boolean; decision: QuoteDecision | null }): QuoteState {
  if (!finalized) return 'draft';
  return decision ?? 'open';
}

/** Why a decision cannot be recorded */
export type DecisionProblem = 'notFinalized' | 'replaced' | 'alreadyDecided' | 'dateBeforeQuote' | 'dateInFuture';

export interface DecisionFacts {
  finalized: boolean;
  /** A later version of the quote is finalized: the customer decides on that one */
  replaced: boolean;
  /** A decision counts already: a second one is taken only after the first is removed */
  decided: boolean;
  /** The date of the quote (YYYY-MM-DD) */
  quoteDate: string;
  /** The date of the decision (YYYY-MM-DD) */
  date: string;
  /** Today, the latest date a decision can carry */
  today: string;
}

/** Why a decision cannot be recorded; empty when it can */
export function decisionProblems(f: DecisionFacts): DecisionProblem[] {
  const problems: DecisionProblem[] = [];
  if (!f.finalized) problems.push('notFinalized');
  if (f.replaced) problems.push('replaced');
  if (f.decided) problems.push('alreadyDecided');
  if (f.date < f.quoteDate) problems.push('dateBeforeQuote');
  if (f.date > f.today) problems.push('dateInFuture');
  return problems;
}

/** The date of a decision as typed: an ISO date */
export function readDecisionDate(date: string): { ok: true; value: string } | { ok: false; error: FieldError<'date'>[] } {
  const c = new Checker<'date'>();
  if (!isIsoDate(date)) c.add('date', 'date');
  return c.done(() => date);
}
