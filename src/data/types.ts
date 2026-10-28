// File formats of the company folder (see DEVELOPMENT.md, "Data format").

import type { AccountDetails } from '../domain/bankAccount';
import type { CompanyProfile } from '../domain/company';
import type { ContactProfile } from '../domain/contact';
import type { InvoiceContent, IssuedInfo } from '../domain/invoice';
import type { ItemProfile } from '../domain/item';
import type { QuoteContent } from '../domain/quote';
import { keysOf, type AccountId, type CompanyId, type ContactId, type DocumentId, type ItemId } from './ids';

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

/** Quote fields merged one by one. The lines are one field: the later change of the lines wins as a whole. */
const QUOTE_MERGEABLE: Record<QuoteMergeableField, true> = {
  customerId: true,
  date: true,
  validUntil: true,
  subject: true,
  introText: true,
  closingText: true,
  lines: true,
  deletedAt: true,
};
export const QUOTE_MERGEABLE_FIELDS = keysOf(QUOTE_MERGEABLE);
export type QuoteMergeableField = keyof QuoteContent | 'customerId' | 'deletedAt';

/**
 * The finalized quote a new version replaces (F22), with its number and date, so that the version says by itself what
 * it replaces. A version is numbered with the first number of the quote and its version: versionNumber(firstNumber,
 * version), for example "AN-2026-0012-2".
 */
export interface RevisedQuote {
  id: DocumentId;
  number: string;
  /** The date of the replaced quote */
  date: string;
  /** The number of the first version of the quote */
  firstNumber: string;
  /** 2 for the first change */
  version: number;
}

/** documents/<id>.json with `kind: 'quote'`: a quote, a draft until it is finalized ("Angebot abschließen") */
export interface QuoteFile extends QuoteContent {
  schemaVersion: number;
  id: DocumentId;
  kind: 'quote';
  /** The customer; the draft shows the contact's current data, a finalized quote its snapshot */
  customerId: ContactId;
  /**
   * null for a draft. Finalizing gives the quote its number from the quote range, a snapshot of the master data and
   * its PDF in documents/quotes/; like an issued invoice it never changes again (ADR 0004). Not a mergeable field.
   */
  issued: IssuedInfo | null;
  /** For a new version: the finalized quote it replaces; null for a first version. Not a mergeable field: it never changes. */
  revises: RevisedQuote | null;
  createdAt: string;
  /** Soft delete: a deleted draft stays in its file and is hidden in the app */
  deletedAt: string | null;
  fieldUpdatedAt: Partial<Record<QuoteMergeableField, string>>;
}

/** Invoice fields merged one by one; like a quote, the lines are one field. The quote it came from does not change. */
const INVOICE_MERGEABLE: Record<InvoiceMergeableField, true> = {
  customerId: true,
  accountId: true,
  date: true,
  service: true,
  paymentTermDays: true,
  taxTreatment: true,
  orderReference: true,
  leitwegId: true,
  subject: true,
  introText: true,
  closingText: true,
  lines: true,
  deletedAt: true,
};
export const INVOICE_MERGEABLE_FIELDS = keysOf(INVOICE_MERGEABLE);
export type InvoiceMergeableField = keyof InvoiceContent | 'customerId' | 'accountId' | 'deletedAt';

/** The invoice a cancellation cancels, with its number and date, so that the cancellation says what it cancels by itself */
export interface CancelledInvoice {
  id: DocumentId;
  number: string;
  /** The date of the cancelled invoice */
  date: string;
}

/** documents/<id>.json with `kind: 'invoice'`: an invoice, a draft until it is issued (ADR 0004) */
export interface InvoiceFile extends InvoiceContent {
  schemaVersion: number;
  id: DocumentId;
  kind: 'invoice';
  /** The customer; like a quote, the draft shows the contact's current data */
  customerId: ContactId;
  /** The account of the company the invoice is paid to; it may have been removed since */
  accountId: AccountId;
  /** The quote the invoice was made from; null when it was written without one */
  quoteId: DocumentId | null;
  /**
   * null for a draft. Once issued, the invoice never changes again: not in the app, not by the merge, and its PDF is
   * never overwritten (ADR 0004). Not a mergeable field: the issued state wins as a whole.
   */
  issued: IssuedInfo | null;
  /**
   * For a cancellation invoice (Stornorechnung): the issued invoice it cancels; null for any other invoice. A
   * cancellation is issued as soon as it is made (app/issue.ts), so it is never a draft. Not a mergeable field.
   */
  cancels: CancelledInvoice | null;
  createdAt: string;
  /** Soft delete: a deleted draft stays in its file and is hidden in the app */
  deletedAt: string | null;
  fieldUpdatedAt: Partial<Record<InvoiceMergeableField, string>>;
}

/** documents/<id>.json: quotes and invoices, told apart by `kind` */
export type DocumentFile = QuoteFile | InvoiceFile;

export const isQuote = (d: DocumentFile): d is QuoteFile => d.kind === 'quote';
export const isInvoice = (d: DocumentFile): d is InvoiceFile => d.kind === 'invoice';

/** What a new version of a finalized quote replaces: that quote, and the next version of the same first number */
export const nextVersionOf = (q: QuoteFile & { issued: IssuedInfo }): RevisedQuote => ({
  id: q.id,
  number: q.issued.number,
  date: q.date,
  firstNumber: q.revises?.firstNumber ?? q.issued.number,
  version: (q.revises?.version ?? 1) + 1,
});

/** The cancellation of an invoice, if it has one */
export function cancellationOf(documents: Iterable<DocumentFile>, id: DocumentId): InvoiceFile | undefined {
  for (const d of documents) if (d.kind === 'invoice' && d.cancels?.id === id) return d;
  return undefined;
}

/**
 * The number ranges: invoices (with their cancellations) and quotes. Each range has its own counters
 * (numbering/<range>.json) and its own folder of PDFs, so the numbers of one range never block the other.
 */
export type NumberRange = 'invoice' | 'quote';
export const NUMBER_RANGES: readonly NumberRange[] = ['invoice', 'quote'];

/** A number given to a document, written before its PDF so that a second writer is noticed (ADR 0004) */
export interface Reservation {
  number: string;
  counterKey: string;
  counter: number;
  documentId: DocumentId;
  /** The browser that reserved it */
  device: string;
  at: string;
}

/** numbering/<range>.json: the highest counter per key and the latest reservations */
export interface NumberingFile {
  schemaVersion: number;
  range: NumberRange;
  /** The highest counter per key ("2026", or "all" for a pattern without year) */
  counters: { key: string; last: number }[];
  /** The latest reservations, newest last; the audit log keeps all of them */
  reservations: Reservation[];
}

interface AuditBase {
  at: string;
  documentId: DocumentId;
  number: string;
  /** The files written, with their SHA-256 */
  files: { file: string; sha256: string }[];
  device: string;
}

/**
 * A line of audit/<YYYY-MM>.jsonl: what happened to a document, appended and never changed. `issue`: an invoice was
 * issued; `cancel`: a cancellation invoice was issued, `cancels` names the invoice it cancels; `issueQuote`: a quote was
 * finalized.
 */
export type AuditEntry =
  | (AuditBase & { action: 'issue' })
  | (AuditBase & { action: 'cancel'; cancels: { documentId: DocumentId; number: string } })
  | (AuditBase & { action: 'issueQuote' });

/** What a backup holds */
export interface BackupSnapshot {
  company: CompanyFile;
  contacts: readonly ContactFile[];
  items: readonly ItemFile[];
  documents: readonly DocumentFile[];
}

/** backups/<YYYY-MM-DD>.json: the state of the company folder on that day */
export interface BackupFile extends BackupSnapshot {
  schemaVersion: number;
  createdAt: string;
}
