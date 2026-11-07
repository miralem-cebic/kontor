import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildOverview } from '../../src/app/overview';
import { buildReports } from '../../src/app/reports';
import { makeContact, makeExpense, makeInvoice } from '../../src/data/schema';
import type { ContactFile, DocumentFile, ExpenseFile, InvoiceFile } from '../../src/data/types';
import type { ContactId, DocumentId } from '../../src/data/ids';
import { vatStatusAt, type VatStatusPoint } from '../../src/domain/vatStatus';
import { cents } from '../../src/domain/money';
import { usePrefs } from '../../src/store/prefs';
import { fcParams, sampleCompany, sampleContact, sampleExpense, sampleInvoice, sampleIssued } from './fixtures';

beforeEach(() => usePrefs.setState({ language: 'de' }));

const REGULAR = { kind: 'regular' as const, method: 'cash' as const, period: 'quarterly' as const, permanentExtension: false };
const SMALL = { kind: 'smallBusiness' as const };
const withVat = (vat: typeof REGULAR | typeof SMALL) => ({ ...sampleCompany(), tax: { ...sampleCompany().tax, vat } });
const ACCOUNT_ID = sampleCompany().bank.defaultAccountId;

const point = (date: string, smallBusiness: boolean): VatStatusPoint => ({ date, issuedAt: `${date}T10:00:00.000Z`, smallBusiness });

describe('vatStatusAt: the VAT status that was valid on a day (#70)', () => {
  it('takes the status of the last invoice issued on or before the day', () => {
    const status = vatStatusAt([point('2025-03-01', false), point('2026-02-01', true)], true);
    expect(status('2025-06-10')).toBe(false);
    expect(status('2025-12-31')).toBe(false);
    expect(status('2026-02-01')).toBe(true);
    expect(status('2026-05-05')).toBe(true);
  });

  it('takes the first known status for a day before the first invoice', () => {
    expect(vatStatusAt([point('2025-03-01', false)], true)('2024-01-01')).toBe(false);
  });

  it('after the last invoice, keeps its status in that calendar year and takes the status of the company from the next year on', () => {
    const status = vatStatusAt([point('2025-03-01', false)], true);
    expect(status('2025-11-20')).toBe(false);
    expect(status('2026-01-02')).toBe(true);
  });

  it('takes the status of the company when there is no invoice at all', () => {
    expect(vatStatusAt([], true)('2025-06-10')).toBe(true);
    expect(vatStatusAt([], false)('2025-06-10')).toBe(false);
  });

  it('does not depend on the order of the invoices', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 700 }), fc.boolean()), { maxLength: 8 }), fc.integer({ min: 0, max: 900 }), fc.boolean(), (list, day, current) => {
        const iso = (n: number) => new Date(Date.UTC(2025, 0, 1 + n)).toISOString().slice(0, 10);
        const points = list.map(([n, small]) => point(iso(n), small));
        const a = vatStatusAt(points, current)(iso(day));
        const b = vatStatusAt([...points].reverse(), current)(iso(day));
        // two invoices of one day with different statuses are ordered by the time of issue, which is the same here: skip them
        const sameDay = new Set(points.map((p) => p.date)).size !== points.length;
        if (!sameDay) expect(b).toBe(a);
      }),
      fcParams,
    );
  });
});

describe('switching the VAT status does not change the figures of an earlier year (#70)', () => {
  const customer: ContactFile = makeContact(sampleContact({ name: 'Kunde GmbH', customerNumber: 'K-1001' }));
  const contacts = new Map<ContactId, ContactFile>([[customer.id, customer]]);
  const NOW = new Date(2026, 10, 7);

  const issue = (number: string, date: string, small: boolean): InvoiceFile => ({
    ...makeInvoice(customer.id, ACCOUNT_ID, sampleInvoice({ date }), null),
    issued: sampleIssued(number, { snapshot: { ...sampleIssued().snapshot, company: { ...sampleIssued().snapshot.company, tax: { ...sampleIssued().snapshot.company.tax, vat: small ? SMALL : REGULAR } } } }),
  });
  const docs = (...list: DocumentFile[]): Map<DocumentId, DocumentFile> => new Map(list.map((d) => [d.id, d]));
  const expenses = (...list: ExpenseFile[]) => new Map(list.map((e) => [e.id, e]));

  // regular in 2025, small business from 2026: an invoice of each year, and an expense of 119.00 € with 19 % VAT in 2025
  const a = issue('RE-2025-0001', '2025-03-10', false);
  const b = issue('RE-2026-0001', '2026-03-10', true);
  const e2025 = makeExpense(sampleExpense({ date: '2025-06-10', gross: cents(11_900) }));
  const e2026 = makeExpense(sampleExpense({ date: '2026-06-10', gross: cents(11_900) }));

  it('the expense of 2025 counts without VAT after the company changed to small business, the one of 2026 counts gross', () => {
    const company = withVat(SMALL);
    const view = buildReports(company, contacts, docs(a, b), new Map(), expenses(e2025, e2026), new Map(), 2025, NOW)!;
    expect(view.expenses.total).toBe(10_000);
    expect(view.comparison.current.expenses).toBe(10_000);
    const view26 = buildReports(company, contacts, docs(a, b), new Map(), expenses(e2025, e2026), new Map(), 2026, NOW)!;
    expect(view26.expenses.total).toBe(11_900);
    expect(view26.comparison.previous.expenses).toBe(10_000);
  });

  it('the figures of 2025 are the same before and after the switch', () => {
    const before = buildReports(withVat(REGULAR), contacts, docs(a), new Map(), expenses(e2025), new Map(), 2025, NOW)!;
    const after = buildReports(withVat(SMALL), contacts, docs(a, b), new Map(), expenses(e2025), new Map(), 2025, NOW)!;
    expect(after.expenses.total).toBe(before.expenses.total);
    expect(after.comparison.current).toEqual(before.comparison.current);
  });

  it('the overview counts an expense with the status of its day: gross in 2026, without VAT in 2025', () => {
    expect(buildOverview(withVat(SMALL), docs(a, b), new Map(), expenses(e2025, e2026), new Map(), NOW)!.figures.expenses).toBe(11_900);
    // as it was seen in November 2025, with the company switched already (and the first invoice of the new status in the data)
    expect(buildOverview(withVat(SMALL), docs(a, b), new Map(), expenses(e2025, e2026), new Map(), new Date(2025, 10, 7))!.figures.expenses).toBe(10_000);
  });

  it('an expense of a year without invoices counts with the status of the company today', () => {
    const lone = makeExpense(sampleExpense({ date: '2026-02-02', gross: cents(11_900) }));
    expect(buildOverview(withVat(SMALL), docs(), new Map(), expenses(lone), new Map(), NOW)!.figures.expenses).toBe(11_900);
    expect(buildOverview(withVat(REGULAR), docs(), new Map(), expenses(lone), new Map(), NOW)!.figures.expenses).toBe(10_000);
  });
});
