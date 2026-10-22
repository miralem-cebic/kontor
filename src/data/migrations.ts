import { SCHEMA_VERSION } from './schema';
import { InvalidRecordError, isRecord, validateCompany, validateContact, type Check } from './validate';
import type { CompanyFile, ContactFile } from './types';

// Migration layer: every file is upgraded to SCHEMA_VERSION when it is read, then validated.
// New format version: increase SCHEMA_VERSION and add a step { from: n, up } for every file kind
// (a kind whose format did not change gets `unchanged(n)`). See CLAUDE.md, "Schema changes".

/** The kinds of files and what each one is read as */
interface FileTypes {
  company: CompanyFile;
  contact: ContactFile;
}
export type FileKind = keyof FileTypes;

const VALIDATORS: { [K in FileKind]: Check<FileTypes[K]> } = { company: validateCompany, contact: validateContact };

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

/** Version 1 is the first format; contacts were added in it as a new kind of file. */
export const MIGRATIONS: Record<FileKind, readonly Migration[]> = {
  company: [severalAccounts],
  contact: [unchanged(1)],
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
