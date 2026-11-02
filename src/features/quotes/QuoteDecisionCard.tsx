import { useMemo, useState } from 'react';
import { TextField } from '../../components/Field';
import { decideQuoteOf, removeQuoteDecisionOf } from '../../app/quoteStatus';
import type { DocumentId } from '../../data/ids';
import { isoDateOf } from '../../domain/dates';
import { activeDecision, readDecisionDate, type DecisionProblem, type QuoteDecision } from '../../domain/quoteStatus';
import { t } from '../../i18n';
import { quoteDecisionFailureText, quoteDecisionProblemText } from '../../lib/labels';
import { showToast, useApp } from '../../store/appStore';
import { formatDate } from '../documents/common';

// The decision of the customer on a finalized quote (F21): accepted or declined, with its date. It is recorded as a file of
// its own (app/quoteStatus.ts); the quote does not change. A wrong decision is removed here, and the removal is logged.

export function QuoteDecisionCard({ quoteId, replaced }: { quoteId: DocumentId; replaced: boolean }) {
  const quoteStatuses = useApp((s) => s.quoteStatuses);
  const active = useMemo(() => activeDecision([...quoteStatuses.values()].filter((s) => s.quoteId === quoteId)), [quoteStatuses, quoteId]);
  const [date, setDate] = useState(() => isoDateOf(new Date()));
  const [problems, setProblems] = useState<DecisionProblem[]>([]);
  const [busy, setBusy] = useState(false);

  const record = async (decision: QuoteDecision) => {
    const checked = readDecisionDate(date);
    if (!checked.ok) {
      showToast(t('quotes.decisionDateInvalid'));
      return;
    }
    setBusy(true);
    const r = await decideQuoteOf(quoteId, { decision, date: checked.value });
    setBusy(false);
    if (!r.ok) {
      if (r.failure === 'planning') setProblems(r.problems);
      else showToast(quoteDecisionFailureText(r.failure));
      return;
    }
    setProblems([]);
    showToast(t(r.auditWritten ? 'quotes.decisionToast' : 'quotes.decisionAuditMissing'));
  };

  const remove = async () => {
    if (!active) return;
    setBusy(true);
    const r = await removeQuoteDecisionOf(active.id);
    setBusy(false);
    if (!r.ok) {
      showToast(r.failure === 'planning' ? t('quotes.decisionFailed') : quoteDecisionFailureText(r.failure));
      return;
    }
    showToast(t(r.auditWritten ? 'quotes.decisionRemovedToast' : 'quotes.decisionAuditMissing'));
  };

  return (
    <section className="card" aria-labelledby="quote-decision">
      <h2 id="quote-decision" tabIndex={-1}>
        {t('quotes.decisionSection')}
      </h2>
      <p className="note">{t('quotes.decisionNote')}</p>
      {active ? (
        <dl className="facts">
          <dt>{t('quotes.decisionState')}</dt>
          <dd>{t(active.decision === 'accepted' ? 'quotes.decisionAccepted' : 'quotes.decisionDeclined')}</dd>
          <dt>{t('quotes.decisionOn')}</dt>
          <dd>{formatDate(active.date)}</dd>
        </dl>
      ) : (
        <p className="empty">{t('quotes.decisionNone')}</p>
      )}
      {replaced ? (
        <p className="note">{t('quotes.decisionReplaced')}</p>
      ) : active ? (
        <div className="card-actions">
          <button type="button" className="btn ghost danger-text" onClick={() => void remove()} disabled={busy}>
            {t('quotes.decisionRemove')}
          </button>
        </div>
      ) : (
        <form className="decision-form" noValidate onSubmit={(e) => e.preventDefault()}>
          <TextField className="w-date" type="date" label={t('quotes.decisionDateInput')} value={date} onChange={setDate} required />
          {problems.length > 0 && (
            <p className="f-error" role="alert">
              {problems.map(quoteDecisionProblemText).join(' ')}
            </p>
          )}
          <div className="card-actions">
            <button type="button" className="btn primary" onClick={() => void record('accepted')} disabled={busy}>
              {t('quotes.decisionAccept')}
            </button>
            <button type="button" className="btn" onClick={() => void record('declined')} disabled={busy}>
              {t('quotes.decisionDecline')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
