// Number patterns for invoices, for example "RE-{YYYY}-{NNNN}" → "RE-2026-0001".
// The number is used as a file name (documents/issued/<number>.pdf), so only characters that are safe in
// file names on every system are allowed. The rules for the counter (one more than the highest known, restarting
// every year when the pattern contains {YYYY} or {YY}) are here; reserving a number in the folder is app/issue.ts
// (ADR 0004).

export const DEFAULT_INVOICE_PATTERN = 'RE-{YYYY}-{NNNN}';
export const MAX_PATTERN_LENGTH = 40;

export type PatternProblem = 'empty' | 'tooLong' | 'invalidCharacter' | 'unknownToken' | 'noCounter' | 'multipleCounters';

type Token = { kind: 'text'; text: string } | { kind: 'year4' } | { kind: 'year2' } | { kind: 'month' } | { kind: 'counter'; digits: number };

const LITERAL = /^[A-Za-z0-9_-]+$/;

function tokenize(pattern: string): Token[] | PatternProblem {
  const tokens: Token[] = [];
  for (const part of pattern.split(/(\{[^{}]*\})/)) {
    if (part === '') continue;
    if (!part.startsWith('{')) {
      if (!LITERAL.test(part)) return 'invalidCharacter';
      tokens.push({ kind: 'text', text: part });
    } else if (part === '{YYYY}') tokens.push({ kind: 'year4' });
    else if (part === '{YY}') tokens.push({ kind: 'year2' });
    else if (part === '{MM}') tokens.push({ kind: 'month' });
    else if (/^\{N{1,10}\}$/.test(part)) tokens.push({ kind: 'counter', digits: part.length - 2 });
    else return 'unknownToken';
  }
  return tokens;
}

/** Why a pattern cannot be used, or null when it can. */
export function patternProblem(pattern: string): PatternProblem | null {
  if (pattern.trim() === '') return 'empty';
  if (pattern.length > MAX_PATTERN_LENGTH) return 'tooLong';
  const tokens = tokenize(pattern);
  if (typeof tokens === 'string') return tokens;
  const counters = tokens.filter((t) => t.kind === 'counter').length;
  if (counters === 0) return 'noCounter';
  if (counters > 1) return 'multipleCounters';
  return null;
}

export interface NumberParts {
  year: number;
  /** 1–12 */
  month: number;
  /** 1 or more */
  counter: number;
}

/** The number for the given parts. The counter is padded with zeros to the width of {N…}; a larger counter is longer. */
export function formatNumber(pattern: string, parts: NumberParts): string {
  const tokens = tokenize(pattern);
  if (typeof tokens === 'string' || patternProblem(pattern)) throw new Error(`Invalid number pattern: ${pattern}`);
  return tokens
    .map((t) => {
      switch (t.kind) {
        case 'text':
          return t.text;
        case 'year4':
          return String(parts.year).padStart(4, '0');
        case 'year2':
          return String(parts.year % 100).padStart(2, '0');
        case 'month':
          return String(parts.month).padStart(2, '0');
        case 'counter':
          return String(parts.counter).padStart(t.digits, '0');
      }
    })
    .join('');
}

/* ---------- Assigning (ADR 0004) ---------- */

/** Does the counter start again every year? It does when the pattern contains {YYYY} or {YY}; a month alone does not. */
export function restartsYearly(pattern: string): boolean {
  const tokens = tokenize(pattern);
  return typeof tokens !== 'string' && tokens.some((t) => t.kind === 'year4' || t.kind === 'year2');
}

/** The counter a number belongs to: the year of the document date when the counter restarts yearly, otherwise "all" */
export const counterKey = (pattern: string, isoDate: string): string => (restartsYearly(pattern) ? isoDate.slice(0, 4) : 'all');

/**
 * The next counter of a key: one more than the highest one known, from the range file or from the issued documents,
 * so that a range file that fell behind (for example a sync conflict) never leads to a number given twice.
 */
export const nextCounter = (known: readonly number[]): number => Math.max(0, ...known) + 1;

/** The number for a document date (YYYY-MM-DD) and a counter */
export function numberFor(pattern: string, isoDate: string, counter: number): string {
  return formatNumber(pattern, { year: Number(isoDate.slice(0, 4)), month: Number(isoDate.slice(5, 7)), counter });
}
