import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Choice, Row, SelectField, TextArea, TextField } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { JumpNav, type JumpSection } from '../../components/JumpNav';
import { isoDateOf } from '../../domain/dates';
import { draftTotals, hasNegativeRate, type LineFieldPath } from '../../domain/document';
import {
  byInvoiceDate,
  customerDefaults,
  draftDueDate,
  draftFromInvoice,
  dueDate,
  emptyInvoiceDraft,
  INVOICE_LIMITS,
  invoiceDraftFromCopy,
  invoiceDraftFromQuote,
  invoiceMatches,
  invoiceTotals,
  issueProblems,
  readInvoice,
  TAX_TREATMENTS,
  taxTreatmentHint,
  vatNote,
  type InvoiceDraft,
  type InvoiceField,
  type InvoiceFieldError,
  type ServicePeriod,
  type TaxTreatment,
} from '../../domain/invoice';
import { formatCents } from '../../domain/money';
import type { DocumentId } from '../../data/ids';
import { isInvoice, isQuote, type CompanyFile, type InvoiceFile, type QuoteFile } from '../../data/types';
import { issueInvoice } from '../../app/issue';
import { currentLang, t, type MessageKey } from '../../i18n';
import { accountDetail, accountName, fieldError, issueFailureText, issueProblemText, problemText, taxTreatmentHintText, taxTreatmentText } from '../../lib/labels';
import { addInvoice, deleteDocument, showToast, updateInvoice, useApp } from '../../store/appStore';
import { customerOptions, focusFirstError, formatDate, useSmallBusiness } from '../documents/common';
import { LinesEditor, newLineKey, Totals } from '../documents/LinesEditor';
import { PdfButton } from '../documents/PdfButton';
import { IssuedInvoiceView } from './IssuedInvoiceView';

// Invoices: a searchable list and a form for a new or an existing draft. Like a quote, the form edits a draft; only
// "Save" puts the checked invoice into the store (and the persister writes it). The form shows what a draft still needs
// before it can be issued; issuing (app/issue.ts, ADR 0004) gives it its number and makes it read-only.

/** A new invoice starts empty, from a quote, or as a copy of an issued invoice */
type Mode = { kind: 'list' } | { kind: 'new'; fromQuote: DocumentId | null; copyOf: DocumentId | null } | { kind: 'edit'; id: DocumentId };
type StatusFilter = 'all' | 'drafts' | 'issued';

const STATUS_FILTERS: { value: StatusFilter; label: MessageKey }[] = [
  { value: 'all', label: 'invoices.filterAll' },
  { value: 'drafts', label: 'invoices.filterDrafts' },
  { value: 'issued', label: 'invoices.filterIssued' },
];

/** `fromQuote` opens a new invoice for that quote right away */
export function InvoicesView({ fromQuote }: { fromQuote: DocumentId | null }) {
  const [mode, setMode] = useState<Mode>(fromQuote ? { kind: 'new', fromQuote, copyOf: null } : { kind: 'list' });
  const back = () => setMode({ kind: 'list' });
  const open = (id: DocumentId) => setMode({ kind: 'edit', id });
  switch (mode.kind) {
    case 'list':
      return <InvoiceList onNew={() => setMode({ kind: 'new', fromQuote: null, copyOf: null })} onOpen={open} />;
    case 'new':
      return <NewInvoice key={mode.copyOf ?? mode.fromQuote ?? 'new'} fromQuote={mode.fromQuote} copyOf={mode.copyOf} onDone={back} />;
    case 'edit':
      return <EditExisting key={mode.id} id={mode.id} onDone={back} onOpen={open} onCopy={(id) => setMode({ kind: 'new', fromQuote: null, copyOf: id })} />;
  }
}

/**
 * A new invoice with the company's defaults; made from a quote, with its customer, subject and lines; or a copy of an
 * issued invoice, dated today
 */
function NewInvoice({ fromQuote, copyOf, onDone }: { fromQuote: DocumentId | null; copyOf: DocumentId | null; onDone: () => void }) {
  const company = useApp((s) => s.company);
  const contacts = useApp((s) => s.contacts);
  const source = useApp((s) => (fromQuote ? s.documents.get(fromQuote) : undefined));
  const original = useApp((s) => (copyOf ? s.documents.get(copyOf) : undefined));
  if (!company) return null;
  const quote = source && isQuote(source) ? source : null;
  const copy = original && isInvoice(original) && original.issued ? { invoice: original, number: original.issued.number } : null;
  const start = () => {
    const termDays = company.invoiceDefaults.paymentTermDays;
    const today = isoDateOf(new Date());
    if (copy) return invoiceDraftFromCopy(copy.invoice.customerId, copy.invoice.accountId, copy.invoice, today, currentLang(), newLineKey);
    const base = emptyInvoiceDraft(today, company.bank.defaultAccountId, termDays);
    if (!quote) return base;
    const customer = [...contacts.values()].find((c) => c.id === quote.customerId);
    return invoiceDraftFromQuote({ ...base, customerId: quote.customerId, ...(customer ? customerDefaults(customer, termDays) : {}) }, quote, currentLang(), newLineKey);
  };
  return <InvoiceEditor company={company} invoice={null} quote={quote} copyOf={copy?.number ?? null} start={start} onDone={onDone} />;
}

function EditExisting({ id, onDone, onOpen, onCopy }: { id: DocumentId; onDone: () => void; onOpen: (id: DocumentId) => void; onCopy: (id: DocumentId) => void }) {
  const company = useApp((s) => s.company);
  const found = useApp((s) => s.documents.get(id));
  const invoice = found && isInvoice(found) && !found.deletedAt ? found : null;
  const source = useApp((s) => (invoice?.quoteId ? s.documents.get(invoice.quoteId) : undefined));
  // deleted or gone (for example merged away from another device): back to the list
  useEffect(() => {
    if (!invoice) onDone();
  }, [invoice, onDone]);
  if (!invoice || !company) return null;
  if (invoice.issued) return <IssuedInvoiceView invoice={{ ...invoice, issued: invoice.issued }} onDone={onDone} onOpen={onOpen} onCopy={onCopy} />;
  const start = () => draftFromInvoice(invoice.customerId, invoice.accountId, invoice, currentLang(), newLineKey);
  return <InvoiceEditor company={company} invoice={invoice} quote={source && isQuote(source) ? source : null} copyOf={null} start={start} onDone={onDone} />;
}

/* ---------- List ---------- */

function InvoiceList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: DocumentId) => void }) {
  const documents = useApp((s) => s.documents);
  const contacts = useApp((s) => s.contacts);
  const smallBusiness = useSmallBusiness();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const searchId = useId();
  const active = useMemo(() => [...documents.values()].filter(isInvoice).filter((d) => !d.deletedAt).sort(byInvoiceDate), [documents]);
  const cancelled = useMemo(() => new Set(active.flatMap((inv) => (inv.cancels ? [inv.cancels.id] : []))), [active]);
  // an issued invoice keeps the customer and the VAT scheme it was issued with
  const customerName = (inv: InvoiceFile) => inv.issued?.snapshot.customer.name ?? contacts.get(inv.customerId)?.name ?? '';
  const gross = (inv: InvoiceFile) => invoiceTotals(inv, inv.issued ? inv.issued.snapshot.company.tax.vat.kind === 'smallBusiness' : smallBusiness).gross;
  const inFilter = (inv: InvoiceFile, f: StatusFilter) => f === 'all' || (f === 'issued') === (inv.issued !== null);
  const matching = active.filter((inv) => invoiceMatches(inv, customerName(inv), query) || (inv.issued?.number.toLowerCase().includes(query.trim().toLowerCase()) ?? false));
  const shown = matching.filter((inv) => inFilter(inv, status));
  const lang = currentLang();

  return (
    <div className="page wide">
      <header className="top">
        <h1>{t('invoices.title')}</h1>
        <span className="sp" />
        <button type="button" className="btn primary" onClick={onNew}>
          <Icon n="plus" s={14} />
          {t('invoices.new')}
        </button>
      </header>
      <p className="note page-note" role="note">
        {t('invoices.draftNote')}
      </p>
      {active.length === 0 ? (
        <p className="empty">{t('invoices.empty')}</p>
      ) : (
        <>
          <div className="list-tools">
            <label className="visually-hidden" htmlFor={searchId}>
              {t('invoices.search')}
            </label>
            <input id={searchId} className="search-in" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('invoices.searchPlaceholder')} />
            <div className="seg" role="group" aria-label={t('invoices.filter')}>
              {STATUS_FILTERS.map((f) => (
                <button key={f.value} type="button" className={status === f.value ? 'on' : ''} aria-pressed={status === f.value} onClick={() => setStatus(f.value)}>
                  {t(f.label)} <span className="seg-n">{matching.filter((inv) => inFilter(inv, f.value)).length}</span>
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="empty" role="status">
              {t('invoices.noMatch')}
            </p>
          ) : (
            <table className="table">
              <caption className="visually-hidden">{t('invoices.count', { n: shown.length })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('invoices.colNumber')}</th>
                  <th scope="col">{t('documents.colDate')}</th>
                  <th scope="col">{t('documents.colCustomer')}</th>
                  <th scope="col">{t('documents.colSubject')}</th>
                  <th scope="col">{t('invoices.colDue')}</th>
                  <th scope="col" className="num">
                    {t('documents.colTotal')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      {inv.issued ? inv.issued.number : <span className="badge muted-badge">{t('invoices.draft')}</span>}
                      {inv.cancels && <span className="badge muted-badge list-badge">{t('invoices.cancellationShort')}</span>}
                      {cancelled.has(inv.id) && <span className="badge muted-badge list-badge">{t('invoices.cancelled')}</span>}
                    </td>
                    <td>{formatDate(inv.date)}</td>
                    <td>
                      <button type="button" className="row-link" onClick={() => onOpen(inv.id)}>
                        <span>{customerName(inv)}</span>
                      </button>
                    </td>
                    <td>{inv.subject || <span className="muted">{t('documents.noSubject')}</span>}</td>
                    <td>{inv.cancels || cancelled.has(inv.id) ? <span className="muted">–</span> : formatDate(dueDate(inv))}</td>
                    <td className="num">{formatCents(gross(inv), lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Form ---------- */

interface EditorProps {
  company: CompanyFile;
  invoice: InvoiceFile | null;
  /** The quote the invoice is made from, if any */
  quote: QuoteFile | null;
  /** The number of the issued invoice this new one is a copy of, if any */
  copyOf: string | null;
  /** The draft the form starts with */
  start: () => InvoiceDraft;
  onDone: () => void;
}

function InvoiceEditor({ company, invoice, quote, copyOf, start, onDone }: EditorProps) {
  const contacts = useApp((s) => s.contacts);
  const smallBusiness = company.tax.vat.kind === 'smallBusiness';
  const lang = currentLang();
  const [draft, setDraft] = useState<InvoiceDraft>(start);
  const [errors, setErrors] = useState<readonly InvoiceFieldError[]>([]);
  const [checked, setChecked] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), []);

  const set = (patch: Partial<InvoiceDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (checked) {
      const r = readInvoice(next, lang, smallBusiness);
      setErrors(r.ok ? [] : r.error);
    }
  };
  const e = (f: InvoiceField) => fieldError(errors, f);
  const findContact = (id: string) => [...contacts.values()].find((c) => c.id === id);
  const findAccount = (id: string) => company.bank.accounts.find((a) => a.id === id);
  const termDays = company.invoiceDefaults.paymentTermDays;
  // choosing a customer takes over its payment term, order number and Leitweg-ID
  const chooseCustomer = (customerId: string) => {
    const c = findContact(customerId);
    set({ customerId, ...(c ? customerDefaults(c, termDays) : {}) });
  };

  const customer = findContact(draft.customerId);
  const account = findAccount(draft.accountId);
  const treatment: TaxTreatment = smallBusiness ? 'standard' : draft.taxTreatment;
  const note = vatNote(treatment, smallBusiness);
  const totals = draftTotals(draft.lines, lang, note !== null);
  // a negative sum shows up while it is typed, not only on "Save"
  const lineError = (path: LineFieldPath | 'lines') => e(path) ?? (path === 'lines' && hasNegativeRate(totals) ? problemText('negativeTotal') : undefined);
  const problems = issueProblems({
    lineCount: draft.lines.length,
    gross: totals.gross,
    taxTreatment: treatment,
    customer: customer ?? null,
    ownVatId: company.tax.vatId,
    accountActive: !!account && !account.deletedAt,
  });
  const due = draftDueDate(draft);
  const treatmentHint = taxTreatmentHint(draft.taxTreatment, customer?.address?.country ?? null);
  const options = customerOptions(contacts, draft.customerId);
  const accountOptions = company.bank.accounts
    .filter((a) => !a.deletedAt || a.id === draft.accountId)
    .map((a) => {
      const label = `${accountName(a)} · ${accountDetail(a)}`;
      return { value: a.id as string, label: a.deletedAt ? t('invoices.accountRemoved', { name: label }) : label };
    });
  const sections: JumpSection[] = [
    { id: 'invoice-sec-head', title: t('invoices.sectionInvoice'), icon: 'invoice' },
    { id: 'invoice-sec-lines', title: t('lines.title'), icon: 'item' },
    ...(smallBusiness ? [] : [{ id: 'invoice-sec-tax', title: t('invoices.sectionTax'), icon: 'tax' } as const]),
    { id: 'invoice-sec-payment', title: t('invoices.sectionPayment'), icon: 'expense' },
    { id: 'invoice-sec-closing', title: t('documents.closingText'), icon: 'text' },
    { id: 'invoice-sec-issue', title: t('invoices.sectionIssue'), icon: 'check' },
  ];

  /** Checks the draft and puts it into the store; returns the invoice's ID and its customer's name, or null on errors */
  const store = (): { id: DocumentId; customerName: string } | null => {
    const r = readInvoice(draft, lang, smallBusiness);
    const chosen = r.ok ? findContact(r.value.customerId) : undefined;
    const paidTo = r.ok ? findAccount(r.value.accountId) : undefined;
    if (!r.ok || !chosen || !paidTo) {
      const missing: InvoiceFieldError[] = [
        ...(chosen ? [] : [{ field: 'customerId', problem: 'required' } as const]),
        ...(paidTo ? [] : [{ field: 'accountId', problem: 'required' } as const]),
      ];
      setChecked(true);
      setErrors(r.ok ? missing : r.error);
      focusFirstError('invoice-form');
      return null;
    }
    if (invoice) updateInvoice(invoice.id, chosen.id, paidTo.id, r.value.content);
    return { id: invoice ? invoice.id : addInvoice(chosen.id, paidTo.id, r.value.content, quote?.id ?? null), customerName: chosen.name };
  };

  const save = () => {
    const saved = store();
    if (!saved) return;
    showToast(t('invoices.saved', { name: saved.customerName }));
    onDone();
  };

  const remove = () => {
    if (!invoice) return;
    deleteDocument(invoice.id);
    showToast(t('invoices.deleted', { name: findContact(invoice.customerId)?.name ?? '' }));
    onDone();
  };

  const title = invoice ? [findContact(invoice.customerId)?.name ?? '', invoice.subject].filter(Boolean).join(' · ') : t('invoices.new');

  return (
    <div className="page with-panel">
      <header className="top">
        <button type="button" className="icon-btn" onClick={onDone} aria-label={t('documents.backToList')}>
          <Icon n="chevL" />
        </button>
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        <span className="badge muted-badge">{t('invoices.draft')}</span>
      </header>
      <div className="split">
        <JumpNav label={t('invoices.sections')} sections={sections} />
        <form
          className="form invoice-form"
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault();
            save();
          }}
        >
          <section className="card" id="invoice-sec-head" aria-labelledby="invoice-head">
            <h2 id="invoice-head" tabIndex={-1}>
              {t('invoices.sectionInvoice')}
            </h2>
            {quote && <p className="f-hint">{t('invoices.fromQuote', { date: formatDate(quote.date), subject: quote.subject || t('documents.noSubject') })}</p>}
            {copyOf && <p className="f-hint">{t('invoices.copyOf', { number: copyOf })}</p>}
            <SelectField
              label={t('documents.customer')}
              hint={options.length === 0 ? t('documents.noCustomers') : undefined}
              value={draft.customerId}
              options={[{ value: '', label: t('documents.customerChoose') }, ...options]}
              onChange={chooseCustomer}
              error={e('customerId')}
              required
            />
            <Row>
              <TextField className="w-date" type="date" label={t('invoices.date')} value={draft.date} onChange={(date) => set({ date })} error={e('date')} required />
            </Row>
            <Choice<ServicePeriod['kind']>
              label={t('invoices.service')}
              hint={t('invoices.serviceHint')}
              value={draft.serviceKind}
              options={[
                { value: 'date', label: t('invoices.serviceOnDay') },
                { value: 'period', label: t('invoices.serviceOverPeriod') },
              ]}
              onChange={(serviceKind) => set({ serviceKind })}
            />
            {draft.serviceKind === 'date' ? (
              <Row>
                <TextField className="w-date" type="date" label={t('invoices.serviceDate')} value={draft.serviceDate} onChange={(serviceDate) => set({ serviceDate })} error={e('serviceDate')} required />
              </Row>
            ) : (
              <Row>
                <TextField className="w-date" type="date" label={t('invoices.serviceStart')} value={draft.serviceStart} onChange={(serviceStart) => set({ serviceStart })} error={e('serviceStart')} required />
                <TextField className="w-date" type="date" label={t('invoices.serviceEnd')} value={draft.serviceEnd} onChange={(serviceEnd) => set({ serviceEnd })} error={e('serviceEnd')} required />
              </Row>
            )}
            <TextField label={t('documents.subject')} hint={t('documents.subjectHint')} value={draft.subject} onChange={(subject) => set({ subject })} error={e('subject')} maxLength={INVOICE_LIMITS.subject} />
            <Row>
              <TextField
                label={t('invoices.orderReference')}
                hint={t('invoices.orderReferenceHint')}
                value={draft.orderReference}
                onChange={(orderReference) => set({ orderReference })}
                error={e('orderReference')}
                maxLength={INVOICE_LIMITS.orderReference}
              />
              <TextField label={t('invoices.leitwegId')} hint={t('invoices.leitwegIdHint')} value={draft.leitwegId} onChange={(leitwegId) => set({ leitwegId })} error={e('leitwegId')} maxLength={INVOICE_LIMITS.leitwegId} />
            </Row>
            <TextArea label={t('documents.introText')} hint={t('documents.introTextHint')} value={draft.introText} onChange={(introText) => set({ introText })} error={e('introText')} maxLength={INVOICE_LIMITS.text} />
          </section>

          <section className="card" id="invoice-sec-lines" aria-labelledby="invoice-lines">
            <h2 id="invoice-lines" tabIndex={-1}>
              {t('lines.title')}
            </h2>
            <LinesEditor lines={draft.lines} onChange={(lines) => set({ lines })} errorFor={lineError} withoutVat={note !== null} />
            <Totals totals={totals} note={note} />
          </section>

          {!smallBusiness && (
            <section className="card" id="invoice-sec-tax" aria-labelledby="invoice-tax">
              <h2 id="invoice-tax" tabIndex={-1}>
                {t('invoices.sectionTax')}
              </h2>
              <Choice<TaxTreatment>
                label={t('invoices.taxTreatment')}
                hint={treatmentHint ? taxTreatmentHintText(treatmentHint) : undefined}
                value={draft.taxTreatment}
                options={TAX_TREATMENTS.map((v) => ({ value: v, ...taxTreatmentText(v) }))}
                onChange={(taxTreatment) => set({ taxTreatment })}
              />
            </section>
          )}

          <section className="card" id="invoice-sec-payment" aria-labelledby="invoice-payment">
            <h2 id="invoice-payment" tabIndex={-1}>
              {t('invoices.sectionPayment')}
            </h2>
            <TextField
              className="w-num"
              label={t('invoices.paymentTerm')}
              hint={due ? t('invoices.dueOn', { date: formatDate(due) }) : undefined}
              value={draft.paymentTermDays}
              onChange={(paymentTermDays) => set({ paymentTermDays })}
              error={e('paymentTermDays')}
              required
              inputMode="numeric"
              maxLength={3}
            />
            <SelectField
              label={t('invoices.account')}
              hint={t('invoices.accountHint')}
              value={account ? draft.accountId : ''}
              options={account ? accountOptions : [{ value: '', label: t('invoices.accountChoose') }, ...accountOptions]}
              onChange={(accountId) => set({ accountId })}
              error={e('accountId')}
              required
            />
          </section>

          <section className="card" id="invoice-sec-closing" aria-labelledby="invoice-closing">
            <h2 id="invoice-closing" tabIndex={-1}>
              {t('documents.closingText')}
            </h2>
            <TextArea
              label={t('documents.closingText')}
              hint={t('documents.closingTextHint')}
              value={draft.closingText}
              onChange={(closingText) => set({ closingText })}
              error={e('closingText')}
              maxLength={INVOICE_LIMITS.text}
            />
          </section>

          <section className="card" id="invoice-sec-issue" aria-labelledby="invoice-issue">
            <h2 id="invoice-issue" tabIndex={-1}>
              {t('invoices.sectionIssue')}
            </h2>
            <p className="muted">{t('invoices.issueLater')}</p>
            {problems.length === 0 ? (
              <>
                <ul className="checks">
                  <li className="ok">
                    <Icon n="check" s={14} />
                    {t('invoices.ready')}
                  </li>
                </ul>
                {invoice ? <IssueAction prepare={() => store()?.id ?? null} /> : <p className="f-hint">{t('invoices.issueSaveFirst')}</p>}
              </>
            ) : (
              <>
                <p className="muted" id="invoice-missing">
                  {t('invoices.missing')}
                </p>
                <ul className="checks" aria-labelledby="invoice-missing">
                  {problems.map((p) => (
                    <li key={p} className="bad">
                      <Icon n="alert" s={14} />
                      {issueProblemText(p)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <div className="card-actions">
            <button type="submit" className="btn primary">
              {t('documents.save')}
            </button>
            <button type="button" className="btn" onClick={onDone}>
              {t('common.cancel')}
            </button>
            {invoice && <PdfButton prepare={() => store()?.id ?? null} />}
            <span className="sp" />
            {invoice &&
              (confirmDelete ? (
                <div className="confirm" role="group" aria-label={t('invoices.deleteConfirm')}>
                  <span>{t('invoices.deleteConfirm')}</span>
                  <button type="button" className="btn danger" onClick={remove} autoFocus>
                    {t('documents.delete')}
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button type="button" className="btn ghost danger-text" onClick={() => setConfirmDelete(true)}>
                  {t('documents.delete')}
                </button>
              ))}
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Issuing after asking: changes not saved yet are saved first (`prepare`), then the invoice gets its number. The view
 * switches to the issued invoice by itself, because the store then holds it as issued.
 */
function IssueAction({ prepare }: { prepare: () => DocumentId | null }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const id = prepare();
    if (!id) {
      setConfirming(false);
      return;
    }
    setBusy(true);
    const r = await issueInvoice(id);
    setBusy(false);
    if (r.ok) showToast(t(r.auditWritten ? 'invoices.issuedToast' : 'invoices.issuedAuditMissing', { number: r.invoice.issued?.number ?? '' }));
    else {
      setConfirming(false);
      showToast(issueFailureText(r.failure));
    }
  };
  if (!confirming) {
    return (
      <div className="card-actions">
        <button type="button" className="btn primary" onClick={() => setConfirming(true)}>
          <Icon n="check" s={14} />
          {t('invoices.issue')}
        </button>
      </div>
    );
  }
  return (
    <div className="confirm" role="group" aria-label={t('invoices.issueConfirm')}>
      <span>{t('invoices.issueConfirm')}</span>
      <button type="button" className="btn primary" onClick={() => void run()} disabled={busy} autoFocus>
        {busy ? t('invoices.issueBusy') : t('invoices.issueNow')}
      </button>
      <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>
        {t('common.cancel')}
      </button>
    </div>
  );
}
