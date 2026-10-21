import { beforeEach, describe, expect, it } from 'vitest';
import { FsRepository } from '../../src/data/fs/FsRepository';
import { MemDir } from '../../src/data/fs/memoryFs';
import { dailyBackup, KEEP_BACKUPS } from '../../src/data/maintenance';
import { must } from '../../src/data/result';
import { makeCompany } from '../../src/data/schema';
import { sampleProfile } from './fixtures';

let repo: FsRepository;
const company = makeCompany(sampleProfile());

beforeEach(() => {
  repo = new FsRepository(new MemDir('c').asHandle());
});

describe('dailyBackup', () => {
  it('writes one backup per day', async () => {
    const day = new Date(2026, 9, 21, 9);
    expect(must(await dailyBackup(repo, company, day))).toBe('2026-10-21');
    expect(must(await dailyBackup(repo, company, new Date(2026, 9, 21, 18)))).toBeNull();
    expect(must(await repo.listBackups())).toHaveLength(1);
  });

  it(`keeps the newest ${KEEP_BACKUPS} daily backups and leaves other files alone`, async () => {
    must(await repo.writeBackup('before-import', company));
    for (let d = 1; d <= 20; d++) must(await dailyBackup(repo, company, new Date(2026, 9, d, 12)));
    const names = must(await repo.listBackups()).map((b) => b.name);
    expect(names).toContain('before-import');
    const daily = names.filter((n) => /^\d{4}-/.test(n));
    expect(daily).toHaveLength(KEEP_BACKUPS);
    expect(daily[0]).toBe('2026-10-20');
    expect(daily.at(-1)).toBe('2026-10-07');
  });
});
