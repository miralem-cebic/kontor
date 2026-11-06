// CSV export of the lists, for spreadsheets (Excel, LibreOffice, Numbers). The file is UTF-8 with a byte order mark, so
// that umlauts show up correctly; the cells are separated by `;` and the lines end with CRLF (RFC 4180), which is what
// German spreadsheets expect. Pure: the caller builds the rows, this module only writes them.

/** A number kontor formatted itself (an amount, a rate, a count). It is never a formula, so it is never protected. */
export interface NumberCell {
  number: string;
}

/** A cell: text (protected against formulas) or a number that kontor formatted */
export type Cell = string | NumberCell;

export const num = (value: string): NumberCell => ({ number: value });

/** The characters a spreadsheet reads as the start of a formula, or as a tab or a line break inside a cell */
const FORMULA_START = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Text that a spreadsheet could read as a formula, for example "=HYPERLINK(…)", is written with a leading apostrophe,
 * so that it stays text (CSV formula injection; see the OWASP guidance). Other text is unchanged.
 */
export function protectText(value: string): string {
  return FORMULA_START.some((c) => value.startsWith(c)) ? `'${value}` : value;
}

/** One cell as it is written: quoted when it holds the separator, a quote or a line break */
function cellText(cell: Cell): string {
  const raw = typeof cell === 'string' ? protectText(cell) : cell.number;
  return /[;"\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/** The bytes of a CSV file: a header line and one line per row */
export function encodeCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): Uint8Array {
  const lines = [header.map(cellText), ...rows.map((row) => row.map(cellText))];
  return new TextEncoder().encode('﻿' + lines.map((line) => line.join(';')).join('\r\n') + '\r\n');
}
