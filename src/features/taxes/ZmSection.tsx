import { useMemo, useState } from 'react';
import { buildZm, exportZmCsv, ZM_NOTICE_TEXT, zmCopyValue, zmKindText, zmProblemText } from '../../app/zm';
import { ExternalLink } from '../../components/ExternalLink';
import { SelectField } from '../../components/Field';
import { isoDateOf, toLocalDate } from '../../domain/dates';
import { cents, formatCents } from '../../domain/money';
import { taxParams } from '../../domain/tax/params';
import { lastCompletedPeriod, type UstvaPeriod, type UstvaPeriodKind } from '../../domain/ustva';
import { ZM_PORTAL_URL, zmWholeEuros, type ZmLine } from '../../domain/zm';
import { currentLang, fmt, t } from '../../i18n';
import { useApp } from '../../store/appStore';
import { copyText } from './copy';

// The summary report (ZM, R8) as a filling aid: the period, the due date, one line per recipient VAT ID with a copy button
// per value, the check of the VAT IDs and of Kz 21, and the link to the BZSt portal. A filling aid, not tax advice.

const NOT_COVERED = ['zm.notCovered.other', 'zm.notCovered.annual', 'zm.notCovered.correction', 'zm.notCovered.otherCompanies'] as const;

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export function ZmSection() {
  const company = useApp((s) => s.company);
  const documents = useApp((s) => s.documents);
  const payments = useApp((s) => s.payments);
  const expenses = useApp((s) => s.expenses);
  const today = isoDateOf(new Date());
  const regular = company?.tax.vat.kind === 'regular';
  const [kind, setKind] = useState<UstvaPeriodKind>('quarter');
  const [period, setPeriod] = useState<UstvaPeriod>(() => lastCompletedPeriod(today, 'quarter'));
  const view = useMemo(() => buildZm(company, documents, payments, expenses, period), [company, documents, payments, expenses, period]);

  if (!company) return null;
  if (!regular || !view) {
    return (
      <section className="card" aria-label={t('zm.title')}>
        <h2>{t('zm.title')}</h2>
        <div className="note">
          <p>
            <strong>{t('zm.smallBusiness.title')}</strong>
          </p>
          <p>{t('zm.smallBusiness.text')}</p>
        </div>
      </section>
    );
  }

  const { zm, check } = view;
  const lang = currentLang();
  const thisYear = new Date().getFullYear();
  const years = range(Math.min(thisYear - 3, period.year), Math.max(thisYear, period.year));
  const limit = formatCents(taxParams(period.year).summaryReport.monthlySupplyLimit, lang);
  const changeKind = (next: UstvaPeriodKind) => {
    setKind(next);
    setPeriod(lastCompletedPeriod(today, next));
  };
  const indexOptions =
    period.kind === 'month'
      ? range(1, 12).map((m) => ({ value: String(m), label: fmt(new Date(2000, m - 1, 1), 'LLLL') }))
      : range(1, 4).map((q) => ({ value: String(q), label: t('ustva.period.quarterName', { n: q }) }));

  return (
    <section className="card" aria-label={t('zm.title')}>
      <h2>{t('zm.title')}</h2>
      <div className="note">
        <p>{t('zm.estimate')}</p>
      </div>
      <p>{t('zm.rules')}</p>
      <p className="f-label">{t('zm.periodHint', { limit })}</p>

      <div className="f-row" role="group" aria-label={t('ustva.period.title')}>
        <SelectField<UstvaPeriodKind>
          label={t('ustva.period.kind')}
          value={kind}
          options={[
            { value: 'quarter', label: t('ustva.period.kindQuarter') },
            { value: 'month', label: t('ustva.period.kindMonth') },
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
        <strong>{t('zm.due', { date: fmt(toLocalDate(zm.dueDate), 'P') })}</strong>. {t('zm.dueHint')}
      </p>

      {zm.problems.length > 0 && (
        <div className="note" role="alert">
          <p>
            <strong>{t('zm.problems.title')}</strong>
          </p>
          {zm.problems.map((p) => (
            <p key={`${p.invoiceId}-${p.code}`}>{t('zm.problems.item', { number: p.number, text: zmProblemText(p.code) })}</p>
          ))}
          <p>{t('zm.problems.hint')}</p>
        </div>
      )}

      {zm.lines.length === 0 ? (
        <p className="empty">{t('zm.empty')}</p>
      ) : (
        <>
          <table className="table">
            <caption className="visually-hidden">{t('zm.tableTitle')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('zm.col.country')}</th>
                <th scope="col">{t('zm.col.vatId')}</th>
                <th scope="col">{t('zm.col.kind')}</th>
                <th scope="col" className="num">
                  {t('zm.col.amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {zm.lines.map((line) => (
                <LineRow key={`${line.vatId}-${line.kind}`} line={line} lang={lang} />
              ))}
            </tbody>
          </table>
          <p className="f-label">{t('zm.amountHint')}</p>
          <p>{t('zm.total', { service: formatCents(zm.total.service, lang), supply: formatCents(zm.total.supply, lang) })}</p>
          <div className="card-actions">
            <button type="button" className="btn" onClick={() => exportZmCsv(zm)}>
              {t('zm.exportCsv')}
            </button>
          </div>
        </>
      )}

      {(check || (period.kind === 'month' && zm.lines.length === 0)) && (
        <div className="note" role="status">
          <p>
            <strong>{t('zm.check.title')}</strong>
          </p>
          {check === null ? (
            <p>{t('zm.check.none')}</p>
          ) : check.consistent ? (
            <p>{t('zm.check.ok', { amount: formatCents(check.zm, lang) })}</p>
          ) : (
            <p>{t('zm.check.differs', { zm: formatCents(check.zm, lang), ustva: formatCents(check.ustva, lang), difference: formatCents(check.difference, lang) })}</p>
          )}
        </div>
      )}

      {zm.notices.length > 0 && (
        <div className="note" role="status">
          <p>
            <strong>{t('zm.notices.title')}</strong>
          </p>
          {zm.notices.map((n) => (
            <p key={n.code}>{t(ZM_NOTICE_TEXT[n.code], { n: n.count, amount: formatCents(n.amount, lang), limit })}</p>
          ))}
        </div>
      )}

      <p>
        {t('zm.portal.text')} <ExternalLink href={ZM_PORTAL_URL}>{t('zm.portal.link')}</ExternalLink>
      </p>
      <p className="f-label">{t('zm.portal.import')}</p>

      <h3>{t('zm.notCovered.title')}</h3>
      <p>{t('zm.notCovered.intro')}</p>
      <ul>
        {NOT_COVERED.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>
    </section>
  );
}

function LineRow({ line, lang }: { line: ZmLine; lang: 'de' | 'en' }) {
  const name = line.vatId || t('zm.noId');
  const amount = zmCopyValue('amount', line);
  return (
    <tr>
      <td>
        <CopyValue text={line.country} label={t('zm.copyCountry', { name, value: line.country })} value={line.country} />
      </td>
      <td>
        {line.vatId ? <CopyValue text={line.vatId} label={t('zm.copyId', { name, value: line.idNumber })} value={line.idNumber} /> : <em>{t('zm.noId')}</em>}
        {line.problem !== null && <div className="f-label">{zmProblemText(line.problem)}</div>}
      </td>
      <td>{zmKindText(line.kind)}</td>
      <td className="num">
        <CopyValue text={formatCents(cents(zmWholeEuros(line.base) * 100), lang)} label={t('zm.copyAmount', { name, value: amount })} value={amount} />
      </td>
    </tr>
  );
}

/** A shown text with a copy button for the value the portal takes */
function CopyValue({ text, label, value }: { text: string; label: string; value: string }) {
  return (
    <span className="ustva-value">
      {text}
      <button type="button" className="btn sm ghost" aria-label={label} onClick={() => void copyText(value)}>
        {t('ustva.copy')}
      </button>
    </span>
  );
}
