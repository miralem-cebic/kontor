import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckGroup, Choice, Row, TextArea, TextField } from '../../components/Field';
import { Icon } from '../../components/Icon';
import {
  byContactName,
  CONTACT_LIMITS,
  contactMatches,
  draftFromContact,
  emptyContactDraft,
  readContact,
  type ContactDraft,
  type ContactField,
  type ContactFieldError,
  type ContactKind,
  type ContactRoles,
} from '../../domain/contact';
import { TEXT_LIMITS } from '../../domain/check';
import type { ContactId } from '../../data/ids';
import type { ContactFile } from '../../data/types';
import { t, type MessageKey } from '../../i18n';
import { fieldError } from '../../lib/labels';
import { addContact, deleteContact, showToast, updateContact, useApp } from '../../store/appStore';

// Customers and suppliers: a searchable list, and a form for a new or an existing contact.
// The form edits a draft; only "Save" puts the checked contact into the store (and the persister writes it).

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; id: ContactId };
type RoleFilter = 'all' | 'customer' | 'supplier';

export function ContactsView() {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const back = () => setMode({ kind: 'list' });
  switch (mode.kind) {
    case 'list':
      return <ContactList onNew={() => setMode({ kind: 'new' })} onOpen={(id) => setMode({ kind: 'edit', id })} />;
    case 'new':
      return <ContactEditor contact={null} onDone={back} />;
    case 'edit':
      return <EditExisting id={mode.id} onDone={back} />;
  }
}

function EditExisting({ id, onDone }: { id: ContactId; onDone: () => void }) {
  const contact = useApp((s) => s.contacts.get(id));
  // deleted or gone (for example merged away from another device): back to the list
  useEffect(() => {
    if (!contact || contact.deletedAt) onDone();
  }, [contact, onDone]);
  return contact && !contact.deletedAt ? <ContactEditor key={id} contact={contact} onDone={onDone} /> : null;
}

/* ---------- List ---------- */

const ROLE_FILTERS: { value: RoleFilter; label: MessageKey }[] = [
  { value: 'all', label: 'contacts.filterAll' },
  { value: 'customer', label: 'contacts.filterCustomers' },
  { value: 'supplier', label: 'contacts.filterSuppliers' },
];

function roleLabel(r: ContactRoles): string {
  if (r.customer && r.supplier) return t('contacts.roleBoth');
  return r.customer ? t('contacts.roleCustomer') : t('contacts.roleSupplier');
}

function ContactList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: ContactId) => void }) {
  const all = useApp((s) => s.contacts);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<RoleFilter>('all');
  const searchId = useId();
  const active = useMemo(() => [...all.values()].filter((c) => !c.deletedAt).sort(byContactName), [all]);
  const shown = active.filter((c) => (role === 'all' || c.roles[role]) && contactMatches(c, query));

  return (
    <div className="page wide">
      <header className="top">
        <h1>{t('contacts.title')}</h1>
        <span className="sp" />
        <button type="button" className="btn primary" onClick={onNew}>
          <Icon n="plus" s={14} />
          {t('contacts.new')}
        </button>
      </header>
      {active.length === 0 ? (
        <p className="empty">{t('contacts.empty')}</p>
      ) : (
        <>
          <div className="list-tools">
            <label className="visually-hidden" htmlFor={searchId}>
              {t('contacts.search')}
            </label>
            <input id={searchId} className="search-in" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('contacts.searchPlaceholder')} />
            <div className="seg" role="group" aria-label={t('contacts.filter')}>
              {ROLE_FILTERS.map((f) => (
                <button key={f.value} type="button" className={role === f.value ? 'on' : ''} aria-pressed={role === f.value} onClick={() => setRole(f.value)}>
                  {t(f.label)}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="empty" role="status">
              {t('contacts.noMatch')}
            </p>
          ) : (
            <table className="table">
              <caption className="visually-hidden">{t('contacts.count', { n: shown.length })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('contacts.colName')}</th>
                  <th scope="col">{t('contacts.colRole')}</th>
                  <th scope="col">{t('contacts.colCity')}</th>
                  <th scope="col">{t('contacts.colNumber')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <ContactRow key={c.id} contact={c} onOpen={onOpen} />
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function ContactRow({ contact: c, onOpen }: { contact: ContactFile; onOpen: (id: ContactId) => void }) {
  return (
    <tr>
      <td>
        <button type="button" className="row-link" onClick={() => onOpen(c.id)}>
          <Icon n={c.kind === 'company' ? 'building' : 'contacts'} s={14} />
          <span>
            {c.name}
            {(c.nameLine2 || c.contactPerson) && <small>{[c.nameLine2, c.contactPerson].filter(Boolean).join(' · ')}</small>}
          </span>
        </button>
      </td>
      <td>{roleLabel(c.roles)}</td>
      <td>{c.address?.city ?? ''}</td>
      <td>{c.customerNumber}</td>
    </tr>
  );
}

/* ---------- Form ---------- */

function ContactEditor({ contact, onDone }: { contact: ContactFile | null; onDone: () => void }) {
  const contacts = useApp((s) => s.contacts);
  const defaultTerm = useApp((s) => s.company?.invoiceDefaults.paymentTermDays ?? 0);
  const [draft, setDraft] = useState<ContactDraft>(() => (contact ? draftFromContact(contact) : emptyContactDraft()));
  const [errors, setErrors] = useState<readonly ContactFieldError[]>([]);
  const [checked, setChecked] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), []);

  /** Another active contact with the same number (ignoring case and surrounding spaces) */
  const isNumberTaken = (n: string) =>
    [...contacts.values()].some((c) => c.id !== contact?.id && !c.deletedAt && c.customerNumber.trim().toLowerCase() === n.toLowerCase());

  const set = (patch: Partial<ContactDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (checked) {
      const r = readContact(next, isNumberTaken);
      setErrors(r.ok ? [] : r.error);
    }
  };
  const e = (f: ContactField) => fieldError(errors, f);

  const save = () => {
    const r = readContact(draft, isNumberTaken);
    if (!r.ok) {
      setChecked(true);
      setErrors(r.error);
      requestAnimationFrame(() => {
        const el = document.querySelector('.contact-form [aria-invalid="true"]');
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : el?.querySelector('input'))?.focus();
      });
      return;
    }
    if (contact) updateContact(contact.id, r.value);
    else addContact(r.value);
    showToast(t('contacts.saved', { name: r.value.name }));
    onDone();
  };

  const remove = () => {
    if (!contact) return;
    deleteContact(contact.id);
    showToast(t('contacts.deleted', { name: contact.name }));
    onDone();
  };

  const kindOptions: { value: ContactKind; label: string }[] = [
    { value: 'company', label: t('contacts.kindCompany') },
    { value: 'person', label: t('contacts.kindPerson') },
  ];

  return (
    <div className="page">
      <header className="top">
        <button type="button" className="icon-btn" onClick={onDone} aria-label={t('contacts.backToList')}>
          <Icon n="chevL" />
        </button>
        <h1 ref={heading} tabIndex={-1}>
          {contact ? contact.name : t('contacts.new')}
        </h1>
      </header>
      <form
        className="form contact-form"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          save();
        }}
      >
        <section className="card" aria-labelledby="contact-who">
          <h2 id="contact-who">{t('contacts.sectionWho')}</h2>
          <Choice<ContactKind> label={t('contacts.kind')} value={draft.kind} options={kindOptions} onChange={(kind) => set({ kind })} required />
          <CheckGroup<'customer' | 'supplier'>
            label={t('contacts.role')}
            options={[
              { key: 'customer', label: t('contacts.roleCustomer'), checked: draft.customer },
              { key: 'supplier', label: t('contacts.roleSupplier'), checked: draft.supplier },
            ]}
            onChange={(key, value) => set(key === 'customer' ? { customer: value } : { supplier: value })}
            error={e('customer')}
            required
          />
          <TextField
            label={draft.kind === 'company' ? t('contacts.nameCompany') : t('contacts.namePerson')}
            value={draft.name}
            onChange={(name) => set({ name })}
            error={e('name')}
            required
            maxLength={CONTACT_LIMITS.name}
          />
          <TextField label={t('contacts.nameLine2')} hint={t('contacts.nameLine2Hint')} value={draft.nameLine2} onChange={(nameLine2) => set({ nameLine2 })} error={e('nameLine2')} maxLength={CONTACT_LIMITS.nameLine2} />
          {draft.kind === 'company' && (
            <TextField label={t('contacts.contactPerson')} value={draft.contactPerson} onChange={(contactPerson) => set({ contactPerson })} error={e('contactPerson')} maxLength={CONTACT_LIMITS.contactPerson} />
          )}
          <TextField className="w-num" label={t('contacts.number')} value={draft.customerNumber} onChange={(customerNumber) => set({ customerNumber })} error={e('customerNumber')} maxLength={CONTACT_LIMITS.customerNumber} />
        </section>

        <section className="card" aria-labelledby="contact-address">
          <h2 id="contact-address">{t('contacts.sectionAddress')}</h2>
          <p className="f-intro">{t('contacts.addressHint')}</p>
          <TextField label={t('company.street')} value={draft.street} onChange={(street) => set({ street })} error={e('street')} maxLength={TEXT_LIMITS.street} autoComplete="off" />
          <Row>
            <TextField className="w-postal" label={t('company.postalCode')} value={draft.postalCode} onChange={(postalCode) => set({ postalCode })} error={e('postalCode')} autoComplete="off" />
            <TextField label={t('company.city')} value={draft.city} onChange={(city) => set({ city })} error={e('city')} maxLength={TEXT_LIMITS.city} autoComplete="off" />
            <TextField className="w-country" label={t('company.country')} hint={t('company.countryHint')} value={draft.country} onChange={(country) => set({ country })} error={e('country')} maxLength={2} autoComplete="off" />
          </Row>
          <Row>
            <TextField label={t('contacts.email')} type="email" value={draft.email} onChange={(email) => set({ email })} error={e('email')} inputMode="email" maxLength={TEXT_LIMITS.email} autoComplete="off" />
            <TextField label={t('company.phone')} type="tel" value={draft.phone} onChange={(phone) => set({ phone })} error={e('phone')} inputMode="tel" maxLength={TEXT_LIMITS.phone} autoComplete="off" />
          </Row>
        </section>

        <section className="card" aria-labelledby="contact-invoicing">
          <h2 id="contact-invoicing">{t('contacts.sectionInvoicing')}</h2>
          <Row>
            <TextField label={t('contacts.vatId')} hint={t('contacts.vatIdHint')} value={draft.vatId} onChange={(vatId) => set({ vatId })} error={e('vatId')} maxLength={CONTACT_LIMITS.vatId} />
            <TextField label={t('contacts.leitwegId')} hint={t('contacts.leitwegIdHint')} value={draft.leitwegId} onChange={(leitwegId) => set({ leitwegId })} error={e('leitwegId')} maxLength={46} />
          </Row>
          <Row>
            <TextField label={t('contacts.orderReference')} hint={t('contacts.orderReferenceHint')} value={draft.orderReference} onChange={(orderReference) => set({ orderReference })} error={e('orderReference')} maxLength={CONTACT_LIMITS.orderReference} />
            <TextField
              className="w-num"
              label={t('invoice.paymentTerm')}
              hint={t('contacts.paymentTermHint', { days: defaultTerm })}
              value={draft.paymentTermDays}
              onChange={(paymentTermDays) => set({ paymentTermDays })}
              error={e('paymentTermDays')}
              inputMode="numeric"
              maxLength={3}
            />
          </Row>
          <TextArea label={t('contacts.notes')} value={draft.notes} onChange={(notes) => set({ notes })} error={e('notes')} maxLength={CONTACT_LIMITS.notes} />
        </section>

        <div className="card-actions">
          <button type="submit" className="btn primary">
            {t('contacts.save')}
          </button>
          <button type="button" className="btn" onClick={onDone}>
            {t('common.cancel')}
          </button>
          <span className="sp" />
          {contact &&
            (confirmDelete ? (
              <div className="confirm" role="group" aria-label={t('contacts.deleteConfirm')}>
                <span>{t('contacts.deleteConfirm')}</span>
                <button type="button" className="btn danger" onClick={remove} autoFocus>
                  {t('contacts.delete')}
                </button>
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <button type="button" className="btn ghost danger-text" onClick={() => setConfirmDelete(true)}>
                {t('contacts.delete')}
              </button>
            ))}
        </div>
      </form>
    </div>
  );
}
