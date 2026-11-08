import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { buildReports, type NamedGroupReport, type ReportsView as ReportsData } from '../../app/reports';
import { exportReportCsv, type ReportKind } from '../../app/reportsExport';
import { buildSearchEntries } from '../../app/search';
import { SelectField } from '../../components/Field';
import { currentLang, fmt, t, type MessageKey } from '../../i18n';
import type { ComparisonReport } from '../../domain/reports';
import { searchEntries, MIN_SEARCH_LENGTH, type SearchKind } from '../../domain/search';
import { formatCents, type Cents } from '../../domain/money';
import { tabIndexForKey } from '../../lib/tabs';
import { useApp } from '../../store/appStore';
import { formatDate } from '../documents/common';
import { LoadIssuesNotice } from '../shell/LoadIssuesNotice';

// Reports (Auswertungen, F11): the income per customer, the expenses per category, the open items and the year against
// the year before, and a search over all records. Every figure is an estimate for orientation (the note says so); each
// report downloads as CSV. A hit of the search is listed with the kind of record; the views of the records do not open a
// single record from outside, so there is no jump to it.

const TABS: { kind: ReportKind; label: MessageKey }[] = [
  { kind: 'turnover', label: 'reports.tab.turnover' },
  { kind: 'expenses', label: 'reports.tab.expenses' },
  { kind: 'open', label: 'reports.tab.open' },
  { kind: 'comparison', label: 'reports.tab.comparison' },
];

const KIND_LABEL: Record<SearchKind, MessageKey> = {
  contact: 'reports.kind.contact',
  item: 'reports.kind.item',
  quote: 'reports.kind.quote',
  invoice: 'reports.kind.invoice',
  expense: 'reports.kind.expense',
};

/** At most this many hits are listed */
const MAX_HITS = 50;

const money = (c: Cents) => formatCents(c, currentLang());
/** A month without a booking shows a dash, so that the twelve columns stay readable */
const monthCell = (c: Cents) => (c === 0 ? '–' : money(c));

export function ReportsView() {
  const company = useApp((s) => s.company);
  const contacts = useApp((s) => s.contacts);
  const documents = useApp((s) => s.documents);
  const payments = useApp((s) => s.payments);
  const expenses = useApp((s) => s.expenses);
  const payouts = useApp((s) => s.payouts);
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [tab, setTab] = useState<ReportKind>('turnover');
  const tabsId = useId();

  // the tabs pattern: the arrow keys, Home and End select the tab they move to and focus it (only the selected tab is in
  // the Tab order); the report is computed already, so showing it right away costs nothing
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = tabIndexForKey(e.key, TABS.findIndex((x) => x.kind === tab), TABS.length);
    const target = next === null ? undefined : TABS[next];
    if (!target) return;
    e.preventDefault();
    setTab(target.kind);
    document.getElementById(`${tabsId}-${target.kind}`)?.focus();
  };

  const view = useMemo(() => buildReports(company, contacts, documents, payments, expenses, payouts, year, now), [company, contacts, documents, payments, expenses, payouts, year, now]);

  if (!view) {
    return (
      <div className="page">
        <header className="top">
          <h1>{t('reports.title')}</h1>
        </header>
        <p className="empty">{t('overview.noCompany')}</p>
      </div>
    );
  }

  return (
    <div className="page wide">
      <header className="top">
        <h1>{t('reports.title')}</h1>
        <span className="sp" />
        <button type="button" className="btn" onClick={() => exportReportCsv(tab, view)}>
          {t('csv.export')}
        </button>
      </header>

      <LoadIssuesNotice />
      <GlobalSearch />

      <div className="list-tools report-tools">
        <div className="seg" role="tablist" aria-label={t('reports.tabsLabel')} onKeyDown={onTabKey}>
          {TABS.map((x) => (
            <button
              key={x.kind}
              type="button"
              role="tab"
              id={`${tabsId}-${x.kind}`}
              aria-selected={tab === x.kind}
              aria-controls={`${tabsId}-panel`}
              tabIndex={tab === x.kind ? 0 : -1}
              className={tab === x.kind ? 'on' : ''}
              onClick={() => setTab(x.kind)}
            >
              {t(x.label)}
            </button>
          ))}
        </div>
        <span className="sp" />
        {tab !== 'open' && (
          <SelectField
            label={t('reports.year')}
            value={String(year)}
            options={yearOptions(view)}
            onChange={(v) => setYear(Number(v))}
          />
        )}
      </div>

      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
        {tab === 'turnover' && <GroupSection view={view} report={view.turnover} title={t('reports.turnover.title', { year: view.year })} hint={t('reports.turnover.hint')} empty={t('reports.turnover.empty')} firstColumn={t('reports.customer')} nameOf={(n) => n || t('reports.unknownCustomer')} />}
        {tab === 'expenses' && <GroupSection view={view} report={view.expenses} title={t('reports.expenses.title', { year: view.year })} hint={t('reports.expenses.hint')} empty={t('reports.expenses.empty')} firstColumn={t('reports.category')} nameOf={(n) => n || t('reports.uncategorized')} />}
        {tab === 'open' && <OpenSection view={view} />}
        {tab === 'comparison' && <ComparisonSection c={view.comparison} />}
      </div>

      <p className="disclaimer">{t('reports.estimate')}</p>
      <p className="disclaimer">{t('disclaimer.text')}</p>
    </div>
  );
}

/** The selector offers the years with records; the year that is shown stays in it */
function yearOptions(view: ReportsData): { value: string; label: string }[] {
  const years = view.years.includes(view.year) ? view.years : [...view.years, view.year].sort((a, b) => b - a);
  return years.map((y) => ({ value: String(y), label: String(y) }));
}

/* ---------- Income per customer, expenses per category ---------- */

function GroupSection({ view, report, title, hint, empty, firstColumn, nameOf }: { view: ReportsData; report: NamedGroupReport; title: string; hint: string; empty: string; firstColumn: string; nameOf: (name: string) => string }) {
  return (
    <section className="card" aria-label={title}>
      <h2>{title}</h2>
      <p className="muted">{hint}</p>
      {report.rows.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <div className="report-scroll" role="region" aria-label={t('reports.scrollLabel')} tabIndex={0}>
          <table className="table report-table">
            <caption className="visually-hidden">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{firstColumn}</th>
                {Array.from({ length: 12 }, (_, i) => (
                  <th key={i} scope="col" className="num">
                    {fmt(new Date(view.year, i, 1), 'LLL')}
                  </th>
                ))}
                <th scope="col" className="num">
                  {t('reports.totalEstimate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{nameOf(r.name)}</th>
                  {r.months.map((m, i) => (
                    <td key={i} className="num">
                      {monthCell(m)}
                    </td>
                  ))}
                  <td className="num">{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t('reports.total')}</th>
                {report.months.map((m, i) => (
                  <td key={i} className="num">
                    {monthCell(m)}
                  </td>
                ))}
                <td className="num">{money(report.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------- Open items ---------- */

function OpenSection({ view }: { view: ReportsData }) {
  const { open } = view;
  const title = t('reports.open.title', { date: formatDate(view.today) });
  return (
    <>
      <section className="card" aria-label={title}>
        <h2>{title}</h2>
        <p className="muted">{t('reports.open.hint')}</p>
        {open.items.length === 0 ? (
          <p className="empty">{t('reports.open.empty')}</p>
        ) : (
            <div className="report-scroll" role="region" aria-label={t('reports.scrollLabel')} tabIndex={0}>
              <table className="table report-table">
                <caption className="visually-hidden">{t('reports.open.invoices')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('reports.col.number')}</th>
                    <th scope="col">{t('reports.customer')}</th>
                    <th scope="col">{t('reports.col.date')}</th>
                    <th scope="col">{t('reports.col.due')}</th>
                    <th scope="col" className="num">
                      {t('reports.col.gross')}
                    </th>
                    <th scope="col" className="num">
                      {t('reports.col.paid')}
                    </th>
                    <th scope="col" className="num">
                      {t('reports.col.open')}
                    </th>
                    <th scope="col" className="num">
                      {t('reports.col.daysOverdue')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {open.items.map((i) => (
                    <tr key={i.id}>
                      <th scope="row">{i.number}</th>
                      <td>{i.customerName || t('reports.unknownCustomer')}</td>
                      <td>{formatDate(i.date)}</td>
                      <td>{formatDate(i.dueDate)}</td>
                      <td className="num">{money(i.gross)}</td>
                      <td className="num">{money(i.paid)}</td>
                      <td className="num">{money(i.open)}</td>
                      <td className="num">{i.daysOverdue > 0 ? i.daysOverdue : <span className="muted">{t('reports.notOverdue')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={6}>
                      {t('reports.total')}
                    </th>
                    <td className="num">{money(open.open)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
        )}
      </section>

      {open.customers.length > 0 && (
        <section className="card" aria-label={t('reports.open.byCustomer')}>
          <h2>{t('reports.open.byCustomer')}</h2>
          <div className="report-scroll" role="region" aria-label={t('reports.scrollLabel')} tabIndex={0}>
            <table className="table report-table">
              <caption className="visually-hidden">{t('reports.open.byCustomer')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('reports.customer')}</th>
                  <th scope="col" className="num">
                    {t('reports.col.count')}
                  </th>
                  <th scope="col" className="num">
                    {t('reports.col.open')}
                  </th>
                  <th scope="col" className="num">
                    {t('reports.col.overdue')}
                  </th>
                  <th scope="col" className="num">
                    {t('reports.col.overdueCount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {open.customers.map((c) => (
                  <tr key={c.key}>
                    <th scope="row">{c.name || t('reports.unknownCustomer')}</th>
                    <td className="num">{c.count}</td>
                    <td className="num">{money(c.open)}</td>
                    <td className="num">{money(c.overdue)}</td>
                    <td className="num">{c.overdueCount}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{t('reports.total')}</th>
                  <td className="num">{open.items.length}</td>
                  <td className="num">{money(open.open)}</td>
                  <td className="num">{money(open.overdue)}</td>
                  <td className="num">{open.overdueCount}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

/* ---------- The year against the year before ---------- */

function ComparisonSection({ c }: { c: ComparisonReport }) {
  const title = t('reports.comparison.title', { year: c.year, previous: c.previousYear });
  const head = (label: MessageKey, year: number) => t('reports.colYear', { label: t(label), year });
  return (
    <section className="card" aria-label={title}>
      <h2>{title}</h2>
      <p className="muted">{t('reports.comparison.hint')}</p>
      <div className="report-scroll" role="region" aria-label={t('reports.scrollLabel')} tabIndex={0}>
        <table className="table report-table">
          <caption className="visually-hidden">{title}</caption>
          <thead>
            <tr>
              <th scope="col">{t('overview.colMonth')}</th>
              {(['reports.col.income', 'reports.col.expenses', 'reports.col.surplus'] as const).flatMap((label) => [
                <th key={`${label}-${c.year}`} scope="col" className="num">
                  {head(label, c.year)}
                </th>,
                <th key={`${label}-${c.previousYear}`} scope="col" className="num">
                  {head(label, c.previousYear)}
                </th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {c.months.map((m) => (
              <tr key={m.month}>
                <th scope="row">{fmt(new Date(c.year, m.month - 1, 1), 'LLLL')}</th>
                <td className="num">{monthCell(m.income)}</td>
                <td className="num">{monthCell(m.previousIncome)}</td>
                <td className="num">{monthCell(m.expenses)}</td>
                <td className="num">{monthCell(m.previousExpenses)}</td>
                <td className="num">{monthCell(m.profit)}</td>
                <td className="num">{monthCell(m.previousProfit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t('reports.total')}</th>
              <td className="num">{money(c.current.income)}</td>
              <td className="num">{money(c.previous.income)}</td>
              <td className="num">{money(c.current.expenses)}</td>
              <td className="num">{money(c.previous.expenses)}</td>
              <td className="num">{money(c.current.profit)}</td>
              <td className="num">{money(c.previous.profit)}</td>
            </tr>
            <tr>
              <th scope="row">{t('reports.change')}</th>
              <td className="num">{money(c.change.income)}</td>
              <td />
              <td className="num">{money(c.change.expenses)}</td>
              <td />
              <td className="num">{money(c.change.profit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/* ---------- Search ---------- */

function GlobalSearch() {
  const contacts = useApp((s) => s.contacts);
  const items = useApp((s) => s.items);
  const documents = useApp((s) => s.documents);
  const expenses = useApp((s) => s.expenses);
  const [query, setQuery] = useState('');
  const searchId = useId();
  const entries = useMemo(() => buildSearchEntries(contacts, items, documents, expenses), [contacts, items, documents, expenses]);
  const searching = query.trim().length >= MIN_SEARCH_LENGTH;
  const result = useMemo(() => searchEntries(entries, query, MAX_HITS), [entries, query]);

  return (
    <section className="card" role="search">
      <div className="field">
        <label htmlFor={searchId}>{t('reports.search.label')}</label>
        <input id={searchId} className="search-in" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('reports.search.placeholder')} aria-describedby={`${searchId}-hint`} />
        <p id={`${searchId}-hint`} className="muted">
          {t('reports.search.hint')}
        </p>
      </div>
      {searching && (
        <div aria-label={t('reports.search.results')} role="region">
          <p role="status">{result.total === 0 ? t('reports.search.none') : t('reports.search.count', { n: result.total })}</p>
          {result.total > 0 && (
            <div className="report-scroll" role="region" aria-label={t('reports.scrollLabel')} tabIndex={0}>
              <table className="table report-table">
                <caption className="visually-hidden">{t('reports.search.results')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('reports.search.colKind')}</th>
                    <th scope="col">{t('reports.search.colHit')}</th>
                    <th scope="col">{t('reports.search.colDetails')}</th>
                    <th scope="col">{t('reports.search.colDate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.hits.map((h) => (
                    <tr key={`${h.kind}-${h.id}`}>
                      <td>{t(KIND_LABEL[h.kind])}</td>
                      <th scope="row">{h.title}</th>
                      <td>{h.detail}</td>
                      <td>{h.date ? formatDate(h.date) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.total > result.hits.length && <p className="muted">{t('reports.search.more', { shown: result.hits.length, total: result.total })}</p>}
        </div>
      )}
    </section>
  );
}
