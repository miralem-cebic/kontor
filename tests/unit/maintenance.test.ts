import { beforeEach, describe, expect, it } from 'vitest';
import { FsRepository } from '../../src/data/fs/FsRepository';
import { MemDir } from '../../src/data/fs/memoryFs';
import { dailyBackup, KEEP_BACKUPS } from '../../src/data/maintenance';
import { must } from '../../src/data/result';
import { makeContact, makeItem } from '../../src/data/schema';
import { sampleCompany, sampleContact, sampleItem } from './fixtures';

let repo: FsRepository;
const snapshot = { company: sampleCompany(), contacts: [], items: [] };

beforeEach(() => {
  repo = new FsRepository(new MemDir('c').asHandle());
});

describe('dailyBackup', () => {
  it('writes one backup per day', async () => {
    const day = new Date(2026, 9, 21, 9);
    expect(must(await dailyBackup(repo, snapshot, day))).toBe('2026-10-21');
    expect(must(await dailyBackup(repo, snapshot, new Date(2026, 9, 21, 18)))).toBeNull();
    expect(must(await repo.listBackups())).toHaveLength(1);
  });

  it(`keeps the newest ${KEEP_BACKUPS} daily backups and leaves other files alone`, async () => {
    must(await repo.writeBackup('before-import', snapshot));
    for (let d = 1; d <= 20; d++) must(await dailyBackup(repo, snapshot, new Date(2026, 9, d, 12)));
    const names = must(await repo.listBackups()).map((b) => b.name);
    expect(names).toContain('before-import');
    const daily = names.filter((n) => /^\d{4}-/.test(n));
    expect(daily).toHaveLength(KEEP_BACKUPS);
    expect(daily[0]).toBe('2026-10-20');
    expect(daily.at(-1)).toBe('2026-10-07');
  });

  it('the backup holds the company, its contacts and its items', async () => {
    const root = new MemDir('b');
    const r = new FsRepository(root.asHandle());
    const contact = makeContact(sampleContact());
    const item = makeItem(sampleItem());
    must(await dailyBackup(r, { company: snapshot.company, contacts: [contact], items: [item] }, new Date(2026, 9, 21)));
    const file = await (await (await root.getDirectoryHandle('backups')).getFileHandle('2026-10-21.json')).getFile();
    const backup = JSON.parse(await file.text());
    expect(backup.company.id).toBe(snapshot.company.id);
    expect(backup.contacts.map((c: { id: string }) => c.id)).toEqual([contact.id]);
    expect(backup.items.map((i: { id: string }) => i.id)).toEqual([item.id]);
  });
});
