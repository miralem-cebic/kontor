// Quotes (Angebote): to whom, when, how long they are valid, texts around the lines, and the lines. A quote is a
// draft for now; numbering and the PDF follow (ADR 0004). The quote form edits a draft of plain strings;
// `readQuote` checks it.

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

/* ---------- Checks ---------- */

/** Checks a quote draft. A draft may have no lines yet; every line it has must be complete. */
export function readQuote(d: QuoteDraft, locale: MoneyLocale): Result<{ customerId: string; content: QuoteContent }, QuoteFieldError[]> {
  const c = new Checker<QuoteField>();
  if (!d.customerId) c.add('customerId', 'required');
  if (!isIsoDate(d.date)) c.add('date', 'date');
  if (!isIsoDate(d.validUntil)) c.add('validUntil', 'date');
  else if (c.passed('date') && d.validUntil < d.date) c.add('validUntil', 'validUntil');
  const subject = c.optionalText('subject', d.subject, QUOTE_LIMITS.subject);
  const introText = c.optionalText('introText', d.introText, QUOTE_LIMITS.text);
  const closingText = c.optionalText('closingText', d.closingText, QUOTE_LIMITS.text);
  const lines = readLines(c, d.lines, locale);
  return c.done(() => ({ customerId: d.customerId, content: { date: d.date, validUntil: d.validUntil, subject, introText, closingText, lines } }));
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
