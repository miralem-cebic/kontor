// In-memory stand-in for FileSystemDirectoryHandle, used by the unit tests.

type Node = MemFile | MemDir;
type Data = string | Blob | ArrayBuffer | ArrayBufferView;

async function toBlob(d: Data): Promise<Blob> {
  return d instanceof Blob ? d : new Blob([d as BlobPart]);
}

export class MemFile {
  readonly kind = 'file' as const;
  content: Blob = new Blob([]);
  lastModified = Date.now();
  constructor(readonly name: string) {}

  async getFile() {
    return new File([this.content], this.name, { lastModified: this.lastModified, type: this.content.type });
  }

  async createWritable() {
    const parts: Blob[] = [];
    return {
      write: async (data: Data) => {
        parts.push(await toBlob(data));
      },
      close: async () => {
        this.content = new Blob(parts);
        // lastModified must strictly increase on quick consecutive writes
        this.lastModified = Math.max(Date.now(), this.lastModified + 1);
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
    return other === this;
  }
}

export class MemDir {
  readonly kind = 'directory' as const;
  readonly children = new Map<string, Node>();

  constructor(readonly name: string) {}

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    const n = this.children.get(name);
    if (n?.kind === 'file') return n;
    if (n) throw new DOMException(`${name} is a folder`, 'TypeMismatchError');
    if (!opts?.create) throw new DOMException(`${name} not found`, 'NotFoundError');
    const f = new MemFile(name);
    this.children.set(name, f);
    return f;
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    const n = this.children.get(name);
    if (n?.kind === 'directory') return n;
    if (n) throw new DOMException(`${name} is a file`, 'TypeMismatchError');
    if (!opts?.create) throw new DOMException(`${name} not found`, 'NotFoundError');
    const d = new MemDir(name);
    this.children.set(name, d);
    return d;
  }

  async removeEntry(name: string, _opts?: { recursive?: boolean }) {
    if (!this.children.delete(name)) throw new DOMException(`${name} not found`, 'NotFoundError');
  }

  async *entries(): AsyncIterableIterator<[string, Node]> {
    for (const e of [...this.children.entries()]) yield e;
  }

  async queryPermission() {
    return 'granted' as PermissionState;
  }
  async requestPermission() {
    return 'granted' as PermissionState;
  }
  async isSameEntry(other: unknown) {
    return other === this;
  }

  asHandle() {
    return this as unknown as FileSystemDirectoryHandle;
  }
}
