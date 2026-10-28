import { DEFAULT_QUOTE_PATTERN } from '../domain/numbering';
import { SCHEMA_VERSION } from './schema';
import { InvalidRecordError, isRecord, validateCompany, validateContact, validateDocument, validateItem, validateNumbering, type Check } from './validate';
import type { CompanyFile, ContactFile, DocumentFile, ItemFile, NumberingFile } from './types';

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
}
export type FileKind = keyof FileTypes;

const VALIDATORS: { [K in FileKind]: Check<FileTypes[K]> } = {
  company: validateCompany,
  contact: validateContact,
  item: validateItem,
  document: validateDocument,
  numbering: validateNumbering,
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
 * Version 6 for documents: a quote of version 5 is a draft (`issued: null`). The company in the snapshot of an issued
 * invoice is a company profile and gets the quote pattern like company.json, so that it is read with the same checks;
 * nothing else of the issued invoice changes, and its PDF is not touched.
 */
const quotesIssued: Migration = {
  from: 5,
  up: (raw) => {
    if (raw['kind'] === 'quote') return 'issued' in raw ? raw : { ...raw, issued: null };
    const issued = raw['issued'];
    if (!isRecord(issued) || !isRecord(issued['snapshot'])) return raw;
    const snapshot = issued['snapshot'];
    return { ...raw, issued: { ...issued, snapshot: { ...snapshot, company: withQuotePattern(snapshot['company']) } } };
  },
};

/**
 * Version 1 is the first format; contacts were added in it as a new kind of file. Items and documents (quotes) were
 * added in version 2 as new kinds of file: such a file without a version counts as version 1 like any other, and its
 * format is the same. Version 3 adds invoices as a kind of document; no existing file changes. Version 4 lets
 * invoices be issued and adds the range files (numbering/), a new kind of file. Version 5 adds cancellation invoices.
 * Version 6 gives quotes numbers: they can be finalized, and the settings have a quote pattern.
 */
export const MIGRATIONS: Record<FileKind, readonly Migration[]> = {
  company: [severalAccounts, unchanged(2), unchanged(3), unchanged(4), quotePattern],
  contact: [unchanged(1), unchanged(2), unchanged(3), unchanged(4), unchanged(5)],
  item: [unchanged(1), unchanged(2), unchanged(3), unchanged(4), unchanged(5)],
  document: [unchanged(1), unchanged(2), invoicesIssued, invoicesCancelled, quotesIssued],
  numbering: [unchanged(1), unchanged(2), unchanged(3), unchanged(4), unchanged(5)],
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
