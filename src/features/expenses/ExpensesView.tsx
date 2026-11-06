import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Row, SelectField, TextArea, TextField } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { ExportCsvButton } from '../export/ExportCsvButton';
import type { ExpenseId } from '../../data/ids';
import type { ExpenseFile } from '../../data/types';
import { isoDateOf } from '../../domain/dates';
import { draftFromExpense, emptyExpenseDraft, EXPENSE_LIMITS, EXPENSE_TAX_TREATMENTS, expenseMatches, expenseVat, readExpense, type ExpenseDraft, type ExpenseField, type ExpenseFieldError, type ExpenseTaxTreatment } from '../../domain/expense';
import { formatCents, formatRate } from '../../domain/money';
import { VAT_RATES } from '../../domain/vat';
import { currentLang, t } from '../../i18n';
import { accountDetail, accountName, expenseTreatmentText, fieldError } from '../../lib/labels';
import { addExpense, deleteExpense, showToast, updateExpense, useApp } from '../../store/appStore';
import { formatDate } from '../documents/common';
import { ReceiptCard } from './ReceiptCard';

// The expenses: a searchable list, and a form for a new or an existing expense. The form edits a draft; only "Save"
// puts the checked expense into the store (and the persister writes it). A receipt is not part of this version.

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; id: ExpenseId };

/** Newest first, then by supplier */
const byNewest = (a: ExpenseFile, b: ExpenseFile): number => b.date.localeCompare(a.date) || a.supplier.localeCompare(b.supplier, 'de', { sensitivity: 'base' });

export function ExpensesView() {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const back = () => setMode({ kind: 'list' });
  switch (mode.kind) {
    case 'list':
      return <ExpenseList onNew={() => setMode({ kind: 'new' })} onOpen={(id) => setMode({ kind: 'edit', id })} />;
    case 'new':
      return <ExpenseEditor expense={null} onDone={back} />;
    case 'edit':
      return <EditExisting id={mode.id} onDone={back} />;
  }
}

function EditExisting({ id, onDone }: { id: ExpenseId; onDone: () => void }) {
  const expense = useApp((s) => s.expenses.get(id));
  // deleted or gone (for example merged away from another device): back to the list
  useEffect(() => {
    if (!expense || expense.deletedAt) onDone();
  }, [expense, onDone]);
  return expense && !expense.deletedAt ? <ExpenseEditor key={id} expense={expense} onDone={onDone} /> : null;
}

/* ---------- List ---------- */

function ExpenseList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: ExpenseId) => void }) {
  const all = useApp((s) => s.expenses);
  const [query, setQuery] = useState('');
  const searchId = useId();
  const lang = currentLang();
  const active = useMemo(() => [...all.values()].filter((e) => !e.deletedAt).sort(byNewest), [all]);
  const shown = active.filter((e) => expenseMatches(e, query));

  return (
    <div className="page wide">
      <header className="top">
        <h1>{t('expenses.title')}</h1>
        <span className="sp" />
        <ExportCsvButton kind="expenses" />
        <button type="button" className="btn primary" onClick={onNew}>
          <Icon n="plus" s={14} />
          {t('expenses.new')}
        </button>
      </header>
      {active.length === 0 ? (
        <p className="empty">{t('expenses.empty')}</p>
      ) : (
        <>
          <div className="list-tools">
            <label className="visually-hidden" htmlFor={searchId}>
              {t('expenses.search')}
            </label>
            <input id={searchId} className="search-in" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('expenses.searchPlaceholder')} />
          </div>
          {shown.length === 0 ? (
            <p className="empty" role="status">
              {t('expenses.noMatch')}
            </p>
          ) : (
            <table className="table">
              <caption className="visually-hidden">{t('expenses.count', { n: shown.length })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('expenses.colDate')}</th>
                  <th scope="col">{t('expenses.colSupplier')}</th>
                  <th scope="col">{t('expenses.colCategory')}</th>
                  <th scope="col" className="num">
                    {t('expenses.colGross')}
                  </th>
                  <th scope="col" className="num">
                    {t('expenses.colVat')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.date)}</td>
                    <td>
                      <button type="button" className="row-link" onClick={() => onOpen(e.id)}>
                        <span>
                          {e.supplier}
                          {e.reference && <small>{e.reference}</small>}
                        </span>
                      </button>
                    </td>
                    <td>{e.category}</td>
                    <td className="num">{formatCents(e.gross, lang)}</td>
                    <td className="num">{e.taxTreatment === 'domestic' ? formatCents(expenseVat(e), lang) : '–'}</td>
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

function ExpenseEditor({ expense, onDone }: { expense: ExpenseFile | null; onDone: () => void }) {
  const company = useApp((s) => s.company);
  const lang = currentLang();
  const accounts = company?.bank.accounts ?? [];
  const activeAccounts = accounts.filter((a) => !a.deletedAt);
  const [draft, setDraft] = useState<ExpenseDraft>(() => (expense ? draftFromExpense(expense, lang) : emptyExpenseDraft(isoDateOf(new Date()), company?.bank.defaultAccountId ?? '')));
  const [errors, setErrors] = useState<readonly ExpenseFieldError[]>([]);
  const [checked, setChecked] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), []);

  const check = (d: ExpenseDraft) => readExpense(d, lang, activeAccounts.map((a) => a.id));
  const set = (patch: Partial<ExpenseDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (checked) {
      const r = check(next);
      setErrors(r.ok ? [] : r.error);
    }
  };
  const e = (f: ExpenseField) => fieldError(errors, f);

  // the VAT inside the gross amount, shown under the amount as soon as the amount can be read
  const preview = check(draft);
  const vatHint = preview.ok && preview.value.taxTreatment === 'domestic' ? t('expenses.grossHintVat', { vat: formatCents(expenseVat(preview.value), lang) }) : t('expenses.grossHint');

  const save = () => {
    const r = check(draft);
    if (!r.ok) {
      setChecked(true);
      setErrors(r.error);
      requestAnimationFrame(() => {
        const el = document.querySelector('.expense-form [aria-invalid="true"]');
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.focus();
      });
      return;
    }
    if (expense) updateExpense(expense.id, r.value);
    else addExpense(r.value);
    showToast(t('expenses.saved', { supplier: r.value.supplier }));
    onDone();
  };

  const remove = () => {
    if (!expense) return;
    deleteExpense(expense.id);
    showToast(t('expenses.deleted', { supplier: expense.supplier }));
    onDone();
  };

  const treatmentOptions = EXPENSE_TAX_TREATMENTS.map((v) => ({ value: v, label: expenseTreatmentText(v) }));
  const rateOptions = VAT_RATES.map((r) => ({ value: String(r), label: formatRate(r, lang) }));
  // a removed account stays selectable, so that the expense shows it; the check then asks for another one
  const accountOptions = [
    { value: '', label: t('expenses.accountNone') },
    ...accounts
      .filter((a) => !a.deletedAt || a.id === draft.accountId)
      .map((a) => ({ value: a.id, label: a.deletedAt ? t('invoices.accountRemoved', { name: accountName(a) }) : `${accountName(a)} · ${accountDetail(a)}` })),
  ];
  const title = expense ? expense.supplier : t('expenses.new');

  return (
    <div className="page with-panel">
      <header className="top">
        <button type="button" className="icon-btn" onClick={onDone} aria-label={t('expenses.backToList')}>
          <Icon n="chevL" />
        </button>
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
      </header>
      <div className="split">
        <form
          className="form expense-form"
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault();
            save();
          }}
        >
          <section className="card" aria-label={title}>
            <Row>
              <TextField className="w-date" type="date" label={t('expenses.date')} hint={t('expenses.dateHint')} value={draft.date} onChange={(date) => set({ date })} error={e('date')} required />
              <TextField label={t('expenses.gross')} hint={vatHint} value={draft.gross} onChange={(gross) => set({ gross })} error={e('gross')} required inputMode="decimal" maxLength={20} />
            </Row>
            <TextField label={t('expenses.supplier')} hint={t('expenses.supplierHint')} value={draft.supplier} onChange={(supplier) => set({ supplier })} error={e('supplier')} required maxLength={EXPENSE_LIMITS.supplier} />
            <Row>
              <TextField className="w-num" label={t('expenses.reference')} hint={t('expenses.referenceHint')} value={draft.reference} onChange={(reference) => set({ reference })} error={e('reference')} maxLength={EXPENSE_LIMITS.reference} />
              <TextField label={t('expenses.category')} hint={t('expenses.categoryHint')} value={draft.category} onChange={(category) => set({ category })} error={e('category')} maxLength={EXPENSE_LIMITS.category} />
            </Row>
            <Row>
              <SelectField<ExpenseTaxTreatment> label={t('expenses.taxTreatment')} hint={t('expenses.taxTreatmentHint')} value={draft.taxTreatment} options={treatmentOptions} onChange={(taxTreatment) => set({ taxTreatment })} />
              {draft.taxTreatment === 'domestic' && (
                <SelectField
                  label={t('expenses.vatRate')}
                  value={String(draft.vatRate)}
                  options={rateOptions}
                  onChange={(v) => {
                    const vatRate = VAT_RATES.find((r) => String(r) === v);
                    if (vatRate !== undefined) set({ vatRate });
                  }}
                />
              )}
            </Row>
            <SelectField label={t('expenses.account')} value={draft.accountId} options={accountOptions} onChange={(accountId) => set({ accountId })} error={e('accountId')} />
            <TextArea label={t('expenses.note')} value={draft.note} onChange={(note) => set({ note })} error={e('note')} maxLength={EXPENSE_LIMITS.note} />
          </section>

          <div className="card-actions">
            <button type="submit" className="btn primary">
              {t('expenses.save')}
            </button>
            <button type="button" className="btn" onClick={onDone}>
              {t('common.cancel')}
            </button>
            <span className="sp" />
            {expense &&
              (confirmDelete ? (
                <div className="confirm" role="group" aria-label={t('expenses.deleteConfirm')}>
                  <span>{t('expenses.deleteConfirm')}</span>
                  <button type="button" className="btn danger" onClick={remove} autoFocus>
                    {t('expenses.delete')}
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button type="button" className="btn ghost danger-text" onClick={() => setConfirmDelete(true)}>
                  {t('expenses.delete')}
                </button>
              ))}
          </div>
        </form>
      </div>
      {expense && <ReceiptCard expense={expense} />}
    </div>
  );
}
