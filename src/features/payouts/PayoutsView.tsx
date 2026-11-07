import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { bookPayoutOfOpenCompany, changePayoutOfOpenCompany, removePayoutOfOpenCompany, type PayoutResult } from '../../app/payouts';
import { ExternalLink } from '../../components/ExternalLink';
import { Row, SelectField, TextArea, TextField } from '../../components/Field';
import { Icon } from '../../components/Icon';
import type { PayoutId } from '../../data/ids';
import type { ContactFile, PayoutFile } from '../../data/types';
import { isoDateOf } from '../../domain/dates';
import { isHttpsUrl } from '../../domain/links';
import { formatCents, formatRate, parseCents } from '../../domain/money';
import {
  draftFromPayout,
  emptyPayoutDraft,
  PAYOUT_LIMITS,
  payoutMatches,
  payoutNet,
  payoutTreatmentsFor,
  payoutVat,
  readPayout,
  type PayoutDraft,
  type PayoutField,
  type PayoutFieldError,
  type PayoutTaxTreatment,
} from '../../domain/payout';
import { VAT_RATES } from '../../domain/vat';
import { currentLang, t } from '../../i18n';
import { accountDetail, accountName, fieldError, payoutTreatmentExplanation, payoutTreatmentText } from '../../lib/labels';
import { showToast, useApp } from '../../store/appStore';
import { ExportCsvButton } from '../export/ExportCsvButton';
import { customerOptions, formatDate } from '../documents/common';

// The payouts: income without an invoice of kontor (Apple, Google, Stripe, PayPal …). A searchable list, and a form for a new
// or an existing payout. The form edits a draft; only "Save" books the checked payout (the store, the file and the audit
// log). The tax treatment is chosen by the person and never preselected. The statement is an https link; the file of the
// statement is not kept here (the receipts of expenses are tied to the expense, so they were not reused).

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; id: PayoutId };

/** Newest first */
const byNewest = (a: PayoutFile, b: PayoutFile): number => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

export function PayoutsView() {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const back = () => setMode({ kind: 'list' });
  switch (mode.kind) {
    case 'list':
      return <PayoutList onNew={() => setMode({ kind: 'new' })} onOpen={(id) => setMode({ kind: 'edit', id })} />;
    case 'new':
      return <PayoutEditor payout={null} onDone={back} />;
    case 'edit':
      return <EditExisting id={mode.id} onDone={back} />;
  }
}

function EditExisting({ id, onDone }: { id: PayoutId; onDone: () => void }) {
  const payout = useApp((s) => s.payouts.get(id));
  // deleted or gone (for example merged away from another device): back to the list
  useEffect(() => {
    if (!payout || payout.deletedAt) onDone();
  }, [payout, onDone]);
  return payout && !payout.deletedAt ? <PayoutEditor key={id} payout={payout} onDone={onDone} /> : null;
}

/** The text of a failed booking, or null when it worked */
function problemText(r: PayoutResult): string | null {
  if (!r.ok) return r.failure === 'notSaved' ? t('payouts.notSaved') : t('error.other');
  return r.auditWritten ? null : t('payouts.auditFailed');
}

/* ---------- List ---------- */

function PayoutList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: PayoutId) => void }) {
  const all = useApp((s) => s.payouts);
  const contacts = useApp((s) => s.contacts);
  const [query, setQuery] = useState('');
  const searchId = useId();
  const lang = currentLang();
  const payerName = (p: PayoutFile) => contacts.get(p.payerId)?.name ?? '';
  const active = useMemo(() => [...all.values()].filter((p) => !p.deletedAt).sort(byNewest), [all]);
  const shown = active.filter((p) => payoutMatches(p, payerName(p), query));

  return (
    <div className="page wide">
      <header className="top">
        <h1>{t('payouts.title')}</h1>
        <span className="sp" />
        <ExportCsvButton kind="payouts" />
        <button type="button" className="btn primary" onClick={onNew}>
          <Icon n="plus" s={14} />
          {t('payouts.new')}
        </button>
      </header>
      <p className="muted">{t('payouts.intro')}</p>
      {active.length === 0 ? (
        <p className="empty">{t('payouts.empty')}</p>
      ) : (
        <>
          <div className="list-tools">
            <label className="visually-hidden" htmlFor={searchId}>
              {t('payouts.search')}
            </label>
            <input id={searchId} className="search-in" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('payouts.searchPlaceholder')} />
          </div>
          {shown.length === 0 ? (
            <p className="empty" role="status">
              {t('payouts.noMatch')}
            </p>
          ) : (
            <table className="table">
              <caption className="visually-hidden">{t('payouts.count', { n: shown.length })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('payouts.colDate')}</th>
                  <th scope="col">{t('payouts.colPayer')}</th>
                  <th scope="col">{t('payouts.colPeriod')}</th>
                  <th scope="col">{t('payouts.colTreatment')}</th>
                  <th scope="col" className="num">
                    {t('payouts.colAmount')}
                  </th>
                  <th scope="col" className="num">
                    {t('payouts.colIncome')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.date)}</td>
                    <td>
                      <button type="button" className="row-link" onClick={() => onOpen(p.id)}>
                        <span>{payerName(p)}</span>
                      </button>
                    </td>
                    <td>{p.period}</td>
                    <td>{payoutTreatmentText(p.taxTreatment)}</td>
                    <td className="num">{formatCents(p.amount, lang)}</td>
                    <td className="num">{formatCents(payoutNet(p), lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Form ---------- */

function PayoutEditor({ payout, onDone }: { payout: PayoutFile | null; onDone: () => void }) {
  const company = useApp((s) => s.company);
  const contacts = useApp((s) => s.contacts);
  const lang = currentLang();
  const accounts = company?.bank.accounts ?? [];
  const activeAccounts = accounts.filter((a) => !a.deletedAt);
  const smallBusiness = company?.tax.vat.kind === 'smallBusiness';
  const [draft, setDraft] = useState<PayoutDraft>(() => (payout ? draftFromPayout(payout, lang) : emptyPayoutDraft(isoDateOf(new Date()), company?.bank.defaultAccountId ?? '')));
  const [errors, setErrors] = useState<readonly PayoutFieldError[]>([]);
  const [checked, setChecked] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), []);

  // the contacts that can be named as payer: the active customers, with their VAT ID for the check of the treatment
  const payers = [...contacts.values()].filter((c: ContactFile) => c.roles.customer && !c.deletedAt).map((c) => ({ id: c.id as string, vatId: c.vatId, name: c.name }));
  const check = (d: PayoutDraft) => readPayout(d, lang, { accounts: activeAccounts.map((a) => a.id), payers, smallBusiness });
  const set = (patch: Partial<PayoutDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (checked) {
      const r = check(next);
      setErrors(r.ok ? [] : r.error);
    }
  };
  const e = (f: PayoutField) => fieldError(errors, f);

  // the VAT inside the amount of a domestic payout, shown under the amount as soon as the amount can be read
  const typed = parseCents(draft.amount, lang);
  const amountHint =
    draft.taxTreatment === 'domesticTaxed' && typed !== null && typed > 0
      ? (() => {
          const p = { amount: typed, taxTreatment: draft.taxTreatment, vatRate: draft.vatRate };
          return t('payouts.amountHintVat', { vat: formatCents(payoutVat(p), lang), net: formatCents(payoutNet(p), lang) });
        })()
      : t('payouts.amountHint');

  const save = async () => {
    const r = check(draft);
    if (!r.ok) {
      setChecked(true);
      setErrors(r.error);
      requestAnimationFrame(() => {
        const el = document.querySelector('.payout-form [aria-invalid="true"]');
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.focus();
      });
      return;
    }
    setBusy(true);
    const result = payout ? await changePayoutOfOpenCompany(payout.id, r.value) : await bookPayoutOfOpenCompany(r.value);
    setBusy(false);
    const problem = problemText(result);
    if (!result.ok) {
      showToast(problem ?? t('error.other'));
      return;
    }
    showToast(t('payouts.saved', { payer: payers.find((x) => x.id === r.value.payerId)?.name ?? '' }));
    if (problem) showToast(problem);
    onDone();
  };

  const remove = async () => {
    if (!payout) return;
    const result = await removePayoutOfOpenCompany(payout.id);
    const problem = problemText(result);
    if (result.ok) showToast(t('payouts.deleted', { payer: contacts.get(payout.payerId)?.name ?? '' }));
    if (problem) showToast(problem);
    onDone();
  };

  const offered = payoutTreatmentsFor(smallBusiness);
  // the treatment of a saved payout stays selectable, so that the form shows it; the check then says why it cannot be kept
  const treatmentList: PayoutTaxTreatment[] = draft.taxTreatment !== '' && !offered.includes(draft.taxTreatment) ? [...offered, draft.taxTreatment] : offered;
  const treatmentOptions: { value: PayoutTaxTreatment | ''; label: string }[] = [
    { value: '', label: t('payouts.taxTreatmentChoose') },
    ...treatmentList.map((v) => ({ value: v, label: payoutTreatmentText(v) })),
  ];
  const rateOptions = VAT_RATES.map((r) => ({ value: String(r), label: formatRate(r, lang) }));
  // a removed account stays selectable, so that the payout shows it; the check then asks for another one
  const accountOptions = accounts
    .filter((a) => !a.deletedAt || a.id === draft.accountId)
    .map((a) => ({ value: a.id as string, label: a.deletedAt ? t('invoices.accountRemoved', { name: accountName(a) }) : `${accountName(a)} · ${accountDetail(a)}` }));
  const payerOptions = [{ value: '', label: t('payouts.payerChoose') }, ...customerOptions(contacts, draft.payerId)];
  const hasPayers = payers.length > 0;
  const title = payout ? (contacts.get(payout.payerId)?.name ?? t('payouts.title')) : t('payouts.new');

  return (
    <div className="page with-panel">
      <header className="top">
        <button type="button" className="icon-btn" onClick={onDone} aria-label={t('payouts.backToList')}>
          <Icon n="chevL" />
        </button>
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
      </header>
      <div className="split">
        <form
          className="form payout-form"
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault();
            void save();
          }}
        >
          <section className="card" aria-label={title}>
            <Row>
              <TextField className="w-date" type="date" label={t('payouts.date')} hint={t('payouts.dateHint')} value={draft.date} onChange={(date) => set({ date })} error={e('date')} required />
              <TextField label={t('payouts.amount')} hint={amountHint} value={draft.amount} onChange={(amount) => set({ amount })} error={e('amount')} required inputMode="decimal" maxLength={20} />
            </Row>
            <SelectField label={t('payouts.payer')} hint={hasPayers ? t('payouts.payerHint') : t('payouts.payerNone')} value={draft.payerId} options={payerOptions} onChange={(payerId) => set({ payerId })} error={e('payerId')} required />
            <Row>
              <TextField className="w-date" type="month" label={t('payouts.period')} hint={t('payouts.periodHint')} value={draft.period} onChange={(period) => set({ period })} error={e('period')} />
              <SelectField label={t('payouts.account')} value={draft.accountId} options={accountOptions} onChange={(accountId) => set({ accountId })} error={e('accountId')} required />
            </Row>
            <Row>
              <SelectField<PayoutTaxTreatment | ''>
                label={t('payouts.taxTreatment')}
                hint={t('payouts.taxTreatmentHint')}
                value={draft.taxTreatment}
                options={treatmentOptions}
                onChange={(taxTreatment) => set({ taxTreatment })}
                error={e('taxTreatment')}
                required
              />
              {draft.taxTreatment === 'domesticTaxed' && (
                <SelectField
                  label={t('payouts.vatRate')}
                  value={String(draft.vatRate)}
                  options={rateOptions}
                  onChange={(v) => {
                    const vatRate = VAT_RATES.find((r) => String(r) === v);
                    if (vatRate !== undefined) set({ vatRate });
                  }}
                />
              )}
            </Row>
            {draft.taxTreatment !== '' && (
              <p className="note" role="note">
                {payoutTreatmentExplanation(draft.taxTreatment)}
              </p>
            )}
            {draft.taxTreatment === 'platformCollectsVat' && (
              <p className="note" role="alert">
                <strong>{t('payouts.platformWarning')}</strong>
              </p>
            )}
            <TextField label={t('payouts.statementUrl')} hint={t('payouts.statementUrlHint')} value={draft.statementUrl} onChange={(statementUrl) => set({ statementUrl })} error={e('statementUrl')} maxLength={PAYOUT_LIMITS.statementUrl} />
            {isHttpsUrl(draft.statementUrl.trim()) && (
              <p>
                <ExternalLink href={draft.statementUrl.trim()}>{t('payouts.statementOpen')}</ExternalLink>
              </p>
            )}
            <TextArea label={t('payouts.note')} value={draft.note} onChange={(note) => set({ note })} error={e('note')} maxLength={PAYOUT_LIMITS.note} />
          </section>

          <div className="card-actions">
            <button type="submit" className="btn primary" disabled={busy}>
              {t('payouts.save')}
            </button>
            <button type="button" className="btn" onClick={onDone}>
              {t('common.cancel')}
            </button>
            <span className="sp" />
            {payout &&
              (confirmDelete ? (
                <div className="confirm" role="group" aria-label={t('payouts.deleteConfirm')}>
                  <span>{t('payouts.deleteConfirm')}</span>
                  <button type="button" className="btn danger" onClick={() => void remove()} autoFocus>
                    {t('payouts.delete')}
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button type="button" className="btn ghost danger-text" onClick={() => setConfirmDelete(true)}>
                  {t('payouts.delete')}
                </button>
              ))}
          </div>
        </form>
      </div>
    </div>
  );
}
