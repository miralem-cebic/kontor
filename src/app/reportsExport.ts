// The reports (F11) as CSV for spreadsheets. They use the encoder, the number format and the download of the list
// exports (src/app/csvExport.ts, src/data/export/csv.ts), so a name that starts with `=`, `+`, `-` or `@` is written as
// text there. Each report is one table: a header line, the rows and a line of sums.

import { date, encodeCsv, num, type Cell } from '../data/export/csv';
import { fmt, t } from '../i18n';
import { saveFile } from '../lib/browser';
import type { ComparisonReport } from '../domain/reports';
import type { Cents } from '../domain/money';
import { amount, type Table } from './csvExport';
import type { NamedGroupReport, NamedOpenItemsReport, ReportsView } from './reports';

export type ReportKind = 'turnover' | 'expenses' | 'open' | 'comparison';

const monthName = (year: number, index: number, pattern: 'LLL' | 'LLLL'): string => fmt(new Date(year, index, 1), pattern);

/** The rows of a group report: the name, the twelve months and the total; then the sums */
function groupTable(report: NamedGroupReport, year: number, firstColumn: string, nameOf: (name: string) => string): Table {
  const months = Array.from({ length: 12 }, (_, i) => monthName(year, i, 'LLL'));
  const row = (label: string, values: readonly Cents[], total: Cents): Cell[] => [label, ...values.map(amount), amount(total)];
  return {
    header: [firstColumn, ...months, t('reports.totalEstimate')],
    rows: [...report.rows.map((r) => row(nameOf(r.name), r.months, r.total)), row(t('reports.total'), report.months, report.total)],
  };
}

/** Income per customer and month */
export const turnoverTable = (report: NamedGroupReport, year = 2000): Table => groupTable(report, year, t('reports.customer'), (name) => name || t('reports.unknownCustomer'));

/** Expenses per category and month */
export const expensesCategoryTable = (report: NamedGroupReport, year = 2000): Table => groupTable(report, year, t('reports.category'), (name) => name || t('reports.uncategorized'));

/** The open invoices, oldest due date first, and the sum of what is open */
export function openItemsTable(report: NamedOpenItemsReport): Table {
  return {
    header: [t('reports.col.number'), t('reports.customer'), t('reports.col.date'), t('reports.col.due'), t('reports.col.gross'), t('reports.col.paid'), t('reports.col.open'), t('reports.col.daysOverdue')],
    rows: [
      ...report.items.map((i): Cell[] => [i.number, i.customerName || t('reports.unknownCustomer'), date(i.date), date(i.dueDate), amount(i.gross), amount(i.paid), amount(i.open), num(String(i.daysOverdue))]),
      [t('reports.total'), '', '', '', '', '', amount(report.open), ''],
    ],
  };
}

/** Income, expenses and surplus of both years per month, the sums and the change */
export function comparisonTable(c: ComparisonReport): Table {
  const label = (key: 'reports.col.income' | 'reports.col.expenses' | 'reports.col.surplus', year: number) => t('reports.colYear', { label: t(key), year });
  return {
    header: [
      t('overview.colMonth'),
      label('reports.col.income', c.year),
      label('reports.col.income', c.previousYear),
      label('reports.col.expenses', c.year),
      label('reports.col.expenses', c.previousYear),
      label('reports.col.surplus', c.year),
      label('reports.col.surplus', c.previousYear),
    ],
    rows: [
      ...c.months.map((m): Cell[] => [monthName(c.year, m.month - 1, 'LLLL'), amount(m.income), amount(m.previousIncome), amount(m.expenses), amount(m.previousExpenses), amount(m.profit), amount(m.previousProfit)]),
      [t('reports.total'), amount(c.current.income), amount(c.previous.income), amount(c.current.expenses), amount(c.previous.expenses), amount(c.current.profit), amount(c.previous.profit)],
      [t('reports.change'), amount(c.change.income), '', amount(c.change.expenses), '', amount(c.change.profit), ''],
    ],
  };
}

/** The table of one report of the view */
export function reportTable(kind: ReportKind, view: ReportsView): Table {
  switch (kind) {
    case 'turnover':
      return turnoverTable(view.turnover, view.year);
    case 'expenses':
      return expensesCategoryTable(view.expenses, view.year);
    case 'open':
      return openItemsTable(view.open);
    case 'comparison':
      return comparisonTable(view.comparison);
  }
}

/** Saves one report as a CSV file through the browser's download. The name says the report and its year (the day, for the open items). */
export function exportReportCsv(kind: ReportKind, view: ReportsView): void {
  const table = reportTable(kind, view);
  const stamp = kind === 'open' ? view.today : String(view.year);
  saveFile(encodeCsv(table.header, table.rows), `kontor-${kind}-${stamp}.csv`, 'text/csv');
}
