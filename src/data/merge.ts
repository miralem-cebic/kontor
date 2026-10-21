import { CONTACT_MERGEABLE_FIELDS, MERGEABLE_FIELDS, type CompanyFile, type ContactFile } from './types';

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

export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
