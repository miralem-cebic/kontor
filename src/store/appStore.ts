import { create } from 'zustand';
import { MAX_ACCOUNTS, type AccountDetails } from '../domain/bankAccount';
import type { ContactProfile } from '../domain/contact';
import { keysOf, type AccountId, type ContactId } from '../data/ids';
import { mergeCompany, mergeContact, sameJson } from '../data/merge';
import type { StorageErrorKind } from '../data/repository';
import { makeAccount, makeContact, nowIso } from '../data/schema';
import type { BankAccount, Banking, CompanyFile, ContactFile, ContactMergeableField, MergeableField } from '../data/types';

// Central app state. Every change goes through the actions below: they change the state immediately,
// and the persister (data/persister.ts) writes in the background. Components never write files.

export type SaveStatus = { state: 'saved' } | { state: 'saving' } | { state: 'error'; kind: StorageErrorKind };

export interface Toast {
  id: string;
  msg: string;
}

export interface AppState {
  /** The open company, or null before one is loaded */
  company: CompanyFile | null;
  /** Contacts of the open company by ID, deleted ones included (they are hidden in the UI) */
  contacts: ReadonlyMap<ContactId, ContactFile>;
  /** Object URL of the logo for display; not stored */
  logoUrl: string | null;
  save: SaveStatus;
  toast: Toast | null;
}

const initial: AppState = { company: null, contacts: new Map(), logoUrl: null, save: { state: 'saved' }, toast: null };

export const useApp = create<AppState>()(() => ({ ...initial }));
const get = useApp.getState;
const set = useApp.setState;

export function resetApp() {
  const url = get().logoUrl;
  if (url) URL.revokeObjectURL(url);
  set({ ...initial });
}

const byId = (contacts: readonly ContactFile[]) => new Map(contacts.map((c) => [c.id, c]));

/** A company and its contacts as read from the folder */
export function loadCompany(company: CompanyFile, contacts: readonly ContactFile[]) {
  set({ company, contacts: byId(contacts), save: { state: 'saved' } });
}

/** Unsaved changes from an earlier session, merged into the loaded state; the persister writes them */
export function applyRecovered(company: CompanyFile, contacts: readonly ContactFile[]) {
  if (get().company?.id !== company.id) return;
  set((s) => ({ company, contacts: contacts.length ? new Map([...s.contacts, ...byId(contacts)]) : s.contacts }));
}

interface Stamped<F extends string> {
  fieldUpdatedAt: Partial<Record<F, string>>;
}

/**
 * The record with the changed fields of `patch`. Every changed field gets a new `fieldUpdatedAt`, which the
 * merge relies on. Returns `current` itself when nothing changed.
 */
function withChanges<F extends string, T extends Stamped<F> & Record<F, unknown>>(current: T, patch: Partial<Pick<T, F>>, at = nowIso()): T {
  const next: T = { ...current, fieldUpdatedAt: { ...current.fieldUpdatedAt } };
  let changed = false;
  for (const field of keysOf<F>(patch)) {
    const value = patch[field];
    if (value === undefined || sameJson(value, current[field])) continue;
    next[field] = value as T[F];
    next.fieldUpdatedAt[field] = at;
    changed = true;
  }
  return changed ? next : current;
}

export type CompanyPatch = Partial<Pick<CompanyFile, MergeableField>>;

export function updateCompany(patch: CompanyPatch) {
  const current = get().company;
  if (!current) return;
  const next = withChanges<MergeableField, CompanyFile>(current, patch);
  if (next !== current) set({ company: next });
}

/**
 * The repository merged a change from another device while saving `sent`. When the state did not change
 * in the meantime, the written state is taken as it is; otherwise the newer local edits are merged on top.
 */
export function integrateWrittenCompany(sent: CompanyFile, written: CompanyFile) {
  const current = get().company;
  if (!current || current.id !== written.id) return;
  set({ company: current === sent ? written : mergeCompany(current, written) });
}

/* ---------- Bank accounts ---------- */

// The accounts are one field of company.json (`bank`): every change goes through updateCompany, which stamps it.

function changeBank(change: (bank: Banking) => Banking) {
  const company = get().company;
  if (company) updateCompany({ bank: change(company.bank) });
}

const activeAccount = (bank: Banking, id: AccountId): BankAccount | undefined => bank.accounts.find((a) => a.id === id && !a.deletedAt);

/** A new account from checked details (the form's draft is never stored). Returns its ID, or null at the limit. */
export function addAccount(details: AccountDetails): AccountId | null {
  const company = get().company;
  if (!company || company.bank.accounts.length >= MAX_ACCOUNTS) return null;
  const account = makeAccount(details);
  changeBank((bank) => ({ ...bank, accounts: [...bank.accounts, account] }));
  return account.id;
}

/** New details for an active account. The kind of an account does not change. */
export function updateAccount(id: AccountId, details: AccountDetails) {
  changeBank((bank) => {
    const current = activeAccount(bank, id);
    if (!current || current.kind !== details.kind) return bank;
    return { ...bank, accounts: bank.accounts.map((a) => (a === current ? { ...a, ...details } : a)) };
  });
}

/** The account proposed for new invoices */
export function setDefaultAccount(id: AccountId) {
  changeBank((bank) => (activeAccount(bank, id) ? { ...bank, defaultAccountId: id } : bank));
}

/** Soft delete: the account stays in company.json and is hidden. The default account cannot be removed. */
export function deleteAccount(id: AccountId) {
  changeBank((bank) => {
    const current = activeAccount(bank, id);
    if (!current || bank.defaultAccountId === id) return bank;
    const at = nowIso();
    return { ...bank, accounts: bank.accounts.map((a) => (a === current ? { ...a, deletedAt: at } : a)) };
  });
}

/* ---------- Contacts ---------- */

function putContact(contact: ContactFile) {
  set((s) => ({ contacts: new Map(s.contacts).set(contact.id, contact) }));
}

/** A new contact from a checked profile (the form's draft is never stored). Returns its ID. */
export function addContact(profile: ContactProfile): ContactId {
  const contact = makeContact(profile);
  putContact(contact);
  return contact.id;
}

export function updateContact(id: ContactId, profile: ContactProfile) {
  const current = get().contacts.get(id);
  if (!current) return;
  const next = withChanges<ContactMergeableField, ContactFile>(current, profile);
  if (next !== current) putContact(next);
}

/** Soft delete: the file stays, the contact is hidden */
export function deleteContact(id: ContactId) {
  const current = get().contacts.get(id);
  if (!current || current.deletedAt) return;
  const at = nowIso();
  putContact(withChanges<ContactMergeableField, ContactFile>(current, { deletedAt: at }, at));
}

/** Like `integrateWrittenCompany`, for one contact */
export function integrateWrittenContact(sent: ContactFile, written: ContactFile) {
  const current = get().contacts.get(written.id);
  if (!current) return;
  putContact(current === sent ? written : mergeContact(current, written));
}

/* ---------- UI ---------- */

export function setLogoUrl(url: string | null) {
  const old = get().logoUrl;
  if (old && old !== url) URL.revokeObjectURL(old);
  set({ logoUrl: url });
}

export const setSaveStatus = (save: SaveStatus) => set({ save });

let toastSeq = 0;
export function showToast(msg: string) {
  set({ toast: { id: String(++toastSeq), msg } });
}
export const dismissToast = () => set({ toast: null });
