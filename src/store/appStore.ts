import { create } from 'zustand';
import { MAX_ACCOUNTS, type AccountDetails } from '../domain/bankAccount';
import type { ContactProfile } from '../domain/contact';
import type { Receipt } from '../domain/receipt';
import type { ExpenseProfile } from '../domain/expense';
import type { PayoutProfile } from '../domain/payout';
import type { InvoiceContent } from '../domain/invoice';
import type { ItemProfile } from '../domain/item';
import type { QuoteContent } from '../domain/quote';
import { keysOf, type AccountId, type ContactId, type DocumentId, type DunningId, type ExpenseId, type ImportBatchId, type ItemId, type PaymentId, type PayoutId, type QuoteStatusId } from '../data/ids';
import { mergeCompany, mergeContact, mergeDocument, mergeExpense, mergeItem, mergePayment, mergePayout, mergeQuoteStatus, sameJson } from '../data/merge';
import type { StorageErrorKind } from '../data/repository';
import { makeAccount, makeContact, makeExpense, makeInvoice, makeItem, makePayout, makeQuote, nowIso } from '../data/schema';
import type {
  BankAccount,
  Banking,
  CompanyFile,
  ContactFile,
  ContactMergeableField,
  DocumentFile,
  ExpenseFile,
  ExpenseMergeableField,
  InvoiceFile,
  InvoiceMergeableField,
  ItemFile,
  ItemMergeableField,
  DunningFile,
  MergeableField,
  PaymentFile,
  PayoutFile,
  PayoutMergeableField,
  QuoteFile,
  QuoteStatusFile,
  QuoteMergeableField,
  RevisedQuote,
} from '../data/types';

// Central app state. Every change goes through the actions below: they change the state immediately,
// and the persister (data/persister.ts) writes in the background. Components never write files.

export type SaveStatus = { state: 'saved' } | { state: 'saving' } | { state: 'error'; kind: StorageErrorKind };

/**
 * A change the folder refuses for a reason that trying again does not fix (a newer or damaged file, a conflict). It
 * waits apart, so that the other records are written and the work goes on; it can be tried again or discarded.
 * `key` is the persister's key of the record: `company`, or the kind and the ID (`contact:<id>`).
 */
export interface UnsavedWrite {
  key: string;
  kind: StorageErrorKind;
}

export interface Toast {
  id: string;
  msg: string;
}

export interface AppState {
  /** The open company, or null before one is loaded */
  company: CompanyFile | null;
  /** Contacts of the open company by ID, deleted ones included (they are hidden in the UI) */
  contacts: ReadonlyMap<ContactId, ContactFile>;
  /** Items of the catalogue by ID, deleted ones included (they are hidden in the UI) */
  items: ReadonlyMap<ItemId, ItemFile>;
  /** Quotes and invoices by ID, deleted ones included (they are hidden in the UI) */
  documents: ReadonlyMap<DocumentId, DocumentFile>;
  /** Payments of issued invoices by ID, deleted ones included (they count as no payment) */
  payments: ReadonlyMap<PaymentId, PaymentFile>;
  /** Dunnings of issued invoices by ID; a dunning is never changed */
  dunnings: ReadonlyMap<DunningId, DunningFile>;
  /** Decisions of the customer on quotes by ID, removed ones included (they count as no decision) */
  quoteStatuses: ReadonlyMap<QuoteStatusId, QuoteStatusFile>;
  /** Expenses by ID, removed ones included (they are hidden in the UI) */
  expenses: ReadonlyMap<ExpenseId, ExpenseFile>;
  /** Payouts (income without an invoice) by ID, removed ones included (they count as no income) */
  payouts: ReadonlyMap<PayoutId, PayoutFile>;
  /** Object URL of the logo for display; not stored */
  logoUrl: string | null;
  save: SaveStatus;
  /** Changes the folder refused for good; empty when there are none */
  unsaved: readonly UnsavedWrite[];
  /** The browser could not keep the emergency copy of the unsaved changes (its storage is full or blocked) */
  emergencyCopyFailed: boolean;
  toast: Toast | null;
}

const initial: AppState = { company: null, contacts: new Map(), items: new Map(), documents: new Map(), payments: new Map(), dunnings: new Map(), quoteStatuses: new Map(), expenses: new Map(), payouts: new Map(), logoUrl: null, save: { state: 'saved' }, unsaved: [], emergencyCopyFailed: false, toast: null };

export const useApp = create<AppState>()(() => ({ ...initial }));
const get = useApp.getState;
const set = useApp.setState;

export function resetApp() {
  const url = get().logoUrl;
  if (url) URL.revokeObjectURL(url);
  set({ ...initial });
}

const byId = <T extends { id: string }>(records: readonly T[]) => new Map<T['id'], T>(records.map((r) => [r.id, r]));

/** The records of a company folder besides company.json */
export interface CompanyRecords {
  contacts: readonly ContactFile[];
  items: readonly ItemFile[];
  documents: readonly DocumentFile[];
  payments: readonly PaymentFile[];
  dunnings: readonly DunningFile[];
  quoteStatuses: readonly QuoteStatusFile[];
  expenses: readonly ExpenseFile[];
  payouts: readonly PayoutFile[];
}

/** A company and its records as read from the folder */
export function loadCompany(company: CompanyFile, { contacts, items, documents, payments, dunnings, quoteStatuses, expenses, payouts }: CompanyRecords) {
  set({ company, contacts: byId(contacts), items: byId(items), documents: byId(documents), payments: byId(payments), dunnings: byId(dunnings), quoteStatuses: byId(quoteStatuses), expenses: byId(expenses), payouts: byId(payouts), save: { state: 'saved' }, unsaved: [], emergencyCopyFailed: false });
}

/** Unsaved changes from an earlier session, merged into the loaded state; the persister writes them */
export function applyRecovered(company: CompanyFile, { contacts, items, documents, payments, dunnings, quoteStatuses, expenses, payouts }: CompanyRecords) {
  if (get().company?.id !== company.id) return;
  set((s) => ({
    company,
    contacts: contacts.length ? new Map([...s.contacts, ...byId(contacts)]) : s.contacts,
    items: items.length ? new Map([...s.items, ...byId(items)]) : s.items,
    documents: documents.length ? new Map([...s.documents, ...byId(documents)]) : s.documents,
    payments: payments.length ? new Map([...s.payments, ...byId(payments)]) : s.payments,
    dunnings: dunnings.length ? new Map([...s.dunnings, ...byId(dunnings)]) : s.dunnings,
    quoteStatuses: quoteStatuses.length ? new Map([...s.quoteStatuses, ...byId(quoteStatuses)]) : s.quoteStatuses,
    expenses: expenses.length ? new Map([...s.expenses, ...byId(expenses)]) : s.expenses,
    payouts: payouts.length ? new Map([...s.payouts, ...byId(payouts)]) : s.payouts,
  }));
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

/** A new contact from a checked profile (the form's draft is never stored). `importBatchId`: the import it comes from, if any. Returns its ID. */
export function addContact(profile: ContactProfile, importBatchId: ImportBatchId | null = null): ContactId {
  const contact = makeContact(profile, importBatchId);
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

/** Takes back an import: every contact of the batch is removed (a soft delete). Returns how many were removed. */
export function undoContactImport(batch: ImportBatchId): number {
  const ids = [...get().contacts.values()].filter((c) => c.importBatchId === batch && !c.deletedAt).map((c) => c.id);
  for (const id of ids) deleteContact(id);
  return ids.length;
}

/** Like `integrateWrittenCompany`, for one contact */
export function integrateWrittenContact(sent: ContactFile, written: ContactFile) {
  const current = get().contacts.get(written.id);
  if (!current) return;
  putContact(current === sent ? written : mergeContact(current, written));
}

/* ---------- Items ---------- */

function putItem(item: ItemFile) {
  set((s) => ({ items: new Map(s.items).set(item.id, item) }));
}

/** A new item from a checked profile (the form's draft is never stored). `importBatchId`: the import it comes from, if any. Returns its ID. */
export function addItem(profile: ItemProfile, importBatchId: ImportBatchId | null = null): ItemId {
  const item = makeItem(profile, importBatchId);
  putItem(item);
  return item.id;
}

export function updateItem(id: ItemId, profile: ItemProfile) {
  const current = get().items.get(id);
  if (!current) return;
  const next = withChanges<ItemMergeableField, ItemFile>(current, profile);
  if (next !== current) putItem(next);
}

/** Soft delete: the file stays, the item is hidden */
export function deleteItem(id: ItemId) {
  const current = get().items.get(id);
  if (!current || current.deletedAt) return;
  const at = nowIso();
  putItem(withChanges<ItemMergeableField, ItemFile>(current, { deletedAt: at }, at));
}

/** Takes back an import: every item of the batch is removed (a soft delete). Returns how many were removed. */
export function undoItemImport(batch: ImportBatchId): number {
  const ids = [...get().items.values()].filter((i) => i.importBatchId === batch && !i.deletedAt).map((i) => i.id);
  for (const id of ids) deleteItem(id);
  return ids.length;
}

/** Like `integrateWrittenCompany`, for one item */
export function integrateWrittenItem(sent: ItemFile, written: ItemFile) {
  const current = get().items.get(written.id);
  if (!current) return;
  putItem(current === sent ? written : mergeItem(current, written));
}

/* ---------- Expenses ---------- */

function putExpense(expense: ExpenseFile) {
  set((s) => ({ expenses: new Map(s.expenses).set(expense.id, expense) }));
}

/**
 * The account of the company as its own ID. A removed account is still found, so that the expense keeps it; the form
 * has checked the ID against the active accounts already.
 */
function accountIdOf(id: string | null): AccountId | null {
  if (id === null) return null;
  return get().company?.bank.accounts.find((a) => a.id === id)?.id ?? null;
}

/** A new expense from a checked profile (the form's draft is never stored). Returns its ID. */
export function addExpense(profile: ExpenseProfile): ExpenseId {
  const expense = makeExpense({ ...profile, accountId: accountIdOf(profile.accountId) });
  putExpense(expense);
  return expense.id;
}

export function updateExpense(id: ExpenseId, profile: ExpenseProfile) {
  const current = get().expenses.get(id);
  if (!current || current.deletedAt) return;
  const next = withChanges<ExpenseMergeableField, ExpenseFile>(current, { ...profile, accountId: accountIdOf(profile.accountId) });
  if (next !== current) putExpense(next);
}

/** Soft delete: the file stays, the expense is hidden */
export function deleteExpense(id: ExpenseId) {
  const current = get().expenses.get(id);
  if (!current || current.deletedAt) return;
  const at = nowIso();
  putExpense(withChanges<ExpenseMergeableField, ExpenseFile>(current, { deletedAt: at }, at));
}

/** The receipt of an expense (or none): a field of its own, merged like the others. The file is written by app/receipts.ts first. */
export function setExpenseReceipt(id: ExpenseId, receipt: Receipt | null) {
  const current = get().expenses.get(id);
  if (!current || current.deletedAt) return;
  const next = withChanges<ExpenseMergeableField, ExpenseFile>(current, { receipt }, nowIso());
  if (next !== current) putExpense(next);
}

/** Like `integrateWrittenItem`, for one expense */
export function integrateWrittenExpense(sent: ExpenseFile, written: ExpenseFile) {
  const current = get().expenses.get(written.id);
  if (!current) return;
  putExpense(current === sent ? written : mergeExpense(current, written));
}

/* ---------- Payouts ---------- */

function putPayout(payout: PayoutFile) {
  set((s) => ({ payouts: new Map(s.payouts).set(payout.id, payout) }));
}

/** The contact with that ID, as its own ID; null when there is none (the form has checked it against the contact list) */
const contactIdOf = (id: string): ContactId | null => [...get().contacts.keys()].find((k) => k === id) ?? null;

/** A new payout from a checked profile (the form's draft is never stored). Returns its ID, or null when the account or the payer is not known. */
export function addPayout(profile: PayoutProfile): PayoutId | null {
  const accountId = accountIdOf(profile.accountId);
  const payerId = contactIdOf(profile.payerId);
  if (accountId === null || payerId === null) return null;
  const payout = makePayout({ ...profile, accountId, payerId });
  putPayout(payout);
  return payout.id;
}

/** Changes a payout to a checked profile; false when it is gone, removed, or the account or payer is not known */
export function updatePayout(id: PayoutId, profile: PayoutProfile): boolean {
  const current = get().payouts.get(id);
  const accountId = accountIdOf(profile.accountId);
  const payerId = contactIdOf(profile.payerId);
  if (!current || current.deletedAt || accountId === null || payerId === null) return false;
  const next = withChanges<PayoutMergeableField, PayoutFile>(current, { ...profile, accountId, payerId });
  if (next !== current) putPayout(next);
  return true;
}

/** Soft delete: the file stays, the payout is hidden and counts as no income */
export function deletePayout(id: PayoutId) {
  const current = get().payouts.get(id);
  if (!current || current.deletedAt) return;
  const at = nowIso();
  putPayout(withChanges<PayoutMergeableField, PayoutFile>(current, { deletedAt: at }, at));
}

/** Like `integrateWrittenItem`, for one payout */
export function integrateWrittenPayout(sent: PayoutFile, written: PayoutFile) {
  const current = get().payouts.get(written.id);
  if (!current) return;
  putPayout(current === sent ? written : mergePayout(current, written));
}

/* ---------- Quotes and invoices ---------- */

function putDocument(document: DocumentFile) {
  set((s) => ({ documents: new Map(s.documents).set(document.id, document) }));
}

/** A new quote from checked content (the form's draft is never stored), or a new version of a finalized one. Returns its ID. */
export function addQuote(customerId: ContactId, content: QuoteContent, revises: RevisedQuote | null = null): DocumentId {
  const quote = makeQuote(customerId, content, revises);
  putDocument(quote);
  return quote.id;
}

/** Only a draft can change; a finalized quote stays as it is, like an issued invoice */
export function updateQuote(id: DocumentId, customerId: ContactId, content: QuoteContent) {
  const current = get().documents.get(id);
  if (!current || current.deletedAt || current.kind !== 'quote' || current.issued) return;
  const next = withChanges<QuoteMergeableField, QuoteFile>(current, { customerId, ...content });
  if (next !== current) putDocument(next);
}

/** A new invoice draft from checked content, made from a quote or not. Returns its ID. */
export function addInvoice(customerId: ContactId, accountId: AccountId, content: InvoiceContent, quoteId: DocumentId | null): DocumentId {
  const invoice = makeInvoice(customerId, accountId, content, quoteId);
  putDocument(invoice);
  return invoice.id;
}

/** Only a draft can change; an issued invoice stays as it is (ADR 0004) */
export function updateInvoice(id: DocumentId, customerId: ContactId, accountId: AccountId, content: InvoiceContent) {
  const current = get().documents.get(id);
  if (!current || current.deletedAt || current.kind !== 'invoice' || current.issued) return;
  const next = withChanges<InvoiceMergeableField, InvoiceFile>(current, { customerId, accountId, ...content });
  if (next !== current) putDocument(next);
}

/** Soft delete: the file stays, the draft is hidden. An issued invoice or a finalized quote cannot be deleted. */
export function deleteDocument(id: DocumentId) {
  const current = get().documents.get(id);
  if (!current || current.deletedAt || current.issued) return;
  const at = nowIso();
  putDocument(withChanges<'deletedAt', DocumentFile>(current, { deletedAt: at }, at));
}

/* ---------- Payments ---------- */

function putPayment(payment: PaymentFile) {
  set((s) => ({ payments: new Map(s.payments).set(payment.id, payment) }));
}

/** A payment as the payment flow wrote it (app/payments.ts): recorded, or deleted; the file is written first */
export function putWrittenPayment(payment: PaymentFile) {
  putPayment(payment);
}

/** Like `integrateWrittenCompany`, for one payment */
export function integrateWrittenPayment(sent: PaymentFile, written: PaymentFile) {
  const current = get().payments.get(written.id);
  if (!current) return;
  putPayment(current === sent ? written : mergePayment(current, written));
}

/* ---------- Decisions on quotes ---------- */

function putQuoteStatus(quoteStatus: QuoteStatusFile) {
  set((s) => ({ quoteStatuses: new Map(s.quoteStatuses).set(quoteStatus.id, quoteStatus) }));
}

/** A decision on a quote as the decision flow wrote it (app/quoteStatus.ts): recorded, or removed; the file is written first */
export function putWrittenQuoteStatus(quoteStatus: QuoteStatusFile) {
  putQuoteStatus(quoteStatus);
}

/** Like `integrateWrittenPayment`, for one decision on a quote */
export function integrateWrittenQuoteStatus(sent: QuoteStatusFile, written: QuoteStatusFile) {
  const current = get().quoteStatuses.get(written.id);
  if (!current) return;
  putQuoteStatus(current === sent ? written : mergeQuoteStatus(current, written));
}

/* ---------- Dunnings ---------- */

function putDunning(dunning: DunningFile) {
  set((s) => ({ dunnings: new Map(s.dunnings).set(dunning.id, dunning) }));
}

/** A dunning as the dunning flow wrote it (app/dunning.ts): issued, and kept as it is from then on */
export function putWrittenDunning(dunning: DunningFile) {
  putDunning(dunning);
}

/** Like `integrateWrittenPayment`, for one dunning: a dunning is never changed, so the written one is kept */
export function integrateWrittenDunning(_sent: DunningFile, written: DunningFile) {
  if (get().dunnings.has(written.id)) putDunning(written);
}

/** An invoice or a quote as the issue flow wrote it (app/issue.ts): issued, with its number, snapshot and PDF */
export function putIssuedDocument(written: DocumentFile) {
  if (!written.issued) return;
  putDocument(written);
}

/** Like `integrateWrittenCompany`, for one document */
export function integrateWrittenDocument(sent: DocumentFile, written: DocumentFile) {
  const current = get().documents.get(written.id);
  if (!current) return;
  putDocument(current === sent ? written : mergeDocument(current, written));
}

/* ---------- UI ---------- */

export function setLogoUrl(url: string | null) {
  const old = get().logoUrl;
  if (old && old !== url) URL.revokeObjectURL(old);
  set({ logoUrl: url });
}

export const setSaveStatus = (save: SaveStatus) => set({ save });
export const setUnsaved = (unsaved: readonly UnsavedWrite[]) => set({ unsaved });
export const setEmergencyCopyFailed = (emergencyCopyFailed: boolean) => {
  if (get().emergencyCopyFailed !== emergencyCopyFailed) set({ emergencyCopyFailed });
};

let toastSeq = 0;
export function showToast(msg: string) {
  set({ toast: { id: String(++toastSeq), msg } });
}
export const dismissToast = () => set({ toast: null });
