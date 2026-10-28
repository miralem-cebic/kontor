import { useMemo } from 'react';
import { documentTotals } from '../../domain/document';
import { formatCents, formatQuantity, formatRate } from '../../domain/money';
import { changeStats, lineChanges, versionChain, type LineChange, type LineChangeField } from '../../domain/quoteVersions';
import type { DocumentId } from '../../data/ids';
import { isQuote, type QuoteFile } from '../../data/types';
import { currentLang, t } from '../../i18n';
import { unitText } from '../../lib/labels';
import { useApp } from '../../store/appStore';
import { formatDate, useSmallBusiness } from '../documents/common';

// The versions of a quote (F22): each one with its date and total, what changed from the one before, and how often the
// quotes of the customer were changed.

/** The total of a version: a finalized one with the VAT scheme it was finalized with, a draft with the current one */
const grossOf = (q: QuoteFile, smallBusiness: boolean) => documentTotals(q.lines, q.issued ? q.issued.snapshot.company.tax.vat.kind === 'smallBusiness' : smallBusiness).gross;

/** One change of the lines in words, in the interface language */
function changeText(c: LineChange): string {
  const lang = currentLang();
  switch (c.kind) {
    case 'added':
      return t('versions.added', { name: c.line.name, quantity: formatQuantity(c.line.quantity, lang), unit: unitText(c.line.unit), price: formatCents(c.line.unitPrice, lang) });
    case 'removed':
      return t('versions.removed', { name: c.line.name });
    case 'changed': {
      const { before, after } = c;
      const parts = c.fields.map((f: LineChangeField) => {
        switch (f) {
          case 'description':
            return t('versions.description');
          case 'quantity':
            return t('versions.quantity', { from: formatQuantity(before.quantity, lang), to: formatQuantity(after.quantity, lang) });
          case 'unit':
            return t('versions.unit', { from: unitText(before.unit), to: unitText(after.unit) });
          case 'unitPrice':
            return t('versions.unitPrice', { from: formatCents(before.unitPrice, lang), to: formatCents(after.unitPrice, lang) });
          case 'vatRate':
            return t('versions.vatRate', { from: formatRate(before.vatRate, lang), to: formatRate(after.vatRate, lang) });
        }
      });
      return t('versions.changed', { name: after.name, changes: parts.join(', ') });
    }
  }
}

interface Props {
  quote: QuoteFile;
  /** The name of the customer as the quote shows it */
  customerName: string;
  /** Opens another version */
  onOpen: (id: DocumentId) => void;
}

export function QuoteHistory({ quote, customerName, onOpen }: Props) {
  const documents = useApp((s) => s.documents);
  const smallBusiness = useSmallBusiness();
  const lang = currentLang();
  const quotes = useMemo(() => [...documents.values()].filter(isQuote), [documents]);
  const chain = versionChain(quotes, quote.id);
  const stats = changeStats(quotes.filter((q) => q.customerId === quote.customerId));
  const money = (q: QuoteFile) => formatCents(grossOf(q, smallBusiness), lang);

  return (
    <section className="card" aria-labelledby="quote-versions">
      <h2 id="quote-versions">{t('versions.title')}</h2>
      {chain.length < 2 ? (
        <p className="muted">{t('versions.none')}</p>
      ) : (
        <ol className="versions">
          {chain.map((v, i) => {
            const label = v.issued ? t('quotes.quoteOf', { number: v.issued.number, date: formatDate(v.date) }) : t('quotes.versionDraft', { version: v.revises?.version ?? 1 });
            const previous = i > 0 ? chain[i - 1] : undefined;
            const changes = previous ? lineChanges(previous.lines, v.lines) : [];
            return (
              <li key={v.id}>
                <div className="version-head">
                  {v.id === quote.id ? (
                    <strong>
                      {label} ({t('versions.current')})
                    </strong>
                  ) : (
                    <button type="button" className="link" onClick={() => onOpen(v.id)}>
                      {label}
                    </button>
                  )}
                  <span className="sp" />
                  <span className="num">{money(v)}</span>
                </div>
                {previous && (
                  <ul className="version-changes">
                    {changes.length === 0 ? <li>{t('versions.linesSame')}</li> : changes.map((c, j) => <li key={j}>{changeText(c)}</li>)}
                    <li>{t('versions.total', { from: money(previous), to: money(v) })}</li>
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {stats.total > 0 && <p className="f-hint">{t('versions.customerStats', { name: customerName, ...stats })}</p>}
    </section>
  );
}
