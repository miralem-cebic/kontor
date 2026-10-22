// File formats of the company folder (see DEVELOPMENT.md, "Data format").

import type { AccountDetails } from '../domain/bankAccount';
import type { CompanyProfile } from '../domain/company';
import type { ContactProfile } from '../domain/contact';
import type { ItemProfile } from '../domain/item';
import { keysOf, type AccountId, type CompanyId, type ContactId, type ItemId } from './ids';

/**
 * An account in company.json. Payments will refer to it by its ID, so removing it is a soft delete: it stays in
 * the list, hidden in the app.
 */
export type BankAccount = AccountDetails & { id: AccountId; deletedAt: string | null };

/**
 * company.json `bank`: the accounts and the default for new invoices, which is always an active account.
 * The whole list is one mergeable field: when two devices change accounts at the same time, the later change wins.
 */
export interface Banking {
  defaultAccountId: AccountId;
  accounts: readonly BankAccount[];
}

export type MergeableField = keyof CompanyProfile | 'bank';

/**
 * Fields that are merged one by one when two devices changed company.json: the newer `fieldUpdatedAt` wins.
 * Every field of the profile is listed; the compiler fails when a new profile field is missing here.
 */
const MERGEABLE: Record<MergeableField, true> = {
  name: true,
  owner: true,
  address: true,
  contact: true,
  logo: true,
  tax: true,
  bank: true,
  invoiceDefaults: true,
};
export const MERGEABLE_FIELDS = keysOf(MERGEABLE);

/** company.json */
export interface CompanyFile extends CompanyProfile {
  schemaVersion: number;
  id: CompanyId;
  bank: Banking;
  createdAt: string;
  /** Time of the last change per field; set by every change (store/appStore.ts) */
  fieldUpdatedAt: Partial<Record<MergeableField, string>>;
}

/** Contact fields merged one by one; `deletedAt` is one of them, so a deletion survives edits made elsewhere. */
const CONTACT_MERGEABLE: Record<keyof ContactProfile | 'deletedAt', true> = {
  kind: true,
  roles: true,
  name: true,
  nameLine2: true,
  contactPerson: true,
  customerNumber: true,
  address: true,
  contact: true,
  vatId: true,
  leitwegId: true,
  orderReference: true,
  paymentTermDays: true,
  notes: true,
  deletedAt: true,
};
export const CONTACT_MERGEABLE_FIELDS = keysOf(CONTACT_MERGEABLE);
export type ContactMergeableField = keyof ContactProfile | 'deletedAt';

/** contacts/<id>.json */
export interface ContactFile extends ContactProfile {
  schemaVersion: number;
  id: ContactId;
  createdAt: string;
  /** Soft delete: a deleted contact stays in its file and is hidden in the app */
  deletedAt: string | null;
  fieldUpdatedAt: Partial<Record<ContactMergeableField, string>>;
}

/** Item fields merged one by one; like contacts, a deletion survives edits made elsewhere */
const ITEM_MERGEABLE: Record<keyof ItemProfile | 'deletedAt', true> = {
  number: true,
  name: true,
  description: true,
  unit: true,
  netPrice: true,
  vatRate: true,
  deletedAt: true,
};
export const ITEM_MERGEABLE_FIELDS = keysOf(ITEM_MERGEABLE);
export type ItemMergeableField = keyof ItemProfile | 'deletedAt';

/** items/<id>.json: an item or service of the catalogue */
export interface ItemFile extends ItemProfile {
  schemaVersion: number;
  id: ItemId;
  createdAt: string;
  /** Soft delete: a deleted item stays in its file and is hidden in the app */
  deletedAt: string | null;
  fieldUpdatedAt: Partial<Record<ItemMergeableField, string>>;
}

/** What a backup holds */
export interface BackupSnapshot {
  company: CompanyFile;
  contacts: readonly ContactFile[];
  items: readonly ItemFile[];
}

/** backups/<YYYY-MM-DD>.json: the state of the company folder on that day */
export interface BackupFile extends BackupSnapshot {
  schemaVersion: number;
  createdAt: string;
}
