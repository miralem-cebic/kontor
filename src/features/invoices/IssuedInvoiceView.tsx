import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { lineTotal } from '../../domain/document';
import { dueDate, invoiceTotals, vatNote, type IssuedInfo } from '../../domain/invoice';
import { formatCents, formatQuantity } from '../../domain/money';
import type { InvoiceFile } from '../../data/types';
import { currentLang, fmt, t } from '../../i18n';
import { accountDetail, accountName, unitText } from '../../lib/labels';
import { formatDate } from '../documents/common';
import { Totals } from '../documents/LinesEditor';
import { PdfButton } from '../documents/PdfButton';

// An issued invoice: what it says, with the master data it was issued with, and its PDF in the folder. Nothing can be
// changed or deleted (ADR 0004); corrections will be cancellation invoices (F02).

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </>
);

export function IssuedInvoiceView({ invoice, onDone }: { invoice: InvoiceFile & { issued: IssuedInfo }; onDone: () => void }) {
  const { issued } = invoice;
  const { snapshot } = issued;
  const lang = currentLang();
  const smallBusiness = snapshot.company.tax.vat.kind === 'smallBusiness';
  const totals = invoiceTotals(invoice, smallBusiness);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const service = invoice.service.kind === 'date' ? formatDate(invoice.service.date) : `${formatDate(invoice.service.start)} – ${formatDate(invoice.service.end)}`;

  return (
    <div className="page">
      <header className="top">
        <button type="button" className="icon-btn" onClick={onDone} aria-label={t('documents.backToList')}>
          <Icon n="chevL" />
        </button>
        <h1 ref={heading} tabIndex={-1}>
          {t('invoices.issuedTitle', { number: issued.number })}
        </h1>
        <span className="badge">{t('invoices.issued')}</span>
      </header>
      <div className="form">
        <section className="card" aria-labelledby="issued-facts">
          <h2 id="issued-facts">{t('invoices.sectionInvoice')}</h2>
          <dl className="facts">
            <Fact label={t('documents.customer')}>{snapshot.customer.name}</Fact>
            {invoice.subject && <Fact label={t('documents.subject')}>{invoice.subject}</Fact>}
            <Fact label={t('invoices.date')}>{formatDate(invoice.date)}</Fact>
            <Fact label={invoice.service.kind === 'date' ? t('invoices.serviceDate') : t('invoices.servicePeriodLabel')}>{service}</Fact>
            <Fact label={t('invoices.colDue')}>{formatDate(dueDate(invoice))}</Fact>
            <Fact label={t('invoices.account')}>{`${accountName(snapshot.account)} · ${accountDetail(snapshot.account)}`}</Fact>
            <Fact label={t('invoices.issuedAt')}>{fmt(new Date(issued.issuedAt), 'Pp')}</Fact>
            <Fact label={t('invoices.issuedFile')}>
              <code>documents/issued/{issued.pdf.file}</code>
              <small className="f-hint issued-hash">SHA-256 {issued.pdf.sha256}</small>
            </Fact>
          </dl>
          <p className="note" role="note">
            {t('invoices.issuedNote')}
          </p>
        </section>

        <section className="card" aria-labelledby="issued-lines">
          <h2 id="issued-lines">{t('lines.title')}</h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('lines.name')}</th>
                <th scope="col" className="num">
                  {t('lines.quantity')}
                </th>
                <th scope="col">{t('lines.unit')}</th>
                <th scope="col" className="num">
                  {t('pdf.colPrice')}
                </th>
                <th scope="col" className="num">
                  {t('pdf.colTotal')}
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    {l.name}
                    {l.description && <small className="f-hint issued-desc">{l.description}</small>}
                  </td>
                  <td className="num">{formatQuantity(l.quantity, lang)}</td>
                  <td>{unitText(l.unit)}</td>
                  <td className="num">{formatCents(l.unitPrice, lang)}</td>
                  <td className="num">{formatCents(lineTotal(l), lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Totals totals={totals} note={vatNote(invoice.taxTreatment, smallBusiness)} />
        </section>

        <div className="card-actions">
          <PdfButton prepare={() => invoice.id} />
          <button type="button" className="btn" onClick={onDone}>
            {t('documents.backToList')}
          </button>
        </div>
      </div>
    </div>
  );
}
