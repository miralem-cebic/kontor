import { create } from 'zustand';
import { checkStoredLogo, logoFileName, MAX_LOGO_BYTES, type LogoRef, type LogoType, type NewCompany } from '../domain/company';
import { indexedDbHandleStore, type CompanyEntry, type HandleStore } from '../data/fs/handleStore';
import { FsRepository } from '../data/fs/FsRepository';
import { toSafeFileName } from '../data/fs/fileNames';
import { ensureReadWrite } from '../data/fs/permission';
import { StorageDir, storageHandleStore } from '../data/fs/storageFs';
import { checkSupport } from '../data/fs/support';
import { acquireCompanyLock, waitForClosed, type ClosedMessage, type CompanyLock } from './companyLock';
import type { CompanyId } from '../data/ids';
import { dailyBackup } from '../data/maintenance';
import { mergeCompany, mergeContact, mergeDocument, mergeExpense, mergeItem, mergePayout, sameJson } from '../data/merge';
import { migrate } from '../data/migrations';
import { emergencyKey, legacyEmergencyKey, Persister, readEmergencyCopy } from '../data/persister';
import { classifyError, type Asset, type Repository, type StorageErrorKind } from '../data/repository';
import { makeCompany } from '../data/schema';
import type { CompanyFile } from '../data/types';
import { isRecord } from '../data/validate';
import { t } from '../i18n';
import { sha256Hex } from '../lib/sha256';
import { applyRecovered, loadCompany, resetApp, setLoadIssues, setLogoProblem, setLogoUrl, showToast, updateCompany, useApp, type CompanyRecords } from '../store/appStore';
import { setLastCompany, usePrefs } from '../store/prefs';

// Startup flow: check the browser → known company folders → permission → load → app.
// "Add company" runs the setup assistant while the current company stays open until the new one is ready.

/** `busy`: the company is open in another window of this browser, which holds its lock (#97) */
export type Phase = 'checking' | 'unsupported' | 'setup' | 'reconnect' | 'loading' | 'busy' | 'failed' | 'ready';

/** Why opening or setting up a folder failed */
export type SessionError = StorageErrorKind | 'otherCompany' | 'copiedCompany' | 'noFolder';

export interface CompanySummary {
  id: CompanyId;
  name: string;
}

interface SessionState {
  phase: Phase;
  /** Company folders known to this browser, for the switcher */
  companies: CompanySummary[];
  /** The company that is open, being opened, or waiting for permission */
  currentId: CompanyId | null;
  error: SessionError | null;
  /** The setup assistant was opened from an open company ("Add company") and can be cancelled */
  setupCancelable: boolean;
  /** In `busy`: true when this window had the company open and another window took it over */
  takenOver: boolean;
}

export const useSession = create<SessionState>()(() => ({
  phase: 'checking',
  companies: [],
  currentId: null,
  error: null,
  setupCancelable: false,
  takenOver: false,
}));
const set = useSession.setState;

/* ---------- Test mode: company folders in localStorage (Playwright) ---------- */

// Switched on only by a flag the Playwright setup sets before the app's script runs (addInitScript, tests/e2e/helpers.ts).
// It used to be the URL parameter ?e2e, so a link or a shortcut could keep a whole company in localStorage, which every
// file:// page can read, without a folder permission prompt (#83). Another page cannot set a global of this document.
const E2E = typeof window !== 'undefined' && window.__kontorE2E === true;
const E2E_COUNTER = 'kontor.e2e.counter';
/** Folder the next simulated folder picker returns (test hook), or a new one when unset */
let e2eNextFolder: string | null = null;

let repo: FsRepository | null = null;

/** The folder of the open company, for the actions that write to it (receipts, app/receipts.ts); null without one */
export function currentRepository(): FsRepository | null {
  return repo;
}
let persister: Persister | null = null;
/** The folder of the open company, to ask for its permission again when a write was refused */
let openHandle: FileSystemDirectoryHandle | null = null;
/** The lock of the open company: no other window of this browser opens it meanwhile (#97) */
let companyLock: CompanyLock | null = null;
/** Windows of kontor tell each other here that they closed a company they had open (companyLock.ts) */
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('kontor.session') : null;
/** How long a window that takes a company over waits for the other window to save and close it */
const TAKE_OVER_WAIT_MS = 3_000;
let entries: CompanyEntry[] = [];
let handleStore: HandleStore | null = null;
/** The folder chosen in the setup assistant; nothing is written there before "Finish" */
let setupFolder: { handle: FileSystemDirectoryHandle; notEmpty: boolean } | null = null;

const handles = (): HandleStore => (handleStore ??= E2E ? storageHandleStore(localStorage) : indexedDbHandleStore());

if (E2E) {
  window.__e2e = {
    flush: () => persister?.flush(),
    nextFolder: (name: string) => {
      e2eNextFolder = name;
    },
  };
}

async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  if (E2E) {
    let name = e2eNextFolder;
    e2eNextFolder = null;
    if (!name) {
      const n = Number(localStorage.getItem(E2E_COUNTER) ?? '0') + 1;
      localStorage.setItem(E2E_COUNTER, String(n));
      name = `Ordner-${n}`;
    }
    return new StorageDir(localStorage, `kontor.e2e.dir.${name}`, '', name).asHandle();
  }
  if (!window.showDirectoryPicker) throw new DOMException('The folder picker is not available', 'NotSupportedError');
  return window.showDirectoryPicker({ id: 'kontor', mode: 'readwrite' });
}

const summaries = (): CompanySummary[] => entries.map((e) => ({ id: e.id, name: e.name }));

async function refreshEntries() {
  entries = await handles()
    .list()
    .catch(() => []);
  set({ companies: summaries() });
}

/* ---------- Start ---------- */

export async function boot() {
  if (!E2E && !checkSupport().supported) return set({ phase: 'unsupported' });
  await refreshEntries();
  const last = usePrefs.getState().lastCompany;
  const entry = entries.find((e) => e.id === last) ?? entries[0];
  if (!entry) return startSetup();
  set({ currentId: entry.id, phase: 'loading' });
  let granted = false;
  try {
    granted = await ensureReadWrite(entry.handle, false);
  } catch {
    /* the folder is gone or not accessible: offer to reconnect */
  }
  if (granted) await load(entry);
  else set({ phase: 'reconnect' });
}

/** User gesture: open another known company. Permission is asked first, while the click still counts as a gesture. */
export async function openCompany(id: CompanyId) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  if (id === useSession.getState().currentId && useSession.getState().phase === 'ready') return;
  let granted = false;
  let error: SessionError | null = null;
  try {
    granted = await ensureReadWrite(entry.handle, true);
  } catch (e) {
    error = classifyError(e);
  }
  await closeCurrent();
  set({ currentId: id });
  if (error) set({ phase: 'failed', error });
  else if (granted) await load(entry);
  else set({ phase: 'reconnect' });
}

/** Writes what is pending and closes the open company */
async function closeCurrent() {
  await persister?.flush();
  persister?.stop();
  persister = null;
  repo = null;
  openHandle = null;
  resetApp();
  releaseLock();
}

function releaseLock() {
  companyLock?.release();
  companyLock = null;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The lock of a company for this window, or null when another window has it open. A lock of a window that was just
 * reloaded or closed can take a moment to go away, so a refused lock is asked for a few times. With `takeOver`, the
 * lock is taken from the other window, and the folder is read only after that window saved and closed the company.
 */
async function lockCompany(id: CompanyId, takeOver: boolean): Promise<CompanyLock | null> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const onLost = () => void lostToAnotherWindow(id);
  // taking over needs no patience: the lock is taken anyway
  for (let attempt = 0; attempt < (takeOver ? 1 : 4); attempt++) {
    if (attempt > 0) await pause(250);
    const free = await acquireCompanyLock(locks, id, { steal: false, onLost });
    if (free) return free;
  }
  if (!takeOver) return null;
  const taken = await acquireCompanyLock(locks, id, { steal: true, onLost });
  if (!(await waitForClosed(channel, id, TAKE_OVER_WAIT_MS))) console.warn('The other window did not say that it closed the company');
  return taken;
}

/** Another window took the open company over: what is pending is written, the company is closed, and that window is told */
async function lostToAnotherWindow(id: CompanyId) {
  companyLock = null;
  if (useSession.getState().currentId !== id) return;
  await closeCurrent();
  set({ phase: 'busy', takenOver: true, error: null });
  channel?.postMessage({ closed: id } satisfies ClosedMessage);
}

async function load(entry: CompanyEntry, takeOver = false) {
  set({ phase: 'loading', error: null, currentId: entry.id });
  const r = new FsRepository(entry.handle);
  const res = await r.readCompany();
  if (!res.ok) return set({ phase: 'failed', error: res.error.kind });
  if (res.value.id !== entry.id) return set({ phase: 'failed', error: 'otherCompany' });
  await openLoaded(r, entry, res.value, takeOver);
}

/** Opens a company whose company.json was read, once this window holds its lock; else it shows where it is open (#97) */
async function openLoaded(r: FsRepository, entry: CompanyEntry, company: CompanyFile, takeOver = false) {
  releaseLock();
  const lock = await lockCompany(company.id, takeOver);
  if (!lock) return set({ phase: 'busy', takenOver: false, currentId: company.id, error: null });
  companyLock = lock;
  // the other window wrote what was pending before it gave the company up: company.json is read again after that
  const current = takeOver ? await r.readCompany() : null;
  if (current && !current.ok) {
    releaseLock();
    return set({ phase: 'failed', error: current.error.kind, currentId: company.id });
  }
  await openRecords(r, entry, current?.value ?? company);
  if (useSession.getState().phase !== 'ready') releaseLock();
}

/** Opens the company: its records, the persister, a recovered emergency copy, the logo, the backup */
async function openRecords(r: FsRepository, entry: CompanyEntry, company: CompanyFile) {
  // the collections are independent, so they are read at the same time (#87); the first failure in this order is reported
  const [loadedContacts, loadedItems, loadedDocuments, loadedPayments, loadedDunnings, loadedQuoteStatuses, loadedExpenses, loadedPayouts] = await Promise.all([
    r.loadContacts(),
    r.loadItems(),
    r.loadDocuments(),
    r.loadPayments(),
    r.loadDunnings(),
    r.loadQuoteStatuses(),
    r.loadExpenses(),
    r.loadPayouts(),
  ]);
  if (!loadedContacts.ok) return set({ phase: 'failed', error: loadedContacts.error.kind, currentId: company.id });
  if (!loadedItems.ok) return set({ phase: 'failed', error: loadedItems.error.kind, currentId: company.id });
  if (!loadedDocuments.ok) return set({ phase: 'failed', error: loadedDocuments.error.kind, currentId: company.id });
  if (!loadedPayments.ok) return set({ phase: 'failed', error: loadedPayments.error.kind, currentId: company.id });
  if (!loadedDunnings.ok) return set({ phase: 'failed', error: loadedDunnings.error.kind, currentId: company.id });
  if (!loadedQuoteStatuses.ok) return set({ phase: 'failed', error: loadedQuoteStatuses.error.kind, currentId: company.id });
  if (!loadedExpenses.ok) return set({ phase: 'failed', error: loadedExpenses.error.kind, currentId: company.id });
  if (!loadedPayouts.ok) return set({ phase: 'failed', error: loadedPayouts.error.kind, currentId: company.id });
  const records: CompanyRecords = {
    contacts: loadedContacts.value.contacts,
    items: loadedItems.value.items,
    documents: loadedDocuments.value.documents,
    payments: loadedPayments.value.payments,
    dunnings: loadedDunnings.value.dunnings,
    quoteStatuses: loadedQuoteStatuses.value.quoteStatuses,
    expenses: loadedExpenses.value.expenses,
    payouts: loadedPayouts.value.payouts,
  };
  repo = r;
  openHandle = entry.handle;
  loadCompany(company, records);
  // the secret of the folder that signs the emergency copy; without it no copy is kept, and the sidebar says so
  const copyKey = await r.copyKey();
  if (!copyKey.ok) console.warn('No key for the emergency copy', copyKey.error.cause);
  persister = new Persister(r, copyKey.ok ? copyKey.value : null);
  persister.start();
  // after the persister started with the file state as saved, so that it writes the recovered changes
  const { recovered, rejected } = recoverEmergencyCopy(company, records, copyKey.ok ? copyKey.value : null);
  if (recovered) applyRecovered(recovered.company, recovered);
  // the files that could not be read stay listed on the overview, the reports and the taxes (LoadIssuesNotice), since
  // their records are missing from every figure; the toast only points there, in one message with the recovery (#96)
  const unreadable = [loadedContacts, loadedItems, loadedDocuments, loadedPayments, loadedDunnings, loadedQuoteStatuses, loadedExpenses, loadedPayouts].flatMap((l) => l.value.issues);
  setLoadIssues(unreadable);
  if (unreadable.length) console.warn('Some files could not be read', unreadable);
  const told = [recovered ? t('toast.recovered') : '', rejected ? t('toast.copyRejected') : '', unreadable.length ? t('toast.unreadable', { n: unreadable.length }) : ''].filter(Boolean);
  if (told.length) showToast(told.join(' '));
  setLastCompany(company.id);
  if (entry.name !== company.name) await rememberCompany(entry.handle, company);
  set({ phase: 'ready', currentId: company.id, error: null, setupCancelable: false, takenOver: false });
  void loadLogo();
  void maintenance(r);
}

async function rememberCompany(handle: FileSystemDirectoryHandle, company: CompanyFile) {
  await handles()
    .put({ id: company.id, name: company.name, handle })
    .catch((e: unknown) => console.warn('Could not remember the company folder', e));
  await refreshEntries();
}

const orNull = <T>(run: () => T): T | null => {
  try {
    return run();
  } catch {
    return null;
  }
};

/** The records of an emergency copy that pass the checks and differ from the loaded ones, merged with them */
function recoverRecords<T extends { id: string }>(saved: unknown, loaded: readonly T[], read: (raw: unknown) => T, merge: (local: T, remote: T) => T): T[] {
  if (!Array.isArray(saved)) return [];
  const known = new Map(loaded.map((r) => [r.id, r]));
  return saved.flatMap((raw: unknown) => {
    const record = orNull(() => read(raw));
    if (!record) return [];
    const current = known.get(record.id);
    const merged = current ? merge(current, record) : record;
    return current && sameJson(merged, current) ? [] : [merged];
  });
}

/** Removes a stored item; true when there was one */
function removeStored(key: string): boolean {
  try {
    const had = localStorage.getItem(key) !== null;
    localStorage.removeItem(key);
    return had;
  } catch {
    return false;
  }
}

/**
 * Unsaved changes from an earlier session (the folder was not reachable then). Every page under file:// can read and
 * write the browser's storage (#69), so the copy is used only when it carries the signature of the folder's key, and
 * then like any other file: only what passes the same checks, belongs to this company and is newer. An unsigned or
 * forged copy, and the unsigned copies of earlier versions, are removed and reported (`rejected`). Issued documents
 * are never taken from a copy, nor payments, dunnings and decisions on quotes: they are written to the folder before
 * they reach the store, so a copy has nothing of them that the folder lacks.
 */
export function recoverEmergencyCopy(company: CompanyFile, loaded: CompanyRecords, key: Uint8Array | null): { recovered: ({ company: CompanyFile } & CompanyRecords) | null; rejected: boolean } {
  const legacy = removeStored(legacyEmergencyKey(company.id));
  const none = { recovered: null, rejected: legacy };
  const raw = orNull(() => localStorage.getItem(emergencyKey(company.id)));
  // without the key the copy cannot be checked now: it stays for a later start
  if (!raw || !key) return none;
  const read = readEmergencyCopy(raw, key);
  if (!read.ok) {
    console.warn('An emergency copy without the signature of this folder was removed');
    removeStored(emergencyKey(company.id));
    return { recovered: null, rejected: true };
  }
  const copy = read.copy;
  if (!isRecord(copy)) return none;
  const savedCompany = copy['company'] ? orNull(() => migrate('company', copy['company'])) : null;
  const nextCompany = savedCompany?.id === company.id ? mergeCompany(company, savedCompany) : company;
  const contacts = recoverRecords(copy['contacts'], loaded.contacts, (raw) => migrate('contact', raw), mergeContact);
  const items = recoverRecords(copy['items'], loaded.items, (raw) => migrate('item', raw), mergeItem);
  const draft = (raw: unknown) => {
    const document = migrate('document', raw);
    if (document.issued) throw new Error('An issued document is never taken from the emergency copy');
    return document;
  };
  const documents = recoverRecords(copy['documents'], loaded.documents, draft, mergeDocument);
  const expenses = recoverRecords(copy['expenses'], loaded.expenses, (raw) => migrate('expense', raw), mergeExpense);
  const payouts = recoverRecords(copy['payouts'], loaded.payouts, (raw) => migrate('payout', raw), mergePayout);
  if (sameJson(nextCompany, company) && !contacts.length && !items.length && !documents.length && !expenses.length && !payouts.length) return none;
  return { recovered: { company: nextCompany, contacts, items, documents, payments: [], dunnings: [], quoteStatuses: [], expenses, payouts }, rejected: legacy };
}

/**
 * Daily backup of the state in the store. Errors here must not disturb the work. While files of the folder cannot be
 * read, the state is known to be incomplete: no backup is written, so that the older, complete ones are not pushed out
 * of the 14 that are kept (#96). The notice of the unreadable files says so.
 */
async function maintenance(r: FsRepository) {
  const { company, contacts, items, documents, payments, dunnings, quoteStatuses, expenses, payouts, loadIssues } = useApp.getState();
  if (!company) return;
  if (loadIssues.length) return console.warn('No daily backup: some files of the folder could not be read');
  const res = await dailyBackup(r, {
    company,
    contacts: [...contacts.values()],
    items: [...items.values()],
    documents: [...documents.values()],
    payments: [...payments.values()],
    dunnings: [...dunnings.values()],
    quoteStatuses: [...quoteStatuses.values()],
    expenses: [...expenses.values()],
    payouts: [...payouts.values()],
  });
  if (!res.ok) console.warn('Backup of the company folder failed', res.error.cause);
}

/**
 * User gesture: renew the permission for the company waiting in 'reconnect' or 'failed'. In 'busy', `takeOver` opens
 * it here and closes it in the other window (#97).
 */
export async function reconnect(takeOver = false) {
  const id = useSession.getState().currentId;
  const entry = entries.find((e) => e.id === id);
  if (!entry) return startSetup();
  try {
    if (await ensureReadWrite(entry.handle, true)) await load(entry, takeOver);
  } catch (e) {
    set({ phase: 'failed', error: classifyError(e) });
  }
}

/* ---------- Setup assistant ---------- */

export function startSetup() {
  setupFolder = null;
  set({ phase: 'setup', error: null, setupCancelable: useApp.getState().company !== null });
}

export function cancelSetup() {
  setupFolder = null;
  if (useApp.getState().company) set({ phase: 'ready', setupCancelable: false });
}

export type FolderChoice = { kind: 'empty' | 'notEmpty'; name: string } | { kind: 'opened' } | { kind: 'error'; error: SessionError };

/**
 * User gesture: choose the folder for a company. A folder that already holds a company is opened right away
 * (and remembered); for an empty or other folder the assistant goes on.
 */
export async function chooseSetupFolder(): Promise<FolderChoice | null> {
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await pickDirectory();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    return { kind: 'error', error: classifyError(e) };
  }
  const r = new FsRepository(handle);
  const has = await r.hasCompany();
  if (!has.ok) return { kind: 'error', error: has.error.kind };
  if (has.value) {
    const res = await r.readCompany();
    if (!res.ok) return { kind: 'error', error: res.error.kind };
    const known = entries.find((e) => e.id === res.value.id);
    // the same company ID in a second folder is a copy of the folder; opening both would mix them up
    if (known && !(await known.handle.isSameEntry(handle).catch(() => false))) return { kind: 'error', error: 'copiedCompany' };
    await closeCurrent();
    await rememberCompany(handle, res.value);
    await openLoaded(r, { id: res.value.id, name: res.value.name, handle }, res.value);
    return { kind: 'opened' };
  }
  const empty = await r.isEmpty();
  if (!empty.ok) return { kind: 'error', error: empty.error.kind };
  setupFolder = { handle, notEmpty: !empty.value };
  return { kind: empty.value ? 'empty' : 'notEmpty', name: handle.name };
}

/** A new subfolder named after the company inside a folder that is not empty ("Name", "Name (2)", …) */
async function createSubfolder(parent: FileSystemDirectoryHandle, companyName: string): Promise<FileSystemDirectoryHandle> {
  const base = toSafeFileName(companyName);
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base} (${i})`;
    const existing = await parent.getDirectoryHandle(name).catch(() => null);
    if (!existing) return parent.getDirectoryHandle(name, { create: true });
    const empty = await new FsRepository(existing).isEmpty();
    if (empty.ok && empty.value) return existing;
  }
}

export interface LogoUpload {
  bytes: Uint8Array<ArrayBuffer>;
  type: LogoType;
}

async function logoAsset(logo: LogoUpload): Promise<{ asset: Asset; ref: LogoRef }> {
  const sha256 = await sha256Hex(logo.bytes);
  const file = logoFileName(sha256, logo.type);
  return { asset: { name: file, data: new Blob([logo.bytes], { type: logo.type }) }, ref: { file, type: logo.type, sha256 } };
}

/** "Finish" in the setup assistant: writes the company (logo first, company.json last), remembers and opens it. */
export async function finishSetup({ account, ...profile }: NewCompany, logo: LogoUpload | null): Promise<SessionError | null> {
  if (!setupFolder) return 'noFolder';
  try {
    const dir = setupFolder.notEmpty ? await createSubfolder(setupFolder.handle, profile.name) : setupFolder.handle;
    const uploaded = logo ? await logoAsset(logo) : null;
    const company = makeCompany({ ...profile, logo: uploaded?.ref ?? null }, account);
    const r = new FsRepository(dir);
    const res = await r.createCompany(company, uploaded ? [uploaded.asset] : []);
    if (!res.ok) return res.error.kind;
    setupFolder = null;
    await closeCurrent();
    await rememberCompany(dir, company);
    await openLoaded(r, { id: company.id, name: company.name, handle: dir }, company);
    return null;
  } catch (e) {
    return classifyError(e);
  }
}

/* ---------- Logo ---------- */

/**
 * The logo file of the open company, checked before it is used (#78): its size before it is read, then its SHA-256,
 * type and size in pixels against company.json and the limits of an upload (`checkStoredLogo`). Another or a broken
 * file is neither shown nor printed, and the store says why (`logoProblem`). Null without a logo or a valid file.
 */
async function readCheckedLogo(): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: LogoType } | null> {
  const company = useApp.getState().company;
  if (!repo || !company?.logo) {
    setLogoProblem(null);
    return null;
  }
  const res = await repo.readAsset(company.logo.file);
  if (!res.ok) {
    console.warn('Could not read the logo', res.error.cause);
    setLogoProblem('unreadable');
    return null;
  }
  if (res.value.size > MAX_LOGO_BYTES) {
    setLogoProblem('tooLarge');
    return null;
  }
  const bytes = new Uint8Array(await res.value.arrayBuffer());
  const checked = checkStoredLogo(bytes, await sha256Hex(bytes), company.logo);
  if (!checked.ok) {
    console.warn('The logo file of the folder is not used', checked.error);
    setLogoProblem(checked.error);
    return null;
  }
  setLogoProblem(null);
  return { bytes, type: checked.value };
}

async function loadLogo() {
  const logo = await readCheckedLogo();
  // the type comes from company.json, not from the file name, so that an SVG is shown as an image
  setLogoUrl(logo ? URL.createObjectURL(new Blob([logo.bytes], { type: logo.type })) : null);
}

/** The logo file of the open company, for a PDF; null when there is none, or it cannot be read or is not the one saved */
export async function readLogo(): Promise<{ bytes: Uint8Array; type: LogoType } | null> {
  return readCheckedLogo();
}

/** Settings: a new logo is written as a new file (named after its hash); the old file stays in the folder. */
export async function replaceLogo(logo: LogoUpload): Promise<StorageErrorKind | null> {
  if (!repo) return 'notFound';
  const { asset, ref } = await logoAsset(logo);
  const res = await repo.writeAsset(asset);
  if (!res.ok) return res.error.kind;
  updateCompany({ logo: ref });
  await loadLogo();
  return null;
}

export function removeLogo() {
  updateCompany({ logo: null });
  setLogoUrl(null);
  setLogoProblem(null);
}

/* ---------- Runtime ---------- */

/** Keep the company name in the switcher up to date */
useApp.subscribe((s, prev) => {
  const c = s.company;
  if (!c || c.name === prev.company?.name || prev.company?.id !== c.id) return;
  const entry = entries.find((e) => e.id === c.id);
  if (entry && entry.name !== c.name) void rememberCompany(entry.handle, c);
});

/** User gesture: "Try again" in the sidebar. A folder that refused access is asked for the permission again first. */
export function retrySave() {
  const handle = openHandle;
  return persister?.retry(handle ? () => ensureReadWrite(handle, true) : undefined);
}

/**
 * User gesture: drops a change the folder refused for good (#95) and reads the company from the folder again, so that
 * the views show what the folder holds. Other refused changes stay in the emergency copy and come back after loading.
 */
export async function discardUnsaved(key: string) {
  const entry = entries.find((e) => e.id === useSession.getState().currentId);
  if (!persister || !entry) return;
  persister.discard(key);
  await closeCurrent();
  await load(entry);
}

/** The folder of the open company, for the actions that need it beyond loading and saving (issuing, issued PDFs) */
export const openRepository = (): Repository | null => repo;

/**
 * Writes what is pending now; true when everything that can be written was. A change the folder refused for good
 * (`unsaved` in the store) does not count: it must not stop issuing, payments or the export of other records (#95).
 */
export async function flushWrites(): Promise<boolean> {
  await persister?.flush();
  return useApp.getState().save.state === 'saved';
}

/** Keeps unsaved edits in the browser before anything else happens (used when the UI crashed). */
export function saveEmergencyCopy() {
  persister?.writeEmergencyCopy();
}

export const isE2E = () => E2E;
