import type { ReactNode } from 'react';
import { lineTotal, type DocumentLine } from '../../domain/document';
import type { VatNote } from '../../domain/invoice';
import { formatCents, formatQuantity, type TaxTotals } from '../../domain/money';
import { currentLang, t } from '../../i18n';
import { unitText } from '../../lib/labels';
import { Totals } from './LinesEditor';

// What the read-only views of an issued invoice and a finalized quote share: a fact of the document, and its lines with
// the totals.

export const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </>
);

/** The lines of an issued document in a table, with its totals and the note on VAT */
export function IssuedLines({ id, lines, totals, note }: { id: string; lines: readonly DocumentLine[]; totals: TaxTotals; note: VatNote | null }) {
  const lang = currentLang();
  return (
    <section className="card" aria-labelledby={id}>
      <h2 id={id}>{t('lines.title')}</h2>
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
          {lines.map((l, i) => (
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
      <Totals totals={totals} note={note} />
    </section>
  );
}
