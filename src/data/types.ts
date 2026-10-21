// File formats of the company folder (see DEVELOPMENT.md, "Data format").

import type { CompanyProfile } from '../domain/company';
import type { ContactProfile } from '../domain/contact';
import { keysOf, type CompanyId, type ContactId } from './ids';

/**
 * Fields that are merged one by one when two devices changed company.json: the newer `fieldUpdatedAt` wins.
 * Every field of the profile is listed; the compiler fails when a new profile field is missing here.
 */
const MERGEABLE: Record<keyof CompanyProfile, true> = {
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
export type MergeableField = keyof CompanyProfile;

/** company.json */
export interface CompanyFile extends CompanyProfile {
  schemaVersion: number;
  id: CompanyId;
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

/** What a backup holds */
export interface BackupSnapshot {
  company: CompanyFile;
  contacts: readonly ContactFile[];
}

/** backups/<YYYY-MM-DD>.json: the state of the company folder on that day */
export interface BackupFile extends BackupSnapshot {
  schemaVersion: number;
  createdAt: string;
}
