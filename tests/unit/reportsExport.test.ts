import { beforeEach, describe, expect, it } from 'vitest';
import { encodeCsv } from '../../src/data/export/csv';
import { comparisonTable, expensesCategoryTable, openItemsTable, turnoverTable } from '../../src/app/reportsExport';
import type { Table } from '../../src/app/csvExport';
import type { NamedGroupReport, NamedOpenItemsReport } from '../../src/app/reports';
import { yearComparison } from '../../src/domain/reports';
import { cents } from '../../src/domain/money';
import { usePrefs } from '../../src/store/prefs';

beforeEach(() => usePrefs.setState({ language: 'de' }));

const csvText = (table: Table): string => new TextDecoder().decode(encodeCsv(table.header, table.rows)).replace(/^\uFEFF/, '');
const lines = (table: Table): string[][] => csvText(table).trimEnd().split('\r\n').map((l) => l.split(';'));

const months = (values: Record<number, number>) => Array.from({ length: 12 }, (_, i) => cents(values[i] ?? 0));

const turnover: NamedGroupReport = {
  rows: [
    { key: 'k1', name: 'Kunde GmbH', months: months({ 3: 123_450, 4: 50_000 }), total: cents(173_450) },
    { key: 'k2', name: '=HYPERLINK("http://evil.example")', months: months({ 0: -1_250 }), total: cents(-1_250) },
    { key: '', name: '', months: months({ 5: 100 }), total: cents(100) },
  ],
  months: months({ 0: -1_250, 3: 123_450, 4: 50_000, 5: 100 }),
  total: cents(172_300),
};

describe('turnoverTable', () => {
  it('has the customer, the twelve months and the total, with decimal commas, and a line of sums', () => {
    const rows = lines(turnoverTable(turnover));
    expect(rows[0]).toHaveLength(14);
    expect(rows[0]?.[0]).toBe('Kunde');
    expect(rows[0]?.[1]).toBe('Jan');
    expect(rows[0]?.[13]).toBe('Summe (Schätzung)');
    expect(rows[1]?.slice(0, 1).concat(rows[1]?.slice(4, 6) ?? [], rows[1]?.slice(13) ?? [])).toEqual(['Kunde GmbH', '1234,50', '500,00', '1734,50']);
    expect(rows[3]?.[0]).toBe('Ohne bekannte Rechnung');
    expect(rows[4]?.[0]).toBe('Summe');
    expect(rows[4]?.[13]).toBe('1723,00');
    expect(rows).toHaveLength(5);
  });

  it('protects a customer name that a spreadsheet would read as a formula, and keeps a negative amount a number', () => {
    const rows = lines(turnoverTable(turnover));
    expect(rows[2]?.[0]?.startsWith("\"'=HYPERLINK")).toBe(true);
    expect(rows[2]?.[1]).toBe('-12,50');
  });
});

describe('expensesCategoryTable', () => {
  it('names an expense without a category and adds a line of sums', () => {
    const report: NamedGroupReport = { rows: [{ key: '', name: '', months: months({ 1: 2_000 }), total: cents(2_000) }], months: months({ 1: 2_000 }), total: cents(2_000) };
    const rows = lines(expensesCategoryTable(report));
    expect(rows[0]?.[0]).toBe('Kategorie');
    expect(rows[1]?.[0]).toBe('Ohne Kategorie');
    expect(rows[1]?.[2]).toBe('20,00');
    expect(rows[2]?.[0]).toBe('Summe');
  });
});

describe('openItemsTable', () => {
  const open: NamedOpenItemsReport = {
    items: [{ id: 'r1', number: 'RE-2026-0001', customerId: 'k1', customerName: 'Kunde GmbH', date: '2026-03-10', dueDate: '2026-03-24', gross: cents(11_900), paid: cents(5_950), open: cents(5_950), daysOverdue: 69 }],
    customers: [{ key: 'k1', name: 'Kunde GmbH', count: 1, open: cents(5_950), overdue: cents(5_950), overdueCount: 1 }],
    open: cents(5_950),
    overdue: cents(5_950),
    overdueCount: 1,
  };

  it('has one line per invoice with the dates as dates and the days overdue, and a line of sums', () => {
    const rows = lines(openItemsTable(open));
    expect(rows[0]).toEqual(['Nummer', 'Kunde', 'Datum', 'Fällig am', 'Brutto', 'Bezahlt', 'Offen', 'Tage überfällig']);
    expect(rows[1]).toEqual(['RE-2026-0001', 'Kunde GmbH', '2026-03-10', '2026-03-24', '119,00', '59,50', '59,50', '69']);
    expect(rows[2]).toEqual(['Summe', '', '', '', '', '', '59,50', '']);
  });
});

describe('comparisonTable', () => {
  it('has a line per month and the total, with both years and the change', () => {
    const c = yearComparison({
      year: 2026,
      today: '2026-11-07',
      smallBusiness: true,
      invoices: [{ id: 'r1', number: 'R', customerId: 'k', date: '2026-01-01', issued: true, isCancellation: false, cancelled: false, net: cents(10_000), gross: cents(10_000), dueDate: '2026-01-15' }],
      payments: [{ invoiceId: 'r1', date: '2026-02-03', amount: cents(10_000) }],
      expenses: [{ date: '2025-02-03', gross: cents(4_000), vat: cents(0), category: '' }],
      payouts: [],
    });
    const rows = lines(comparisonTable(c));
    expect(rows[0]).toEqual(['Monat', 'Einnahmen (netto) 2026', 'Einnahmen (netto) 2025', 'Ausgaben (netto) 2026', 'Ausgaben (netto) 2025', 'Überschuss (Schätzung) 2026', 'Überschuss (Schätzung) 2025']);
    expect(rows[2]).toEqual(['Februar', '100,00', '0,00', '0,00', '40,00', '100,00', '-40,00']);
    expect(rows).toHaveLength(1 + 12 + 2);
    expect(rows[13]).toEqual(['Summe', '100,00', '0,00', '0,00', '40,00', '100,00', '-40,00']);
    expect(rows[14]).toEqual(['Veränderung', '100,00', '', '-40,00', '', '140,00', '']);
  });
});
