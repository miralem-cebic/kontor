// Quotes (Angebote): to whom, when, how long they are valid, texts around the lines, and the lines. A quote is a
// draft until it is finalized ("Angebot abschließen"): that gives it its number, writes its PDF and makes it read-only,
// like issuing an invoice (ADR 0004). The quote form edits a draft of plain strings; `readQuote` checks it, and
// `quoteProblems` lists what still keeps a saved quote from being finalized.

import type { Result } from '../data/result';
import { Checker, type FieldError } from './check';
import { addDays, isIsoDate } from './dates';
import { draftFromLine, readLines, type DocumentLine, type LineDraft, type LineFieldPath } from './document';
import type { MoneyLocale } from './money';

export interface QuoteContent {
  /** Date of the quote, YYYY-MM-DD */
  date: string;
  /** Last day the quote is valid, YYYY-MM-DD, not before `date` */
  validUntil: string;
  /** Subject line, for example "Website-Relaunch"; empty when not given */
  subject: string;
  /** Text above the lines (greeting, reference); empty when not given */
  introText: string;
  /** Text below the lines (conditions, closing); empty when not given */
  closingText: string;
  lines: DocumentLine[];
}

export const QUOTE_LIMITS = { subject: 200, text: 4000 } as const;

/** How long a new quote is valid, in days; it can be changed for every quote */
export const DEFAULT_VALIDITY_DAYS = 30;

/* ---------- Draft ---------- */

export interface QuoteDraft {
  /** The chosen customer; empty when none is chosen yet */
  customerId: string;
  date: string;
  validUntil: string;
  subject: string;
  introText: string;
  closingText: string;
  lines: LineDraft[];
}

export type QuoteField = Exclude<keyof QuoteDraft, 'lines'> | 'lines' | LineFieldPath;
export type QuoteFieldError = FieldError<QuoteField>;

export const emptyQuoteDraft = (today: string): QuoteDraft => ({
  customerId: '',
  date: today,
  validUntil: addDays(today, DEFAULT_VALIDITY_DAYS),
  subject: '',
  introText: '',
  closingText: '',
  lines: [],
});

/** `newKey` gives every line a key for the editor */
export const draftFromQuote = (customerId: string, q: QuoteContent, locale: MoneyLocale, newKey: () => string): QuoteDraft => ({
  customerId,
  date: q.date,
  validUntil: q.validUntil,
  subject: q.subject,
  introText: q.introText,
  closingText: q.closingText,
  lines: q.lines.map((l) => draftFromLine(newKey(), l, locale)),
});

/** A new draft with the content of a quote, dated `today` and valid for the usual days: a finalized quote is copied like this */
export const quoteDraftFromCopy = (customerId: string, q: QuoteContent, today: string, locale: MoneyLocale, newKey: () => string): QuoteDraft => ({
  ...draftFromQuote(customerId, q, locale, newKey),
  date: today,
  validUntil: addDays(today, DEFAULT_VALIDITY_DAYS),
});

/* ---------- Checks ---------- */

/** Checks a quote draft. A draft may have no lines yet; every line it has must be complete, and their sums must not be negative. */
export function readQuote(d: QuoteDraft, locale: MoneyLocale, smallBusiness: boolean): Result<{ customerId: string; content: QuoteContent }, QuoteFieldError[]> {
  const c = new Checker<QuoteField>();
  if (!d.customerId) c.add('customerId', 'required');
  if (!isIsoDate(d.date)) c.add('date', 'date');
  if (!isIsoDate(d.validUntil)) c.add('validUntil', 'date');
  else if (c.passed('date') && d.validUntil < d.date) c.add('validUntil', 'validUntil');
  const subject = c.optionalText('subject', d.subject, QUOTE_LIMITS.subject);
  const introText = c.optionalText('introText', d.introText, QUOTE_LIMITS.text);
  const closingText = c.optionalText('closingText', d.closingText, QUOTE_LIMITS.text);
  const lines = readLines(c, d.lines, locale, smallBusiness);
  return c.done(() => ({ customerId: d.customerId, content: { date: d.date, validUntil: d.validUntil, subject, introText, closingText, lines } }));
}

/* ---------- Ready to finalize ---------- */

/**
 * What keeps a saved quote from being finalized:
 * - `noCustomer`: no customer is chosen, or the contact is gone.
 * - `noLines`: a quote offers at least one line.
 * - `expired`: the last valid day has passed; a quote is not sent when it has run out already.
 * A quote is no invoice (§ 14 UStG), so it needs neither the customer's address nor a gapless number.
 */
export type QuoteProblem = 'noCustomer' | 'noLines' | 'expired';

export interface QuoteFacts {
  hasCustomer: boolean;
  lineCount: number;
  validUntil: string;
}

/** The problems in the order of the form; none means the quote can be finalized. `today` is an ISO date. */
export function quoteProblems(f: QuoteFacts, today: string): QuoteProblem[] {
  const problems: QuoteProblem[] = [];
  if (!f.hasCustomer) problems.push('noCustomer');
  if (f.lineCount === 0) problems.push('noLines');
  if (f.validUntil < today) problems.push('expired');
  return problems;
}

/* ---------- Lists ---------- */

/** Has the quote run out? `today` is an ISO date. */
export const isExpired = (q: QuoteContent, today: string): boolean => q.validUntil < today;

/** Does the quote match a search text? The customer name and the subject are searched. */
export function quoteMatches(q: QuoteContent, customerName: string, query: string): boolean {
  const s = query.trim().toLocaleLowerCase('de');
  if (!s) return true;
  return [customerName, q.subject].some((v) => v.toLocaleLowerCase('de').includes(s));
}

/** Newest first; the same day by subject */
export const byQuoteDate = (a: QuoteContent, b: QuoteContent): number => b.date.localeCompare(a.date) || a.subject.localeCompare(b.subject, 'de');
