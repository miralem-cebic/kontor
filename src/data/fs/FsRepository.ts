import { mergeCompany, sameJson } from '../merge';
import { InvalidFileError, migrate } from '../migrations';
import { classifyError, type Asset, type BackupInfo, type Repository, type StorageError } from '../repository';
import { err, ok, type Result } from '../result';
import { SCHEMA_VERSION } from '../schema';
import type { BackupFile, CompanyFile } from '../types';
import { isSafeFileName, UnsafeFileNameError } from './fileNames';
import { writeFile, writeJson } from './jsonFile';

// Folder structure (Phase 0; see DEVELOPMENT.md for the planned rest):
//   company.json
//   assets/<file>              logo files, named after their hash, never overwritten
//   backups/<YYYY-MM-DD>.json  daily copy of company.json

export const FILES = { company: 'company.json' } as const;
export const DIRS = { assets: 'assets', backups: 'backups' } as const;

const BACKUP_NAME = /^[A-Za-z0-9_-]{1,64}$/;
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
    return attempt(() => this.runSaveCompany(company));
  }

  /**
   * Writes with a conflict check: if company.json was changed by someone else since the last read, it is read
   * again and merged field by field. A file that cannot be read as company file stops the save, so that nothing
   * from a newer app version or another company is overwritten; a half-written file (sync client) is replaced.
   */
  private async runSaveCompany(company: CompanyFile): Promise<CompanyFile> {
    const data: CompanyFile = { ...company, schemaVersion: SCHEMA_VERSION };
    let next = data;
    try {
      const file = await (await this.root.getFileHandle(FILES.company)).getFile();
      const known = this.known.get(FILES.company);
      if (known === undefined || file.lastModified > known) {
        const text = await file.text();
        if (text.trim()) {
          const remote = migrate('company', JSON.parse(text));
          if (remote.id !== company.id) throw new InvalidFileError('company.json in this folder belongs to another company');
          next = mergeCompany(data, remote);
        }
      }
    } catch (e) {
      if (!isNotFound(e) && !(e instanceof SyntaxError)) throw e;
    }
    this.known.set(FILES.company, await writeJson(this.root, FILES.company, next));
    return sameJson(next, data) ? company : next;
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

  writeBackup(name: string, company: CompanyFile) {
    return attempt(async () => {
      if (!BACKUP_NAME.test(name)) throw new UnsafeFileNameError(name);
      const dir = await this.root.getDirectoryHandle(DIRS.backups, { create: true });
      const backup: BackupFile = { schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), company };
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
