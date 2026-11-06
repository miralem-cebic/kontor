// Rules for importing contacts and items from a file (roadmap I3, I7): which column of the file is which field, how the
// words of a file become the values the forms use, and the checks of the forms for every row. The checks are the forms'
// own (readContact, readItem), so an imported row is as valid as a typed one. Pure: the caller reads the file.

import { err, ok, type Result } from '../data/result';
import { readContact, type ContactDraft, type ContactProfile, type ContactRoles } from './contact';
import { readItem, type ItemProfile } from './item';
import { DEFAULT_COUNTRY, type FieldProblem } from './check';
import type { BasisPoints, MoneyLocale } from './money';
import { DEFAULT_UNIT, UNITS, type UnitCode } from './units';
import { isVatRate, STANDARD_RATE } from './vat';
import { nextFreeNumber } from './numbering';

export type ImportKind = 'contacts' | 'items';

export const CONTACT_IMPORT_FIELDS = ['name', 'customerNumber', 'kind', 'roles', 'email', 'phone', 'street', 'postalCode', 'city', 'country', 'vatId', 'leitwegId', 'notes'] as const;
export const ITEM_IMPORT_FIELDS = ['number', 'name', 'description', 'unit', 'netPrice', 'vatRate'] as const;

export type ContactImportField = (typeof CONTACT_IMPORT_FIELDS)[number];
export type ItemImportField = (typeof ITEM_IMPORT_FIELDS)[number];
export type ImportField = ContactImportField | ItemImportField;

/** The values of one row, by field: the text of the mapped column, or '' when the field is not mapped */
export type ContactRowValues = Record<ContactImportField, string>;
export type ItemRowValues = Record<ItemImportField, string>;

/** Which column holds which field: the index of the column; a field without a column is missing */
export type Mapping = Partial<Record<ImportField, number>>;

/** The problems only the import has: a value of the file that the forms do not know, as a word */
export const IMPORT_ONLY_PROBLEMS = ['kindUnknown', 'rolesUnknown', 'unitUnknown', 'vatRateUnknown'] as const;
export type ImportOnlyProblem = (typeof IMPORT_ONLY_PROBLEMS)[number];
export const isImportOnlyProblem = (p: ImportProblem): p is ImportOnlyProblem => (IMPORT_ONLY_PROBLEMS as readonly string[]).includes(p);

/** A problem of a row: the field it is about, and what is wrong with it. The forms' problems come first, the import's own last. */
export type ImportProblem = FieldProblem | ImportOnlyProblem;
export interface RowProblem {
  field: string;
  problem: ImportProblem;
}

/** Lower case, without spaces and punctuation, and "ß" as "ss", so that "Straße", "Strasse" and "STRASSE" match */
const normalize = (text: string): string => text.trim().toLocaleLowerCase('de').replace(/ß/g, 'ss').replace(/[\s.\-_()/]/g, '');

/** The headers a column can have for each field, normalized; the first column that fits wins */
const ALIASES: Record<ImportField, readonly string[]> = {
  name: ['name', 'firma', 'firmenname', 'kunde', 'kundenname', 'bezeichnung'],
  customerNumber: ['kundennummer', 'kundennr', 'customernumber'],
  kind: ['art', 'typ', 'type', 'kind'],
  roles: ['rollen', 'rolle', 'roles', 'role'],
  email: ['email', 'mail', 'emailadresse'],
  phone: ['telefon', 'telefonnummer', 'phone', 'tel'],
  street: ['strasse', 'street', 'anschrift'],
  postalCode: ['plz', 'postleitzahl', 'postalcode', 'zip'],
  city: ['ort', 'stadt', 'city'],
  country: ['land', 'country'],
  vatId: ['ustidnr', 'ustid', 'umsatzsteuerid', 'vatid'],
  leitwegId: ['leitwegid'],
  notes: ['notizen', 'notiz', 'notes', 'note'],
  number: ['artikelnummer', 'artikelnr', 'nr', 'nummer', 'number', 'itemnumber'],
  description: ['beschreibung', 'description'],
  unit: ['einheit', 'unit'],
  netPrice: ['nettopreis', 'preis', 'price', 'netprice'],
  vatRate: ['ustsatz', 'umsatzsteuer', 'vatrate', 'ust', 'mwst'],
};

/** The columns that fit the fields of a kind. A column is used for one field only. */
export function suggestMapping(kind: ImportKind, header: readonly string[]): Mapping {
  const fields: readonly ImportField[] = kind === 'contacts' ? CONTACT_IMPORT_FIELDS : ITEM_IMPORT_FIELDS;
  const used = new Set<number>();
  const mapping: Mapping = {};
  for (const field of fields) {
    const index = header.findIndex((h, i) => !used.has(i) && ALIASES[field].includes(normalize(h)));
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }
  return mapping;
}

/** A kind of contact: a company (the default for an empty cell) or a private person */
export function parseKind(text: string): ContactDraft['kind'] | null {
  const n = text.trim().toLocaleLowerCase('de');
  if (n === '') return 'company';
  if (['company', 'firma', 'unternehmen', 'organisation', 'organization', 'firma oder organisation'].includes(n)) return 'company';
  if (['person', 'privat', 'privatperson', 'private person'].includes(n)) return 'person';
  return null;
}

/** The roles of a contact: a customer when the cell is empty, both when it names both */
export function parseRoles(text: string): ContactRoles | null {
  const n = text.trim().toLocaleLowerCase('de');
  if (n === '') return { customer: true, supplier: false };
  const customer = /kunde|customer/.test(n);
  const supplier = /lieferant|supplier/.test(n);
  if (!customer && !supplier) return null;
  return { customer, supplier };
}

/** A VAT rate as a file writes it: "19", "19 %", "7,0"; an empty cell is the standard rate. Only the rates the app offers. */
export function parseVatRate(text: string): BasisPoints | null {
  const v = text.replace(/%/g, '').replace(/\s/g, '').replace(',', '.');
  if (v === '') return STANDARD_RATE;
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const rate = Math.round(Number(v) * 100);
  return isVatRate(rate) ? rate : null;
}

/** A unit by its code ("HUR") or its label in the interface language ("Stunde"); an empty cell is the default unit */
export function parseUnit(text: string, labelOf: (code: UnitCode) => string): UnitCode | null {
  const key = text.trim().toLocaleLowerCase('de');
  if (key === '') return DEFAULT_UNIT;
  const byCode = UNITS.find((u) => u.toLocaleLowerCase('de') === key);
  if (byCode) return byCode;
  return UNITS.find((u) => labelOf(u).trim().toLocaleLowerCase('de') === key) ?? null;
}

/**
 * A contact from one row, checked like a typed one. A row without a customer number gets none here: the caller gives
 * it the next free number of the pattern before it calls this (as the form does for a new contact).
 */
export function readContactRow(values: ContactRowValues, isNumberTaken: (customerNumber: string) => boolean): Result<ContactProfile, RowProblem[]> {
  const problems: RowProblem[] = [];
  const kind = parseKind(values.kind);
  if (kind === null) problems.push({ field: 'kind', problem: 'kindUnknown' });
  const roles = parseRoles(values.roles);
  if (roles === null) problems.push({ field: 'roles', problem: 'rolesUnknown' });
  const draft: ContactDraft = {
    kind: kind ?? 'company',
    customer: roles?.customer ?? true,
    supplier: roles?.supplier ?? false,
    name: values.name,
    nameLine2: '',
    contactPerson: '',
    customerNumber: values.customerNumber,
    street: values.street,
    postalCode: values.postalCode,
    city: values.city,
    country: values.country || DEFAULT_COUNTRY,
    email: values.email,
    phone: values.phone,
    vatId: values.vatId,
    leitwegId: values.leitwegId,
    orderReference: '',
    paymentTermDays: '',
    notes: values.notes,
    language: 'de',
  };
  const checked = readContact(draft, isNumberTaken);
  if (!checked.ok) return err([...problems, ...checked.error]);
  return problems.length > 0 ? err(problems) : ok(checked.value);
}

/** An item from one row, checked like a typed one. The price is read in the decimal style the file uses. */
export function readItemRow(values: ItemRowValues, locale: MoneyLocale, labelOf: (code: UnitCode) => string, isNumberTaken: (number: string) => boolean): Result<ItemProfile, RowProblem[]> {
  const problems: RowProblem[] = [];
  const unit = parseUnit(values.unit, labelOf);
  if (unit === null) problems.push({ field: 'unit', problem: 'unitUnknown' });
  const vatRate = parseVatRate(values.vatRate);
  if (vatRate === null) problems.push({ field: 'vatRate', problem: 'vatRateUnknown' });
  const checked = readItem({ number: values.number, name: values.name, description: values.description, unit: unit ?? DEFAULT_UNIT, netPrice: values.netPrice, vatRate: vatRate ?? STANDARD_RATE }, locale, isNumberTaken);
  if (!checked.ok) return err([...problems, ...checked.error]);
  return problems.length > 0 ? err(problems) : ok(checked.value);
}

/** One row of the file after the checks: its line (the header is line 1), the name for the preview, and the outcome */
export interface PlannedRow<P> {
  line: number;
  name: string;
  outcome: Result<P, RowProblem[]>;
}

/** The values of the mapped fields of one row; a field without a column is '' */
function valuesOf<F extends ImportField>(row: readonly string[], mapping: Mapping, fields: readonly F[]): Record<F, string> {
  const out: Partial<Record<F, string>> = {};
  for (const f of fields) {
    const index = mapping[f];
    out[f] = index === undefined ? '' : (row[index] ?? '');
  }
  return out as Record<F, string>;
}

/**
 * The contacts of the rows, checked. A row without a customer number gets the next free number of the pattern, as a new
 * contact does in the form; the number is used up only by a row that is fine, so a refused row leaves it free for the
 * next. `takenNumbers` are the numbers of the contacts that exist; the numbers of the rows before count as taken too.
 */
export function planContactRows(rows: readonly (readonly string[])[], mapping: Mapping, pattern: string | null, takenNumbers: readonly string[]): PlannedRow<ContactProfile>[] {
  const taken = [...takenNumbers];
  return rows.map((row, i) => {
    const values = valuesOf(row, mapping, CONTACT_IMPORT_FIELDS);
    if (values.customerNumber.trim() === '' && pattern !== null) values.customerNumber = nextFreeNumber(pattern, taken) ?? '';
    const outcome = readContactRow(values, (n) => taken.includes(n));
    if (outcome.ok && outcome.value.customerNumber !== '') taken.push(outcome.value.customerNumber);
    return { line: i + 2, name: values.name, outcome };
  });
}

/** The items of the rows, checked; the numbers and the prices as for contacts, with the decimal style of the file */
export function planItemRows(rows: readonly (readonly string[])[], mapping: Mapping, pattern: string | null, takenNumbers: readonly string[], locale: MoneyLocale, labelOf: (code: UnitCode) => string): PlannedRow<ItemProfile>[] {
  const taken = [...takenNumbers];
  return rows.map((row, i) => {
    const values = valuesOf(row, mapping, ITEM_IMPORT_FIELDS);
    if (values.number.trim() === '' && pattern !== null) values.number = nextFreeNumber(pattern, taken) ?? '';
    const outcome = readItemRow(values, locale, labelOf, (n) => taken.includes(n));
    if (outcome.ok && outcome.value.number !== '') taken.push(outcome.value.number);
    return { line: i + 2, name: values.name, outcome };
  });
}

/**
 * The imports that still have records, newest first: each with its ID, how many of its records are still there and
 * when it was made (the earliest of them). Records without a batch, and removed ones, do not count.
 */
export function batchesOf<B extends string>(records: readonly { importBatchId: B | null; createdAt: string; deletedAt: string | null }[]): { id: B; count: number; createdAt: string }[] {
  const byId = new Map<B, { count: number; createdAt: string }>();
  for (const r of records) {
    if (r.importBatchId === null || r.deletedAt !== null) continue;
    const entry = byId.get(r.importBatchId);
    if (!entry) byId.set(r.importBatchId, { count: 1, createdAt: r.createdAt });
    else {
      entry.count += 1;
      if (r.createdAt < entry.createdAt) entry.createdAt = r.createdAt;
    }
  }
  return [...byId.entries()].map(([id, e]) => ({ id, ...e })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
