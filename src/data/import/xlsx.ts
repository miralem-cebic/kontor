// The Excel import: the first sheet of an .xlsx file as rows of text. Numbers come back as numbers with a decimal point
// (the file's own form); the importer writes them in the decimal style of the chosen language. Shared strings (what
// Excel writes), inline strings and plain text are read. Formulas are read as the values they show.

import { CSV_LIMITS } from './csv';
import { readZip, type ZipProblem } from './zip';
import { parseXml, type XmlElement } from './xml';
import { err, ok, type Result } from '../result';

/** A cell of a sheet: text, or a number as the file has it (decimal point, no grouping) */
export type SheetCell = string | { number: string };

export interface XlsxSheet {
  /** The rows in the order of the file; a cell that is missing in a row is '' */
  rows: SheetCell[][];
}

export type XlsxProblem = ZipProblem | 'noSheet' | 'tooManyRows' | 'tooManyColumns' | 'cellTooLong';

const NUMBER = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/** The text of an element and everything in it (rich text runs of a shared string are split in <r> elements) */
function allText(el: XmlElement): string {
  return el.children.map((c) => (typeof c === 'string' ? c : allText(c))).join('');
}

/** The element children with a local name (the part after the prefix) */
function kids(el: XmlElement, local: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => typeof c !== 'string' && (c.name === local || c.name.endsWith(`:${local}`)));
}

/** The first element below `el` with a local name, searched depth first */
function find(el: XmlElement, local: string): XmlElement | null {
  for (const c of el.children) {
    if (typeof c === 'string') continue;
    if (c.name === local || c.name.endsWith(`:${local}`)) return c;
    const inner = find(c, local);
    if (inner) return inner;
  }
  return null;
}

/** The column of a cell reference ("B3" is 1): the letters before the row number */
function columnOf(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0] ?? '';
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The text of the strings of the workbook, as Excel writes them in sharedStrings.xml */
function sharedStrings(xml: string | undefined): string[] {
  if (xml === undefined) return [];
  const parsed = parseXml(xml);
  if (!parsed.ok) return [];
  return kids(parsed.value, 'si').map(allText);
}

/** The value of one cell: the text of a shared or inline string, or the number as the file has it */
function valueOf(cell: XmlElement, strings: readonly string[]): SheetCell {
  const type = cell.attrs['t'];
  const v = kids(cell, 'v')[0];
  const raw = v ? allText(v) : '';
  if (type === 's') return strings[Number(raw)] ?? '';
  if (type === 'inlineStr') {
    const is = kids(cell, 'is')[0];
    return is ? allText(is) : '';
  }
  if (type === 'str' || type === 'b' || type === 'e') return raw;
  return NUMBER.test(raw) ? { number: raw } : raw;
}

/** The rows of the first sheet of the file */
export async function readXlsx(bytes: Uint8Array): Promise<Result<XlsxSheet, { kind: XlsxProblem }>> {
  const zip = await readZip(bytes);
  if (!zip.ok) return err(zip.error);
  const files = zip.value;

  const book = files.get('xl/workbook.xml');
  const relsXml = files.get('xl/_rels/workbook.xml.rels');
  if (!book || !relsXml) return err({ kind: 'noSheet' });
  const workbook = parseXml(new TextDecoder().decode(book));
  const rels = parseXml(new TextDecoder().decode(relsXml));
  if (!workbook.ok || !rels.ok) return err({ kind: 'noSheet' });

  const sheetEl = find(workbook.value, 'sheet');
  const rid = sheetEl ? Object.entries(sheetEl.attrs).find(([k]) => k === 'r:id' || k.endsWith(':id'))?.[1] : undefined;
  const relation = kids(rels.value, 'Relationship').find((r) => r.attrs['Id'] === rid);
  const target = relation?.attrs['Target'];
  if (target === undefined) return err({ kind: 'noSheet' });
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const sheetBytes = files.get(path);
  if (!sheetBytes) return err({ kind: 'noSheet' });

  const sheet = parseXml(new TextDecoder().decode(sheetBytes));
  if (!sheet.ok) return err({ kind: 'invalid' });
  const data = find(sheet.value, 'sheetData');
  const sst = files.get('xl/sharedStrings.xml');
  const strings = sharedStrings(sst ? new TextDecoder().decode(sst) : undefined);

  const rows: SheetCell[][] = [];
  for (const row of data ? kids(data, 'row') : []) {
    const cells = kids(row, 'c');
    if (cells.length === 0) continue;
    const line: SheetCell[] = [];
    for (const cell of cells) {
      const col = columnOf(cell.attrs['r'] ?? '');
      if (col < 0 || col >= CSV_LIMITS.columns) return err({ kind: 'tooManyColumns' });
      while (line.length <= col) line.push('');
      line[col] = valueOf(cell, strings);
    }
    if (line.some((c) => (typeof c === 'string' ? c : c.number).length > CSV_LIMITS.cellLength)) return err({ kind: 'cellTooLong' });
    rows.push(line);
  }
  if (rows.length > CSV_LIMITS.rows + 1) return err({ kind: 'tooManyRows' });
  return ok({ rows });
}
