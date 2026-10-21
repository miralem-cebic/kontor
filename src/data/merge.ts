import { MERGEABLE_FIELDS, type CompanyFile, type MergeableField } from './types';

// Field-level merge of company.json: when two devices changed the file, each field keeps the value with the
// newer `fieldUpdatedAt`. On a tie the local value wins. Fields that only the remote file has (from the same format
// version) are kept.

export function mergeCompany(local: CompanyFile, remote: CompanyFile): CompanyFile {
  const out: CompanyFile = { ...remote, ...local, fieldUpdatedAt: { ...local.fieldUpdatedAt } };
  for (const f of MERGEABLE_FIELDS) {
    const l = local.fieldUpdatedAt[f] ?? '';
    const r = remote.fieldUpdatedAt[f] ?? '';
    if (r > l) takeField(out, remote, f);
  }
  return out;
}

function takeField<F extends MergeableField>(target: CompanyFile, source: CompanyFile, field: F) {
  target[field] = source[field];
  const at = source.fieldUpdatedAt[field];
  if (at !== undefined) target.fieldUpdatedAt[field] = at;
}

export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
