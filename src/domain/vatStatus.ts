// The VAT status of the business on a given day (small business or regular VAT), for the figures that depend on it but
// have no record of their own: an expense carries no snapshot, so the company in company.json (which has only today's
// status and no history) cannot tell what was valid when it was paid. The issued invoices can: each carries the company
// as it was when it was issued. The status of a day is therefore taken from the invoices around it. Pure.
//
// Limit: the date of a change is not stored, only the first invoice issued with the new status shows it. A day between
// two invoices of different status counts with the earlier one, and a day after the last invoice with its status in the
// same calendar year (a change takes effect on 1 January in the usual case, § 19 UStG), with the status of the company
// today in a later year. The exact change date would need a history in company.json (a schema change).

/** The status an issued invoice was issued with, on the day it was dated */
export interface VatStatusPoint {
  /** The invoice date, YYYY-MM-DD */
  date: string;
  /** When it was issued (ISO timestamp); decides between two invoices of one day */
  issuedAt: string;
  smallBusiness: boolean;
}

/** The function that tells, for a day (YYYY-MM-DD), whether the business was a small business. `current` is the status today. */
export function vatStatusAt(points: readonly VatStatusPoint[], current: boolean): (date: string) => boolean {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date) || a.issuedAt.localeCompare(b.issuedAt));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return () => current;
  return (date) => {
    if (date < first.date) return first.smallBusiness;
    if (date > last.date && date.slice(0, 4) !== last.date.slice(0, 4)) return current;
    // the last point on or before the day (binary search: there can be thousands of invoices)
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((sorted[mid] as VatStatusPoint).date <= date) lo = mid;
      else hi = mid - 1;
    }
    return (sorted[lo] as VatStatusPoint).smallBusiness;
  };
}
