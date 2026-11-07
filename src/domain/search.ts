// The global search (F11): one text finds contacts, items, quotes, invoices (by number) and expenses. Pure: the caller
// maps the records into entries with the fields to search; this module only matches and orders them.

export type SearchKind = 'invoice' | 'quote' | 'contact' | 'item' | 'expense';

/** A record as the search sees it */
export interface SearchEntry {
  kind: SearchKind;
  /** The ID of the record */
  id: string;
  /** What the result is called, for example the invoice number or the name of the contact */
  title: string;
  /** A second line that tells records apart, for example the customer and the subject */
  detail: string;
  /** The date of the record (YYYY-MM-DD), used to put the newest first; empty for none */
  date: string;
  /** The texts that are searched */
  fields: readonly string[];
}

export interface SearchResult {
  /** The first hits, at most the limit */
  hits: SearchEntry[];
  /** All hits */
  total: number;
}

/** A query shorter than this finds nothing: one letter would match almost everything */
export const MIN_SEARCH_LENGTH = 2;

/** The order in which the kinds are listed */
const KIND_ORDER: Record<SearchKind, number> = { invoice: 0, quote: 1, contact: 2, item: 3, expense: 4 };

const fold = (text: string): string => text.toLocaleLowerCase('de');

/**
 * The entries that contain every word of the query (case does not matter) in one of their fields, by kind and then the
 * newest first. The query is plain text, never a pattern.
 */
export function searchEntries(entries: readonly SearchEntry[], query: string, limit = 50): SearchResult {
  const text = fold(query.trim());
  if (text.length < MIN_SEARCH_LENGTH) return { hits: [], total: 0 };
  const words = text.split(/\s+/);
  const hits = entries
    .filter((e) => {
      const haystack = e.fields.map(fold).join('\n');
      return words.every((w) => haystack.includes(w));
    })
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'de'));
  return { hits: hits.slice(0, Math.max(0, limit)), total: hits.length };
}
