import { useEffect, useMemo, useRef } from 'react';
import { Icon } from '../../components/Icon';
import { isoDateOf } from '../../domain/dates';
import { documentTotals } from '../../domain/document';
import type { IssuedInfo } from '../../domain/invoice';
import { isExpired } from '../../domain/quote';
import { versionChain } from '../../domain/quoteVersions';
import type { DocumentId } from '../../data/ids';
import { isQuote, type QuoteFile } from '../../data/types';
import { fmt, t } from '../../i18n';
import { useApp } from '../../store/appStore';
import { formatDate } from '../documents/common';
import { Fact, IssuedLines } from '../documents/IssuedParts';
import { PdfButton } from '../documents/PdfButton';
import { QuoteHistory } from './QuoteHistory';

// A finalized quote: what it says, with the master data it was finalized with, and its PDF in the folder. Nothing can be
// changed or deleted (ADR 0004); a change is a new version (F22), which replaces it. The quote can still become an
// invoice or be copied into a new quote.

type FinalizedQuote = QuoteFile & { issued: IssuedInfo };

interface Props {
  quote: FinalizedQuote;
  onDone: () => void;
  /** Opens a new invoice made from this quote */
  onCreateInvoice: (id: DocumentId) => void;
  /** Starts a new draft as a copy of this quote */
  onCopy: (id: DocumentId) => void;
  /** Starts the next version of this quote */
  onNewVersion: (id: DocumentId) => void;
  /** Opens another version */
  onOpen: (id: DocumentId) => void;
}

export function IssuedQuoteView({ quote, onDone, onCreateInvoice, onCopy, onNewVersion, onOpen }: Props) {
  const { issued, revises } = quote;
  const { snapshot } = issued;
  const smallBusiness = snapshot.company.tax.vat.kind === 'smallBusiness';
  const documents = useApp((s) => s.documents);
  // the version after this one, a draft or finalized; while there is one, no other version is started
  const next = useMemo(() => {
    const chain = versionChain([...documents.values()].filter(isQuote), quote.id);
    return chain[chain.findIndex((v) => v.id === quote.id) + 1];
  }, [documents, quote.id]);
  const replaced = !!next?.issued;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <div className="page">
      <header className="top">
        <button type="button" className="icon-btn" onClick={onDone} aria-label={t('documents.backToList')}>
          <Icon n="chevL" />
        </button>
        <h1 ref={heading} tabIndex={-1}>
          {t('quotes.finalizedTitle', { number: issued.number })}
        </h1>
        {replaced ? <span className="badge muted-badge">{t('quotes.replaced')}</span> : <span className="badge">{t('quotes.finalized')}</span>}
      </header>
      <div className="form">
        <section className="card" aria-labelledby="finalized-facts">
          <h2 id="finalized-facts">{t('quotes.sectionQuote')}</h2>
          <dl className="facts">
            <Fact label={t('documents.customer')}>{snapshot.customer.name}</Fact>
            {revises && (
              <Fact label={t('quotes.replaces')}>
                {documents.has(revises.id) ? (
                  <button type="button" className="link" onClick={() => onOpen(revises.id)}>
                    {t('quotes.quoteOf', { number: revises.number, date: formatDate(revises.date) })}
                  </button>
                ) : (
                  t('quotes.quoteOf', { number: revises.number, date: formatDate(revises.date) })
                )}
              </Fact>
            )}
            {next && (
              <Fact label={t('quotes.replacedBy')}>
                <button type="button" className="link" onClick={() => onOpen(next.id)}>
                  {next.issued ? t('quotes.quoteOf', { number: next.issued.number, date: formatDate(next.date) }) : t('quotes.versionDraft', { version: next.revises?.version ?? 2 })}
                </button>
              </Fact>
            )}
            {quote.subject && <Fact label={t('documents.subject')}>{quote.subject}</Fact>}
            <Fact label={t('quotes.date')}>{formatDate(quote.date)}</Fact>
            <Fact label={t('quotes.validUntil')}>
              {formatDate(quote.validUntil)} {isExpired(quote, isoDateOf(new Date())) && <span className="badge muted-badge">{t('quotes.expired')}</span>}
            </Fact>
            <Fact label={t('quotes.finalizedAt')}>{fmt(new Date(issued.issuedAt), 'Pp')}</Fact>
            <Fact label={t('quotes.file')}>
              <code>documents/quotes/{issued.pdf.file}</code>
              <small className="f-hint issued-hash">SHA-256 {issued.pdf.sha256}</small>
            </Fact>
          </dl>
          <p className="note" role="note">
            {t(replaced ? 'quotes.replacedNote' : 'quotes.finalizedNote')}
          </p>
        </section>

        <IssuedLines id="finalized-lines" lines={quote.lines} totals={documentTotals(quote.lines, smallBusiness)} note={smallBusiness ? 'smallBusiness' : null} />

        <QuoteHistory quote={quote} customerName={snapshot.customer.name} onOpen={onOpen} />

        <div className="card-actions">
          <PdfButton prepare={() => quote.id} />
          {!next && (
            <button type="button" className="btn" onClick={() => onNewVersion(quote.id)}>
              {t('quotes.newVersion')}
            </button>
          )}
          <button type="button" className="btn" onClick={() => onCreateInvoice(quote.id)}>
            <Icon n="invoice" s={14} />
            {t('quotes.createInvoice')}
          </button>
          <button type="button" className="btn" onClick={() => onCopy(quote.id)}>
            {t('quotes.copy')}
          </button>
          <button type="button" className="btn" onClick={onDone}>
            {t('documents.backToList')}
          </button>
        </div>
      </div>
    </div>
  );
}
