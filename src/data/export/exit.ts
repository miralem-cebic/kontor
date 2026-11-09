// The exit archive (F12, "Exit at any time"): the company folder as it is, every list as a CSV file, and a readme. The
// folder's own files are kept byte for byte, so the archive is a copy that another program can read without kontor.
// Pure: the caller lists the folder and the lists; this module only decides what goes into the entries of a ZIP file.
//
// Names come from the folder, which other devices and other systems write too (#80): a name with a character that a
// ZIP tool on Windows reads as a separator or a drive (`\`, `:`), a step up (`..`), a control character or a leading
// space would let the archive write outside the place it is unpacked to. Such a file is left out and named in the
// readme. The files are read one by one while the archive is written, and a folder too large for a ZIP file without
// ZIP64 that is made in memory is refused before anything is read.

import { isSafeFileName } from '../fs/fileNames';
import { isSafeEntryName } from '../import/zip';
import { encodeCsv, type Cell } from './csv';
import type { LazyZipEntry, ZipEntry } from './zip';

/** A file of the company folder, by its path inside the folder; its bytes are read when the archive is written */
export interface ArchiveFile {
  path: string;
  size: number;
  read: () => Promise<Uint8Array>;
}

/** A list as a table: its name (the file name without .csv), the header line and the rows */
export interface ArchiveList {
  name: string;
  header: readonly string[];
  rows: readonly (readonly Cell[])[];
}

/**
 * The most the archive takes. A ZIP file without ZIP64 holds at most 65,535 entries and 4 GiB, and the archive is made
 * in the memory of the browser tab; a larger folder is copied as it is instead.
 */
export const ARCHIVE_LIMITS = { files: 65_000, bytes: 2 * 1024 ** 3 } as const;

/** A path that is safe as the name of an entry: a path the reader takes back, and every part a safe file name */
export const isSafeArchivePath = (path: string): boolean => isSafeEntryName(path) && path.split('/').every(isSafeFileName);

/** True when the folder has more files or bytes than the archive takes; checked before any file is read */
export function archiveTooLarge(folder: readonly ArchiveFile[]): boolean {
  if (folder.length > ARCHIVE_LIMITS.files) return true;
  let bytes = 0;
  for (const f of folder) bytes += f.size;
  return bytes > ARCHIVE_LIMITS.bytes;
}

/**
 * The entries of the archive: the folder files with a safe path as they are, then listen/<name>.csv for each list, then
 * the readme, which names the files that were left out. `skipped` lists those paths.
 */
export function exitArchive(folder: readonly ArchiveFile[], lists: readonly ArchiveList[], readme: (skipped: readonly string[]) => string): { entries: (ZipEntry | LazyZipEntry)[]; skipped: string[] } {
  const skipped = folder.filter((f) => !isSafeArchivePath(f.path)).map((f) => f.path);
  const entries: (ZipEntry | LazyZipEntry)[] = folder.filter((f) => isSafeArchivePath(f.path)).map((f) => ({ name: f.path, read: f.read }));
  for (const list of lists) entries.push({ name: `listen/${list.name}.csv`, data: encodeCsv(list.header, list.rows) });
  entries.push({ name: 'LIESMICH.txt', data: new TextEncoder().encode(readme(skipped)) });
  return { entries, skipped };
}
