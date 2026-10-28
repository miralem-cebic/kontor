import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Row, SelectField, TextArea, TextField } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { JumpNav, type JumpSection } from '../../components/JumpNav';
import { isoDateOf } from '../../domain/dates';
import { documentTotals, draftTotals, hasNegativeRate, type LineFieldPath } from '../../domain/document';
import { formatCents } from '../../domain/money';
import {
  byQuoteDate,
  draftFromQuote,
  emptyQuoteDraft,
  isExpired,
  QUOTE_LIMITS,
  quoteDraftFromCopy,
  quoteMatches,
  quoteProblems,
  readQuote,
  type QuoteDraft,
  type QuoteField,
  type QuoteFieldError,
} from '../../domain/quote';
import { changeStats, replacedAlready, versionNumber } from '../../domain/quoteVersions';
import type { DocumentId } from '../../data/ids';
import { isQuote, nextVersionOf, type QuoteFile, type RevisedQuote } from '../../data/types';
import { finalizeQuote } from '../../app/issue';
import { currentLang, t, type MessageKey } from '../../i18n';
import { fieldError, finalizeFailureText, problemText, quoteProblemText } from '../../lib/labels';
import { addQuote, deleteDocument, showToast, updateQuote, useApp } from '../../store/appStore';
import { customerOptions, focusFirstError, formatDate, useSmallBusiness } from '../documents/common';
import { LinesEditor, newLineKey, Totals } from '../documents/LinesEditor';
import { PdfButton } from '../documents/PdfButton';
import { IssuedQuoteView } from './IssuedQuoteView';

// Quotes: a searchable list and a form for a new or an existing quote. The form edits a draft; only "Save" puts
// the checked quote into the store (and the persister writes it). Finalizing ("Angebot abschließen", app/issue.ts)
// gives a saved quote its number and its PDF and makes it read-only; a change after that is a new version (F22). A saved
// quote can become a new invoice, and a finalized one can be copied into a new draft.

/** A new quote starts empty, as a copy of a finalized quote, or as its next version */
type Mode = { kind: 'list' } | { kind: 'new'; copyOf: DocumentId | null; versionOf: DocumentId | null } | { kind: 'edit'; id: DocumentId };
type ValidityFilter = 'all' | 'valid' | 'expired';

const VALIDITY_FILTERS: { value: ValidityFilter; label: MessageKey }[] = [
  { value: 'all', label: 'quotes.filterAll' },
  { value: 'valid', label: 'quotes.filterValid' },
  { value: 'expired', label: 'quotes.filterExpired' },
];

/** `onCreateInvoice` opens a new invoice for a saved quote */
export function QuotesView({ onCreateInvoice }: { onCreateInvoice: (quoteId: DocumentId) => void }) {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const back = () => setMode({ kind: 'list' });
  const open = (id: DocumentId) => setMode({ kind: 'edit', id });
  switch (mode.kind) {
    case 'list':
      return <QuoteList onNew={() => setMode({ kind: 'new', copyOf: null, versionOf: null })} onOpen={open} />;
    case 'new':
      return <NewQuote key={mode.versionOf ?? mode.copyOf ?? 'new'} copyOf={mode.copyOf} versionOf={mode.versionOf} onDone={back} onCreateInvoice={onCreateInvoice} />;
    case 'edit':
      return (
        <EditExisting
          key={mode.id}
          id={mode.id}
          onDone={back}
          onOpen={open}
          onCreateInvoice={onCreateInvoice}
          onCopy={(id) => setMode({ kind: 'new', copyOf: id, versionOf: null })}
          onNewVersion={(id) => setMode({ kind: 'new', copyOf: null, versionOf: id })}
        />
      );
  }
}

interface NewProps {
  copyOf: DocumentId | null;
  versionOf: DocumentId | null;
  onDone: () => void;
  onCreateInvoice: (quoteId: DocumentId) => void;
}

/** A new quote: empty, or with everything from a finalized quote dated today, as a copy or as its next version */
function NewQuote({ copyOf, versionOf, onDone, onCreateInvoice }: NewProps) {
  const sourceId = versionOf ?? copyOf;
  const found = useApp((s) => (sourceId ? s.documents.get(sourceId) : undefined));
  const source = found && isQuote(found) && found.issued ? { ...found, issued: found.issued } : null;
  const revises = versionOf && source ? nextVersionOf(source) : null;
  const start = (): QuoteDraft => {
    const today = isoDateOf(new Date());
    return source ? quoteDraftFromCopy(source.customerId, source, today, currentLang(), newLineKey) : emptyQuoteDraft(today);
  };
  return <QuoteEditor quote={null} copyOf={source && !revises ? source.issued.number : null} revises={revises} start={start} onDone={onDone} onCreateInvoice={onCreateInvoice} />;
}

interface ExistingProps {
  id: DocumentId;
  onDone: () => void;
  onOpen: (quoteId: DocumentId) => void;
  onCreateInvoice: (quoteId: DocumentId) => void;
  onCopy: (quoteId: DocumentId) => void;
  onNewVersion: (quoteId: DocumentId) => void;
}

function EditExisting({ id, onDone, onOpen, onCreateInvoice, onCopy, onNewVersion }: ExistingProps) {
  const found = useApp((s) => s.documents.get(id));
  const quote = found && isQuote(found) && !found.deletedAt ? found : null;
  // deleted or gone (for example merged away from another device): back to the list
  useEffect(() => {
    if (!quote) onDone();
  }, [quote, onDone]);
  if (!quote) return null;
  if (quote.issued) {
    return <IssuedQuoteView quote={{ ...quote, issued: quote.issued }} onDone={onDone} onOpen={onOpen} onCreateInvoice={onCreateInvoice} onCopy={onCopy} onNewVersion={onNewVersion} />;
  }
  const start = () => draftFromQuote(quote.customerId, quote, currentLang(), newLineKey);
  return <QuoteEditor quote={quote} copyOf={null} revises={quote.revises} start={start} onDone={onDone} onCreateInvoice={onCreateInvoice} />;
}

/* ---------- List ---------- */

function QuoteList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: DocumentId) => void }) {
  const documents = useApp((s) => s.documents);
  const contacts = useApp((s) => s.contacts);
  const smallBusiness = useSmallBusiness();
  const [query, setQuery] = useState('');
  const [validity, setValidity] = useState<ValidityFilter>('all');
  const searchId = useId();
  const active = useMemo(() => [...documents.values()].filter(isQuote).filter((d) => !d.deletedAt).sort(byQuoteDate), [documents]);
  // a finalized quote keeps the customer and the VAT scheme it was finalized with
  const customerName = (q: QuoteFile) => q.issued?.snapshot.customer.name ?? contacts.get(q.customerId)?.name ?? '';
  const gross = (q: QuoteFile) => documentTotals(q.lines, q.issued ? q.issued.snapshot.company.tax.vat.kind === 'smallBusiness' : smallBusiness).gross;
  const today = isoDateOf(new Date());
  const inFilter = (q: QuoteFile, f: ValidityFilter) => f === 'all' || isExpired(q, today) === (f === 'expired');
  const matching = active.filter((q) => quoteMatches(q, customerName(q), query) || (q.issued?.number.toLowerCase().includes(query.trim().toLowerCase()) ?? false));
  const shown = matching.filter((q) => inFilter(q, validity));
  const lang = currentLang();
  const stats = changeStats(active);
  // a quote with a finalized later version is replaced
  const replaced = new Set(active.flatMap((q) => (q.issued && q.revises ? [q.revises.id] : [])));

  return (
    <div className="page wide">
      <header className="top">
        <h1>{t('quotes.title')}</h1>
        <span className="sp" />
        <button type="button" className="btn primary" onClick={onNew}>
          <Icon n="plus" s={14} />
          {t('quotes.new')}
        </button>
      </header>
      <p className="note page-note" role="note">
        {t('quotes.draftNote')}
      </p>
      {active.length === 0 ? (
        <p className="empty">{t('quotes.empty')}</p>
      ) : (
        <>
          <div className="list-tools">
            <label className="visually-hidden" htmlFor={searchId}>
              {t('quotes.search')}
            </label>
            <input id={searchId} className="search-in" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('quotes.searchPlaceholder')} />
            <div className="seg" role="group" aria-label={t('quotes.filter')}>
              {VALIDITY_FILTERS.map((f) => (
                <button key={f.value} type="button" className={validity === f.value ? 'on' : ''} aria-pressed={validity === f.value} onClick={() => setValidity(f.value)}>
                  {t(f.label)} <span className="seg-n">{matching.filter((q) => inFilter(q, f.value)).length}</span>
                </button>
              ))}
            </div>
          </div>
          {stats.total > 0 && <p className="muted page-note">{t('quotes.changeStats', { ...stats })}</p>}
          {shown.length === 0 ? (
            <p className="empty" role="status">
              {t('quotes.noMatch')}
            </p>
          ) : (
            <table className="table">
              <caption className="visually-hidden">{t('quotes.count', { n: shown.length })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('quotes.colNumber')}</th>
                  <th scope="col">{t('documents.colDate')}</th>
                  <th scope="col">{t('documents.colCustomer')}</th>
                  <th scope="col">{t('documents.colSubject')}</th>
                  <th scope="col">{t('quotes.colValidUntil')}</th>
                  <th scope="col" className="num">
                    {t('documents.colTotal')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((q) => (
                  <tr key={q.id}>
                    <td>
                      {q.issued ? q.issued.number : <span className="badge muted-badge">{t('quotes.draft')}</span>}
                      {!q.issued && q.revises && <span className="badge muted-badge list-badge">{t('quotes.versionBadge', { version: q.revises.version })}</span>}
                      {replaced.has(q.id) && <span className="badge muted-badge list-badge">{t('quotes.replaced')}</span>}
                    </td>
                    <td>{formatDate(q.date)}</td>
                    <td>
                      <button type="button" className="row-link" onClick={() => onOpen(q.id)}>
                        <span>{customerName(q)}</span>
                      </button>
                    </td>
                    <td>{q.subject || <span className="muted">{t('documents.noSubject')}</span>}</td>
                    <td>
                      {formatDate(q.validUntil)} {isExpired(q, today) && <span className="badge muted-badge">{t('quotes.expired')}</span>}
                    </td>
                    <td className="num">{formatCents(gross(q), lang)}</td>
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
  /** The saved draft, or null for a new quote */
  quote: QuoteFile | null;
  /** The number of the finalized quote this new one is a copy of, if any */
  copyOf: string | null;
  /** For a new version: the finalized quote it replaces */
  revises: RevisedQuote | null;
  /** The draft the form starts with */
  start: () => QuoteDraft;
  onDone: () => void;
  onCreateInvoice: (quoteId: DocumentId) => void;
}

function QuoteEditor({ quote, copyOf, revises, start, onDone, onCreateInvoice }: EditorProps) {
  const contacts = useApp((s) => s.contacts);
  const documents = useApp((s) => s.documents);
  const smallBusiness = useSmallBusiness();
  const lang = currentLang();
  const [draft, setDraft] = useState<QuoteDraft>(start);
  const [errors, setErrors] = useState<readonly QuoteFieldError[]>([]);
  const [checked, setChecked] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), []);

  const set = (patch: Partial<QuoteDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (checked) {
      const r = readQuote(next, lang, smallBusiness);
      setErrors(r.ok ? [] : r.error);
    }
  };
  const e = (f: QuoteField) => fieldError(errors, f);
  const totals = draftTotals(draft.lines, lang, smallBusiness);
  // a negative sum shows up while it is typed, not only on "Save"
  const lineError = (path: LineFieldPath | 'lines') => e(path) ?? (path === 'lines' && hasNegativeRate(totals) ? problemText('negativeTotal') : undefined);
  const sections: JumpSection[] = [
    { id: 'quote-sec-head', title: t('quotes.sectionQuote'), icon: 'quote' },
    { id: 'quote-sec-lines', title: t('lines.title'), icon: 'invoice' },
    { id: 'quote-sec-closing', title: t('documents.closingText'), icon: 'text' },
    { id: 'quote-sec-finalize', title: t('quotes.sectionFinalize'), icon: 'check' },
  ];
  const options = customerOptions(contacts, draft.customerId);
  const findContact = (id: string) => [...contacts.values()].find((c) => c.id === id);
  const customerName = (id: string) => findContact(id)?.name ?? '';
  const newerVersion = replacedAlready([...documents.values()].filter(isQuote), { id: quote?.id ?? '', customerId: draft.customerId, deletedAt: null, issued: null, revises });
  const problems = quoteProblems({ hasCustomer: !!findContact(draft.customerId), lineCount: draft.lines.length, validUntil: draft.validUntil, newerVersion }, isoDateOf(new Date()));

  /** Checks the draft and puts it into the store; returns the quote's ID and its customer's name, or null on errors */
  const store = (): { id: DocumentId; customerName: string } | null => {
    const r = readQuote(draft, lang, smallBusiness);
    const customer = r.ok ? [...contacts.values()].find((c) => c.id === r.value.customerId) : undefined;
    if (!r.ok || !customer) {
      setChecked(true);
      setErrors(r.ok ? [{ field: 'customerId', problem: 'required' }] : r.error);
      focusFirstError('quote-form');
      return null;
    }
    if (quote) updateQuote(quote.id, customer.id, r.value.content);
    return { id: quote ? quote.id : addQuote(customer.id, r.value.content, revises), customerName: customer.name };
  };

  const save = () => {
    const saved = store();
    if (!saved) return;
    showToast(t('quotes.saved', { name: saved.customerName }));
    onDone();
  };

  // the invoice is made from the quote as saved, so changes not saved yet are saved first
  const createInvoice = () => {
    const saved = store();
    if (saved) onCreateInvoice(saved.id);
  };

  const remove = () => {
    if (!quote) return;
    deleteDocument(quote.id);
    showToast(t('quotes.deleted', { name: customerName(quote.customerId) }));
    onDone();
  };

  const title = quote
    ? [customerName(quote.customerId), quote.subject].filter(Boolean).join(' · ')
    : revises
      ? t('quotes.versionTitle', { version: revises.version, number: revises.firstNumber })
      : t('quotes.new');

  return (
    <div className="page with-panel">
      <header className="top">
        <button type="button" className="icon-btn" onClick={onDone} aria-label={t('documents.backToList')}>
          <Icon n="chevL" />
        </button>
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
      </header>
      <div className="split">
        <JumpNav label={t('quotes.sections')} sections={sections} />
        <form
          className="form quote-form"
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault();
            save();
          }}
        >
          <section className="card" id="quote-sec-head" aria-labelledby="quote-head">
            <h2 id="quote-head" tabIndex={-1}>{t('quotes.sectionQuote')}</h2>
            {copyOf && <p className="f-hint">{t('quotes.copyOf', { number: copyOf })}</p>}
            {revises && (
              <p className="f-hint">
                {t('quotes.versionOf', {
                  version: revises.version,
                  first: revises.firstNumber,
                  number: revises.number,
                  date: formatDate(revises.date),
                  next: versionNumber(revises.firstNumber, revises.version),
                })}
              </p>
            )}
            <SelectField
              label={t('documents.customer')}
              hint={options.length === 0 ? t('documents.noCustomers') : undefined}
              value={draft.customerId}
              options={[{ value: '', label: t('documents.customerChoose') }, ...options]}
              onChange={(customerId) => set({ customerId })}
              error={e('customerId')}
              required
            />
            <Row>
              <TextField className="w-date" type="date" label={t('quotes.date')} value={draft.date} onChange={(date) => set({ date })} error={e('date')} required />
              <TextField className="w-date" type="date" label={t('quotes.validUntil')} value={draft.validUntil} onChange={(validUntil) => set({ validUntil })} error={e('validUntil')} required />
            </Row>
            <TextField label={t('documents.subject')} hint={t('documents.subjectHint')} value={draft.subject} onChange={(subject) => set({ subject })} error={e('subject')} maxLength={QUOTE_LIMITS.subject} />
            <TextArea label={t('documents.introText')} hint={t('documents.introTextHint')} value={draft.introText} onChange={(introText) => set({ introText })} error={e('introText')} maxLength={QUOTE_LIMITS.text} />
          </section>

          <section className="card" id="quote-sec-lines" aria-labelledby="quote-lines">
            <h2 id="quote-lines" tabIndex={-1}>
              {t('lines.title')}
            </h2>
            <LinesEditor lines={draft.lines} onChange={(lines) => set({ lines })} errorFor={lineError} withoutVat={smallBusiness} />
            <Totals totals={totals} note={smallBusiness ? 'smallBusiness' : null} />
          </section>

          <section className="card" id="quote-sec-closing" aria-labelledby="quote-closing">
            <h2 id="quote-closing" tabIndex={-1}>{t('documents.closingText')}</h2>
            <TextArea label={t('documents.closingText')} hint={t('documents.closingTextHint')} value={draft.closingText} onChange={(closingText) => set({ closingText })} error={e('closingText')} maxLength={QUOTE_LIMITS.text} />
          </section>

          <section className="card" id="quote-sec-finalize" aria-labelledby="quote-finalize">
            <h2 id="quote-finalize" tabIndex={-1}>
              {t('quotes.sectionFinalize')}
            </h2>
            <p className="muted">{t('quotes.finalizeLater')}</p>
            {problems.length === 0 ? (
              <>
                <ul className="checks">
                  <li className="ok">
                    <Icon n="check" s={14} />
                    {t('quotes.ready')}
                  </li>
                </ul>
                {quote ? <FinalizeAction prepare={() => store()?.id ?? null} /> : <p className="f-hint">{t('quotes.finalizeSaveFirst')}</p>}
              </>
            ) : (
              <>
                <p className="muted" id="quote-missing">
                  {t('quotes.missing')}
                </p>
                <ul className="checks" aria-labelledby="quote-missing">
                  {problems.map((p) => (
                    <li key={p} className="bad">
                      <Icon n="alert" s={14} />
                      {quoteProblemText(p)}
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
            {quote && (
              <>
                <PdfButton prepare={() => store()?.id ?? null} />
                <button type="button" className="btn" onClick={createInvoice}>
                  <Icon n="invoice" s={14} />
                  {t('quotes.createInvoice')}
                </button>
              </>
            )}
            <span className="sp" />
            {quote &&
              (confirmDelete ? (
                <div className="confirm" role="group" aria-label={t('quotes.deleteConfirm')}>
                  <span>{t('quotes.deleteConfirm')}</span>
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
 * Finalizing after asking: changes not saved yet are saved first (`prepare`), then the quote gets its number. The view
 * switches to the finalized quote by itself, because the store then holds it as finalized.
 */
function FinalizeAction({ prepare }: { prepare: () => DocumentId | null }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const id = prepare();
    if (!id) {
      setConfirming(false);
      return;
    }
    setBusy(true);
    const r = await finalizeQuote(id);
    setBusy(false);
    if (r.ok) showToast(t(r.auditWritten ? 'quotes.finalizedToast' : 'quotes.finalizedAuditMissing', { number: r.document.issued?.number ?? '' }));
    else {
      setConfirming(false);
      showToast(finalizeFailureText(r.failure));
    }
  };
  if (!confirming) {
    return (
      <div className="card-actions">
        <button type="button" className="btn primary" onClick={() => setConfirming(true)}>
          <Icon n="check" s={14} />
          {t('quotes.finalize')}
        </button>
      </div>
    );
  }
  return (
    <div className="confirm" role="group" aria-label={t('quotes.finalizeConfirm')}>
      <span>{t('quotes.finalizeConfirm')}</span>
      <button type="button" className="btn primary" onClick={() => void run()} disabled={busy} autoFocus>
        {busy ? t('quotes.finalizeBusy') : t('quotes.finalizeNow')}
      </button>
      <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>
        {t('common.cancel')}
      </button>
    </div>
  );
}
