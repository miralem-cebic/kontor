// Versions of quotes (F22): a finalized quote never changes; a change is a new version that replaces it. Every version
// keeps the number of the first one with its version as a suffix ("AN-2026-0012-2"). This module numbers versions,
// lists what changed between two of them, finds the versions of a quote and counts how often quotes are changed.

import type { DocumentLine } from './document';

/** The number of a version: the first number of the quote with the version as a suffix */
export const versionNumber = (firstNumber: string, version: number): string => `${firstNumber}-${version}`;

/* ---------- What changed ---------- */

/** The fields of a line that can change between versions; a line with another name is another line */
export type LineChangeField = 'description' | 'quantity' | 'unit' | 'unitPrice' | 'vatRate';
const LINE_CHANGE_FIELDS: readonly LineChangeField[] = ['description', 'quantity', 'unit', 'unitPrice', 'vatRate'];

export type LineChange =
  | { kind: 'added'; line: DocumentLine }
  | { kind: 'removed'; line: DocumentLine }
  | { kind: 'changed'; before: DocumentLine; after: DocumentLine; fields: LineChangeField[] };

/**
 * What changed in the lines from one version to the next. Lines are matched by their name, lines of the same name in
 * their order; the order of the lines alone is no change. The result follows the lines of the new version, then the
 * lines that were removed.
 */
export function lineChanges(before: readonly DocumentLine[], after: readonly DocumentLine[]): LineChange[] {
  const unmatched = [...before];
  const changes: LineChange[] = [];
  for (const line of after) {
    const i = unmatched.findIndex((b) => b.name === line.name);
    if (i < 0) {
      changes.push({ kind: 'added', line });
      continue;
    }
    const [old] = unmatched.splice(i, 1);
    if (!old) continue;
    const fields = LINE_CHANGE_FIELDS.filter((f) => old[f] !== line[f]);
    if (fields.length > 0) changes.push({ kind: 'changed', before: old, after: line, fields });
  }
  return [...changes, ...unmatched.map((line): LineChange => ({ kind: 'removed', line }))];
}

/* ---------- Versions of a quote ---------- */

/** What the versions of quotes are found by; a quote file has these fields */
export interface VersionInfo {
  id: string;
  customerId: string;
  deletedAt: string | null;
  /** null for a draft */
  issued: { number: string } | null;
  /** The quote this version replaces; null for a first version */
  revises: { id: string } | null;
}

/** The next version of a quote: a finalized one wins over a draft (two devices made one each), a deleted draft is none */
function successor<Q extends VersionInfo>(quotes: readonly Q[], id: string): Q | undefined {
  const next = quotes.filter((q) => !q.deletedAt && q.revises?.id === id);
  return next.find((q) => q.issued) ?? next[0];
}

/**
 * The versions of the quote `id` belongs to, from the first to the latest. The files may come from another device, so a
 * loop of references ends the chain instead of running forever.
 */
export function versionChain<Q extends VersionInfo>(quotes: readonly Q[], id: string): Q[] {
  const byId = new Map(quotes.map((q) => [q.id, q]));
  let first = byId.get(id);
  if (!first) return [];
  const seen = new Set([first.id]);
  for (let prev = first.revises && byId.get(first.revises.id); prev && !seen.has(prev.id); prev = prev.revises && byId.get(prev.revises.id)) {
    seen.add(prev.id);
    first = prev;
  }
  const chain = [first];
  for (let next = successor(quotes, first.id); next && !chain.includes(next); next = successor(quotes, next.id)) chain.push(next);
  return chain;
}

/** Is there another finalized version of the quote that `q` replaces? Then `q` cannot be finalized any more. */
export const replacedAlready = (quotes: readonly VersionInfo[], q: VersionInfo): boolean =>
  !!q.revises && quotes.some((o) => o.id !== q.id && !o.deletedAt && !!o.issued && o.revises?.id === q.revises?.id);

export interface ChangeStats {
  /** Finalized quotes, each counted once with all its versions */
  total: number;
  /** Those of them with at least one finalized later version */
  changed: number;
  /** Finalized later versions: how often the quotes were changed */
  changes: number;
}

/** How often finalized quotes were changed; for one customer, pass that customer's quotes */
export function changeStats(quotes: readonly VersionInfo[]): ChangeStats {
  const stats: ChangeStats = { total: 0, changed: 0, changes: 0 };
  for (const q of quotes) {
    if (!q.issued || q.revises || q.deletedAt) continue;
    const later = versionChain(quotes, q.id)
      .slice(1)
      .filter((v) => v.issued).length;
    stats.total += 1;
    if (later > 0) stats.changed += 1;
    stats.changes += later;
  }
  return stats;
}
