import { useEffect, useRef } from 'react';
import { Icon } from '../../components/Icon';
import { isoDateOf } from '../../domain/dates';
import { documentTotals } from '../../domain/document';
import type { IssuedInfo } from '../../domain/invoice';
import { isExpired } from '../../domain/quote';
import type { DocumentId } from '../../data/ids';
import type { QuoteFile } from '../../data/types';
import { fmt, t } from '../../i18n';
import { formatDate } from '../documents/common';
import { Fact, IssuedLines } from '../documents/IssuedParts';
import { PdfButton } from '../documents/PdfButton';

// A finalized quote: what it says, with the master data it was finalized with, and its PDF in the folder. Nothing can be
// changed or deleted (ADR 0004); a changed offer starts as a copy. The quote can still become an invoice.

type FinalizedQuote = QuoteFile & { issued: IssuedInfo };

interface Props {
  quote: FinalizedQuote;
  onDone: () => void;
  /** Opens a new invoice made from this quote */
  onCreateInvoice: (id: DocumentId) => void;
  /** Starts a new draft as a copy of this quote */
  onCopy: (id: DocumentId) => void;
}

export function IssuedQuoteView({ quote, onDone, onCreateInvoice, onCopy }: Props) {
  const { issued } = quote;
  const { snapshot } = issued;
  const smallBusiness = snapshot.company.tax.vat.kind === 'smallBusiness';
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
        <span className="badge">{t('quotes.finalized')}</span>
      </header>
      <div className="form">
        <section className="card" aria-labelledby="finalized-facts">
          <h2 id="finalized-facts">{t('quotes.sectionQuote')}</h2>
          <dl className="facts">
            <Fact label={t('documents.customer')}>{snapshot.customer.name}</Fact>
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
            {t('quotes.finalizedNote')}
          </p>
        </section>

        <IssuedLines id="finalized-lines" lines={quote.lines} totals={documentTotals(quote.lines, smallBusiness)} note={smallBusiness ? 'smallBusiness' : null} />

        <div className="card-actions">
          <PdfButton prepare={() => quote.id} />
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
