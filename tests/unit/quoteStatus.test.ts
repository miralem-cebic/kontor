import { describe, expect, it } from 'vitest';
import { activeDecision, decisionProblems, quoteStateOf, readDecisionDate } from '../../src/domain/quoteStatus';

// Decisions of the customer on a finalized quote (F21). A decision is a file of its own: it never changes, a wrong one is
// removed (soft delete), and the quote itself stays as it was finalized (ADR 0004).

const decision = (over: Partial<{ id: string; decision: 'accepted' | 'declined'; createdAt: string; deletedAt: string | null }> = {}) => ({
  id: 'd1',
  decision: 'accepted' as const,
  createdAt: '2026-11-03T09:00:00.000Z',
  deletedAt: null,
  ...over,
});

describe('the decision that counts', () => {
  it('a quote without a decision has none', () => {
    expect(activeDecision([])).toBeNull();
  });

  it('a removed decision counts as none', () => {
    expect(activeDecision([decision({ deletedAt: '2026-11-04T09:00:00.000Z' })])).toBeNull();
  });

  it('when two devices decided, the later one counts', () => {
    const first = decision({ id: 'a', decision: 'accepted', createdAt: '2026-11-03T09:00:00.000Z' });
    const later = decision({ id: 'b', decision: 'declined', createdAt: '2026-11-03T10:00:00.000Z' });
    expect(activeDecision([first, later])?.id).toBe('b');
    expect(activeDecision([later, first])?.id).toBe('b');
  });

  it('a removed later decision leaves the earlier one counting again', () => {
    const first = decision({ id: 'a', createdAt: '2026-11-03T09:00:00.000Z' });
    const later = decision({ id: 'b', decision: 'declined', createdAt: '2026-11-03T10:00:00.000Z', deletedAt: '2026-11-03T11:00:00.000Z' });
    expect(activeDecision([first, later])?.id).toBe('a');
  });
});

describe('the state of a quote', () => {
  it('a draft is not finalized; a finalized quote without a decision is open', () => {
    expect(quoteStateOf({ finalized: false, decision: null })).toBe('draft');
    expect(quoteStateOf({ finalized: true, decision: null })).toBe('open');
  });

  it('a finalized quote is accepted or declined as decided', () => {
    expect(quoteStateOf({ finalized: true, decision: 'accepted' })).toBe('accepted');
    expect(quoteStateOf({ finalized: true, decision: 'declined' })).toBe('declined');
  });
});

describe('when a decision can be recorded', () => {
  const ok = { finalized: true, replaced: false, decided: false, quoteDate: '2026-11-01', date: '2026-11-03', today: '2026-11-03' };

  it('a finalized, current quote without a decision takes one on a day from its date up to today', () => {
    expect(decisionProblems(ok)).toEqual([]);
    expect(decisionProblems({ ...ok, date: '2026-11-01' })).toEqual([]);
  });

  it('a draft takes no decision, and neither does a quote that a later version replaced', () => {
    expect(decisionProblems({ ...ok, finalized: false })).toEqual(['notFinalized']);
    expect(decisionProblems({ ...ok, replaced: true })).toEqual(['replaced']);
  });

  it('a quote takes one decision only, until the decision is removed', () => {
    expect(decisionProblems({ ...ok, decided: true })).toEqual(['alreadyDecided']);
  });

  it('the date is not before the quote and not in the future', () => {
    expect(decisionProblems({ ...ok, date: '2026-10-31' })).toEqual(['dateBeforeQuote']);
    expect(decisionProblems({ ...ok, date: '2026-11-04' })).toEqual(['dateInFuture']);
  });
});

describe('the date of a decision', () => {
  it('is an ISO date', () => {
    expect(readDecisionDate('2026-11-03')).toEqual({ ok: true, value: '2026-11-03' });
    expect(readDecisionDate('03.11.2026')).toEqual({ ok: false, error: [{ field: 'date', problem: 'date' }] });
    expect(readDecisionDate('')).toEqual({ ok: false, error: [{ field: 'date', problem: 'date' }] });
  });
});
