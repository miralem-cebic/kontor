import { create } from 'zustand';
import { keysOf } from '../data/ids';
import { mergeCompany, sameJson } from '../data/merge';
import type { StorageErrorKind } from '../data/repository';
import { nowIso } from '../data/schema';
import type { CompanyFile, MergeableField } from '../data/types';

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
  /** Object URL of the logo for display; not stored */
  logoUrl: string | null;
  save: SaveStatus;
  toast: Toast | null;
}

const initial: AppState = { company: null, logoUrl: null, save: { state: 'saved' }, toast: null };

export const useApp = create<AppState>()(() => ({ ...initial }));
const get = useApp.getState;
const set = useApp.setState;

export function resetApp() {
  const url = get().logoUrl;
  if (url) URL.revokeObjectURL(url);
  set({ ...initial });
}

/** A company as read from its folder */
export function loadCompany(company: CompanyFile) {
  set({ company, save: { state: 'saved' } });
}

/** Unsaved changes from an earlier session, merged into the loaded company; the persister writes them */
export function applyRecoveredCompany(company: CompanyFile) {
  if (get().company?.id === company.id) set({ company });
}

export type CompanyPatch = Partial<Pick<CompanyFile, MergeableField>>;

function assign<F extends MergeableField>(target: CompanyFile, patch: CompanyPatch, field: F): boolean {
  const value = patch[field];
  if (value === undefined || sameJson(value, target[field])) return false;
  target[field] = value as CompanyFile[F];
  return true;
}

/** Changes fields of the company. Every changed field gets a new `fieldUpdatedAt`, which the merge relies on. */
export function updateCompany(patch: CompanyPatch) {
  const current = get().company;
  if (!current) return;
  const next: CompanyFile = { ...current, fieldUpdatedAt: { ...current.fieldUpdatedAt } };
  const at = nowIso();
  let changed = false;
  for (const field of keysOf(patch)) {
    if (assign(next, patch, field)) {
      next.fieldUpdatedAt[field] = at;
      changed = true;
    }
  }
  if (changed) set({ company: next });
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
