import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { indexedDbHandleStore, toEntry } from '../../src/data/fs/handleStore';
import { StorageDir, storageHandleStore } from '../../src/data/fs/storageFs';
import { brandId } from '../../src/data/ids';
import { MemoryStorage } from './fixtures';

const id = (s: string) => brandId<'CompanyId'>(s);
/** IndexedDB stores a structured clone; a plain object with `kind` stands in for a directory handle */
const handle = (name: string) => ({ kind: 'directory', name }) as unknown as FileSystemDirectoryHandle;

describe('IndexedDB handle store (several companies)', () => {
  it('keeps several folders, sorted by name, and replaces by ID', async () => {
    const store = indexedDbHandleStore(new IDBFactory());
    await store.put({ id: id('b'), name: 'Zeta GmbH', handle: handle('zeta') });
    await store.put({ id: id('a'), name: 'Alpha', handle: handle('alpha') });
    expect((await store.list()).map((e) => e.name)).toEqual(['Alpha', 'Zeta GmbH']);

    await store.put({ id: id('b'), name: 'Beta', handle: handle('beta') });
    const list = await store.list();
    expect(list.map((e) => [e.id, e.name, e.handle.name])).toEqual([
      ['a', 'Alpha', 'alpha'],
      ['b', 'Beta', 'beta'],
    ]);

    await store.remove(id('a'));
    expect((await store.list()).map((e) => e.id)).toEqual(['b']);
  });

  it('survives reopening the database', async () => {
    const factory = new IDBFactory();
    await indexedDbHandleStore(factory).put({ id: id('a'), name: 'Alpha', handle: handle('alpha') });
    expect((await indexedDbHandleStore(factory).list()).map((e) => e.id)).toEqual(['a']);
  });

  it('skips entries that do not have the expected shape', async () => {
    const factory = new IDBFactory();
    const store = indexedDbHandleStore(factory);
    await store.put({ id: id('ok'), name: 'Ok', handle: handle('ok') });
    // write broken records directly
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open('kontor', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('companies', 'readwrite');
    tx.objectStore('companies').put({ id: '__proto__', name: 'x', handle: handle('x') });
    tx.objectStore('companies').put({ id: 'nohandle', name: 'x' });
    tx.objectStore('companies').put({ id: 'file', name: 'x', handle: { kind: 'file' } });
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
    expect((await store.list()).map((e) => e.id)).toEqual(['ok']);
  });
});

describe('toEntry', () => {
  it.each([null, 'x', { id: 'a', name: 1, handle: handle('a') }, { id: 'a b', name: 'n', handle: handle('a') }])('rejects %j', (raw) => expect(toEntry(raw)).toBeNull());
});

describe('test-mode handle store', () => {
  it('recreates the simulated folders, including subfolders', async () => {
    const s = new MemoryStorage();
    const store = storageHandleStore(s);
    const root = new StorageDir(s, 'kontor.e2e.dir.A', '', 'A');
    const sub = (await root.getDirectoryHandle('Muster', { create: true })) as StorageDir;
    await store.put({ id: id('one'), name: 'One', handle: root.asHandle() });
    await store.put({ id: id('two'), name: 'Two', handle: sub.asHandle() });
    const list = await storageHandleStore(s).list();
    expect(list.map((e) => e.handle.name)).toEqual(['A', 'Muster']);
    expect(await (list[1]?.handle as unknown as StorageDir).isSameEntry(sub)).toBe(true);
  });

  it('ignores broken stored data', async () => {
    const s = new MemoryStorage();
    s.setItem('kontor.e2e.companies', '{"not":"a list"}');
    expect(await storageHandleStore(s).list()).toEqual([]);
    s.setItem('kontor.e2e.companies', 'not json');
    expect(await storageHandleStore(s).list()).toEqual([]);
  });
});
