import type { Result } from './result';
import type { AuditEntry, BackupSnapshot, CompanyFile, ContactFile, DocumentFile, ItemFile, NumberingFile, NumberRange } from './types';

export interface BackupInfo {
  name: string;
  lastModified: number;
  size: number;
}

/** A file that could not be read; the rest was loaded */
export interface LoadIssue {
  file: string;
  message: string;
}

/** A failed storage operation: what went wrong, and the exception it came from (if any) */
export interface StorageError {
  kind: StorageErrorKind;
  cause: unknown;
}

/** `conflict`: another writer got there first (a number or an issued file that exists already); nothing was overwritten */
export type StorageErrorKind = 'permission' | 'notFound' | 'quota' | 'newerSchema' | 'invalid' | 'conflict' | 'other';

/**
 * Storage of one company folder. The UI and the store only know this interface, not the folder of files;
 * only `data/fs/` talks to the File System Access API.
 *
 * Every operation returns a result: a failure is a value the caller has to handle.
 * `saveCompany` and `saveContact` check before writing whether the file was changed by someone else in the
 * meantime; they merge in that case and return the state that was actually written.
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
  /** All contacts, deleted ones included. A broken file is left out and reported; it does not stop the others. */
  loadContacts(): Promise<Result<{ contacts: ContactFile[]; issues: LoadIssue[] }, StorageError>>;
  /** Writes contacts/<id>.json, with the same conflict check and merge as `saveCompany` */
  saveContact(contact: ContactFile): Promise<Result<ContactFile, StorageError>>;
  /** All items of the catalogue, deleted ones included; a broken file is reported like a contact */
  loadItems(): Promise<Result<{ items: ItemFile[]; issues: LoadIssue[] }, StorageError>>;
  /** Writes items/<id>.json, with the same conflict check and merge as `saveCompany` */
  saveItem(item: ItemFile): Promise<Result<ItemFile, StorageError>>;
  /** All quotes and invoices, deleted ones included; a broken file is reported like a contact */
  loadDocuments(): Promise<Result<{ documents: DocumentFile[]; issues: LoadIssue[] }, StorageError>>;
  /**
   * Writes documents/<id>.json, with the same conflict check and merge as `saveCompany`; a quote never merges with an
   * invoice. An issued invoice in the folder is never overwritten: a draft saved over it gets the issued one back, and
   * an invoice issued with another number stops the save (`conflict`).
   */
  saveDocument(document: DocumentFile): Promise<Result<DocumentFile, StorageError>>;
  /** numbering/<range>.json, or null when no number of that range was given yet */
  readNumbering(range: NumberRange): Promise<Result<NumberingFile | null, StorageError>>;
  /** Writes the range file and reads it back: what holds after the write, in case another device wrote at the same time */
  writeNumbering(file: NumberingFile): Promise<Result<NumberingFile, StorageError>>;
  /** The names of the files in documents/issued/ */
  listIssuedFiles(): Promise<Result<string[], StorageError>>;
  /** Writes documents/issued/<name> once: an existing file of that name is never replaced (`conflict`) */
  writeIssuedFile(name: string, data: Uint8Array): Promise<Result<void, StorageError>>;
  readIssuedFile(name: string): Promise<Result<Uint8Array, StorageError>>;
  /** Adds a line to audit/<YYYY-MM>.jsonl */
  appendAudit(month: string, entry: AuditEntry): Promise<Result<void, StorageError>>;
  writeBackup(name: string, snapshot: BackupSnapshot): Promise<Result<void, StorageError>>;
  listBackups(): Promise<Result<BackupInfo[], StorageError>>;
  /** Physical removal: only maintenance.ts calls it, for backups beyond the retention */
  removeBackup(name: string): Promise<Result<void, StorageError>>;
}

/** Another writer got there first; thrown inside the repository and returned as `conflict` */
export class ConflictError extends Error {
  override name = 'ConflictError';
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
  if (e instanceof Error && e.name === 'ConflictError') return 'conflict';
  if (e instanceof Error && (e.name === 'InvalidFileError' || e.name === 'UnsafeFileNameError' || e instanceof SyntaxError)) return 'invalid';
  return 'other';
}
