import { format } from 'date-fns';
import type { Repository, StorageError } from './repository';
import { ok, type Result } from './result';
import type { CompanyFile } from './types';

// Upkeep of the company folder: one backup per day, the newest 14 are kept.
// This is the only module that removes files physically (backups beyond the retention).

export const KEEP_BACKUPS = 14;
const DAILY = /^\d{4}-\d{2}-\d{2}$/;

/** Writes backups/<today>.json unless it exists already (whoever opens the folder first that day). Returns the name or null. */
export async function dailyBackup(repo: Repository, company: CompanyFile, now = new Date()): Promise<Result<string | null, StorageError>> {
  const day = format(now, 'yyyy-MM-dd');
  const list = await repo.listBackups();
  if (!list.ok) return list;
  if (list.value.some((b) => b.name === day)) return ok(null);
  const written = await repo.writeBackup(day, company);
  if (!written.ok) return written;
  const daily = [day, ...list.value.map((b) => b.name).filter((n) => DAILY.test(n))].sort().reverse();
  for (const name of daily.slice(KEEP_BACKUPS)) {
    const removed = await repo.removeBackup(name);
    if (!removed.ok) return removed;
  }
  return ok(day);
}
