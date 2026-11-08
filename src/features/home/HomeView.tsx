import { useMemo } from 'react';
import { buildOverview } from '../../app/overview';
import { currentLang, fmt, t, type MessageKey } from '../../i18n';
import { formatCents } from '../../domain/money';
import type { LimitWarning } from '../../domain/smallBusiness';
import type { Cents } from '../../domain/money';
import { useApp } from '../../store/appStore';
import { formatDate } from '../documents/common';
import { LoadIssuesNotice } from '../shell/LoadIssuesNotice';

// The overview ("Wo stehe ich?"): what came in and went out in this calendar year on the cash basis, what is open, the
// months, and the small business limits. Every figure is an estimate for orientation (the note says so).

function Figure({ label, value, hint }: { label: MessageKey; value: Cents; hint: MessageKey }) {
  const lang = currentLang();
  return (
    <section className="card overview-figure" aria-label={t(label)}>
      <h2>{t(label)}</h2>
      <p className="overview-value">{formatCents(value, lang)}</p>
      <p className="hint">{t(hint)}</p>
    </section>
  );
}

/** The text of the warning about the small business limits */
function warningText(w: LimitWarning, currentLimit: Cents, previousLimit: Cents, turnover: Cents, lang: ReturnType<typeof currentLang>): string {
  switch (w.kind) {
    case 'close':
      return t('smallBusiness.warnClose', { percent: w.percent, limit: formatCents(currentLimit, lang), turnover: formatCents(turnover, lang) });
    case 'crossed':
      return t('smallBusiness.warnCrossed', { limit: formatCents(currentLimit, lang), date: formatDate(w.day) });
    case 'previousYear':
      return t('smallBusiness.warnPreviousYear', { limit: formatCents(previousLimit, lang) });
  }
}

export function HomeView() {
  const company = useApp((s) => s.company);
  const documents = useApp((s) => s.documents);
  const payments = useApp((s) => s.payments);
  const expenses = useApp((s) => s.expenses);
  const payouts = useApp((s) => s.payouts);
  const view = useMemo(() => buildOverview(company, documents, payments, expenses, payouts, new Date()), [company, documents, payments, expenses, payouts]);
  const lang = currentLang();

  if (!view) {
    return (
      <div className="page">
        <header className="top">
          <h1>{t('home.title')}</h1>
        </header>
        <p className="empty">{t('overview.noCompany')}</p>
      </div>
    );
  }

  const { figures, previousTurnover, limits, warning, reverseChargeExpenses } = view;
  const now = new Date();
  const asOf = t('overview.asOf', { year: figures.year, date: fmt(now, 'P') });
  const limitLine = (turnover: Cents, limit: Cents, above: boolean) => `${formatCents(turnover, lang)} ${t('overview.of')} ${formatCents(limit, lang)} ${above ? t('overview.above') : t('overview.below')}`;

  return (
    <div className="page wide">
      <header className="top">
        <h1>{t('home.title')}</h1>
      </header>
      <p className="lead">{asOf}</p>
      <LoadIssuesNotice />

      {warning && (
        <div className="note warn" role="status" aria-label={t('overview.limitsTitle')}>
          <p>{warningText(warning, limits.currentLimit, limits.previousLimit, figures.turnover, lang)}</p>
          <p>{t('smallBusiness.warnScope')}</p>
        </div>
      )}
      {reverseChargeExpenses > 0 && (
        <div className="note warn" role="status">
          <p>{t('smallBusiness.reverseCharge', { n: reverseChargeExpenses })}</p>
        </div>
      )}

      <div className="overview-grid">
        <Figure label="overview.income" value={figures.income} hint="overview.incomeHint" />
        <Figure label="overview.expenses" value={figures.expenses} hint="overview.expensesHint" />
        <Figure label="overview.profit" value={figures.profit} hint="overview.profitHint" />
        <Figure label="overview.open" value={figures.openReceivables} hint="overview.openHint" />
      </div>
      {figures.overdueCount > 0 && (
        <p className="f-error" role="status">
          {t('overview.overdue', { amount: formatCents(figures.overdueReceivables, lang), n: figures.overdueCount })}
        </p>
      )}

      <section className="card" aria-label={t('overview.monthsTitle')}>
        <h2>{t('overview.monthsTitle')}</h2>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('overview.colMonth')}</th>
              <th scope="col" className="num">
                {t('overview.income')}
              </th>
              <th scope="col" className="num">
                {t('overview.expenses')}
              </th>
              <th scope="col" className="num">
                {t('overview.profit')}
              </th>
            </tr>
          </thead>
          <tbody>
            {figures.months.map((m) => (
              <tr key={m.month}>
                <td>{fmt(new Date(figures.year, m.month - 1, 1), 'LLLL')}</td>
                <td className="num">{formatCents(m.income, lang)}</td>
                <td className="num">{formatCents(m.expenses, lang)}</td>
                <td className="num">{formatCents(m.profit, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card" aria-label={t('overview.limitsTitle')}>
        <h2>{t('overview.limitsTitle')}</h2>
        <p>
          <strong>{t('overview.limitPrevious')}</strong>: {limitLine(previousTurnover, limits.previousLimit, limits.previousAbove)}
        </p>
        <p>
          <strong>{t('overview.limitCurrent')}</strong>: {limitLine(figures.turnover, limits.currentLimit, limits.currentAbove)}
        </p>
      </section>

      <p className="disclaimer">{t('overview.note')}</p>
      <p className="disclaimer">{t('disclaimer.text')}</p>
    </div>
  );
}
