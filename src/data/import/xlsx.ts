// The Excel import: the first sheet of an .xlsx file as rows of text. Numbers come back as numbers with a decimal point
// (the file's own form); the importer writes them in the decimal style of the chosen language. Shared strings (what
// Excel writes), inline strings and plain text are read. Formulas are read as the values they show.
//
// The file is untrusted, and a sheet that packs well can hold far more rows than a list (#76). So the rows and the shared
// strings are taken one element at a time (`elements`), each parsed on its own and turned into cells at once; the limits
// stop the reading at the first element above them, and no tree of the whole sheet is built.

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

export const XLSX_LIMITS = {
  /** All <row> elements, empty ones included (Excel writes a row of its own height or format without cells) */
  rowElements: 10 * (CSV_LIMITS.rows + 1),
  /** The shared strings: at most one per cell of the largest list */
  strings: (CSV_LIMITS.rows + 1) * CSV_LIMITS.columns,
} as const;

class SheetError extends Error {
  constructor(readonly kind: XlsxProblem) {
    super(kind);
  }
}

/** The start of an element, with its prefix: group 1 is the name as written, group 2 the local name */
const START_TAG = /<((?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*))(?=[\s/>])/y;

/** An end tag, with its prefix: group 1 is the local name */
const END_TAG = /<\/(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\s*>/y;

/**
 * The elements with a local name in the text, as their text, one after the other, without a tree of the whole text:
 * from `from`, up to the end tag of `until` (the element they are in) or the end of the text. Comments, CDATA sections
 * and processing instructions are skipped, so that a tag inside them does not count; the other tags are passed over.
 * These elements do not nest (a row in a row, a string in a string), so the first end tag of the name closes one. What
 * is not well-formed here is `invalid`, when the reading gets to it.
 */
function* elements(text: string, local: string, from = 0, until?: string): Generator<string> {
  let at = from;
  for (;;) {
    const lt = text.indexOf('<', at);
    if (lt < 0) return;
    if (until !== undefined && text.startsWith('</', lt)) {
      END_TAG.lastIndex = lt;
      if (END_TAG.exec(text)?.[1] === until) return;
    }
    const skip = text.startsWith('<!--', lt) ? '-->' : text.startsWith('<![CDATA[', lt) ? ']]>' : text.startsWith('<?', lt) ? '?>' : null;
    if (skip) {
      const end = text.indexOf(skip, lt);
      if (end < 0) throw new SheetError('invalid');
      at = end + skip.length;
      continue;
    }
    START_TAG.lastIndex = lt;
    const m = START_TAG.exec(text);
    if (!m || m[2] !== local) {
      at = lt + 1;
      continue;
    }
    const tagEnd = text.indexOf('>', lt);
    if (tagEnd < 0) throw new SheetError('invalid');
    if (text[tagEnd - 1] === '/') {
      yield text.slice(lt, tagEnd + 1);
      at = tagEnd + 1;
      continue;
    }
    const close = `</${m[1] as string}>`;
    const end = text.indexOf(close, tagEnd);
    if (end < 0) throw new SheetError('invalid');
    yield text.slice(lt, end + close.length);
    at = end + close.length;
  }
}

/** One element taken from the text, parsed on its own */
function parsed(xml: string): XmlElement {
  const r = parseXml(xml);
  if (!r.ok) throw new SheetError('invalid');
  return r.value;
}

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

/** The text of the strings of the workbook, as Excel writes them in sharedStrings.xml, one <si> at a time */
function sharedStrings(xml: string | undefined): string[] {
  if (xml === undefined) return [];
  const strings: string[] = [];
  for (const si of elements(xml, 'si')) {
    if (strings.length >= XLSX_LIMITS.strings) throw new SheetError('tooManyRows');
    strings.push(allText(parsed(si)));
  }
  return strings;
}

/** Where the start tag of the first element with a local name ends (after its `>`), and whether it closes itself; null without one */
function startTagOf(text: string, local: string): { end: number; empty: boolean } | null {
  for (let lt = text.indexOf('<'); lt >= 0; lt = text.indexOf('<', lt + 1)) {
    START_TAG.lastIndex = lt;
    if (START_TAG.exec(text)?.[2] !== local) continue;
    const end = text.indexOf('>', lt);
    return end < 0 ? null : { end: end + 1, empty: text[end - 1] === '/' };
  }
  return null;
}

/** The rows of the sheet with cells, one <row> at a time; the limits stop at the first row above them */
function sheetRows(sheet: string, strings: readonly string[]): SheetCell[][] {
  const data = startTagOf(sheet, 'sheetData');
  if (!data || data.empty) return [];
  const rows: SheetCell[][] = [];
  let rowElements = 0;
  for (const rowXml of elements(sheet, 'row', data.end, 'sheetData')) {
    if (++rowElements > XLSX_LIMITS.rowElements) throw new SheetError('tooManyRows');
    const cells = kids(parsed(rowXml), 'c');
    if (cells.length === 0) continue;
    if (rows.length >= CSV_LIMITS.rows + 1) throw new SheetError('tooManyRows');
    const line: SheetCell[] = [];
    for (const cell of cells) {
      const col = columnOf(cell.attrs['r'] ?? '');
      if (col < 0 || col >= CSV_LIMITS.columns) throw new SheetError('tooManyColumns');
      while (line.length <= col) line.push('');
      line[col] = valueOf(cell, strings);
    }
    if (line.some((c) => (typeof c === 'string' ? c : c.number).length > CSV_LIMITS.cellLength)) throw new SheetError('cellTooLong');
    rows.push(line);
  }
  return rows;
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

  const sst = files.get('xl/sharedStrings.xml');
  try {
    const strings = sharedStrings(sst ? new TextDecoder().decode(sst) : undefined);
    return ok({ rows: sheetRows(new TextDecoder().decode(sheetBytes), strings) });
  } catch (e) {
    if (e instanceof SheetError) return err({ kind: e.kind });
    throw e;
  }
}
