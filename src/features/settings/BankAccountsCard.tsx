import { useEffect, useRef, useState } from 'react';
import { Choice, Row, TextField } from '../../components/Field';
import { Icon } from '../../components/Icon';
import {
  ACCOUNT_LIMITS,
  accountKey,
  draftFromAccount,
  emptyAccountDraft,
  MAX_ACCOUNTS,
  readAccount,
  type AccountDraft,
  type AccountField,
  type AccountFieldError,
  type AccountKind,
} from '../../domain/bankAccount';
import { TEXT_LIMITS } from '../../domain/check';
import type { AccountId } from '../../data/ids';
import type { BankAccount } from '../../data/types';
import { t } from '../../i18n';
import { accountDetail, accountName, fieldError } from '../../lib/labels';
import { addAccount, deleteAccount, setDefaultAccount, showToast, updateAccount, useApp } from '../../store/appStore';

// Settings: the accounts of the company. One account is the default for new invoices; it cannot be removed.
// An account is edited as a draft in place of its row; only "Save" puts the checked details into the store.

type Editing = { kind: 'none' } | { kind: 'new' } | { kind: 'edit'; id: AccountId };

export function BankAccountsCard() {
  const company = useApp((s) => s.company);
  const [editing, setEditing] = useState<Editing>({ kind: 'none' });
  const heading = useRef<HTMLHeadingElement>(null);
  if (!company) return null;
  const { accounts, defaultAccountId } = company.bank;
  const active = accounts.filter((a) => !a.deletedAt);
  const atLimit = accounts.length >= MAX_ACCOUNTS;
  const close = () => {
    setEditing({ kind: 'none' });
    requestAnimationFrame(() => heading.current?.focus());
  };
  const form = (account: BankAccount | null) => (
    <AccountForm account={account} isDefault={account?.id === defaultAccountId} active={active} owner={company.owner} onDone={close} />
  );

  return (
    <section className="card" aria-labelledby="settings-accounts">
      <h2 id="settings-accounts" ref={heading} tabIndex={-1}>
        {t('accounts.title')}
      </h2>
      <p className="f-intro">{t('accounts.intro')}</p>
      <ul className="accounts" aria-label={t('accounts.list')}>
        {active.map((a) =>
          editing.kind === 'edit' && editing.id === a.id ? (
            <li key={a.id} className="acct editing">
              {form(a)}
            </li>
          ) : (
            <AccountRow key={a.id} account={a} isDefault={a.id === defaultAccountId} onEdit={() => setEditing({ kind: 'edit', id: a.id })} />
          ),
        )}
      </ul>
      {editing.kind === 'new' ? (
        <div className="acct-new">{form(null)}</div>
      ) : (
        <div className="card-actions">
          <button type="button" className="btn" onClick={() => setEditing({ kind: 'new' })} disabled={atLimit} aria-describedby={atLimit ? 'accounts-limit' : undefined}>
            <Icon n="plus" s={14} />
            {t('accounts.add')}
          </button>
        </div>
      )}
      {atLimit && (
        <p className="f-hint" id="accounts-limit">
          {t('accounts.limit', { max: MAX_ACCOUNTS })}
        </p>
      )}
    </section>
  );
}

function AccountRow({ account: a, isDefault, onEdit }: { account: BankAccount; isDefault: boolean; onEdit: () => void }) {
  const name = accountName(a);
  return (
    <li className="acct">
      <div className="acct-main">
        <span className="acct-name">
          {name}
          {isDefault && <span className="badge">{t('accounts.default')}</span>}
        </span>
        <small>{accountDetail(a)}</small>
      </div>
      {!isDefault && (
        <button
          type="button"
          className="btn sm ghost"
          aria-label={t('accounts.makeDefaultNamed', { name })}
          onClick={() => {
            setDefaultAccount(a.id);
            showToast(t('accounts.defaultSet', { name }));
          }}
        >
          {t('accounts.makeDefault')}
        </button>
      )}
      <button type="button" className="btn sm" aria-label={t('accounts.editNamed', { name })} onClick={onEdit}>
        {t('summary.edit')}
      </button>
    </li>
  );
}

interface FormProps {
  /** null for a new account */
  account: BankAccount | null;
  isDefault: boolean;
  /** The active accounts, for the check against the same IBAN or PayPal address twice */
  active: readonly BankAccount[];
  /** Suggested as the holder of a new bank account */
  owner: string;
  onDone: () => void;
}

function AccountForm({ account, isDefault, active, owner, onDone }: FormProps) {
  const [draft, setDraft] = useState<AccountDraft>(() => (account ? draftFromAccount(account) : emptyAccountDraft(owner)));
  const [errors, setErrors] = useState<readonly AccountFieldError[]>([]);
  const [checked, setChecked] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), []);

  const isTaken = (key: string) => active.some((a) => a.id !== account?.id && accountKey(a) === key);
  const set = (patch: Partial<AccountDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (checked) {
      const r = readAccount(next, isTaken);
      setErrors(r.ok ? [] : r.error);
    }
  };
  const e = (f: AccountField) => fieldError(errors, f);

  const save = () => {
    const r = readAccount(draft, isTaken);
    if (!r.ok) {
      setChecked(true);
      setErrors(r.error);
      requestAnimationFrame(() => {
        const el = formRef.current?.querySelector('[aria-invalid="true"]');
        (el instanceof HTMLInputElement ? el : el?.querySelector('input'))?.focus();
      });
      return;
    }
    if (account) updateAccount(account.id, r.value);
    else addAccount(r.value);
    showToast(t('accounts.saved', { name: accountName(r.value) }));
    onDone();
  };

  const remove = () => {
    if (!account) return;
    deleteAccount(account.id);
    showToast(t('accounts.removed', { name: accountName(account) }));
    onDone();
  };

  const title = account ? accountName(account) : t('accounts.new');
  const kindOptions: { value: AccountKind; label: string; hint: string }[] = [
    { value: 'bank', label: t('accounts.kindBank'), hint: t('accounts.kindBankHint') },
    { value: 'paypal', label: t('accounts.kindPaypal'), hint: t('accounts.kindPaypalHint') },
  ];

  return (
    <form
      ref={formRef}
      className="form account-form"
      noValidate
      aria-label={title}
      onSubmit={(ev) => {
        ev.preventDefault();
        save();
      }}
    >
      <h3 ref={heading} tabIndex={-1}>
        {title}
      </h3>
      {/* the kind is chosen once: payments and imports will rely on it */}
      {!account && <Choice<AccountKind> label={t('accounts.kind')} value={draft.kind} options={kindOptions} onChange={(kind) => set({ kind })} required />}
      <TextField label={t('accounts.name')} hint={t('accounts.nameHint')} value={draft.name} onChange={(name) => set({ name })} error={e('name')} maxLength={ACCOUNT_LIMITS.name} />
      {draft.kind === 'bank' ? (
        <>
          <TextField label={t('bank.holder')} value={draft.holder} onChange={(holder) => set({ holder })} error={e('holder')} required maxLength={ACCOUNT_LIMITS.holder} />
          <Row>
            <TextField label={t('bank.iban')} value={draft.iban} onChange={(iban) => set({ iban })} error={e('iban')} required maxLength={42} />
            <TextField className="w-bic" label={t('bank.bic')} hint={t('bank.bicHint')} value={draft.bic} onChange={(bic) => set({ bic })} error={e('bic')} maxLength={11} />
          </Row>
        </>
      ) : (
        <TextField label={t('accounts.paypalEmail')} type="email" value={draft.email} onChange={(email) => set({ email })} error={e('email')} required inputMode="email" maxLength={TEXT_LIMITS.email} />
      )}
      <div className="card-actions">
        <button type="submit" className="btn primary">
          {t('settings.save')}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <span className="sp" />
        {account &&
          !isDefault &&
          (confirmRemove ? (
            <div className="confirm" role="group" aria-label={t('accounts.removeConfirm')}>
              <span>{t('accounts.removeConfirm')}</span>
              <button type="button" className="btn danger" onClick={remove} autoFocus>
                {t('accounts.remove')}
              </button>
              <button type="button" className="btn" onClick={() => setConfirmRemove(false)}>
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button type="button" className="btn ghost danger-text" onClick={() => setConfirmRemove(true)}>
              {t('accounts.remove')}
            </button>
          ))}
      </div>
      {account && isDefault && <p className="f-hint">{t('accounts.defaultLocked')}</p>}
    </form>
  );
}
