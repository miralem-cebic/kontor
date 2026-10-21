import type { Result } from './result';
import type { CompanyFile } from './types';

export interface BackupInfo {
  name: string;
  lastModified: number;
  size: number;
}

/** A failed storage operation: what went wrong, and the exception it came from (if any) */
export interface StorageError {
  kind: StorageErrorKind;
  cause: unknown;
}

export type StorageErrorKind = 'permission' | 'notFound' | 'quota' | 'newerSchema' | 'invalid' | 'other';

/**
 * Storage of one company folder. The UI and the store only know this interface, not the folder of files;
 * only `data/fs/` talks to the File System Access API.
 *
 * Every operation returns a result: a failure is a value the caller has to handle.
 * `saveCompany` checks before writing whether the file was changed by someone else in the meantime;
 * it merges in that case and returns the state that was actually written.
 */
export interface Repository {
  /** Name of the folder, for display */
  readonly label: string;
  /** Does the folder contain a company.json? */
  hasCompany(): Promise<Result<boolean, StorageError>>;
  /** Is the folder empty (ignoring hidden files)? */
  isEmpty(): Promise<Result<boolean, StorageError>>;
  readCompany(): Promise<Result<CompanyFile, StorageError>>;
  /** Writes a new company: the given assets first, company.json last, so that a folder counts as set up only when complete */
  createCompany(company: CompanyFile, assets: readonly Asset[]): Promise<Result<CompanyFile, StorageError>>;
  saveCompany(company: CompanyFile): Promise<Result<CompanyFile, StorageError>>;
  /** Writes assets/<name>. An existing file of that name is kept: asset names contain their hash. */
  writeAsset(asset: Asset): Promise<Result<void, StorageError>>;
  readAsset(name: string): Promise<Result<File, StorageError>>;
  writeBackup(name: string, company: CompanyFile): Promise<Result<void, StorageError>>;
  listBackups(): Promise<Result<BackupInfo[], StorageError>>;
  /** Physical removal: only maintenance.ts calls it, for backups beyond the retention */
  removeBackup(name: string): Promise<Result<void, StorageError>>;
}

export interface Asset {
  name: string;
  data: Blob;
}

export function classifyError(e: unknown): StorageErrorKind {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') return 'permission';
    if (e.name === 'NotFoundError') return 'notFound';
    if (e.name === 'QuotaExceededError') return 'quota';
  }
  if (e instanceof Error && e.name === 'NewerSchemaError') return 'newerSchema';
  if (e instanceof Error && (e.name === 'InvalidFileError' || e.name === 'UnsafeFileNameError' || e instanceof SyntaxError)) return 'invalid';
  return 'other';
}
