import { mergeCompany, mergeContact, mergeDocument, mergeItem, sameJson } from '../merge';
import { InvalidFileError, migrate } from '../migrations';
import { classifyError, type Asset, type BackupInfo, type LoadIssue, type Repository, type StorageError } from '../repository';
import { err, ok, type Result } from '../result';
import { SCHEMA_VERSION } from '../schema';
import type { BackupFile, BackupSnapshot, CompanyFile, ContactFile, DocumentFile, ItemFile } from '../types';
import { isSafeFileName, UnsafeFileNameError } from './fileNames';
import { writeFile, writeJson } from './jsonFile';

// Folder structure (see DEVELOPMENT.md for the planned rest):
//   company.json
//   contacts/<id>.json         one file per customer or supplier
//   items/<id>.json            one file per item or service of the catalogue
//   documents/<id>.json        one file per quote
//   assets/<file>              logo files, named after their hash, never overwritten
//   backups/<YYYY-MM-DD>.json  daily copy of company.json and the contacts

export const FILES = { company: 'company.json' } as const;
export const DIRS = { contacts: 'contacts', items: 'items', documents: 'documents', assets: 'assets', backups: 'backups' } as const;

const BACKUP_NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** A record file (contact, item) is named after its ID; other names (conflict copies of sync clients) are not read */
const RECORD_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;
const isNotFound = (e: unknown) => e instanceof DOMException && e.name === 'NotFoundError';

/** Runs a storage operation: an exception from the browser API becomes a failed result, once, here. */
async function attempt<T>(run: () => Promise<T>): Promise<Result<T, StorageError>> {
  try {
    return ok(await run());
  } catch (cause) {
    return err({ kind: classifyError(cause), cause });
  }
}

/** Files of a directory (without helper files such as .crswap, .DS_Store, ~$…), with lastModified and size */
async function listFiles(dir: FileSystemDirectoryHandle): Promise<Map<string, { lastModified: number; size: number }>> {
  const out = new Map<string, { lastModified: number; size: number }>();
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== 'file' || name.startsWith('.') || name.startsWith('~') || name.endsWith('.crswap') || name.endsWith('.tmp')) continue;
    try {
      const f = await (h as FileSystemFileHandle).getFile();
      out.set(name, { lastModified: f.lastModified, size: f.size });
    } catch {
      /* the file vanished while being listed (sync client): skip it */
    }
  }
  return out;
}

/** Does the directory contain a file of that name? Other errors (permission) are thrown. */
const fileExists = (dir: FileSystemDirectoryHandle, name: string): Promise<boolean> =>
  dir.getFileHandle(name).then(
    () => true,
    (e: unknown) => {
      if (isNotFound(e)) return false;
      throw e;
    },
  );

const checkName = (name: string) => {
  if (!isSafeFileName(name)) throw new UnsafeFileNameError(name);
};

export class FsRepository implements Repository {
  /** Path → lastModified at the last read or write, to notice changes made by someone else */
  readonly known = new Map<string, number>();

  constructor(private readonly root: FileSystemDirectoryHandle) {}

  get label() {
    return this.root.name;
  }

  hasCompany() {
    return attempt(() => fileExists(this.root, FILES.company));
  }

  isEmpty() {
    return attempt(async () => {
      for await (const [name] of this.root.entries()) if (!name.startsWith('.')) return false;
      return true;
    });
  }

  readCompany() {
    return attempt(async () => {
      const file = await (await this.root.getFileHandle(FILES.company)).getFile();
      this.known.set(FILES.company, file.lastModified);
      return migrate('company', JSON.parse(await file.text()));
    });
  }

  createCompany(company: CompanyFile, assets: readonly Asset[]) {
    return attempt(async () => {
      if (await fileExists(this.root, FILES.company)) throw new InvalidFileError('The folder already contains a company');
      for (const a of assets) await this.runWriteAsset(a);
      const data = { ...company, schemaVersion: SCHEMA_VERSION };
      this.known.set(FILES.company, await writeJson(this.root, FILES.company, data));
      return company;
    });
  }

  saveCompany(company: CompanyFile) {
    return attempt(() => this.writeChecked(this.root, FILES.company, FILES.company, company, (raw) => migrate('company', raw), mergeCompany));
  }

  loadContacts() {
    return attempt(async () => {
      const { records, issues } = await this.loadRecords(DIRS.contacts, (raw) => migrate('contact', raw));
      return { contacts: records, issues };
    });
  }

  saveContact(contact: ContactFile) {
    return attempt(() => this.saveRecord(DIRS.contacts, contact, (raw) => migrate('contact', raw), mergeContact));
  }

  loadItems() {
    return attempt(async () => {
      const { records, issues } = await this.loadRecords(DIRS.items, (raw) => migrate('item', raw));
      return { items: records, issues };
    });
  }

  saveItem(item: ItemFile) {
    return attempt(() => this.saveRecord(DIRS.items, item, (raw) => migrate('item', raw), mergeItem));
  }

  loadDocuments() {
    return attempt(async () => {
      const { records, issues } = await this.loadRecords(DIRS.documents, (raw) => migrate('document', raw));
      return { documents: records, issues };
    });
  }

  saveDocument(document: DocumentFile) {
    return attempt(() => this.saveRecord(DIRS.documents, document, (raw) => migrate('document', raw), mergeDocument));
  }

  /** The records of a directory, one file per record named after its ID. A broken file is reported; the others still load. */
  private async loadRecords<T extends { id: string }>(dirName: string, read: (raw: unknown) => T): Promise<{ records: T[]; issues: LoadIssue[] }> {
    const dir = await this.root.getDirectoryHandle(dirName, { create: true });
    const records: T[] = [];
    const issues: LoadIssue[] = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== 'file' || !RECORD_FILE.test(name)) continue;
      const path = `${dirName}/${name}`;
      try {
        const file = await (h as FileSystemFileHandle).getFile();
        this.known.set(path, file.lastModified);
        const record = read(JSON.parse(await file.text()));
        if (`${record.id}.json` !== name) throw new InvalidFileError('The file name does not match the ID in the file');
        records.push(record);
      } catch (e) {
        issues.push({ file: path, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return { records, issues };
  }

  private async saveRecord<T extends { id: string; schemaVersion: number }>(dirName: string, record: T, read: (raw: unknown) => T, merge: (local: T, remote: T) => T): Promise<T> {
    const dir = await this.root.getDirectoryHandle(dirName, { create: true });
    const name = `${record.id}.json`;
    return this.writeChecked(dir, name, `${dirName}/${name}`, record, read, merge);
  }

  /**
   * Writes with a conflict check: if the file was changed by someone else since the last read, it is read again
   * and merged field by field. A file that cannot be read as this kind of file (newer app version, another
   * record) stops the save, so that nothing is overwritten that this app cannot merge; a half-written file
   * (sync client) is replaced. Returns `record` itself when nothing had to be merged.
   */
  private async writeChecked<T extends { id: string; schemaVersion: number }>(
    dir: FileSystemDirectoryHandle,
    name: string,
    path: string,
    record: T,
    read: (raw: unknown) => T,
    merge: (local: T, remote: T) => T,
  ): Promise<T> {
    const data: T = { ...record, schemaVersion: SCHEMA_VERSION };
    let next = data;
    try {
      const file = await (await dir.getFileHandle(name)).getFile();
      const known = this.known.get(path);
      if (known === undefined || file.lastModified > known) {
        const text = await file.text();
        if (text.trim()) {
          const remote = read(JSON.parse(text));
          if (remote.id !== record.id) throw new InvalidFileError(`${path} belongs to another record`);
          next = merge(data, remote);
        }
      }
    } catch (e) {
      if (!isNotFound(e) && !(e instanceof SyntaxError)) throw e;
    }
    this.known.set(path, await writeJson(dir, name, next));
    return sameJson(next, data) ? record : next;
  }

  writeAsset(asset: Asset) {
    return attempt(() => this.runWriteAsset(asset));
  }

  private async runWriteAsset(asset: Asset) {
    checkName(asset.name);
    const dir = await this.root.getDirectoryHandle(DIRS.assets, { create: true });
    if (!(await fileExists(dir, asset.name))) await writeFile(dir, asset.name, asset.data);
  }

  readAsset(name: string) {
    return attempt(async () => {
      // The name comes from company.json, which other devices may have written: never use it unchecked
      checkName(name);
      const dir = await this.root.getDirectoryHandle(DIRS.assets);
      return (await dir.getFileHandle(name)).getFile();
    });
  }

  /* ---------- Backups ---------- */

  writeBackup(name: string, snapshot: BackupSnapshot) {
    return attempt(async () => {
      if (!BACKUP_NAME.test(name)) throw new UnsafeFileNameError(name);
      const dir = await this.root.getDirectoryHandle(DIRS.backups, { create: true });
      const backup: BackupFile = { schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), ...snapshot };
      await writeJson(dir, `${name}.json`, backup);
    });
  }

  listBackups() {
    return attempt(async () => {
      const files = await listFiles(await this.root.getDirectoryHandle(DIRS.backups, { create: true }));
      return [...files]
        .filter(([n]) => n.endsWith('.json') && BACKUP_NAME.test(n.slice(0, -5)))
        .map(([n, f]): BackupInfo => ({ name: n.slice(0, -5), lastModified: f.lastModified, size: f.size }))
        .sort((a, b) => b.name.localeCompare(a.name));
    });
  }

  removeBackup(name: string) {
    return attempt(async () => {
      if (!BACKUP_NAME.test(name)) throw new UnsafeFileNameError(name);
      const dir = await this.root.getDirectoryHandle(DIRS.backups, { create: true });
      await dir.removeEntry(`${name}.json`).catch((e: unknown) => {
        if (!isNotFound(e)) throw e;
      });
    });
  }
}
