import { useMemo, useState } from 'react';
import { buildUstva, exportUstvaCsv, ustvaCopyValue, ustvaFieldText } from '../../app/ustva';
import { SelectField } from '../../components/Field';
import { isoDateOf, toLocalDate } from '../../domain/dates';
import { cents, formatCents, type Cents } from '../../domain/money';
import { lastCompletedPeriod, wholeEuros, type UstvaField, type UstvaNotice, type UstvaPeriod, type UstvaPeriodKind } from '../../domain/ustva';
import { currentLang, fmt, t, type MessageKey } from '../../i18n';
import { useApp } from '../../store/appStore';
import { copyText } from './copy';

// The advance VAT return as a filling aid (R1): the period, the due date, the fields of the form with a copy button per
// value, what kontor left out and what it assumed. Everything here is an estimate, not tax advice.

const NOTICE_TEXT: Record<UstvaNotice['code'], MessageKey> = {
  supplyUnplaced: 'ustva.notice.supplyUnplaced',
  expenseReverseCharge: 'ustva.notice.expenseReverseCharge',
  expenseThirdCountry: 'ustva.notice.expenseThirdCountry',
};

const NOT_COVERED: readonly MessageKey[] = [
  'ustva.notCovered.rates',
  'ustva.notCovered.reverseCharge',
  'ustva.notCovered.prepayments',
  'ustva.notCovered.refunds',
  'ustva.notCovered.corrections',
  'ustva.notCovered.cashBases',
  'ustva.notCovered.extension',
  'ustva.notCovered.otherCompanies',
  'ustva.notCovered.summaryReport',
];

const ASSUMPTIONS: readonly MessageKey[] = ['ustva.assume.taxFree', 'ustva.assume.inputTax', 'ustva.assume.customerCountry'];

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export function UstvaSection() {
  const company = useApp((s) => s.company);
  const documents = useApp((s) => s.documents);
  const payments = useApp((s) => s.payments);
  const expenses = useApp((s) => s.expenses);
  const today = isoDateOf(new Date());
  const regular = company?.tax.vat.kind === 'regular' ? company.tax.vat : null;
  const [kind, setKind] = useState<UstvaPeriodKind>(regular?.period === 'monthly' ? 'month' : 'quarter');
  const [period, setPeriod] = useState<UstvaPeriod>(() => lastCompletedPeriod(today, kind));
  const result = useMemo(() => buildUstva(company, documents, payments, expenses, period), [company, documents, payments, expenses, period]);

  if (!company) return <p className="empty">{t('overview.noCompany')}</p>;
  if (!regular || !result) {
    return (
      <section className="card" aria-label={t('ustva.title')}>
        <h2>{t('ustva.title')}</h2>
        <div className="note">
          <p>
            <strong>{t('ustva.smallBusiness.title')}</strong>
          </p>
          <p>{t('ustva.smallBusiness.text')}</p>
        </div>
      </section>
    );
  }

  const lang = currentLang();
  const thisYear = new Date().getFullYear();
  const years = range(Math.min(thisYear - 3, period.year), Math.max(thisYear, period.year));
  const changeKind = (next: UstvaPeriodKind) => {
    setKind(next);
    setPeriod(lastCompletedPeriod(today, next));
  };
  const indexOptions =
    period.kind === 'month'
      ? range(1, 12).map((m) => ({ value: String(m), label: fmt(new Date(2000, m - 1, 1), 'LLLL') }))
      : range(1, 4).map((q) => ({ value: String(q), label: t('ustva.period.quarterName', { n: q }) }));

  return (
    <section className="card" aria-label={t('ustva.title')}>
      <h2>{t('ustva.title')}</h2>
      <div className="note">
        <p>{t('ustva.estimate')}</p>
      </div>
      {regular.period === 'yearly' && <p className="f-label">{t('ustva.period.yearlyHint')}</p>}

      <div className="f-row" role="group" aria-label={t('ustva.period.title')}>
        <SelectField<UstvaPeriodKind>
          label={t('ustva.period.kind')}
          value={kind}
          options={[
            { value: 'month', label: t('ustva.period.kindMonth') },
            { value: 'quarter', label: t('ustva.period.kindQuarter') },
          ]}
          onChange={changeKind}
        />
        <SelectField
          label={t('ustva.period.year')}
          value={String(period.year)}
          options={years.map((y) => ({ value: String(y), label: String(y) }))}
          onChange={(y) => setPeriod({ ...period, year: Number(y) })}
        />
        <SelectField
          label={period.kind === 'month' ? t('ustva.period.month') : t('ustva.period.quarter')}
          value={String(period.index)}
          options={indexOptions}
          onChange={(i) => setPeriod({ ...period, index: Number(i) })}
        />
      </div>

      <p>
        <strong>{t('ustva.due', { date: fmt(toLocalDate(result.dueDate), 'P') })}</strong> ({regular.permanentExtension ? t('ustva.dueExtension') : t('ustva.dueNoExtension')}). {t('ustva.dueHint')}
      </p>
      <p>{t(result.method === 'cash' ? 'ustva.method.cash' : 'ustva.method.accrual')}</p>

      <table className="table">
        <caption className="visually-hidden">{t('ustva.tableTitle')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('ustva.col.kz')}</th>
            <th scope="col">{t('ustva.col.description')}</th>
            <th scope="col" className="num">
              {t('ustva.col.base')}
            </th>
            <th scope="col" className="num">
              {t('ustva.col.tax')}
            </th>
          </tr>
        </thead>
        <tbody>
          {result.fields
            .filter((f) => f.shown)
            .map((f) => (
              <FieldRow key={f.id} field={f} lang={lang} />
            ))}
        </tbody>
      </table>
      <p className="f-label">{t('ustva.baseHint')}</p>
      <div className="card-actions">
        <button type="button" className="btn" onClick={() => exportUstvaCsv(result)}>
          {t('ustva.exportCsv')}
        </button>
      </div>

      {result.notices.length > 0 && (
        <div className="note" role="status">
          <p>
            <strong>{t('ustva.notices.title')}</strong>
          </p>
          {result.notices.map((n) => (
            <p key={n.code}>{t(NOTICE_TEXT[n.code], { n: n.count, amount: formatCents(n.amount, lang) })}</p>
          ))}
        </div>
      )}

      <h3>{t('ustva.assumptions.title')}</h3>
      <ul>
        {ASSUMPTIONS.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>

      <h3>{t('ustva.notCovered.title')}</h3>
      <p>{t('ustva.notCovered.intro')}</p>
      <ul>
        {NOT_COVERED.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>
    </section>
  );
}

function FieldRow({ field, lang }: { field: UstvaField; lang: 'de' | 'en' }) {
  return (
    <tr>
      <td>
        <strong>{field.kz}</strong>
      </td>
      <td>{ustvaFieldText(field.id)}</td>
      <td className="num">{field.base !== null && <Value kz={field.kz} what="base" amount={field.base} lang={lang} />}</td>
      <td className="num">{field.tax !== null && <Value kz={field.kz} what="tax" amount={field.tax} lang={lang} />}</td>
    </tr>
  );
}

/** A value of the form with its copy button. A base is shown in whole euros, as the form takes it. */
function Value({ kz, what, amount, lang }: { kz: string; what: 'base' | 'tax'; amount: Cents; lang: 'de' | 'en' }) {
  const copy = ustvaCopyValue(what, amount);
  const shown = what === 'base' ? cents(wholeEuros(amount) * 100) : amount;
  return (
    <span className="ustva-value">
      {formatCents(shown, lang)}
      <button type="button" className="btn sm ghost" aria-label={t(what === 'base' ? 'ustva.copyBase' : 'ustva.copyTax', { kz, value: copy })} onClick={() => void copyText(copy)}>
        {t('ustva.copy')}
      </button>
    </span>
  );
}
