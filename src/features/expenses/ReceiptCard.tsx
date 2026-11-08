import { useId, useState } from 'react';
import { attachReceiptFile, attachReceiptLink, openReceiptFile, removeReceipt, type ReceiptFailure } from '../../app/receipts';
import { TextField } from '../../components/Field';
import { ExternalLink } from '../../components/ExternalLink';
import type { ExpenseFile } from '../../data/types';
import { receiptPath, RECEIPT_MAX_BYTES } from '../../domain/receipt';
import { errorText } from '../../lib/labels';
import { t } from '../../i18n';
import { saveFile } from '../../lib/browser';
import { showToast } from '../../store/appStore';

// The receipt of a saved expense: a file the person picks (copied into the folder) or a link. The actions work at once;
// they are not part of the form's draft, so they do not wait for "Save".

const MAX_MB = `${RECEIPT_MAX_BYTES / 1_000_000} MB`;

function failureText(f: ReceiptFailure): string {
  switch (f) {
    case 'notReady':
      return t('receipt.notReady');
    case 'expense':
      return t('receipt.expenseGone');
    case 'empty':
      return t('receipt.empty');
    case 'tooLarge':
      return t('receipt.tooLarge', { max: MAX_MB });
    case 'type':
      return t('receipt.type');
    case 'link':
      return t('receipt.linkInvalid');
    case 'changed':
      return t('receipt.changed');
    case 'audit':
      return t('receipt.audit');
    case 'permission':
    case 'notFound':
    case 'quota':
    case 'locked':
    case 'newerSchema':
    case 'invalid':
    case 'conflict':
    case 'other':
      return t('receipt.failed', { reason: errorText(f) });
  }
}

export function ReceiptCard({ expense }: { expense: ExpenseFile }) {
  const [failure, setFailure] = useState<ReceiptFailure | null>(null);
  const [link, setLink] = useState('');
  const [confirming, setConfirming] = useState(false);
  const uploadId = useId();
  const replaceId = useId();
  const receipt = expense.receipt;

  const run = async (action: () => Promise<ReceiptFailure | null>, done: string) => {
    const f = await action();
    setFailure(f);
    if (f === null) showToast(done);
  };

  const pick = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await run(() => attachReceiptFile(expense.id, { bytes, name: file.name, type: file.type }), t('receipt.saved'));
  };

  const download = async () => {
    const r = await openReceiptFile(expense.id);
    if (typeof r === 'string') setFailure(r);
    else saveFile(r.bytes, r.name, r.type);
  };

  const fileInput = (id: string) => (
    <input
      id={id}
      type="file"
      accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
      className="visually-hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) void pick(file);
      }}
    />
  );

  return (
    <section className="card" aria-label={t('receipt.title')}>
      <h2>{t('receipt.title')}</h2>
      {receipt === null ? (
        <>
          <p>{t('receipt.none')}</p>
          <label htmlFor={uploadId} className="btn primary">
            {t('receipt.upload')}
          </label>
          {fileInput(uploadId)}
          <p className="hint">{t('receipt.uploadHint', { max: MAX_MB })}</p>
          <TextField label={t('receipt.linkLabel')} hint={t('receipt.linkHint')} value={link} onChange={setLink} maxLength={2000} />
          <button type="button" className="btn" onClick={() => void run(() => attachReceiptLink(expense.id, link), t('receipt.saved'))}>
            {t('receipt.saveLink')}
          </button>
        </>
      ) : receipt.kind === 'file' ? (
        <>
          <p>{receipt.name.replace(`${expense.id}-`, '')}</p>
          <p className="hint">{t('receipt.keptIn', { path: receiptPath(receipt.year, receipt.name) })}</p>
          <button type="button" className="btn" onClick={() => void download()}>
            {t('receipt.open')}
          </button>
          <label htmlFor={replaceId} className="btn">
            {t('receipt.replace')}
          </label>
          {fileInput(replaceId)}
        </>
      ) : (
        <>
          <p>
            <ExternalLink href={receipt.url}>{receipt.url}</ExternalLink>
          </p>
          <p className="hint">{t('receipt.linkNote')}</p>
        </>
      )}

      {receipt !== null &&
        (confirming ? (
          <div className="confirm" role="group" aria-label={t('receipt.removeConfirm')}>
            <span>{t('receipt.removeConfirm')}</span>
            <button
              type="button"
              className="btn danger"
              autoFocus
              onClick={() => {
                setConfirming(false);
                void run(() => removeReceipt(expense.id), t('receipt.removed'));
              }}
            >
              {t('receipt.removeNow')}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <button type="button" className="btn ghost danger-text" onClick={() => setConfirming(true)}>
            {t('receipt.remove')}
          </button>
        ))}

      {failure !== null && (
        <p className="f-error" role="alert">
          {failureText(failure)}
        </p>
      )}
    </section>
  );
}
