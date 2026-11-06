// The Excel export (F37): a sheet of the table in an .xlsx file (SpreadsheetML in a ZIP). Text is written as inline text,
// so a text that starts with "=" stays text (the formula protection of the roadmap); amounts are numbers with two
// decimals; dates are dates; rates and counts are plain numbers. The file has one sheet, named "Liste".

import { escapeXml } from '../import/xml';
import type { Cell } from './csv';
import { writeZip, type ZipEntry } from './zip';

/** The table of a list: the header line and the rows (the same shape as the CSV export) */
export interface XlsxSheet {
  header: readonly string[];
  rows: readonly (readonly Cell[])[];
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** The styles of the cells: 0 text and plain numbers, 1 a date (yyyy-mm-dd), 2 an amount (#,##0.00) */
const STYLE = { text: 0, date: 1, amount: 2 } as const;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Liste" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`;

/** The column letters of a 0-based column: 0 is A, 26 is AA */
export function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Excel's serial number of an ISO date (days since 30 December 1899); null for a text that is not a date */
export function excelSerial(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/** The text as XML holds it; control characters that XML cannot hold are dropped (escapeXml) */
const text = (value: string): string => escapeXml(value);

/** One cell of a row, at its reference (A1 style) */
function cellXml(ref: string, cell: Cell): string {
  if (typeof cell === 'string') {
    // an empty text is written too, so that every row has its cells
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text(cell)}</t></is></c>`;
  }
  if ('date' in cell) {
    const serial = excelSerial(cell.date);
    return serial === null ? `<c r="${ref}" t="inlineStr"><is><t>${text(cell.date)}</t></is></c>` : `<c r="${ref}" s="${STYLE.date}"><v>${serial}</v></c>`;
  }
  // an amount has a decimal comma; a rate or a count does not
  const value = Number(cell.number.replace(',', '.'));
  if (!Number.isFinite(value) || /[^0-9,.-]/.test(cell.number)) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text(cell.number)}</t></is></c>`;
  return `<c r="${ref}" s="${cell.number.includes(',') ? STYLE.amount : STYLE.text}"><v>${value}</v></c>`;
}

/** The sheet part: every row, and within it every cell with its reference */
function sheetXml(sheet: XlsxSheet): string {
  const rows: readonly (readonly Cell[])[] = [sheet.header, ...sheet.rows];
  const body = rows
    .map((row, r) => {
      const cells = row.map((cell, c) => cellXml(`${columnName(c)}${r + 1}`, cell)).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${NS}"><sheetData>${body}</sheetData></worksheet>`;
}

/** The bytes of an .xlsx file with the table as its one sheet */
export async function tableToXlsx(sheet: XlsxSheet): Promise<Uint8Array> {
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: new TextEncoder().encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: new TextEncoder().encode(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: new TextEncoder().encode(WORKBOOK) },
    { name: 'xl/_rels/workbook.xml.rels', data: new TextEncoder().encode(WORKBOOK_RELS) },
    { name: 'xl/styles.xml', data: new TextEncoder().encode(STYLES) },
    { name: 'xl/worksheets/sheet1.xml', data: new TextEncoder().encode(sheetXml(sheet)) },
  ];
  return writeZip(entries);
}
