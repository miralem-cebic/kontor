import { useState } from 'react';
import { discardUnsaved, retrySave } from '../../app/session';
import { t } from '../../i18n';
import { errorText } from '../../lib/labels';
import { useApp, type AppState, type UnsavedWrite } from '../../store/appStore';
import { formatDate } from '../documents/common';

// Below the save status in the sidebar: the changes the folder refuses for good (a file written by a newer kontor, a
// damaged or foreign file, a conflict), each with the reason. They do not stop the work; each can be tried again or
// discarded, which reads the company from the folder again (#95). And a warning when the browser could not keep the
// emergency copy of what is unsaved, so the person knows not to close the window.

/** What a refused change is about: the kind of record with its name, number or date */
function recordText(key: string, s: AppState): string {
  if (key === 'company') return t('unsaved.company');
  const at = key.indexOf(':');
  const id = key.slice(at + 1);
  const find = <T,>(records: ReadonlyMap<string, T>): T | undefined => records.get(id);
  const dated = (record: { date: string } | undefined) => (record ? formatDate(record.date) : id);
  switch (key.slice(0, at)) {
    case 'contact':
      return t('unsaved.contact', { name: find(s.contacts)?.name ?? id });
    case 'item':
      return t('unsaved.item', { name: find(s.items)?.name ?? id });
    case 'document': {
      const d = find(s.documents);
      return t(d?.kind === 'quote' ? 'unsaved.quote' : 'unsaved.invoice', { name: d?.issued?.number ?? (d?.subject || id) });
    }
    case 'expense':
      return t('unsaved.expense', { name: find(s.expenses)?.supplier ?? id });
    case 'payment':
      return t('unsaved.payment', { date: dated(find(s.payments)) });
    case 'dunning':
      return t('unsaved.dunning', { date: dated(find(s.dunnings)) });
    case 'payout':
      return t('unsaved.payout', { date: dated(find(s.payouts)) });
    case 'quoteStatus':
      return t('unsaved.quoteStatus', { date: dated(find(s.quoteStatuses)) });
    default:
      return key;
  }
}

export function UnsavedChanges() {
  const unsaved = useApp((s) => s.unsaved);
  const saveFailed = useApp((s) => s.save.state === 'error');
  const copyFailed = useApp((s) => s.emergencyCopyFailed);
  const [confirm, setConfirm] = useState<UnsavedWrite | null>(null);
  const [busy, setBusy] = useState(false);
  const showCopyWarning = copyFailed && (saveFailed || unsaved.length > 0);
  if (!unsaved.length && !showCopyWarning) return null;
  const state = useApp.getState();

  const discard = async (u: UnsavedWrite) => {
    setBusy(true);
    await discardUnsaved(u.key);
    setBusy(false);
    setConfirm(null);
  };

  return (
    <div className="save unsaved" role="alert">
      {unsaved.length > 0 && (
        <>
          <p>{t('unsaved.title')}</p>
          <ul>
            {unsaved.map((u) => (
              <li key={u.key}>
                <span>
                  {recordText(u.key, state)}: {errorText(u.kind)}
                </span>
                <button type="button" className="btn sm" onClick={() => setConfirm(u)} disabled={busy}>
                  {t('unsaved.discard')}
                </button>
              </li>
            ))}
          </ul>
          {confirm && (
            <div className="confirm" role="group" aria-label={t('unsaved.discardConfirm', { what: recordText(confirm.key, state) })}>
              <span>{t('unsaved.discardConfirm', { what: recordText(confirm.key, state) })}</span>
              <button type="button" className="btn sm danger" onClick={() => void discard(confirm)} disabled={busy} autoFocus>
                {t('unsaved.discardNow')}
              </button>
              <button type="button" className="btn sm" onClick={() => setConfirm(null)} disabled={busy}>
                {t('common.cancel')}
              </button>
            </div>
          )}
          {!saveFailed && (
            <button type="button" className="btn sm" onClick={() => void retrySave()} disabled={busy}>
              {t('save.retry')}
            </button>
          )}
        </>
      )}
      {showCopyWarning && <p>{t('save.copyFailed')}</p>}
    </div>
  );
}
