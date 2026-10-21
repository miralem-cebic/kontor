// The company folders this browser knows (one folder per company, see ADR 0002), so the app can offer them after a
// restart and switch between them. IndexedDB is the only place that can keep FileSystemDirectoryHandle objects.
// The entries were written by this app, but are read like any other stored data: an entry that does not pass the
// check is skipped.

import { brandId, type CompanyId } from '../ids';
import { isRecord, isValidId } from '../validate';

export interface CompanyEntry {
  id: CompanyId;
  /** Company name when the folder was last opened, shown before the folder is opened again */
  name: string;
  handle: FileSystemDirectoryHandle;
}

export interface HandleStore {
  /** All entries, sorted by name */
  list(): Promise<CompanyEntry[]>;
  /** Adds the entry or replaces the one with the same ID */
  put(entry: CompanyEntry): Promise<void>;
  remove(id: CompanyId): Promise<void>;
}

export const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

const DB_NAME = 'kontor';
const DB_VERSION = 1;
const STORE = 'companies';

/** A stored entry, or null when it does not have the expected shape */
export function toEntry(raw: unknown): CompanyEntry | null {
  if (!isRecord(raw)) return null;
  const { id, name, handle } = raw;
  if (!isValidId(id) || typeof name !== 'string' || !isRecord(handle) || handle['kind'] !== 'directory') return null;
  return { id: brandId<'CompanyId'>(id), name, handle: handle as unknown as FileSystemDirectoryHandle };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function indexedDbHandleStore(factory: IDBFactory = indexedDB, dbName = DB_NAME): HandleStore {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = factory.open(dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    try {
      return await request(fn(db.transaction(STORE, mode).objectStore(STORE)));
    } finally {
      db.close();
    }
  }

  return {
    async list() {
      const all: unknown[] = await run('readonly', (s) => s.getAll());
      return all.flatMap((raw) => toEntry(raw) ?? []).sort(byName);
    },
    async put(entry) {
      await run('readwrite', (s) => s.put({ id: entry.id, name: entry.name, handle: entry.handle }));
    },
    async remove(id) {
      await run('readwrite', (s) => s.delete(id));
    },
  };
}
