import type { CompanyProfile } from '../domain/company';
import { stampNow } from './clock';
import { newCompanyId } from './ids';
import { MERGEABLE_FIELDS, type CompanyFile, type MergeableField } from './types';

/** Version of every file in the company folder. Increase it for every change of a file format (see migrations.ts). */
export const SCHEMA_VERSION = 1;

export const nowIso = (): string => stampNow();

/** A new company file. Every field counts as changed at creation time. */
export function makeCompany(profile: CompanyProfile): CompanyFile {
  const at = nowIso();
  const fieldUpdatedAt: Partial<Record<MergeableField, string>> = {};
  for (const f of MERGEABLE_FIELDS) fieldUpdatedAt[f] = at;
  return { schemaVersion: SCHEMA_VERSION, id: newCompanyId(), ...profile, createdAt: at, fieldUpdatedAt };
}
