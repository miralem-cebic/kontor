import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Row, SelectField, TextArea, TextField } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { JumpNav, type JumpSection } from '../../components/JumpNav';
import { byContactName } from '../../domain/contact';
import { isoDateOf, toLocalDate } from '../../domain/dates';
import { documentTotals, draftTotals, hasNegativeRate, type LineFieldPath } from '../../domain/document';
import { formatCents } from '../../domain/money';
import { byQuoteDate, draftFromQuote, emptyQuoteDraft, isExpired, QUOTE_LIMITS, quoteMatches, readQuote, type QuoteDraft, type QuoteField, type QuoteFieldError } from '../../domain/quote';
import type { DocumentId } from '../../data/ids';
import type { ContactFile, QuoteFile } from '../../data/types';
import { currentLang, fmt, t, type MessageKey } from '../../i18n';
import { fieldError, problemText } from '../../lib/labels';
import { addQuote, deleteDocument, showToast, updateQuote, useApp } from '../../store/appStore';
import { LinesEditor, newLineKey, Totals } from '../documents/LinesEditor';

// Quotes: a searchable list and a form for a new or an existing quote. The form edits a draft; only "Save" puts
// the checked quote into the store (and the persister writes it). Quotes are drafts until numbering and the PDF come.

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; id: DocumentId };
type ValidityFilter = 'all' | 'valid' | 'expired';

const VALIDITY_FILTERS: { value: ValidityFilter; label: MessageKey }[] = [
  { value: 'all', label: 'quotes.filterAll' },
  { value: 'valid', label: 'quotes.filterValid' },
  { value: 'expired', label: 'quotes.filterExpired' },
];

const useSmallBusiness = () => useApp((s) => s.company?.tax.vat.kind === 'smallBusiness');
const formatDate = (iso: string) => fmt(toLocalDate(iso), 'P');

export function QuotesView() {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const back = () => setMode({ kind: 'list' });
  switch (mode.kind) {
    case 'list':
      return <QuoteList onNew={() => setMode({ kind: 'new' })} onOpen={(id) => setMode({ kind: 'edit', id })} />;
    case 'new':
      return <QuoteEditor quote={null} onDone={back} />;
    case 'edit':
      return <EditExisting id={mode.id} onDone={back} />;
  }
}

function EditExisting({ id, onDone }: { id: DocumentId; onDone: () => void }) {
  const quote = useApp((s) => s.documents.get(id));
  // deleted or gone (for example merged away from another device): back to the list
  useEffect(() => {
    if (!quote || quote.deletedAt) onDone();
  }, [quote, onDone]);
  return quote && !quote.deletedAt ? <QuoteEditor key={id} quote={quote} onDone={onDone} /> : null;
}

/* ---------- List ---------- */

function QuoteList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: DocumentId) => void }) {
  const documents = useApp((s) => s.documents);
  const contacts = useApp((s) => s.contacts);
  const smallBusiness = useSmallBusiness();
  const [query, setQuery] = useState('');
  const [validity, setValidity] = useState<ValidityFilter>('all');
  const searchId = useId();
  const active = useMemo(() => [...documents.values()].filter((d) => !d.deletedAt).sort(byQuoteDate), [documents]);
  const customerName = (q: QuoteFile) => contacts.get(q.customerId)?.name ?? '';
  const today = isoDateOf(new Date());
  const inFilter = (q: QuoteFile, f: ValidityFilter) => f === 'all' || isExpired(q, today) === (f === 'expired');
  const matching = active.filter((q) => quoteMatches(q, customerName(q), query));
  const shown = matching.filter((q) => inFilter(q, validity));
  const lang = currentLang();

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
          {shown.length === 0 ? (
            <p className="empty" role="status">
              {t('quotes.noMatch')}
            </p>
          ) : (
            <table className="table">
              <caption className="visually-hidden">{t('quotes.count', { n: shown.length })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('quotes.colDate')}</th>
                  <th scope="col">{t('quotes.colCustomer')}</th>
                  <th scope="col">{t('quotes.colSubject')}</th>
                  <th scope="col">{t('quotes.colValidUntil')}</th>
                  <th scope="col" className="num">
                    {t('quotes.colTotal')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((q) => (
                  <tr key={q.id}>
                    <td>{formatDate(q.date)}</td>
                    <td>
                      <button type="button" className="row-link" onClick={() => onOpen(q.id)}>
                        <span>{customerName(q)}</span>
                      </button>
                    </td>
                    <td>{q.subject || <span className="muted">{t('quotes.noSubject')}</span>}</td>
                    <td>
                      {formatDate(q.validUntil)} {isExpired(q, today) && <span className="badge muted-badge">{t('quotes.expired')}</span>}
                    </td>
                    <td className="num">{formatCents(documentTotals(q.lines, smallBusiness).gross, lang)}</td>
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

/** The active customers, and the quote's customer even when it was deleted or is no customer any more */
function customerOptions(contacts: ReadonlyMap<string, ContactFile>, current: string): { value: string; label: string }[] {
  const list = [...contacts.values()].filter((c) => (c.roles.customer && !c.deletedAt) || c.id === current).sort(byContactName);
  return list.map((c) => ({ value: c.id, label: c.deletedAt ? t('quotes.customerDeleted', { name: c.name }) : c.name }));
}

function QuoteEditor({ quote, onDone }: { quote: QuoteFile | null; onDone: () => void }) {
  const contacts = useApp((s) => s.contacts);
  const smallBusiness = useSmallBusiness();
  const lang = currentLang();
  const [draft, setDraft] = useState<QuoteDraft>(() => (quote ? draftFromQuote(quote.customerId, quote, lang, newLineKey) : emptyQuoteDraft(isoDateOf(new Date()))));
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
    { id: 'quote-sec-closing', title: t('quotes.closingText'), icon: 'text' },
  ];
  const options = customerOptions(contacts, draft.customerId);
  const customerName = (id: string) => [...contacts.values()].find((c) => c.id === id)?.name ?? '';

  const save = () => {
    const r = readQuote(draft, lang, smallBusiness);
    const customer = r.ok ? [...contacts.values()].find((c) => c.id === r.value.customerId) : undefined;
    if (!r.ok || !customer) {
      setChecked(true);
      setErrors(r.ok ? [{ field: 'customerId', problem: 'required' }] : r.error);
      requestAnimationFrame(() => {
        const el = document.querySelector('.quote-form [aria-invalid="true"]');
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.focus();
      });
      return;
    }
    if (quote) updateQuote(quote.id, customer.id, r.value.content);
    else addQuote(customer.id, r.value.content);
    showToast(t('quotes.saved', { name: customer.name }));
    onDone();
  };

  const remove = () => {
    if (!quote) return;
    deleteDocument(quote.id);
    showToast(t('quotes.deleted', { name: customerName(quote.customerId) }));
    onDone();
  };

  const title = quote ? [customerName(quote.customerId), quote.subject].filter(Boolean).join(' · ') : t('quotes.new');

  return (
    <div className="page with-panel">
      <header className="top">
        <button type="button" className="icon-btn" onClick={onDone} aria-label={t('quotes.backToList')}>
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
            <SelectField
              label={t('quotes.customer')}
              hint={options.length === 0 ? t('quotes.noCustomers') : undefined}
              value={draft.customerId}
              options={[{ value: '', label: t('quotes.customerChoose') }, ...options]}
              onChange={(customerId) => set({ customerId })}
              error={e('customerId')}
              required
            />
            <Row>
              <TextField className="w-date" type="date" label={t('quotes.date')} value={draft.date} onChange={(date) => set({ date })} error={e('date')} required />
              <TextField className="w-date" type="date" label={t('quotes.validUntil')} value={draft.validUntil} onChange={(validUntil) => set({ validUntil })} error={e('validUntil')} required />
            </Row>
            <TextField label={t('quotes.subject')} hint={t('quotes.subjectHint')} value={draft.subject} onChange={(subject) => set({ subject })} error={e('subject')} maxLength={QUOTE_LIMITS.subject} />
            <TextArea label={t('quotes.introText')} hint={t('quotes.introTextHint')} value={draft.introText} onChange={(introText) => set({ introText })} error={e('introText')} maxLength={QUOTE_LIMITS.text} />
          </section>

          <section className="card" id="quote-sec-lines" aria-labelledby="quote-lines">
            <h2 id="quote-lines" tabIndex={-1}>
              {t('lines.title')}
            </h2>
            <LinesEditor lines={draft.lines} onChange={(lines) => set({ lines })} errorFor={lineError} smallBusiness={smallBusiness} />
            <Totals totals={totals} smallBusiness={smallBusiness} />
          </section>

          <section className="card" id="quote-sec-closing" aria-labelledby="quote-closing">
            <h2 id="quote-closing" tabIndex={-1}>{t('quotes.closingText')}</h2>
            <TextArea label={t('quotes.closingText')} hint={t('quotes.closingTextHint')} value={draft.closingText} onChange={(closingText) => set({ closingText })} error={e('closingText')} maxLength={QUOTE_LIMITS.text} />
          </section>

          <div className="card-actions">
            <button type="submit" className="btn primary">
              {t('quotes.save')}
            </button>
            <button type="button" className="btn" onClick={onDone}>
              {t('common.cancel')}
            </button>
            <span className="sp" />
            {quote &&
              (confirmDelete ? (
                <div className="confirm" role="group" aria-label={t('quotes.deleteConfirm')}>
                  <span>{t('quotes.deleteConfirm')}</span>
                  <button type="button" className="btn danger" onClick={remove} autoFocus>
                    {t('quotes.delete')}
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button type="button" className="btn ghost danger-text" onClick={() => setConfirmDelete(true)}>
                  {t('quotes.delete')}
                </button>
              ))}
          </div>
        </form>
      </div>
    </div>
  );
}
