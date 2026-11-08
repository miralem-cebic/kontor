// The VAT status an expense counts with: the status that was valid on the day it was paid, not the one of the company
// today (#70). An expense has no snapshot, so the status is taken from the issued invoices around its day
// (src/domain/vatStatus.ts has the rule and its limit).

import type { CompanyFile, DocumentFile } from '../data/types';
import { isInvoice } from '../data/types';
import { vatStatusAt, type VatStatusPoint } from '../domain/vatStatus';

/** Whether the business was a small business on a day (YYYY-MM-DD), from the invoices issued and the company today */
export function smallBusinessOn(company: CompanyFile, docs: Iterable<DocumentFile>): (date: string) => boolean {
  const points: VatStatusPoint[] = [];
  for (const d of docs) {
    // a cancellation carries the snapshot of the invoice it cancels, so it says nothing about the day it was made
    if (!isInvoice(d) || d.issued === null || d.cancels !== null) continue;
    points.push({ date: d.date, issuedAt: d.issued.issuedAt, smallBusiness: d.issued.snapshot.company.tax.vat.kind === 'smallBusiness' });
  }
  return vatStatusAt(points, company.tax.vat.kind === 'smallBusiness');
}
