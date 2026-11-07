import { mergeCompany, mergeContact, mergeDocument, mergeExpense, mergeItem, mergePayment, mergeQuoteStatus, sameJson } from '../merge';
import { InvalidFileError, migrate } from '../migrations';
import { classifyError, ConflictError, type Asset, type BackupInfo, type LoadIssue, type Repository, type StorageError } from '../repository';
import { err, ok, type Result } from '../result';
import { SCHEMA_VERSION } from '../schema';
import type { AuditEntry, BackupFile, BackupSnapshot, CompanyFile, ContactFile, DocumentFile, DunningFile, ExpenseFile, ItemFile, NumberingFile, NumberRange, PaymentFile, QuoteStatusFile } from '../types';
import { isSafeFileName, UnsafeFileNameError } from './fileNames';
import { isReceiptYear } from '../../domain/receipt';
import { writeFile, writeJson } from './jsonFile';

// Folder structure (see DEVELOPMENT.md for the planned rest):
//   company.json
//   contacts/<id>.json         one file per customer or supplier
//   items/<id>.json            one file per item or service of the catalogue
//   documents/<id>.json        one file per quote or invoice
//   payments/<id>.json         one file per payment of an issued invoice
//   quoteStatus/<id>.json   one file per decision of the customer on a quote; never changed, only removed (soft delete)
//   dunnings/<id>.json         one file per dunning (Mahnung) of an issued invoice, never changed
//   expenses/<id>.json         one file per expense (what the business paid for), edited like an item, removed by soft delete
//   documents/issued/<file>    the PDF of an issued invoice, named after its number, written once
//   documents/quotes/<file>    the PDF of a finalized quote, the same way
//   numbering/<range>.json     the counters and reservations of a number range
//   audit/<YYYY-MM>.jsonl      what happened to documents, one JSON line each, only appended
//   assets/<file>              logo files, named after their hash, never overwritten
//   backups/<YYYY-MM-DD>.json  daily copy of company.json and the contacts

export const FILES = { company: 'company.json' } as const;
export const DIRS = { contacts: 'contacts', items: 'items', documents: 'documents', payments: 'payments', dunnings: 'dunnings', quoteStatus: 'quoteStatus', expenses: 'expenses', belege: 'belege', numbering: 'numbering', audit: 'audit', assets: 'assets', backups: 'backups' } as const;

/** The folder in documents/ with the PDFs of each number range */
const ISSUED_DIRS: Record<NumberRange, string> = { invoice: 'issued', quote: 'quotes' };

const AUDIT_MONTH = /^\d{4}-\d{2}$/;

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

/** A receipt is kept under belege/<year>/: the year is four digits and the name is a single safe file name */
const checkReceiptPath = (year: string, name: string) => {
  if (!isReceiptYear(year)) throw new UnsafeFileNameError(year);
  checkName(name);
};

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** What identifies the state of a file: a change of the time in either direction or of the size is a change */
const stampOf = (file: File): string => `${file.lastModified}:${file.size}`;

export class FsRepository implements Repository {
  /** Path → stamp (lastModified and size) at the last read or write, to notice changes made by someone else */
  readonly known = new Map<string, string>();

  constructor(private readonly root: FileSystemDirectoryHandle) {}

  private async stampAt(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
    return stampOf(await (await dir.getFileHandle(name)).getFile());
  }

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
      this.known.set(FILES.company, stampOf(file));
      return migrate('company', JSON.parse(await file.text()));
    });
  }

  createCompany(company: CompanyFile, assets: readonly Asset[]) {
    return attempt(async () => {
      if (await fileExists(this.root, FILES.company)) throw new InvalidFileError('The folder already contains a company');
      for (const a of assets) await this.runWriteAsset(a);
      const data = { ...company, schemaVersion: SCHEMA_VERSION };
      await writeJson(this.root, FILES.company, data);
      this.known.set(FILES.company, await this.stampAt(this.root, FILES.company));
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

  loadExpenses() {
    return attempt(async () => {
      const { records, issues } = await this.loadRecords(DIRS.expenses, (raw) => migrate('expense', raw));
      return { expenses: records, issues };
    });
  }

  saveExpense(expense: ExpenseFile) {
    return attempt(() => this.saveRecord(DIRS.expenses, expense, (raw) => migrate('expense', raw), mergeExpense));
  }

  loadDocuments() {
    return attempt(async () => {
      const { records, issues } = await this.loadRecords(DIRS.documents, (raw) => migrate('document', raw));
      return { documents: records, issues };
    });
  }

  /**
   * A file of the same ID but another kind (a quote where an invoice is saved) is not merged: the save stops. Neither
   * is a document issued with another number. An issued invoice or a finalized quote in the folder wins over a draft
   * (see mergeDocument), and since the merge then leaves the file as it is, nothing is written.
   */
  saveDocument(document: DocumentFile) {
    const read = (raw: unknown) => {
      const remote = migrate('document', raw);
      if (remote.kind !== document.kind) throw new InvalidFileError(`documents/${document.id}.json holds a ${remote.kind}, not a ${document.kind}`);
      if (remote.issued && document.issued && remote.issued.number !== document.issued.number) {
        throw new ConflictError(`documents/${document.id}.json was issued as ${remote.issued.number}, not ${document.issued.number}`);
      }
      return remote;
    };
    return attempt(() => this.saveRecord(DIRS.documents, document, read, mergeDocument));
  }

  loadDunnings() {
    return attempt(async () => {
      const { records, issues } = await this.loadRecords(DIRS.dunnings, (raw) => migrate('dunning', raw));
      return { dunnings: records, issues };
    });
  }

  /** A dunning is a letter that went out: the file that is there wins over a different one with the same ID */
  saveDunning(dunning: DunningFile) {
    return attempt(() => this.saveRecord(DIRS.dunnings, dunning, (raw) => migrate('dunning', raw), (_local, remote) => remote));
  }

  loadPayments() {
    return attempt(async () => {
      const { records, issues } = await this.loadRecords(DIRS.payments, (raw) => migrate('payment', raw));
      return { payments: records, issues };
    });
  }

  savePayment(payment: PaymentFile) {
    return attempt(() => this.saveRecord(DIRS.payments, payment, (raw) => migrate('payment', raw), mergePayment));
  }

  loadQuoteStatuses() {
    return attempt(async () => {
      const { records, issues } = await this.loadRecords(DIRS.quoteStatus, (raw) => migrate('quoteStatus', raw));
      return { quoteStatuses: records, issues };
    });
  }

  saveQuoteStatus(quoteStatus: QuoteStatusFile) {
    return attempt(() => this.saveRecord(DIRS.quoteStatus, quoteStatus, (raw) => migrate('quoteStatus', raw), mergeQuoteStatus));
  }

  /* ---------- Numbering, issued files, audit ---------- */

  readNumbering(range: NumberRange) {
    return attempt(async () => {
      const dir = await this.root.getDirectoryHandle(DIRS.numbering, { create: true });
      const text = await dir.getFileHandle(`${range}.json`).then(
        async (h) => (await h.getFile()).text(),
        (e: unknown) => {
          if (isNotFound(e)) return null;
          throw e;
        },
      );
      return text === null ? null : migrate('numbering', JSON.parse(text));
    });
  }

  writeNumbering(file: NumberingFile) {
    return attempt(async () => {
      const dir = await this.root.getDirectoryHandle(DIRS.numbering, { create: true });
      const name = `${file.range}.json`;
      await writeJson(dir, name, { ...file, schemaVersion: SCHEMA_VERSION });
      // read back: a sync client or another device may have replaced the file in the meantime
      return migrate('numbering', JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text()));
    });
  }

  listIssuedFiles(range: NumberRange) {
    return attempt(async () => [...(await listFiles(await this.issuedDir(range))).keys()]);
  }

  writeIssuedFile(range: NumberRange, name: string, data: Uint8Array) {
    return attempt(async () => {
      checkName(name);
      const dir = await this.issuedDir(range);
      if (await fileExists(dir, name)) throw new ConflictError(`documents/${ISSUED_DIRS[range]}/${name} exists already`);
      await writeFile(dir, name, new Blob([data.slice()], { type: 'application/pdf' }));
    });
  }

  readIssuedFile(range: NumberRange, name: string) {
    return attempt(async () => {
      // the name comes from a document file, which other devices may have written: never use it unchecked
      checkName(name);
      const file = await (await (await this.issuedDir(range)).getFileHandle(name)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    });
  }

  appendAudit(month: string, entry: AuditEntry) {
    return attempt(async () => {
      if (!AUDIT_MONTH.test(month)) throw new UnsafeFileNameError(month);
      const dir = await this.root.getDirectoryHandle(DIRS.audit, { create: true });
      const name = `${month}.jsonl`;
      const before = await dir.getFileHandle(name).then(
        async (h) => (await h.getFile()).text(),
        (e: unknown) => {
          if (isNotFound(e)) return '';
          throw e;
        },
      );
      // the lines so far are written again unchanged and the new one added; the file is never shortened
      const prefix = before === '' || before.endsWith('\n') ? before : `${before}\n`;
      await writeFile(dir, name, `${prefix}${JSON.stringify(entry)}\n`);
    });
  }

  private async issuedDir(range: NumberRange) {
    const documents = await this.root.getDirectoryHandle(DIRS.documents, { create: true });
    return documents.getDirectoryHandle(ISSUED_DIRS[range], { create: true });
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
        this.known.set(path, stampOf(file));
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
      // any difference counts, also an older time: a device with a clock behind ours must not be overwritten
      if (known === undefined || stampOf(file) !== known) {
        const text = await file.text();
        if (text.trim()) {
          const remote = read(JSON.parse(text));
          if (remote.id !== record.id) throw new InvalidFileError(`${path} belongs to another record`);
          next = merge(data, remote);
          // the file already holds the merged state (for example an issued invoice that wins): nothing to write
          if (sameJson(next, remote)) {
            this.known.set(path, stampOf(file));
            return sameJson(next, data) ? record : next;
          }
        }
      }
    } catch (e) {
      if (!isNotFound(e) && !(e instanceof SyntaxError)) throw e;
    }
    await writeJson(dir, name, next);
    this.known.set(path, await this.stampAt(dir, name));
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

  /** Writes belege/<year>/<name>. The same bytes under that name are kept; other bytes are a conflict, never an overwrite. */
  writeReceipt(year: string, name: string, data: Uint8Array) {
    return attempt(() => this.runWriteReceipt(year, name, data));
  }

  private async runWriteReceipt(year: string, name: string, data: Uint8Array) {
    checkReceiptPath(year, name);
    const belege = await this.root.getDirectoryHandle(DIRS.belege, { create: true });
    const dir = await belege.getDirectoryHandle(year, { create: true });
    if (await fileExists(dir, name)) {
      const existing = new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
      if (sameBytes(existing, data)) return;
      throw new ConflictError(`${year}/${name} exists with other content`);
    }
    await writeFile(dir, name, new Blob([data.slice()]));
  }

  readReceipt(year: string, name: string) {
    return attempt(async () => {
      checkReceiptPath(year, name);
      const belege = await this.root.getDirectoryHandle(DIRS.belege);
      const dir = await belege.getDirectoryHandle(year);
      return (await dir.getFileHandle(name)).getFile();
    });
  }

  /** Every file of the folder with its path and bytes, in path order. Hidden files and the helper files of sync clients are left out. */
  listFolder() {
    return attempt(async () => {
      const files: { path: string; data: Uint8Array }[] = [];
      const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
        for await (const [name, h] of dir.entries()) {
          if (name.startsWith('.') || name.startsWith('~') || name.endsWith('.crswap') || name.endsWith('.tmp')) continue;
          const path = prefix === '' ? name : `${prefix}/${name}`;
          if (h.kind === 'directory') await walk(h as FileSystemDirectoryHandle, path);
          else files.push({ path, data: new Uint8Array(await (await (h as FileSystemFileHandle).getFile()).arrayBuffer()) });
        }
      };
      await walk(this.root, '');
      return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    });
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
