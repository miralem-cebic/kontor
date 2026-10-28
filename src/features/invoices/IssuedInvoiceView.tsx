import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { dueDate, invoiceTotals, vatNote, type IssuedInfo } from '../../domain/invoice';
import type { DocumentId } from '../../data/ids';
import { cancellationOf, type InvoiceFile } from '../../data/types';
import { cancelInvoice } from '../../app/issue';
import { fmt, t } from '../../i18n';
import { accountDetail, accountName, cancelFailureText } from '../../lib/labels';
import { showToast, useApp } from '../../store/appStore';
import { formatDate } from '../documents/common';
import { Fact, IssuedLines } from '../documents/IssuedParts';
import { PdfButton } from '../documents/PdfButton';

// An issued invoice: what it says, with the master data it was issued with, and its PDF in the folder. Nothing can be
// changed or deleted (ADR 0004). A mistake is undone by cancelling the invoice: its cancellation invoice reverses
// every amount, and a copy of the invoice is the start of the corrected one. A cancellation is shown here as well.

type IssuedInvoice = InvoiceFile & { issued: IssuedInfo };

/** Number and date of another invoice; a link to it while it is there */
function InvoiceRef({ id, number, date, onOpen }: { id: DocumentId; number: string; date: string; onOpen: (id: DocumentId) => void }) {
  const there = useApp((s) => s.documents.has(id));
  const label = t('invoices.invoiceOf', { number, date: formatDate(date) });
  return there ? (
    <button type="button" className="link" onClick={() => onOpen(id)}>
      {label}
    </button>
  ) : (
    <>{label}</>
  );
}

interface Props {
  invoice: IssuedInvoice;
  onDone: () => void;
  /** Opens another invoice: the cancellation of this one, or the invoice this one cancels */
  onOpen: (id: DocumentId) => void;
  /** Starts a new draft as a copy of this invoice */
  onCopy: (id: DocumentId) => void;
}

export function IssuedInvoiceView({ invoice, onDone, onOpen, onCopy }: Props) {
  const { issued, cancels } = invoice;
  const { snapshot } = issued;
  const documents = useApp((s) => s.documents);
  const cancellation = useMemo(() => cancellationOf(documents.values(), invoice.id), [documents, invoice.id]);
  const smallBusiness = snapshot.company.tax.vat.kind === 'smallBusiness';
  const totals = invoiceTotals(invoice, smallBusiness);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const service = invoice.service.kind === 'date' ? formatDate(invoice.service.date) : `${formatDate(invoice.service.start)} – ${formatDate(invoice.service.end)}`;
  // a cancelled invoice is no longer due, and a cancellation is not paid
  const open = !cancels && !cancellation;

  return (
    <div className="page">
      <header className="top">
        <button type="button" className="icon-btn" onClick={onDone} aria-label={t('documents.backToList')}>
          <Icon n="chevL" />
        </button>
        <h1 ref={heading} tabIndex={-1}>
          {t(cancels ? 'invoices.cancellationTitle' : 'invoices.issuedTitle', { number: issued.number })}
        </h1>
        {cancels ? (
          <span className="badge">{t('invoices.cancellation')}</span>
        ) : cancellation ? (
          <span className="badge muted-badge">{t('invoices.cancelled')}</span>
        ) : (
          <span className="badge">{t('invoices.issued')}</span>
        )}
      </header>
      <div className="form">
        <section className="card" aria-labelledby="issued-facts">
          <h2 id="issued-facts">{t('invoices.sectionInvoice')}</h2>
          <dl className="facts">
            <Fact label={t('documents.customer')}>{snapshot.customer.name}</Fact>
            {cancels && (
              <Fact label={t('invoices.cancels')}>
                <InvoiceRef id={cancels.id} number={cancels.number} date={cancels.date} onOpen={onOpen} />
              </Fact>
            )}
            {cancellation?.issued && (
              <Fact label={t('invoices.cancelledBy')}>
                <InvoiceRef id={cancellation.id} number={cancellation.issued.number} date={cancellation.date} onOpen={onOpen} />
              </Fact>
            )}
            {invoice.subject && <Fact label={t('documents.subject')}>{invoice.subject}</Fact>}
            <Fact label={t('invoices.date')}>{formatDate(invoice.date)}</Fact>
            <Fact label={invoice.service.kind === 'date' ? t('invoices.serviceDate') : t('invoices.servicePeriodLabel')}>{service}</Fact>
            {open && <Fact label={t('invoices.colDue')}>{formatDate(dueDate(invoice))}</Fact>}
            {!cancels && <Fact label={t('invoices.account')}>{`${accountName(snapshot.account)} · ${accountDetail(snapshot.account)}`}</Fact>}
            <Fact label={t('invoices.issuedAt')}>{fmt(new Date(issued.issuedAt), 'Pp')}</Fact>
            <Fact label={t('invoices.issuedFile')}>
              <code>documents/issued/{issued.pdf.file}</code>
              <small className="f-hint issued-hash">SHA-256 {issued.pdf.sha256}</small>
            </Fact>
          </dl>
          <p className="note" role="note">
            {t(cancels ? 'invoices.cancellationNote' : cancellation ? 'invoices.cancelledNote' : 'invoices.issuedNote')}
          </p>
        </section>

        <IssuedLines id="issued-lines" lines={invoice.lines} totals={totals} note={vatNote(invoice.taxTreatment, smallBusiness)} />

        <div className="card-actions">
          <PdfButton prepare={() => invoice.id} />
          {!cancels && (
            <button type="button" className="btn" onClick={() => onCopy(invoice.id)}>
              {t('invoices.copy')}
            </button>
          )}
          <button type="button" className="btn" onClick={onDone}>
            {t('documents.backToList')}
          </button>
          <span className="sp" />
          {open && !confirmCancel && (
            <button type="button" className="btn ghost danger-text" onClick={() => setConfirmCancel(true)}>
              {t('invoices.cancel')}
            </button>
          )}
        </div>
        {open && confirmCancel && <CancelConfirm invoice={invoice} onClose={() => setConfirmCancel(false)} onCancelled={onOpen} />}
      </div>
    </div>
  );
}

/** Asks before cancelling; on success the view moves on to the cancellation */
function CancelConfirm({ invoice, onClose, onCancelled }: { invoice: IssuedInvoice; onClose: () => void; onCancelled: (id: DocumentId) => void }) {
  const [busy, setBusy] = useState(false);
  const number = invoice.issued.number;
  const run = async () => {
    setBusy(true);
    const r = await cancelInvoice(invoice.id);
    setBusy(false);
    if (!r.ok) {
      onClose();
      showToast(cancelFailureText(r.failure));
      return;
    }
    showToast(t(r.auditWritten ? 'invoices.cancelledToast' : 'invoices.cancelledAuditMissing', { number, cancellation: r.document.issued?.number ?? '' }));
    onCancelled(r.document.id);
  };
  return (
    <div className="confirm" role="group" aria-label={t('invoices.cancelConfirm', { number })}>
      <span>{t('invoices.cancelConfirm', { number })}</span>
      <button type="button" className="btn danger" onClick={() => void run()} disabled={busy} autoFocus>
        {busy ? t('invoices.cancelBusy') : t('invoices.cancelNow')}
      </button>
      <button type="button" className="btn" onClick={onClose} disabled={busy}>
        {t('common.cancel')}
      </button>
    </div>
  );
}
