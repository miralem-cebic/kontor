import { useState } from 'react';
import { TextField } from '../../components/Field';
import { issueDunningOf } from '../../app/dunning';
import type { DocumentId, DunningId } from '../../data/ids';
import type { DunningFile, InvoiceFile, PaymentFile } from '../../data/types';
import { isoDateOf } from '../../domain/dates';
import { dueDate, type IssuedInfo } from '../../domain/invoice';
import { claimTotal, planDunning, readDunningDraft, emptyDunningDraft, type Debtor, type DunningDraft, type DunningField, type DunningFieldError, type PriorDunning } from '../../domain/dunning';
import { formatCents, type Cents } from '../../domain/money';
import { openAmount, paidAmount } from '../../domain/payment';
import { currentLang, t } from '../../i18n';
import { DUNNING_LEVEL_KEY, dunningFailureText, dunningProblemText, fieldError } from '../../lib/labels';
import { showToast } from '../../store/appStore';
import { focusFirstError, formatDate } from '../documents/common';
import { SendMailForm } from '../sending/SendMail';

// The dunnings (Mahnungen) of an issued invoice: the levels issued so far with their interest and fees, and the form to
// issue the next one. The form shows what the next dunning would claim before it is saved (domain/dunning.ts). Dunnings
// are estimates for the letter, not legal advice, and they are never changed once issued (app/dunning.ts).

type IssuedInvoice = InvoiceFile & { issued: IssuedInfo };

/** The dunnings as the planning reads them: level, date and the flat fee each claimed */
const priorOf = (dunnings: readonly DunningFile[]): PriorDunning[] => dunnings.map((d) => ({ level: d.level, date: d.date, flatFee: d.flatFee }));

interface Props {
  invoice: IssuedInvoice;
  /** The gross amount the invoice shows */
  gross: Cents;
  /** Every payment of the invoice, deleted ones included */
  payments: readonly PaymentFile[];
  /** The dunnings of the invoice, in the order they were issued */
  dunnings: readonly DunningFile[];
  /** A cancellation of the invoice exists */
  cancelled: boolean;
}

export function DunningCard({ invoice, gross, payments, dunnings, cancelled }: Props) {
  const lang = currentLang();
  const [adding, setAdding] = useState(false);
  /** The dunning whose letter is being mailed */
  const [mailFor, setMailFor] = useState<DunningId | null>(null);
  const mailing = dunnings.find((d) => d.id === mailFor) ?? null;
  const paid = paidAmount(payments);
  const open = openAmount(gross, paid);
  const canAdd = !cancelled && open > 0;
  const claim = claimTotal(
    open,
    dunnings.map((d) => ({ interest: d.interest, fee: d.fee, flatFee: d.flatFee })),
  );

  return (
    <section className="card" aria-labelledby="invoice-dunning">
      <h2 id="invoice-dunning" tabIndex={-1}>
        {t('dunning.section')}
      </h2>
      {cancelled && <p className="note">{t('dunning.cancelledNote')}</p>}
      {!cancelled && open === 0 && <p className="note">{t('dunning.paidNote')}</p>}

      {dunnings.length === 0 ? (
        <p className="empty">{t('dunning.none')}</p>
      ) : (
        <>
          <dl className="facts">
            <dt>{t('dunning.previewClaim')}</dt>
            <dd>{formatCents(claim, lang)}</dd>
          </dl>
          <table className="table">
            <caption className="visually-hidden">{t('dunning.section')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('dunning.colDate')}</th>
                <th scope="col">{t('dunning.colLevel')}</th>
                <th scope="col" className="num">
                  {t('dunning.colInterest')}
                </th>
                <th scope="col" className="num">
                  {t('dunning.colFee')}
                </th>
                <th scope="col" className="num">
                  {t('dunning.colFlat')}
                </th>
                <th scope="col">{t('dunning.colPayBy')}</th>
                <th scope="col">{t('send.colMail')}</th>
              </tr>
            </thead>
            <tbody>
              {dunnings.map((d) => (
                <tr key={d.id}>
                  <td>{formatDate(d.date)}</td>
                  <td>{t(DUNNING_LEVEL_KEY[d.level])}</td>
                  <td className="num">{formatCents(d.interest, lang)}</td>
                  <td className="num">{formatCents(d.fee, lang)}</td>
                  <td className="num">{formatCents(d.flatFee, lang)}</td>
                  <td>{formatDate(d.payBy)}</td>
                  <td>
                    {!cancelled && (
                      <button
                        type="button"
                        className="btn ghost"
                        aria-label={t('send.openFor', { level: t(DUNNING_LEVEL_KEY[d.level]) })}
                        onClick={() => setMailFor(d.id)}
                      >
                        {t('send.open')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {mailing && <SendMailForm key={mailing.id} source={{ kind: 'dunning', documentId: invoice.id, dunningId: mailing.id }} onDone={() => setMailFor(null)} />}
        </>
      )}

      {canAdd &&
        (adding ? (
          <DunningForm
            invoiceId={invoice.id}
            open={open}
            due={dueDate(invoice)}
            debtor={invoice.issued.snapshot.customer.kind === 'company' ? 'business' : 'consumer'}
            prior={priorOf(dunnings)}
            dunnings={dunnings}
            onDone={() => setAdding(false)}
          />
        ) : (
          <div className="card-actions">
            <button type="button" className="btn primary" onClick={() => setAdding(true)}>
              {t('dunning.add')}
            </button>
          </div>
        ))}
      <p className="note" role="note">
        {t('dunning.note')}
      </p>
      <p className="note">{t('dunning.policy')}</p>
    </section>
  );
}

interface FormProps {
  invoiceId: DocumentId;
  /** The amount open on the invoice now */
  open: Cents;
  due: string;
  debtor: Debtor;
  prior: PriorDunning[];
  dunnings: readonly DunningFile[];
  onDone: () => void;
}

/** Issues the next dunning; what it would claim is shown before it is saved */
function DunningForm({ invoiceId, open, due, debtor, prior, dunnings, onDone }: FormProps) {
  const lang = currentLang();
  const today = isoDateOf(new Date());
  const [draft, setDraft] = useState<DunningDraft>(() => emptyDunningDraft(today, lang));
  const [errors, setErrors] = useState<readonly DunningFieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<DunningDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const err = (field: DunningField) => fieldError(errors, field);

  const typed = readDunningDraft(draft, lang);
  const plan = typed.ok ? planDunning({ open, due, date: typed.value.date, today, debtor, cancelled: false, prior }) : null;

  const save = async () => {
    const checked = readDunningDraft(draft, lang);
    if (!checked.ok) {
      setErrors(checked.error);
      focusFirstError('dunning-form');
      return;
    }
    setErrors([]);
    setBusy(true);
    const r = await issueDunningOf(invoiceId, checked.value);
    setBusy(false);
    if (!r.ok) {
      showToast(r.failure === 'planning' ? r.problems.map(dunningProblemText).join(' ') : dunningFailureText(r.failure));
      return;
    }
    showToast(t(r.auditWritten ? 'dunning.createdToast' : 'dunning.createdAuditMissing'));
    onDone();
  };

  return (
    <form className="dunning-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} aria-labelledby="dunning-new">
      <h3 id="dunning-new" tabIndex={-1}>
        {t('dunning.formTitle')}
      </h3>
      <TextField className="w-date" type="date" label={t('dunning.date')} value={draft.date} onChange={(date) => set({ date })} error={err('date')} required />
      <TextField
        className="w-num"
        label={t('dunning.fee')}
        hint={t('dunning.feeHint')}
        value={draft.fee}
        onChange={(fee) => set({ fee })}
        error={err('fee')}
        inputMode="decimal"
      />

      {typed.ok && plan && !plan.ok && (
        <p className="f-error" role="alert">
          {plan.error.map(dunningProblemText).join(' ')}
        </p>
      )}
      {typed.ok && plan?.ok && (
        <dl className="facts" aria-label={t('dunning.preview')}>
          <dt>{t('dunning.previewLevel')}</dt>
          <dd>{t(DUNNING_LEVEL_KEY[plan.value.level])}</dd>
          <dt>{t('dunning.previewInterest', { from: formatDate(plan.value.interestFrom) })}</dt>
          <dd>{formatCents(plan.value.interest, lang)}</dd>
          <dt>{t('dunning.previewFlat')}</dt>
          <dd>{formatCents(plan.value.flatFee, lang)}</dd>
          <dt>{t('dunning.previewClaim')}</dt>
          <dd>
            {formatCents(
              claimTotal(open, [
                ...dunnings.map((d) => ({ interest: d.interest, fee: d.fee, flatFee: d.flatFee })),
                { interest: plan.value.interest, fee: typed.value.fee, flatFee: plan.value.flatFee },
              ]),
              lang,
            )}
          </dd>
        </dl>
      )}

      <div className="card-actions">
        <button type="submit" className="btn primary" disabled={busy || !plan?.ok}>
          {t('dunning.save')}
        </button>
        <button type="button" className="btn" onClick={onDone} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
