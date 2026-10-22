import type { AccountDetails } from '../domain/bankAccount';
import type { CompanyProfile } from '../domain/company';
import type { ContactProfile } from '../domain/contact';
import type { ItemProfile } from '../domain/item';
import { stampNow } from './clock';
import { newAccountId, newCompanyId, newContactId, newItemId } from './ids';
import {
  CONTACT_MERGEABLE_FIELDS,
  ITEM_MERGEABLE_FIELDS,
  MERGEABLE_FIELDS,
  type BankAccount,
  type CompanyFile,
  type ContactFile,
  type ContactMergeableField,
  type ItemFile,
  type ItemMergeableField,
  type MergeableField,
} from './types';

/** Version of every file in the company folder. Increase it for every change of a file format (see migrations.ts). */
export const SCHEMA_VERSION = 2;

export const nowIso = (): string => stampNow();

/** A new company file with its first account as the default. Every field counts as changed at creation time. */
export function makeCompany(profile: CompanyProfile, account: AccountDetails): CompanyFile {
  const at = nowIso();
  const fieldUpdatedAt: Partial<Record<MergeableField, string>> = {};
  for (const f of MERGEABLE_FIELDS) fieldUpdatedAt[f] = at;
  const first = makeAccount(account);
  return { schemaVersion: SCHEMA_VERSION, id: newCompanyId(), ...profile, bank: { defaultAccountId: first.id, accounts: [first] }, createdAt: at, fieldUpdatedAt };
}

/** A new account of a company */
export const makeAccount = (details: AccountDetails): BankAccount => ({ id: newAccountId(), ...details, deletedAt: null });

/** A new contact file. Every field counts as changed at creation time. */
export function makeContact(profile: ContactProfile): ContactFile {
  const at = nowIso();
  const fieldUpdatedAt: Partial<Record<ContactMergeableField, string>> = {};
  for (const f of CONTACT_MERGEABLE_FIELDS) fieldUpdatedAt[f] = at;
  return { schemaVersion: SCHEMA_VERSION, id: newContactId(), ...profile, createdAt: at, deletedAt: null, fieldUpdatedAt };
}

/** A new item of the catalogue. Every field counts as changed at creation time. */
export function makeItem(profile: ItemProfile): ItemFile {
  const at = nowIso();
  const fieldUpdatedAt: Partial<Record<ItemMergeableField, string>> = {};
  for (const f of ITEM_MERGEABLE_FIELDS) fieldUpdatedAt[f] = at;
  return { schemaVersion: SCHEMA_VERSION, id: newItemId(), ...profile, createdAt: at, deletedAt: null, fieldUpdatedAt };
}
