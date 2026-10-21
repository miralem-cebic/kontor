import { create } from 'zustand';
import { logoFileName, type CompanyProfile, type LogoRef, type LogoType } from '../domain/company';
import { indexedDbHandleStore, type CompanyEntry, type HandleStore } from '../data/fs/handleStore';
import { FsRepository } from '../data/fs/FsRepository';
import { toSafeFileName } from '../data/fs/fileNames';
import { ensureReadWrite } from '../data/fs/permission';
import { StorageDir, storageHandleStore } from '../data/fs/storageFs';
import { checkSupport } from '../data/fs/support';
import type { CompanyId } from '../data/ids';
import { dailyBackup } from '../data/maintenance';
import { mergeCompany, mergeContact, sameJson } from '../data/merge';
import { migrate } from '../data/migrations';
import { emergencyKey, Persister } from '../data/persister';
import { classifyError, type Asset, type StorageErrorKind } from '../data/repository';
import { makeCompany } from '../data/schema';
import type { CompanyFile, ContactFile } from '../data/types';
import { isRecord } from '../data/validate';
import { t } from '../i18n';
import { sha256Hex } from '../lib/sha256';
import { applyRecovered, loadCompany, resetApp, setLogoUrl, showToast, updateCompany, useApp } from '../store/appStore';
import { setLastCompany, usePrefs } from '../store/prefs';

// Startup flow: check the browser → known company folders → permission → load → app.
// "Add company" runs the setup assistant while the current company stays open until the new one is ready.

export type Phase = 'checking' | 'unsupported' | 'setup' | 'reconnect' | 'loading' | 'failed' | 'ready';

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
}

export const useSession = create<SessionState>()(() => ({
  phase: 'checking',
  companies: [],
  currentId: null,
  error: null,
  setupCancelable: false,
}));
const set = useSession.setState;

/* ---------- Test mode: company folders in localStorage (Playwright, ?e2e) ---------- */

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const E2E = params.has('e2e');
const E2E_COUNTER = 'kontor.e2e.counter';
/** Folder the next simulated folder picker returns (test hook), or a new one when unset */
let e2eNextFolder: string | null = null;

let repo: FsRepository | null = null;
let persister: Persister | null = null;
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
  resetApp();
}

async function load(entry: CompanyEntry) {
  set({ phase: 'loading', error: null, currentId: entry.id });
  const r = new FsRepository(entry.handle);
  const res = await r.readCompany();
  if (!res.ok) return set({ phase: 'failed', error: res.error.kind });
  if (res.value.id !== entry.id) return set({ phase: 'failed', error: 'otherCompany' });
  await openLoaded(r, entry, res.value);
}

/** Opens a company whose company.json was read: its contacts, the persister, a recovered emergency copy, the logo, the backup */
async function openLoaded(r: FsRepository, entry: CompanyEntry, company: CompanyFile) {
  const loaded = await r.loadContacts();
  if (!loaded.ok) return set({ phase: 'failed', error: loaded.error.kind, currentId: company.id });
  const { contacts, issues } = loaded.value;
  repo = r;
  loadCompany(company, contacts);
  persister = new Persister(r);
  persister.start();
  // after the persister started with the file state as saved, so that it writes the recovered changes
  const recovered = recoverEmergencyCopy(company, contacts);
  if (recovered) applyRecovered(recovered.company, recovered.contacts);
  if (issues.length) {
    console.warn('Some contacts could not be read', issues);
    showToast(t('toast.unreadableContacts', { n: issues.length }));
  }
  setLastCompany(company.id);
  if (entry.name !== company.name) await rememberCompany(entry.handle, company);
  set({ phase: 'ready', currentId: company.id, error: null, setupCancelable: false });
  void loadLogo();
  void maintenance(r);
}

async function rememberCompany(handle: FileSystemDirectoryHandle, company: CompanyFile) {
  await handles()
    .put({ id: company.id, name: company.name, handle })
    .catch((e: unknown) => console.warn('Could not remember the company folder', e));
  await refreshEntries();
}

/**
 * Unsaved changes from an earlier session (the folder was not reachable then). The copy is data like any other
 * file: it is used only if it passes the same checks, belongs to this company and is newer.
 */
function recoverEmergencyCopy(company: CompanyFile, contacts: readonly ContactFile[]): { company: CompanyFile; contacts: ContactFile[] } | null {
  let copy: unknown;
  try {
    const raw = localStorage.getItem(emergencyKey(company.id));
    if (!raw) return null;
    copy = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(copy)) return null;
  const read = <T>(run: () => T): T | null => {
    try {
      return run();
    } catch {
      return null;
    }
  };
  const savedCompany = copy['company'] ? read(() => migrate('company', copy['company'])) : null;
  const nextCompany = savedCompany?.id === company.id ? mergeCompany(company, savedCompany) : company;
  const known = new Map(contacts.map((c) => [c.id, c]));
  const savedContacts = Array.isArray(copy['contacts']) ? copy['contacts'].flatMap((x) => read(() => migrate('contact', x)) ?? []) : [];
  const changedContacts = savedContacts.flatMap((saved) => {
    const current = known.get(saved.id);
    const merged = current ? mergeContact(current, saved) : saved;
    return current && sameJson(merged, current) ? [] : [merged];
  });
  if (sameJson(nextCompany, company) && !changedContacts.length) return null;
  showToast(t('toast.recovered'));
  return { company: nextCompany, contacts: changedContacts };
}

/** Daily backup of the state in the store. Errors here must not disturb the work. */
async function maintenance(r: FsRepository) {
  const { company, contacts } = useApp.getState();
  if (!company) return;
  const res = await dailyBackup(r, { company, contacts: [...contacts.values()] });
  if (!res.ok) console.warn('Backup of the company folder failed', res.error.cause);
}

/** User gesture: renew the permission for the company waiting in 'reconnect' or 'failed' */
export async function reconnect() {
  const id = useSession.getState().currentId;
  const entry = entries.find((e) => e.id === id);
  if (!entry) return startSetup();
  try {
    if (await ensureReadWrite(entry.handle, true)) await load(entry);
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
export async function finishSetup(profile: Omit<CompanyProfile, 'logo'>, logo: LogoUpload | null): Promise<SessionError | null> {
  if (!setupFolder) return 'noFolder';
  try {
    const dir = setupFolder.notEmpty ? await createSubfolder(setupFolder.handle, profile.name) : setupFolder.handle;
    const uploaded = logo ? await logoAsset(logo) : null;
    const company = makeCompany({ ...profile, logo: uploaded?.ref ?? null });
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

async function loadLogo() {
  const company = useApp.getState().company;
  if (!repo || !company?.logo) return setLogoUrl(null);
  const res = await repo.readAsset(company.logo.file);
  // the type comes from company.json, not from the file name, so that an SVG is shown as an image
  if (res.ok) setLogoUrl(URL.createObjectURL(new Blob([res.value], { type: company.logo.type })));
  else console.warn('Could not read the logo', res.error.cause);
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
}

/* ---------- Runtime ---------- */

/** Keep the company name in the switcher up to date */
useApp.subscribe((s, prev) => {
  const c = s.company;
  if (!c || c.name === prev.company?.name || prev.company?.id !== c.id) return;
  const entry = entries.find((e) => e.id === c.id);
  if (entry && entry.name !== c.name) void rememberCompany(entry.handle, c);
});

export function retrySave() {
  return persister?.retry();
}

/** Keeps unsaved edits in the browser before anything else happens (used when the UI crashed). */
export function saveEmergencyCopy() {
  persister?.writeEmergencyCopy();
}

export const isE2E = () => E2E;
