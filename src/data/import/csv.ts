// CSV import: bytes in, rows of text out (roadmap, "Rules for importers"). Pure: no file access. The file is untrusted,
// so it has limits on size, rows, columns and cell length, and it is read the way a spreadsheet writes it: UTF-8 with
// or without a byte order mark, or Windows-1252 when the bytes are not UTF-8; `;`, `,` or a tab as separator; RFC 4180
// quoting with line breaks inside quoted cells.

import { err, ok, type Result } from '../result';

export const CSV_LIMITS = {
  /** A company's contacts and items fit in far less; a larger file is a mistake or not a list */
  bytes: 5_000_000,
  rows: 5_000,
  columns: 100,
  cellLength: 4_000,
} as const;

export type CsvSeparator = ';' | ',' | '\t';

/** A parsed file: the rows as text, the header line first */
export interface CsvFile {
  encoding: 'utf-8' | 'windows-1252';
  separator: CsvSeparator;
  rows: string[][];
}

export type CsvProblem = 'empty' | 'tooLarge' | 'tooManyRows' | 'tooManyColumns' | 'cellTooLong';

const SEPARATORS: readonly CsvSeparator[] = [';', '\t', ','];
const UTF8_BOM = [0xef, 0xbb, 0xbf];

/** The text of the bytes: UTF-8 (a byte order mark is removed), or Windows-1252 when the bytes are not UTF-8 */
function decode(bytes: Uint8Array): { encoding: 'utf-8' | 'windows-1252'; text: string } {
  const hasBom = UTF8_BOM.every((b, i) => bytes[i] === b);
  const body = hasBom ? bytes.subarray(3) : bytes;
  try {
    return { encoding: 'utf-8', text: new TextDecoder('utf-8', { fatal: true }).decode(body) };
  } catch {
    return { encoding: 'windows-1252', text: new TextDecoder('windows-1252').decode(body) };
  }
}

/**
 * The separator is the first of SEPARATORS in the order of preference that occurs in the first line outside quotes:
 * a semicolon, the way German spreadsheets write it, then a tab, then a comma. A comma in the text of a header
 * (`Notiz, lang`) therefore does not turn a semicolon file into a comma file. Cells with a separator in them are quoted.
 */
function separatorOf(text: string): CsvSeparator {
  const found = new Set<string>();
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (ch === '\n' || ch === '\r') {
      if (!quoted) break;
    } else if (!quoted) found.add(ch);
  }
  return SEPARATORS.find((s) => found.has(s)) ?? ';';
}

/** The rows of the text. Blank lines are skipped; a quote starts a quoted cell only at the start of a cell. */
function rowsOfText(text: string, separator: CsvSeparator): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; ) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else cell += ch;
      i++;
    } else if (ch === '"' && cell === '') {
      quoted = true;
      i++;
    } else if (ch === separator) {
      row.push(cell);
      cell = '';
      i++;
    } else if (ch === '\r' || ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += ch === '\r' && text.charAt(i + 1) === '\n' ? 2 : 1;
    } else {
      cell += ch;
      i++;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // a line without any text is no row
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Reads a CSV file. Refusals say what is wrong, so that the import can tell the user. */
export function parseCsv(bytes: Uint8Array): Result<CsvFile, { kind: CsvProblem }> {
  if (bytes.length === 0) return err({ kind: 'empty' });
  if (bytes.length > CSV_LIMITS.bytes) return err({ kind: 'tooLarge' });
  const { encoding, text } = decode(bytes);
  const separator = separatorOf(text);
  const rows = rowsOfText(text, separator);
  if (rows.length === 0) return err({ kind: 'empty' });
  if (rows.length > CSV_LIMITS.rows + 1) return err({ kind: 'tooManyRows' });
  for (const row of rows) {
    if (row.length > CSV_LIMITS.columns) return err({ kind: 'tooManyColumns' });
    if (row.some((c) => c.length > CSV_LIMITS.cellLength)) return err({ kind: 'cellTooLong' });
  }
  return ok({ encoding, separator, rows });
}
