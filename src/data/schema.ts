import type { CompanyProfile } from '../domain/company';
import type { ContactProfile } from '../domain/contact';
import { stampNow } from './clock';
import { newCompanyId, newContactId } from './ids';
import { CONTACT_MERGEABLE_FIELDS, MERGEABLE_FIELDS, type CompanyFile, type ContactFile, type ContactMergeableField, type MergeableField } from './types';

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

/** A new contact file. Every field counts as changed at creation time. */
export function makeContact(profile: ContactProfile): ContactFile {
  const at = nowIso();
  const fieldUpdatedAt: Partial<Record<ContactMergeableField, string>> = {};
  for (const f of CONTACT_MERGEABLE_FIELDS) fieldUpdatedAt[f] = at;
  return { schemaVersion: SCHEMA_VERSION, id: newContactId(), ...profile, createdAt: at, deletedAt: null, fieldUpdatedAt };
}
