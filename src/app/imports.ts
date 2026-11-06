// Importing contacts and items from a file (roadmap I3, I7): read the file, plan its rows (the mapping, the checks of
// the forms, the numbers), and write the rows that are fine as one batch. A batch is taken back as a whole; the file
// is not changed. The rules are in domain/import.ts, the reading in data/import/; this module connects them to the
// store.

import { parseCsv, type CsvProblem } from '../data/import/csv';
import { readXlsx, type SheetCell, type XlsxProblem } from '../data/import/xlsx';
import { newImportBatchId, type ImportBatchId } from '../data/ids';
import { err, ok, type Result } from '../data/result';
import type { ContactProfile } from '../domain/contact';
import { batchesOf, planContactRows, planItemRows, type ImportKind, type Mapping, type PlannedRow } from '../domain/import';
import type { ItemProfile } from '../domain/item';
import type { MoneyLocale } from '../domain/money';
import { unitText } from '../lib/labels';
import { addContact, addItem, undoContactImport, undoItemImport, useApp } from '../store/appStore';

/** A file as a sheet: the header line as text, and the rows; a number keeps the form the file has (decimal point) */
export interface ImportSheet {
  header: string[];
  rows: SheetCell[][];
}

/** What is wrong with a file that cannot be read */
export type ImportFileProblem = CsvProblem | XlsxProblem;

/** A cell as text: a number in the decimal style of the language the import is made in */
const textOf = (cell: SheetCell, decimal: MoneyLocale): string => {
  if (typeof cell === 'string') return cell;
  return decimal === 'de' ? cell.number.replace('.', ',') : cell.number;
};

/** The planned rows of one kind: every row with its line, its name and its outcome */
export type ImportPlan = { kind: 'contacts'; rows: PlannedRow<ContactProfile>[] } | { kind: 'items'; rows: PlannedRow<ItemProfile>[] };

/**
 * Reads a file of the importer: an Excel file (a ZIP file starts with "PK") or a CSV file. The sheet has the header
 * line as text and the rows.
 */
export async function readImportFile(bytes: Uint8Array): Promise<Result<ImportSheet, { kind: ImportFileProblem }>> {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const x = await readXlsx(bytes);
    if (!x.ok) return err(x.error);
    const [header = [], ...rows] = x.value.rows;
    return ok({ header: header.map((c) => textOf(c, 'en')), rows });
  }
  const r = parseCsv(bytes);
  if (!r.ok) return err(r.error);
  const [header = [], ...rows] = r.value.rows;
  return ok({ header, rows });
}

/**
 * The rows of the sheet, checked against the open company: the customer and item numbers come from its patterns, and
 * the numbers already taken are the active records' ones. Nothing is written.
 */
export function planImport(kind: ImportKind, sheet: ImportSheet, mapping: Mapping, decimal: MoneyLocale): ImportPlan {
  const { company, contacts, items } = useApp.getState();
  const rows = sheet.rows.map((row) => row.map((cell) => textOf(cell, decimal)));
  if (kind === 'contacts') {
    const taken = [...contacts.values()].filter((c) => !c.deletedAt).map((c) => c.customerNumber);
    return { kind, rows: planContactRows(rows, mapping, company?.invoiceDefaults.contactPattern ?? null, taken) };
  }
  const taken = [...items.values()].filter((i) => !i.deletedAt).map((i) => i.number);
  return { kind, rows: planItemRows(rows, mapping, company?.invoiceDefaults.itemPattern ?? null, taken, decimal, unitText) };
}

/** Writes the rows that are fine, as one batch. Returns the batch (null when no row was fine) and the counts. */
export function runImport(plan: ImportPlan): { batch: ImportBatchId | null; imported: number; skipped: number } {
  const batch = newImportBatchId();
  let imported = 0;
  if (plan.kind === 'contacts') {
    for (const row of plan.rows) {
      if (!row.outcome.ok) continue;
      addContact(row.outcome.value, batch);
      imported += 1;
    }
  } else {
    for (const row of plan.rows) {
      if (!row.outcome.ok) continue;
      addItem(row.outcome.value, batch);
      imported += 1;
    }
  }
  return { batch: imported > 0 ? batch : null, imported, skipped: plan.rows.length - imported };
}

/** The imports of a kind that still have records in the open company, newest first */
export function batchesOfKind(kind: ImportKind) {
  const { contacts, items } = useApp.getState();
  return kind === 'contacts' ? batchesOf([...contacts.values()]) : batchesOf([...items.values()]);
}

/** Takes back an import: its records are removed (soft delete). Returns how many were removed. */
export function undoImport(kind: ImportKind, batch: ImportBatchId): number {
  return kind === 'contacts' ? undoContactImport(batch) : undoItemImport(batch);
}
