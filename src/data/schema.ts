import type { AccountDetails } from '../domain/bankAccount';
import type { CompanyProfile } from '../domain/company';
import type { ContactProfile } from '../domain/contact';
import { cancellationContent, type InvoiceContent, type IssuedInfo } from '../domain/invoice';
import type { ItemProfile } from '../domain/item';
import type { QuoteContent } from '../domain/quote';
import { stampNow } from './clock';
import { newAccountId, newCompanyId, newContactId, newDocumentId, newItemId, type AccountId, type ContactId, type DocumentId } from './ids';
import {
  CONTACT_MERGEABLE_FIELDS,
  INVOICE_MERGEABLE_FIELDS,
  ITEM_MERGEABLE_FIELDS,
  MERGEABLE_FIELDS,
  QUOTE_MERGEABLE_FIELDS,
  type BankAccount,
  type CompanyFile,
  type ContactFile,
  type ContactMergeableField,
  type InvoiceFile,
  type InvoiceMergeableField,
  type ItemFile,
  type ItemMergeableField,
  type MergeableField,
  type QuoteFile,
  type QuoteMergeableField,
} from './types';

/** Version of every file in the company folder. Increase it for every change of a file format (see migrations.ts). */
export const SCHEMA_VERSION = 5;

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

/** A new quote. Every field counts as changed at creation time. */
export function makeQuote(customerId: ContactId, content: QuoteContent): QuoteFile {
  const at = nowIso();
  const fieldUpdatedAt: Partial<Record<QuoteMergeableField, string>> = {};
  for (const f of QUOTE_MERGEABLE_FIELDS) fieldUpdatedAt[f] = at;
  return { schemaVersion: SCHEMA_VERSION, id: newDocumentId(), kind: 'quote', customerId, ...content, createdAt: at, deletedAt: null, fieldUpdatedAt };
}

/** A new invoice draft, made from a quote or not. Every field counts as changed at creation time. */
export function makeInvoice(customerId: ContactId, accountId: AccountId, content: InvoiceContent, quoteId: DocumentId | null): InvoiceFile {
  const at = nowIso();
  const fieldUpdatedAt: Partial<Record<InvoiceMergeableField, string>> = {};
  for (const f of INVOICE_MERGEABLE_FIELDS) fieldUpdatedAt[f] = at;
  return { schemaVersion: SCHEMA_VERSION, id: newDocumentId(), kind: 'invoice', customerId, accountId, quoteId, ...content, issued: null, cancels: null, createdAt: at, deletedAt: null, fieldUpdatedAt };
}

/**
 * The cancellation of an issued invoice, dated `today` (cancellationContent); `id` is its cancellationId. The issue
 * flow gives it its number at once (app/issue.ts).
 */
export function makeCancellation(original: InvoiceFile & { issued: IssuedInfo }, today: string, id: DocumentId): InvoiceFile {
  const at = nowIso();
  const fieldUpdatedAt: Partial<Record<InvoiceMergeableField, string>> = {};
  for (const f of INVOICE_MERGEABLE_FIELDS) fieldUpdatedAt[f] = at;
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    kind: 'invoice',
    customerId: original.customerId,
    accountId: original.accountId,
    quoteId: null,
    ...cancellationContent(original, today),
    issued: null,
    cancels: { id: original.id, number: original.issued.number, date: original.date },
    createdAt: at,
    deletedAt: null,
    fieldUpdatedAt,
  };
}
