// The exit archive (F12, "Exit at any time"): a ZIP file of the company folder as it is, every list as CSV, and a readme.
// The folder is read through the session's repository; unsaved changes are written first, so the archive holds the
// state the person sees. When a change cannot be written, the archive is refused, unless the person asks for the folder
// as it is (without that change): leaving is possible exactly when something is wrong with the folder (#95). The
// archive is handed out through the browser's download and changes nothing in the folder.

import { archiveTooLarge, exitArchive } from '../data/export/exit';
import { writeZip } from '../data/export/zip';
import { classifyError, type StorageErrorKind } from '../data/repository';
import { isoDateOf } from '../domain/dates';
import { t } from '../i18n';
import { saveFile } from '../lib/browser';
import { allListTables } from './csvExport';
import { useApp } from '../store/appStore';
import { currentRepository, flushWrites } from './session';

/** Why the archive could not be made; `tooLarge`: more files or bytes than the archive takes (ARCHIVE_LIMITS) */
export type ExitFailure = 'notReady' | 'unsaved' | 'tooLarge' | StorageErrorKind;

/**
 * The readme at the top of the archive: what the folder is, where the data is, where the format is written down, and
 * the files left out because of their names (#80)
 */
function readme(date: string, skipped: readonly string[]): string {
  const left = skipped.length ? ['', t('exit.readme.skipped'), ...skipped.map((path) => `- ${path}`)] : [];
  return [t('exit.readme.intro', { date }), '', t('exit.readme.folder'), '', t('exit.readme.lists'), '', t('exit.readme.format'), ...left, ''].join('\n');
}

/**
 * Makes the archive of the open company and offers it for saving: the number of files left out because of their names,
 * or the failure. `unsaved` when a change is not in the folder; with `leaveOutUnsaved`, the folder is exported as it is
 * all the same.
 */
export async function exportCompanyArchive(leaveOutUnsaved = false): Promise<{ ok: true; skipped: number } | { ok: false; failure: ExitFailure }> {
  const fail = (failure: ExitFailure) => ({ ok: false as const, failure });
  const repo = currentRepository();
  if (!repo) return fail('notReady');
  const saved = await flushWrites();
  if (!leaveOutUnsaved && (!saved || useApp.getState().unsaved.length > 0)) return fail('unsaved');
  const listed = await repo.listFolder();
  if (!listed.ok) return fail(listed.error.kind);
  if (archiveTooLarge(listed.value)) return fail('tooLarge');
  const today = isoDateOf(new Date());
  const { entries, skipped } = exitArchive(listed.value, allListTables(), (left) => readme(today, left));
  try {
    saveFile(await writeZip(entries), `kontor-${today}.zip`, 'application/zip');
  } catch (e) {
    // a file changed or vanished while it was read (a sync client)
    console.error('Could not write the archive', e);
    return fail(classifyError(e));
  }
  return { ok: true, skipped: skipped.length };
}
