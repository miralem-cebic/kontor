import { DEFAULT_CONTACT_PATTERN, DEFAULT_ITEM_PATTERN, DEFAULT_QUOTE_PATTERN } from '../domain/numbering';
import { SCHEMA_VERSION } from './schema';
import { InvalidRecordError, isRecord, validateCompany, validateContact, validateDocument, validateDunning, validateItem, validateNumbering, validatePayment, validateQuoteStatus, type Check } from './validate';
import type { CompanyFile, ContactFile, DocumentFile, DunningFile, ItemFile, NumberingFile, PaymentFile, QuoteStatusFile } from './types';

// Migration layer: every file is upgraded to SCHEMA_VERSION when it is read, then validated.
// New format version: increase SCHEMA_VERSION and add a step { from: n, up } for every file kind
// (a kind whose format did not change gets `unchanged(n)`). See CLAUDE.md, "Schema changes".

/** The kinds of files and what each one is read as */
interface FileTypes {
  company: CompanyFile;
  contact: ContactFile;
  item: ItemFile;
  document: DocumentFile;
  numbering: NumberingFile;
  payment: PaymentFile;
  dunning: DunningFile;
  quoteStatus: QuoteStatusFile;
}
export type FileKind = keyof FileTypes;

const VALIDATORS: { [K in FileKind]: Check<FileTypes[K]> } = {
  company: validateCompany,
  contact: validateContact,
  item: validateItem,
  document: validateDocument,
  numbering: validateNumbering,
  payment: validatePayment,
  dunning: validateDunning,
  quoteStatus: validateQuoteStatus,
};

export interface Migration {
  from: number;
  up: (raw: Record<string, unknown>) => Record<string, unknown>;
}

/** A step for a file kind whose format did not change in this version */
export const unchanged = (from: number): Migration => ({ from, up: (raw) => raw });

/**
 * Version 2: a company has several accounts. The one bank account of version 1 becomes the first account and the
 * default for invoices. Its ID is fixed, so that two devices that upgrade the same file get the same account.
 */
export const MIGRATED_ACCOUNT_ID = 'account-1';

const severalAccounts: Migration = {
  from: 1,
  up: (raw) => {
    const bank = raw['bank'];
    // anything else than an object stays as it is and fails the validation that follows
    if (!isRecord(bank)) return raw;
    const account = { id: MIGRATED_ACCOUNT_ID, kind: 'bank', name: '', holder: bank['holder'], iban: bank['iban'], bic: bank['bic'], deletedAt: null };
    return { ...raw, bank: { defaultAccountId: MIGRATED_ACCOUNT_ID, accounts: [account] } };
  },
};

/** Version 4: invoices can be issued. A draft of version 3 gets `issued: null`; a quote does not change. */
const invoicesIssued: Migration = {
  from: 3,
  up: (raw) => (raw['kind'] === 'invoice' && !('issued' in raw) ? { ...raw, issued: null } : raw),
};

/** Version 5: invoices can be cancelled. Every invoice of version 4 gets `cancels: null`; a quote does not change. */
const invoicesCancelled: Migration = {
  from: 4,
  up: (raw) => (raw['kind'] === 'invoice' && !('cancels' in raw) ? { ...raw, cancels: null } : raw),
};

/** A company profile of version 5 gets the default quote pattern; anything else stays and is left to the validation */
function withQuotePattern(profile: unknown): unknown {
  if (!isRecord(profile)) return profile;
  const defaults = profile['invoiceDefaults'];
  if (!isRecord(defaults) || 'quotePattern' in defaults) return profile;
  return { ...profile, invoiceDefaults: { ...defaults, quotePattern: DEFAULT_QUOTE_PATTERN } };
}

/** Version 6: quotes get numbers. company.json gets the quote pattern of the settings. */
const quotePattern: Migration = {
  from: 5,
  up: (raw) => withQuotePattern(raw) as Record<string, unknown>,
};

/**
 * Version 6 for documents: a quote of version 5 is a draft (`issued: null`) and a first version (`revises: null`). The
 * company in the snapshot of an issued invoice is a company profile and gets the quote pattern like company.json, so
 * that it is read with the same checks; nothing else of the issued invoice changes, and its PDF is not touched.
 */
const quotesIssued: Migration = {
  from: 5,
  up: (raw) => {
    if (raw['kind'] === 'quote') return { issued: null, revises: null, ...raw };
    const issued = raw['issued'];
    if (!isRecord(issued) || !isRecord(issued['snapshot'])) return raw;
    const snapshot = issued['snapshot'];
    return { ...raw, issued: { ...issued, snapshot: { ...snapshot, company: withQuotePattern(snapshot['company']) } } };
  },
};

/**
 * Version 10: contacts and items get their numbers from a pattern, so company.json has the two patterns. A profile of
 * version 9 gets the defaults; a profile that has them keeps them.
 */
function withNumberPatterns(profile: unknown): unknown {
  if (!isRecord(profile)) return profile;
  const defaults = profile['invoiceDefaults'];
  if (!isRecord(defaults)) return profile;
  if ('contactPattern' in defaults && 'itemPattern' in defaults) return profile;
  return { ...profile, invoiceDefaults: { contactPattern: DEFAULT_CONTACT_PATTERN, itemPattern: DEFAULT_ITEM_PATTERN, ...defaults } };
}

const numberPatterns: Migration = {
  from: 9,
  up: (raw) => withNumberPatterns(raw) as Record<string, unknown>,
};

/**
 * Version 10 for documents: the company in the snapshot of an issued document gets the two patterns like company.json,
 * so that it is read with the same checks. Nothing else of the document changes, and its PDF is not touched.
 */
const snapshotNumberPatterns: Migration = {
  from: 9,
  up: (raw) => {
    const issued = raw['issued'];
    if (!isRecord(issued) || !isRecord(issued['snapshot'])) return raw;
    const snapshot = issued['snapshot'];
    return { ...raw, issued: { ...issued, snapshot: { ...snapshot, company: withNumberPatterns(snapshot['company']) } } };
  },
};

/**
 * Version 12: a quote or an invoice takes off discounts, on its lines and on the whole document (F23). A document of
 * version 11 has none, so its lines and the document get the empty discount. An issued document keeps its snapshot
 * and its PDF, which were made without the discount it does not have.
 */
const documentDiscounts: Migration = {
  from: 11,
  up: (raw) => {
    if (raw['kind'] !== 'quote' && raw['kind'] !== 'invoice') return raw;
    const lines = raw['lines'];
    return {
      ...raw,
      discount: 'discount' in raw ? raw['discount'] : { kind: 'none' },
      lines: Array.isArray(lines) ? lines.map((l: unknown) => (isRecord(l) && !('discount' in l) ? { ...l, discount: { kind: 'none' } } : l)) : lines,
    };
  },
};

/** Version 9: the documents of a contact are made in its language. A contact of version 8 is German, as its documents were. */
const contactLanguage: Migration = {
  from: 8,
  up: (raw) => ('language' in raw ? raw : { ...raw, language: 'de' }),
};

/**
 * Version 9 for documents: the customer in the snapshot of an issued document of version 8 is German, as its PDF was. A
 * draft or a quote has no snapshot and stays; anything else in the snapshot is left to the validation that follows.
 */
const snapshotLanguage: Migration = {
  from: 8,
  up: (raw) => {
    const issued = raw['issued'];
    if (!isRecord(issued) || !isRecord(issued['snapshot'])) return raw;
    const snapshot = issued['snapshot'];
    const customer = snapshot['customer'];
    if (!isRecord(customer) || 'language' in customer) return raw;
    return { ...raw, issued: { ...issued, snapshot: { ...snapshot, customer: { ...customer, language: 'de' } } } };
  },
};

/**
 * Version 1 is the first format; contacts were added in it as a new kind of file. Items and documents (quotes) were
 * added in version 2 as new kinds of file: such a file without a version counts as version 1 like any other, and its
 * format is the same. Version 3 adds invoices as a kind of document; no existing file changes. Version 4 lets
 * invoices be issued and adds the range files (numbering/), a new kind of file. Version 5 adds cancellation invoices.
 * Version 6 gives quotes numbers: they can be finalized and get new versions, and the settings have a quote pattern.
 * Version 7 adds payments, a new kind of file (payments/); no existing file changes.
 * Version 8 adds dunnings, a new kind of file (dunnings/); no existing file changes.
 * Version 9 gives every contact the language of its documents; the customer in an issued document's snapshot gets it too.
 * Version 10 gives contacts and items numbers from a pattern: company.json gets the two patterns, and the company in an
 * issued document's snapshot gets them too.
 * Version 11 adds the decisions of the customer on a quote, a new kind of file (quoteStatus/); no existing file changes.
 * Version 12 adds discounts to quotes and invoices, on their lines and on the whole document; the other files do not change.
 */
export const MIGRATIONS: Record<FileKind, readonly Migration[]> = {
  company: [severalAccounts, unchanged(2), unchanged(3), unchanged(4), quotePattern, unchanged(6), unchanged(7), unchanged(8), numberPatterns, unchanged(10), unchanged(11)],
  contact: [unchanged(1), unchanged(2), unchanged(3), unchanged(4), unchanged(5), unchanged(6), unchanged(7), contactLanguage, unchanged(9), unchanged(10), unchanged(11)],
  item: [unchanged(1), unchanged(2), unchanged(3), unchanged(4), unchanged(5), unchanged(6), unchanged(7), unchanged(8), unchanged(9), unchanged(10), unchanged(11)],
  document: [
    unchanged(1),
    unchanged(2),
    invoicesIssued,
    invoicesCancelled,
    quotesIssued,
    unchanged(6),
    unchanged(7),
    snapshotLanguage,
    snapshotNumberPatterns,
    unchanged(10),
    documentDiscounts,
  ],
  numbering: [unchanged(1), unchanged(2), unchanged(3), unchanged(4), unchanged(5), unchanged(6), unchanged(7), unchanged(8), unchanged(9), unchanged(10), unchanged(11)],
  payment: [unchanged(1), unchanged(2), unchanged(3), unchanged(4), unchanged(5), unchanged(6), unchanged(7), unchanged(8), unchanged(9), unchanged(10), unchanged(11)],
  dunning: [unchanged(1), unchanged(2), unchanged(3), unchanged(4), unchanged(5), unchanged(6), unchanged(7), unchanged(8), unchanged(9), unchanged(10), unchanged(11)],
  quoteStatus: [unchanged(1), unchanged(2), unchanged(3), unchanged(4), unchanged(5), unchanged(6), unchanged(7), unchanged(8), unchanged(9), unchanged(10), unchanged(11)],
};

export class NewerSchemaError extends Error {
  override name = 'NewerSchemaError';
  constructor(
    public readonly kind: FileKind,
    public readonly version: number,
  ) {
    super(`File (${kind}) has schema version ${version}, this app only knows up to ${SCHEMA_VERSION}.`);
  }
}

export class InvalidFileError extends Error {
  override name = 'InvalidFileError';
}

/**
 * Runs the steps of `steps` from the file's version up to `target`. Exported with its parameters so that
 * tests can run a migration step before it becomes part of MIGRATIONS.
 */
export function upgrade(kind: FileKind, raw: unknown, steps: readonly Migration[] = MIGRATIONS[kind], target: number = SCHEMA_VERSION): Record<string, unknown> {
  if (!isRecord(raw)) throw new InvalidFileError(`Invalid ${kind} file`);
  let doc = raw;
  const declared = doc['schemaVersion'];
  if (declared !== undefined && (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 1)) {
    throw new InvalidFileError(`Invalid schema version in ${kind} file`);
  }
  let version = declared ?? 1;
  if (version > target) throw new NewerSchemaError(kind, version);
  while (version < target) {
    const step = steps.find((m) => m.from === version);
    if (!step) throw new InvalidFileError(`No migration for ${kind} from version ${version}`);
    doc = step.up(doc);
    version += 1;
  }
  return { ...doc, schemaVersion: target };
}

/** Reads a file of the given kind: upgrade, then validate. Throws InvalidFileError or NewerSchemaError. */
export function migrate<K extends FileKind>(kind: K, raw: unknown): FileTypes[K] {
  const doc = upgrade(kind, raw);
  try {
    return VALIDATORS[kind](doc, kind);
  } catch (e) {
    if (e instanceof InvalidRecordError) throw new InvalidFileError(e.message);
    throw e;
  }
}
