// Dunning (Mahnung): the reminder and the dunning levels 1 to 3 of an overdue invoice, with the default interest (§ 288 BGB)
// and the flat fee of 40 € for a business customer (§ 288 Abs. 5 BGB). kontor works out what a dunning claims; the letter
// and its sending come later. These are estimates for the letter, not legal advice: the default starts for a business
// customer the day after the due date, and for a consumer the day after the first reminder (§ 286 BGB), and a payment
// during an interval is not counted day by day.

import { err, ok, type Result } from '../data/result';
import { Checker, type FieldError } from './check';
import { addDays, daysBetween, isIsoDate } from './dates';
import { BASE_RATES } from './tax/params/baseRate';
import { BASIS_POINTS_PER_UNIT, cents, divideRounded, formatDecimal, MAX_FEE, parseCents, type Cents, type MoneyLocale } from './money';

/** The dunning levels in their order: the payment reminder, then the three dunning levels */
export const DUNNING_LEVELS = ['reminder', 'level1', 'level2', 'level3'] as const;
export type DunningLevel = (typeof DUNNING_LEVELS)[number];

/** A business customer (Unternehmer) or a consumer (Verbraucher) decides the interest and the flat fee */
export type Debtor = 'business' | 'consumer';

/** The default interest is the base rate plus this many basis points (§ 288 Abs. 1 Satz 2 and Abs. 2 BGB) */
export const SPREAD_BP: Record<Debtor, number> = { consumer: 500, business: 900 };

/** The flat fee a business creditor may claim once for a claim in default (§ 288 Abs. 5 Satz 1 BGB) */
export const FLAT_FEE = cents(4_000);

/** Days in the year the interest is counted with (an estimate: the statute counts the days, not a year) */
const DAYS_PER_YEAR = 365;

/** The time the debtor has to pay after a dunning, in days; a free choice that the letter states */
export const DUNNING_PAY_DAYS = 14;

/** A dunning already issued for the invoice: its level, its date, and the flat fee it claimed */
export interface PriorDunning {
  level: DunningLevel;
  date: string;
  flatFee: Cents;
}

/** The level of the next dunning after the issued ones (sorted by date), or null after level 3 */
export function nextLevel(prior: readonly PriorDunning[]): DunningLevel | null {
  const last = prior[prior.length - 1];
  if (!last) return DUNNING_LEVELS[0];
  const index = DUNNING_LEVELS.indexOf(last.level);
  return DUNNING_LEVELS[index + 1] ?? null;
}

/**
 * The interest on `open` for the days from `first` to `last` (both included), at the base rate of each day plus the
 * spread. Each part at one base rate is rounded once, half away from zero. Null when a day has no known base rate.
 */
export function interestOn(open: Cents, first: string, last: string, spreadBp: number): { amount: Cents; days: number } | null {
  const days = daysBetween(first, last) + 1;
  if (days <= 0) return { amount: cents(0), days: 0 };
  let amount = 0;
  let counted = 0;
  BASE_RATES.forEach((step, i) => {
    const next = BASE_RATES[i + 1]?.from;
    const lo = step.from > first ? step.from : first;
    const hi = next !== undefined && addDays(next, -1) < last ? addDays(next, -1) : last;
    if (lo > hi) return;
    const partDays = daysBetween(lo, hi) + 1;
    counted += partDays;
    const rate = step.rate + spreadBp;
    const rounded = divideRounded(BigInt(open) * BigInt(rate) * BigInt(partDays), BigInt(BASIS_POINTS_PER_UNIT * DAYS_PER_YEAR));
    amount += Number(rounded);
  });
  if (counted !== days) return null;
  return { amount: cents(amount), days };
}

/** What the dunning being planned claims on top of the open amount */
export interface DunningPlan {
  level: DunningLevel;
  /** The first day of the interest this dunning claims */
  interestFrom: string;
  interest: Cents;
  flatFee: Cents;
}

/** Why a dunning cannot be planned */
export type DunningProblem = 'cancelled' | 'notOpen' | 'notOverdue' | 'dateInFuture' | 'dateBeforePrevious' | 'noNextLevel' | 'rateUnknown';

export interface DunningFacts {
  /** The amount still open on the invoice */
  open: Cents;
  /** The due date of the invoice */
  due: string;
  /** The date of the dunning */
  date: string;
  /** Today, the latest date a dunning can carry */
  today: string;
  debtor: Debtor;
  /** A cancellation of the invoice exists */
  cancelled: boolean;
  /** The dunnings already issued, sorted by date */
  prior: readonly PriorDunning[];
}

/**
 * Plans the next dunning of an invoice: its level, the interest since the last dunning (or since the default started),
 * and the flat fee for a business customer that has not been charged yet. Every reason it cannot be planned is reported.
 */
export function planDunning(f: DunningFacts): Result<DunningPlan, DunningProblem[]> {
  const problems: DunningProblem[] = [];
  const level = nextLevel(f.prior);
  const last = f.prior[f.prior.length - 1];
  if (f.cancelled) problems.push('cancelled');
  if (f.open === 0) problems.push('notOpen');
  if (f.date <= f.due) problems.push('notOverdue');
  if (f.date > f.today) problems.push('dateInFuture');
  if (last && f.date < last.date) problems.push('dateBeforePrevious');
  if (level === null) problems.push('noNextLevel');

  const interestFrom = last ? addDays(last.date, 1) : addDays(f.debtor === 'business' ? f.due : f.date, 1);
  const interest = interestOn(f.open, interestFrom, f.date, SPREAD_BP[f.debtor]);
  if (interest === null) problems.push('rateUnknown');

  if (problems.length > 0 || level === null || interest === null) return err(problems);
  const flatFee = f.debtor === 'business' && !f.prior.some((p) => p.flatFee > 0) ? FLAT_FEE : cents(0);
  return ok({ level, interestFrom, interest: interest.amount, flatFee });
}

/** The claim as the letter states it: the open amount plus the interest, fees and flat fees of every dunning */
export function claimTotal(open: Cents, dunnings: readonly { interest: Cents; fee: Cents; flatFee: Cents }[]): Cents {
  let total: number = open;
  for (const d of dunnings) total += d.interest + d.fee + d.flatFee;
  return cents(total);
}

/* ---------- The form ---------- */

export interface DunningDraft {
  date: string;
  /** The dunning fee (Mahngebühr) as typed; empty means no fee */
  fee: string;
}

export type DunningField = keyof DunningDraft;
export type DunningFieldError = FieldError<DunningField>;

/** A new dunning starts with today and no fee */
export const emptyDunningDraft = (today: string, locale: MoneyLocale): DunningDraft => ({ date: today, fee: formatDecimal(cents(0), locale) });

/** Checks the text of a dunning draft: a date and a fee that is not negative. Whether the dunning may be issued is planDunning's question. */
export function readDunningDraft(d: DunningDraft, locale: MoneyLocale): Result<{ date: string; fee: Cents }, DunningFieldError[]> {
  const c = new Checker<DunningField>();
  if (!isIsoDate(d.date)) c.add('date', 'date');
  let fee = cents(0);
  const typed = d.fee.trim();
  if (typed) {
    const parsed = parseCents(typed, locale);
    if (parsed === null || parsed > MAX_FEE) c.add('fee', 'price');
    else if (parsed < 0) c.add('fee', 'feeNegative');
    else fee = parsed;
  }
  return c.done(() => ({ date: d.date, fee }));
}
