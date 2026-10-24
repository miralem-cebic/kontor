import {
  CONTACT_MERGEABLE_FIELDS,
  INVOICE_MERGEABLE_FIELDS,
  ITEM_MERGEABLE_FIELDS,
  MERGEABLE_FIELDS,
  QUOTE_MERGEABLE_FIELDS,
  type CompanyFile,
  type ContactFile,
  type DocumentFile,
  type ItemFile,
} from './types';

// Field-level merge of a file that two devices changed: each field keeps the value with the newer
// `fieldUpdatedAt`. On a tie the local value wins. Fields that only the remote file has (from the same format
// version) are kept.

interface Stamped<F extends string> {
  fieldUpdatedAt: Partial<Record<F, string>>;
}

function mergeFields<F extends string, T extends Stamped<F> & Record<F, unknown>>(local: T, remote: T, fields: readonly F[]): T {
  const out: T = { ...remote, ...local, fieldUpdatedAt: { ...local.fieldUpdatedAt } };
  for (const f of fields) {
    const l = local.fieldUpdatedAt[f] ?? '';
    const r = remote.fieldUpdatedAt[f] ?? '';
    if (r > l) {
      out[f] = remote[f];
      out.fieldUpdatedAt[f] = r;
    }
  }
  return out;
}

export const mergeCompany = (local: CompanyFile, remote: CompanyFile): CompanyFile => mergeFields(local, remote, MERGEABLE_FIELDS);

/** A deletion is a field like any other: it wins over an older edit, and an edit made after it does not undo it. */
export const mergeContact = (local: ContactFile, remote: ContactFile): ContactFile => mergeFields(local, remote, CONTACT_MERGEABLE_FIELDS);

export const mergeItem = (local: ItemFile, remote: ItemFile): ItemFile => mergeFields(local, remote, ITEM_MERGEABLE_FIELDS);

/**
 * Quotes and invoices have their own fields. A quote and an invoice are never the same record (the repository
 * refuses to merge them, see FsRepository.saveDocument); should they meet here anyway, the local one is kept.
 * An issued invoice is never merged: the issued one wins as a whole (ADR 0004). Two issued invoices with different
 * numbers are a conflict the repository stops at; here the remote one is kept.
 */
export function mergeDocument(local: DocumentFile, remote: DocumentFile): DocumentFile {
  switch (local.kind) {
    case 'quote':
      return remote.kind === 'quote' ? mergeFields(local, remote, QUOTE_MERGEABLE_FIELDS) : local;
    case 'invoice':
      if (remote.kind !== 'invoice') return local;
      if (remote.issued) return remote;
      if (local.issued) return local;
      return mergeFields(local, remote, INVOICE_MERGEABLE_FIELDS);
  }
}

export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
