import { useMemo } from 'react';
import { buildOverview } from '../../app/overview';
import { currentLang, fmt, t, type MessageKey } from '../../i18n';
import { formatCents } from '../../domain/money';
import type { Cents } from '../../domain/money';
import { useApp } from '../../store/appStore';

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

export function HomeView() {
  const company = useApp((s) => s.company);
  const documents = useApp((s) => s.documents);
  const payments = useApp((s) => s.payments);
  const expenses = useApp((s) => s.expenses);
  const view = useMemo(() => buildOverview(company, documents, payments, expenses, new Date()), [company, documents, payments, expenses]);
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

  const { figures, previousTurnover, limits } = view;
  const now = new Date();
  const asOf = t('overview.asOf', { year: figures.year, date: fmt(now, 'P') });
  const limitLine = (turnover: Cents, limit: Cents, above: boolean) => `${formatCents(turnover, lang)} ${t('overview.of')} ${formatCents(limit, lang)} ${above ? t('overview.above') : t('overview.below')}`;

  return (
    <div className="page wide">
      <header className="top">
        <h1>{t('home.title')}</h1>
      </header>
      <p className="lead">{asOf}</p>

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
