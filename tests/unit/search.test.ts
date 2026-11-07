import { describe, expect, it } from 'vitest';
import { MIN_SEARCH_LENGTH, searchEntries, type SearchEntry } from '../../src/domain/search';

const entry = (over: Partial<SearchEntry> & Pick<SearchEntry, 'kind' | 'id'>): SearchEntry => ({ title: over.id, detail: '', date: '', fields: [], ...over });

const ENTRIES: SearchEntry[] = [
  entry({ kind: 'expense', id: 'e1', title: 'Telekom', date: '2026-04-05', fields: ['Telekom', 'Telefon', 'Rechnung 4711'] }),
  entry({ kind: 'invoice', id: 'r1', title: 'RE-2026-0001', date: '2026-03-10', fields: ['RE-2026-0001', 'Kunde GmbH', 'Website-Relaunch'] }),
  entry({ kind: 'invoice', id: 'r2', title: 'RE-2026-0002', date: '2026-05-10', fields: ['RE-2026-0002', 'Müller & Söhne', 'Wartung'] }),
  entry({ kind: 'contact', id: 'k1', title: 'Kunde GmbH', fields: ['Kunde GmbH', 'Berlin', 'einkauf@kunde.example'] }),
  entry({ kind: 'item', id: 'a1', title: 'Webdesign', fields: ['A-1', 'Webdesign', 'Gestaltung nach Aufwand'] }),
  entry({ kind: 'quote', id: 'q1', title: 'AN-2026-0001', date: '2026-02-01', fields: ['AN-2026-0001', 'Kunde GmbH', 'Website-Relaunch'] }),
];

const ids = (query: string, limit?: number) => searchEntries(ENTRIES, query, limit).hits.map((h) => h.id);

describe('searchEntries', () => {
  it('finds nothing for an empty or too short query', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
    expect(MIN_SEARCH_LENGTH).toBe(2);
    expect(ids('k')).toEqual([]);
  });

  it('ignores case and finds part of a word', () => {
    expect(ids('KUNDE')).toEqual(['r1', 'q1', 'k1']);
    expect(ids('tele')).toEqual(['e1']);
  });

  it('finds an invoice by its number, also by the end of it', () => {
    expect(ids('RE-2026-0002')).toEqual(['r2']);
    expect(ids('2026-0001')).toEqual(['r1', 'q1']);
  });

  it('needs every word, in any order, in the fields of the same record', () => {
    expect(ids('relaunch kunde')).toEqual(['r1', 'q1']);
    expect(ids('relaunch berlin')).toEqual([]);
  });

  it('matches umlauts and the German lower case', () => {
    expect(ids('müller')).toEqual(['r2']);
    expect(ids('MÜLLER')).toEqual(['r2']);
  });

  it('orders by kind (invoices, quotes, contacts, items, expenses), then the newest first', () => {
    expect(ids('20')).toEqual(['r2', 'r1', 'q1']);
    // "we" is in the subject of the invoice and the quote ("Website") and in the item ("Webdesign")
    expect(ids('we')).toEqual(['r1', 'q1', 'a1']);
  });

  it('shows at most the limit, and says how many there are in all', () => {
    const result = searchEntries(ENTRIES, '20', 2);
    expect(result.hits.map((h) => h.id)).toEqual(['r2', 'r1']);
    expect(result.total).toBe(3);
  });

  it('does not treat the query as a pattern', () => {
    expect(ids('.*')).toEqual([]);
    expect(ids('(')).toEqual([]);
  });
});
