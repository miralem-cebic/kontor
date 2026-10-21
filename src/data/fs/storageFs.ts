// Stand-in for a folder, based on Web Storage (localStorage).
// For end-to-end tests only (?e2e): every simulated folder is a namespace of keys, so a test can create several
// company folders, reload the page and find them again. Two windows of the same profile share them.

import { isRecord } from '../validate';
import { byName, toEntry, type HandleStore } from './handleStore';

interface Entry {
  /** Content as text or data: URL (binary files) */
  c: string;
  /** lastModified */
  m: number;
  /** Content is a data: URL */
  b?: boolean;
  t?: string;
}

const join = (a: string, b: string) => (a ? `${a}/${b}` : b);

/** Entries are read from localStorage, so they are checked like any other stored data */
function parseEntry(raw: string, name: string): Entry {
  const v: unknown = JSON.parse(raw);
  if (typeof v !== 'object' || v === null) throw new DOMException(`${name} is unreadable`, 'NotReadableError');
  const { c, m, b, t } = v as Record<string, unknown>;
  if (typeof c !== 'string' || typeof m !== 'number') throw new DOMException(`${name} is unreadable`, 'NotReadableError');
  return { c, m, ...(b === true ? { b } : {}), ...(typeof t === 'string' ? { t } : {}) };
}

function dataUrlToBlob(url: string, type?: string): Blob {
  const [, b64 = ''] = url.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], type ? { type } : {});
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

class StorageFile {
  readonly kind = 'file' as const;
  constructor(
    private readonly s: Storage,
    readonly key: string,
    readonly name: string,
  ) {}

  private read(): Entry {
    const raw = this.s.getItem(this.key);
    if (!raw) throw new DOMException(`${this.name} not found`, 'NotFoundError');
    return parseEntry(raw, this.name);
  }

  async getFile() {
    const e = this.read();
    const body = e.b ? dataUrlToBlob(e.c, e.t) : e.c;
    return new File([body], this.name, { lastModified: e.m, type: e.t ?? '' });
  }

  async createWritable() {
    const parts: (string | Blob)[] = [];
    return {
      write: async (d: string | Blob) => {
        parts.push(d);
      },
      close: async () => {
        const prev = this.s.getItem(this.key);
        const m = Math.max(Date.now(), prev ? parseEntry(prev, this.name).m + 1 : 0);
        const binary = parts.some((p) => typeof p !== 'string');
        const type = parts.find((p): p is Blob => typeof p !== 'string')?.type;
        const entry: Entry = binary ? { c: await blobToDataUrl(new Blob(parts)), m, b: true, ...(type ? { t: type } : {}) } : { c: parts.join(''), m };
        this.s.setItem(this.key, JSON.stringify(entry));
      },
      abort: async () => undefined,
    };
  }

  async queryPermission() {
    return 'granted' as PermissionState;
  }
  async requestPermission() {
    return 'granted' as PermissionState;
  }
  async isSameEntry(other: unknown) {
    return other instanceof StorageFile && other.key === this.key;
  }
}

export class StorageDir {
  readonly kind = 'directory' as const;

  constructor(
    private readonly s: Storage,
    readonly ns: string,
    readonly path = '',
    readonly name = 'kontor-test',
  ) {
    if (!path) s.setItem(`${ns}:d:`, '1');
  }

  private fk = (p: string) => `${this.ns}:f:${p}`;
  private dk = (p: string) => `${this.ns}:d:${p}`;

  /** Does this folder already exist (was it ever created)? */
  static exists(s: Storage, ns: string) {
    return s.getItem(`${ns}:d:`) !== null;
  }

  static clear(s: Storage, ns: string) {
    for (const k of Object.keys(s)) if (k.startsWith(`${ns}:`)) s.removeItem(k);
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    const p = join(this.path, name);
    if (this.s.getItem(this.fk(p)) === null) {
      if (!opts?.create) throw new DOMException(`${name} not found`, 'NotFoundError');
      this.s.setItem(this.fk(p), JSON.stringify({ c: '', m: Date.now() } satisfies Entry));
    }
    return new StorageFile(this.s, this.fk(p), name);
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    const p = join(this.path, name);
    if (this.s.getItem(this.dk(p)) === null) {
      if (!opts?.create) throw new DOMException(`${name} not found`, 'NotFoundError');
      this.s.setItem(this.dk(p), '1');
    }
    return new StorageDir(this.s, this.ns, p, name);
  }

  async removeEntry(name: string, opts?: { recursive?: boolean }) {
    const p = join(this.path, name);
    let found = false;
    for (const k of Object.keys(this.s)) {
      if (k === this.fk(p) || k === this.dk(p) || (opts?.recursive && (k.startsWith(this.fk(p) + '/') || k.startsWith(this.dk(p) + '/')))) {
        this.s.removeItem(k);
        found = true;
      }
    }
    if (!found) throw new DOMException(`${name} not found`, 'NotFoundError');
  }

  async *entries(): AsyncIterableIterator<[string, StorageFile | StorageDir]> {
    const prefixF = this.fk(this.path ? this.path + '/' : '');
    const prefixD = this.dk(this.path ? this.path + '/' : '');
    for (const k of Object.keys(this.s)) {
      if (k.startsWith(prefixF)) {
        const rest = k.slice(prefixF.length);
        if (rest && !rest.includes('/')) yield [rest, new StorageFile(this.s, k, rest)];
      } else if (k.startsWith(prefixD)) {
        const rest = k.slice(prefixD.length);
        if (rest && !rest.includes('/')) yield [rest, new StorageDir(this.s, this.ns, join(this.path, rest), rest)];
      }
    }
  }

  async queryPermission() {
    return 'granted' as PermissionState;
  }
  async requestPermission() {
    return 'granted' as PermissionState;
  }
  async isSameEntry(other: unknown) {
    return other instanceof StorageDir && other.ns === this.ns && other.path === this.path;
  }

  asHandle() {
    return this as unknown as FileSystemDirectoryHandle;
  }
}

/* ---------- Known company folders in test mode ---------- */

interface StoredEntry {
  id: string;
  name: string;
  /** Namespace, path and name of the simulated folder */
  ns: string;
  path: string;
  dir: string;
}

/**
 * The list of company folders for test mode: like the IndexedDB store, but the simulated folders cannot be put
 * into IndexedDB, so their namespace is stored in localStorage and the folder is created again when listed.
 */
export function storageHandleStore(s: Storage, key = 'kontor.e2e.companies'): HandleStore {
  const read = (): StoredEntry[] => {
    try {
      const raw: unknown = JSON.parse(s.getItem(key) ?? '[]');
      if (!Array.isArray(raw)) return [];
      return raw.filter((e): e is StoredEntry => isRecord(e) && ['id', 'name', 'ns', 'path', 'dir'].every((k) => typeof e[k] === 'string'));
    } catch {
      return [];
    }
  };
  const write = (entries: StoredEntry[]) => s.setItem(key, JSON.stringify(entries));
  return {
    async list() {
      return read()
        .flatMap((e) => toEntry({ id: e.id, name: e.name, handle: new StorageDir(s, e.ns, e.path, e.dir) }) ?? [])
        .sort(byName);
    },
    async put(entry) {
      const dir: unknown = entry.handle;
      if (!(dir instanceof StorageDir)) throw new Error('Test mode stores only simulated folders');
      write([...read().filter((e) => e.id !== entry.id), { id: entry.id, name: entry.name, ns: dir.ns, path: dir.path, dir: dir.name }]);
    },
    async remove(id) {
      write(read().filter((e) => e.id !== id));
    },
  };
}
