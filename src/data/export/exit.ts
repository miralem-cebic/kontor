// The exit archive (F12, "Exit at any time"): the company folder as it is, every list as a CSV file, and a readme. The
// folder's own files are kept byte for byte, so the archive is a copy that another program can read without kontor.
// Pure: the caller reads the folder and the lists; this module only puts them into the entries of a ZIP file.

import { encodeCsv, type Cell } from './csv';
import type { ZipEntry } from './zip';

/** A file of the company folder, by its path inside the folder */
export interface ArchiveFile {
  path: string;
  data: Uint8Array;
}

/** A list as a table: its name (the file name without .csv), the header line and the rows */
export interface ArchiveList {
  name: string;
  header: readonly string[];
  rows: readonly (readonly Cell[])[];
}

/** The entries of the archive: the folder files as they are, then listen/<name>.csv for each list, then the readme */
export function exitArchive(folder: readonly ArchiveFile[], lists: readonly ArchiveList[], readme: string): ZipEntry[] {
  const entries: ZipEntry[] = folder.map((f) => ({ name: f.path, data: f.data }));
  for (const list of lists) entries.push({ name: `listen/${list.name}.csv`, data: encodeCsv(list.header, list.rows) });
  entries.push({ name: 'LIESMICH.txt', data: new TextEncoder().encode(readme) });
  return entries;
}
