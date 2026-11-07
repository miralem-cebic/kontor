// The global search (F11): the records of the open company as entries for src/domain/search.ts. A deleted record is
// never found. Invoices are found by their number, as well as by their customer, subject and line names.

import type { ContactId, DocumentId } from '../data/ids';
import type { ContactFile, DocumentFile, ExpenseFile, ItemFile } from '../data/types';
import { isInvoice } from '../data/types';
import type { SearchEntry } from '../domain/search';
import { t } from '../i18n';

const joined = (...parts: string[]): string => parts.filter((p) => p !== '').join(' · ');

/** The contacts, items, quotes, invoices and expenses of the open company, without the deleted ones */
export function buildSearchEntries(
  contacts: ReadonlyMap<ContactId, ContactFile>,
  items: ReadonlyMap<string, ItemFile>,
  documents: ReadonlyMap<DocumentId, DocumentFile>,
  expenses: ReadonlyMap<string, ExpenseFile>,
): SearchEntry[] {
  const entries: SearchEntry[] = [];

  for (const c of contacts.values()) {
    if (c.deletedAt) continue;
    entries.push({
      kind: 'contact',
      id: c.id,
      title: c.name,
      detail: joined(c.customerNumber, c.address?.city ?? ''),
      date: '',
      fields: [c.name, c.nameLine2, c.contactPerson, c.customerNumber, c.address?.city ?? '', c.contact.email, c.contact.phone, c.vatId, c.notes],
    });
  }

  for (const i of items.values()) {
    if (i.deletedAt) continue;
    entries.push({ kind: 'item', id: i.id, title: i.name, detail: joined(i.number, i.description), date: '', fields: [i.number, i.name, i.description] });
  }

  for (const d of documents.values()) {
    if (d.deletedAt) continue;
    // an issued document says whom it was made out to; a draft shows the contact as it is now
    const customer = d.issued ? d.issued.snapshot.customer.name : (contacts.get(d.customerId)?.name ?? '');
    const number = d.issued?.number ?? '';
    const lineNames = d.lines.map((l) => l.name);
    if (isInvoice(d)) {
      entries.push({
        kind: 'invoice',
        id: d.id,
        title: number || t('invoices.draft'),
        detail: joined(customer, d.subject),
        date: d.date,
        fields: [number, customer, d.subject, d.orderReference, d.cancels?.number ?? '', ...lineNames],
      });
    } else {
      entries.push({
        kind: 'quote',
        id: d.id,
        title: number || t('quotes.draft'),
        detail: joined(customer, d.subject),
        date: d.date,
        fields: [number, customer, d.subject, ...lineNames],
      });
    }
  }

  for (const e of expenses.values()) {
    if (e.deletedAt) continue;
    entries.push({
      kind: 'expense',
      id: e.id,
      title: e.supplier,
      detail: joined(e.category, e.reference),
      date: e.date,
      fields: [e.supplier, e.reference, e.category, e.note],
    });
  }
  return entries;
}
