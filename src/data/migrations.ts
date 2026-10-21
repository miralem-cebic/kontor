import { SCHEMA_VERSION } from './schema';
import { InvalidRecordError, isRecord, validateCompany } from './validate';
import type { CompanyFile } from './types';

// Migration layer: every file is upgraded to SCHEMA_VERSION when it is read, then validated.
// New format version: increase SCHEMA_VERSION and add a step { from: n, up } for every file kind
// (a kind whose format did not change gets `unchanged(n)`). See CLAUDE.md, "Schema changes".

export type FileKind = 'company';

export interface Migration {
  from: number;
  up: (raw: Record<string, unknown>) => Record<string, unknown>;
}

/** A step for a file kind whose format did not change in this version */
export const unchanged = (from: number): Migration => ({ from, up: (raw) => raw });

/** Version 1 is the first format: no steps yet. */
export const MIGRATIONS: Record<FileKind, readonly Migration[]> = {
  company: [],
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
export function migrate(kind: FileKind, raw: unknown): CompanyFile {
  const doc = upgrade(kind, raw);
  try {
    return validateCompany(doc, kind);
  } catch (e) {
    if (e instanceof InvalidRecordError) throw new InvalidFileError(e.message);
    throw e;
  }
}
