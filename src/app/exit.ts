// The exit archive (F12, "Exit at any time"): a ZIP file of the company folder as it is, every list as CSV, and a readme.
// The folder is read through the session's repository; unsaved changes are written first, so the archive holds the
// state the person sees. When a change cannot be written, the archive is refused, unless the person asks for the folder
// as it is (without that change): leaving is possible exactly when something is wrong with the folder (#95). The
// archive is handed out through the browser's download and changes nothing in the folder.

import { exitArchive } from '../data/export/exit';
import { writeZip } from '../data/export/zip';
import type { StorageErrorKind } from '../data/repository';
import { isoDateOf } from '../domain/dates';
import { t } from '../i18n';
import { saveFile } from '../lib/browser';
import { allListTables } from './csvExport';
import { useApp } from '../store/appStore';
import { currentRepository, flushWrites } from './session';

/** Why the archive could not be made */
export type ExitFailure = 'notReady' | 'unsaved' | StorageErrorKind;

/** The readme at the top of the archive: what the folder is, where the data is, and where the format is written down */
function readme(date: string): string {
  return [t('exit.readme.intro', { date }), '', t('exit.readme.folder'), '', t('exit.readme.lists'), '', t('exit.readme.format'), ''].join('\n');
}

/**
 * Makes the archive of the open company and offers it for saving. Returns the failure, or null when it was offered.
 * `unsaved` when a change is not in the folder; with `leaveOutUnsaved`, the folder is exported as it is all the same.
 */
export async function exportCompanyArchive(leaveOutUnsaved = false): Promise<ExitFailure | null> {
  const repo = currentRepository();
  if (!repo) return 'notReady';
  const saved = await flushWrites();
  if (!leaveOutUnsaved && (!saved || useApp.getState().unsaved.length > 0)) return 'unsaved';
  const listed = await repo.listFolder();
  if (!listed.ok) return listed.error.kind;
  const today = isoDateOf(new Date());
  const bytes = await writeZip(exitArchive(listed.value, allListTables(), readme(today)));
  saveFile(bytes, `kontor-${today}.zip`, 'application/zip');
  return null;
}
