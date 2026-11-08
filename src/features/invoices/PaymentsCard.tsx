import { useMemo, useState } from 'react';
import { SelectField, TextField } from '../../components/Field';
import { recordPaymentOf, removePaymentOf } from '../../app/payments';
import type { PaymentId } from '../../data/ids';
import type { BankAccount, InvoiceFile, PaymentFile } from '../../data/types';
import { isoDateOf } from '../../domain/dates';
import { dueDate, type IssuedInfo } from '../../domain/invoice';
import { formatCents, type Cents } from '../../domain/money';
import { activePayments, emptyPaymentDraft, isOverdue, openAmount, paidAmount, paymentBeforeInvoice, paymentStateOf, PAYMENT_NOTE_LIMIT, readPayment, type PaymentDraft, type PaymentField, type PaymentFieldError } from '../../domain/payment';
import { currentLang, t } from '../../i18n';
import { accountDetail, accountName, fieldError, paymentFailureText, paymentStateText } from '../../lib/labels';
import { showToast, useApp } from '../../store/appStore';
import { focusFirstError, formatDate } from '../documents/common';

// The payments of an issued invoice: what is paid and what is still open, the payments with their account, and the form
// to record one. A payment is never changed; a wrong one is removed, and both are written to the audit log (app/payments.ts).
// A cancelled invoice takes no new payment, but the payments made before the cancellation stay visible.

type IssuedInvoice = InvoiceFile & { issued: IssuedInfo };

interface Props {
  invoice: IssuedInvoice;
  /** The gross amount the invoice shows */
  gross: Cents;
  /** Every payment of the invoice, deleted ones included */
  payments: readonly PaymentFile[];
  /** A cancellation of the invoice exists */
  cancelled: boolean;
}

const byDate = (a: PaymentFile, b: PaymentFile) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);

export function PaymentsCard({ invoice, gross, payments, cancelled }: Props) {
  const company = useApp((s) => s.company);
  const lang = currentLang();
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState<PaymentId | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = useMemo(() => activePayments(payments).sort(byDate), [payments]);
  if (!company) return null;

  const paid = paidAmount(payments);
  const open = openAmount(gross, paid);
  const state = paymentStateOf({ gross, paid, cancelled });
  const overdue = isOverdue({ gross, paid, due: dueDate(invoice), today: isoDateOf(new Date()), cancelled });
  const accounts = company.bank.accounts.filter((a) => !a.deletedAt);
  const accountOf = (id: string): BankAccount | undefined => company.bank.accounts.find((a) => a.id === id);
  const canAdd = !cancelled && open > 0;
  const confirming = shown.find((p) => p.id === confirmId) ?? null;

  const remove = async (p: PaymentFile) => {
    setBusy(true);
    const r = await removePaymentOf(p.id);
    setBusy(false);
    setConfirmId(null);
    if (!r.ok) {
      showToast(paymentFailureText(r.failure));
      return;
    }
    showToast(t(r.auditWritten ? 'payments.removedToast' : 'payments.removedAuditMissing'));
  };

  return (
    <section className="card" aria-labelledby="invoice-payments">
      <h2 id="invoice-payments" tabIndex={-1}>
        {t('payments.section')}
      </h2>
      <dl className="facts">
        <dt>{t('payments.gross')}</dt>
        <dd>{formatCents(gross, lang)}</dd>
        <dt>{t('payments.paid')}</dt>
        <dd>{formatCents(paid, lang)}</dd>
        <dt>{t('payments.open')}</dt>
        <dd>{formatCents(open, lang)}</dd>
      </dl>
      {!cancelled && (
        <p>
          <span className="badge">{paymentStateText(state)}</span>
          {overdue && <span className="badge danger-badge list-badge">{t('payments.overdue')}</span>}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="empty">{t('payments.none')}</p>
      ) : (
        <table className="table">
          <caption className="visually-hidden">{t('payments.section')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('payments.colDate')}</th>
              <th scope="col">{t('payments.colAccount')}</th>
              <th scope="col">{t('payments.colNote')}</th>
              <th scope="col" className="num">
                {t('payments.colAmount')}
              </th>
              <th scope="col">
                <span className="visually-hidden">{t('payments.remove')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const account = accountOf(p.accountId);
              return (
                <tr key={p.id}>
                  <td>{formatDate(p.date)}</td>
                  <td>{account ? accountName(account) : '–'}</td>
                  <td>{p.note}</td>
                  <td className="num">{formatCents(p.amount, lang)}</td>
                  <td className="num">
                    <button type="button" className="btn ghost danger-text" onClick={() => setConfirmId(p.id)} disabled={busy}>
                      {t('payments.remove')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {confirming && (
        <div className="confirm" role="group" aria-label={t('payments.removeConfirm', { date: formatDate(confirming.date), amount: formatCents(confirming.amount, lang) })}>
          <span>{t('payments.removeConfirm', { date: formatDate(confirming.date), amount: formatCents(confirming.amount, lang) })}</span>
          <button type="button" className="btn danger" onClick={() => void remove(confirming)} disabled={busy} autoFocus>
            {t('payments.removeNow')}
          </button>
          <button type="button" className="btn" onClick={() => setConfirmId(null)} disabled={busy}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      {canAdd &&
        (adding ? (
          <PaymentForm
            invoiceId={invoice.id}
            invoiceDate={invoice.date}
            open={open}
            accounts={accounts}
            preferred={accounts.some((a) => a.id === invoice.accountId) ? invoice.accountId : company.bank.defaultAccountId}
            onDone={() => setAdding(false)}
          />
        ) : (
          <div className="card-actions">
            <button type="button" className="btn primary" onClick={() => setAdding(true)}>
              {t('payments.add')}
            </button>
          </div>
        ))}
      <p className="note" role="note">
        {t('payments.policy')}
      </p>
    </section>
  );
}

interface FormProps {
  invoiceId: IssuedInvoice['id'];
  /** The date of the invoice: a payment before it is pointed out (a prepayment, or a typo) */
  invoiceDate: string;
  /** The open amount: a payment may not be more */
  open: Cents;
  accounts: readonly BankAccount[];
  /** The account of the invoice, or the default account when the invoice's account was removed */
  preferred: string;
  onDone: () => void;
}

/** Records one payment; the open amount and the first active account are proposed */
function PaymentForm({ invoiceId, invoiceDate, open, accounts, preferred, onDone }: FormProps) {
  const lang = currentLang();
  const [draft, setDraft] = useState<PaymentDraft>(() => emptyPaymentDraft(isoDateOf(new Date()), preferred, open, lang));
  const [errors, setErrors] = useState<readonly PaymentFieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<PaymentDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const err = (field: PaymentField) => fieldError(errors, field);
  const accountOptions = accounts.map((a) => ({ value: a.id, label: `${accountName(a)} · ${accountDetail(a)}` }));

  const save = async () => {
    const checked = readPayment(draft, lang, { open, accounts: accounts.map((a) => a.id), today: isoDateOf(new Date()) });
    if (!checked.ok) {
      setErrors(checked.error);
      focusFirstError('payment-form');
      return;
    }
    setErrors([]);
    setBusy(true);
    const r = await recordPaymentOf(invoiceId, checked.value);
    setBusy(false);
    if (!r.ok) {
      showToast(paymentFailureText(r.failure));
      return;
    }
    showToast(t(r.auditWritten ? 'payments.recordedToast' : 'payments.recordedAuditMissing'));
    onDone();
  };

  return (
    <form className="payment-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} aria-labelledby="payment-new">
      <h3 id="payment-new" tabIndex={-1}>
        {t('payments.formTitle')}
      </h3>
      <TextField
        className="w-date"
        type="date"
        label={t('payments.date')}
        hint={paymentBeforeInvoice(draft.date, invoiceDate) ? t('payments.dateBeforeInvoice', { date: formatDate(invoiceDate) }) : undefined}
        value={draft.date}
        onChange={(date) => set({ date })}
        error={err('date')}
        required
      />
      <TextField
        className="w-num"
        label={t('payments.amount')}
        hint={t('payments.amountHint')}
        value={draft.amount}
        onChange={(amount) => set({ amount })}
        error={err('amount')}
        required
        inputMode="decimal"
      />
      <SelectField label={t('payments.account')} value={draft.accountId} options={accountOptions} onChange={(accountId) => set({ accountId })} error={err('accountId')} required />
      <TextField label={t('payments.note')} hint={t('payments.noteHint')} value={draft.note} onChange={(note) => set({ note })} error={err('note')} maxLength={PAYMENT_NOTE_LIMIT} />
      <div className="card-actions">
        <button type="submit" className="btn primary" disabled={busy}>
          {t('payments.save')}
        </button>
        <button type="button" className="btn" onClick={onDone} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
