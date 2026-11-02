import { useState } from 'react';
import { TextArea, TextField } from '../../components/Field';
import { currentMailDefaults, openMailProgram, saveMailFile, type SendSource } from '../../app/sending';
import { readMailDraft, SEND_LIMITS, type MailDraft, type MailField, type MailFieldError } from '../../domain/sending';
import { t } from '../../i18n';
import { fieldError, sendFailureText } from '../../lib/labels';
import { showToast } from '../../store/appStore';
import { focusFirstError } from '../documents/common';

// E-mail to the customer for an issued document (F04). The form holds the recipient, the subject and the text, filled in
// from the document; a change is not saved. Two ways out: an .eml file with the PDF attached (a draft in the mail program),
// or the mail program opened with a mailto: link, after the PDF has been downloaded to be attached by hand. kontor sends
// nothing; the audit log records that a mail was prepared.

/** The e-mail of an issued document: a button that opens the form, which is filled in from the document when it opens */
export function SendCard({ source }: { source: SendSource }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card" aria-labelledby="send-section">
      <h2 id="send-section">{t('send.section')}</h2>
      <p className="note">{t('send.note')}</p>
      {open ? (
        <SendMailForm source={source} onDone={() => setOpen(false)} />
      ) : (
        <div className="card-actions">
          <button type="button" className="btn primary" onClick={() => setOpen(true)}>
            {t('send.open')}
          </button>
        </div>
      )}
    </section>
  );
}

interface FormProps {
  source: SendSource;
  onDone: () => void;
}

/** The mail as the form holds it, with the two ways out; a problem with the fields is shown by the field */
export function SendMailForm({ source, onDone }: FormProps) {
  const [draft, setDraft] = useState<MailDraft>(() => currentMailDefaults(source));
  const [errors, setErrors] = useState<readonly MailFieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<MailDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const err = (field: MailField) => fieldError(errors, field);

  const run = async (how: 'eml' | 'mailto') => {
    const checked = readMailDraft(draft);
    if (!checked.ok) {
      setErrors(checked.error);
      focusFirstError('send-form');
      return;
    }
    setErrors([]);
    setBusy(true);
    const r = how === 'eml' ? await saveMailFile(source, draft) : await openMailProgram(source, draft);
    setBusy(false);
    if (!r.ok) {
      if (r.failure === 'fields') {
        setErrors(r.problems);
        focusFirstError('send-form');
      } else showToast(sendFailureText(r.failure));
      return;
    }
    const messages: string[] = [];
    if (how === 'eml') messages.push(t('send.emlDone', { name: r.fileName }));
    else {
      messages.push(t('send.mailtoDone', { name: r.fileName }));
      if (!r.bodyIncluded) messages.push(t('send.mailtoNoBody'));
    }
    if (!r.auditWritten) messages.push(t('send.auditMissing'));
    showToast(messages.join(' '));
    onDone();
  };

  return (
    <form
      className="send-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void run('eml');
      }}
      aria-label={t('send.open')}
    >
      <TextField type="email" label={t('send.to')} value={draft.to} onChange={(to) => set({ to })} error={err('to')} autoComplete="email" required />
      <TextField label={t('send.subject')} value={draft.subject} onChange={(subject) => set({ subject })} error={err('subject')} maxLength={SEND_LIMITS.subject} required />
      <TextArea label={t('send.body')} value={draft.body} onChange={(body) => set({ body })} error={err('body')} hint={t('send.draftNote')} rows={12} maxLength={SEND_LIMITS.body} />
      <div className="card-actions">
        <button type="submit" className="btn primary" disabled={busy}>
          {t('send.asEml')}
        </button>
        <button type="button" className="btn" onClick={() => void run('mailto')} disabled={busy}>
          {t('send.asMailto')}
        </button>
        <button type="button" className="btn" onClick={onDone} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
