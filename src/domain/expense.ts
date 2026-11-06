// Expenses (Ausgaben): what the business paid for, with the day the money left, the gross amount, the VAT rate on the
// receipt, the account it was paid from and a category. kontor works on the cash basis (EÜR, § 11 EStG): the date is the
// day of the payment. The expense form edits a draft of plain strings; `readExpense` checks it and turns it into a profile.

import type { Result } from '../data/result';
import { Checker, type FieldError } from './check';
import { isIsoDate } from './dates';
import { cents, formatDecimal, splitGross, type BasisPoints, type Cents, type MoneyLocale } from './money';
import { STANDARD_RATE, ZERO_RATE } from './vat';

/**
 * How the supplier charged VAT: German VAT on the receipt (`domestic`), or none, for the reasons the other values name.
 * The VAT rate of an expense is only kept for `domestic`; every other treatment has rate 0.
 */
export const EXPENSE_TAX_TREATMENTS = ['domestic', 'euReverseCharge', 'thirdCountry', 'noVat'] as const;
export type ExpenseTaxTreatment = (typeof EXPENSE_TAX_TREATMENTS)[number];

export const EXPENSE_LIMITS = {
  supplier: 200,
  reference: 60,
  category: 60,
  note: 500,
  /** 999,999,999.99 €; far above any real expense, a bound for input and file content */
  maxGross: 99_999_999_999,
} as const;

/** What an expense is: the content as the form checks it; the record adds its ID, its creation and its deletion */
export interface ExpenseProfile {
  /** The day the money left the account (YYYY-MM-DD) */
  date: string;
  /** Who was paid; free text */
  supplier: string;
  /** The number of the receipt of the supplier; empty when not given */
  reference: string;
  /** What was paid, VAT included; more than 0 */
  gross: Cents;
  taxTreatment: ExpenseTaxTreatment;
  /** The VAT rate on the receipt; 0 for every treatment but `domestic` */
  vatRate: BasisPoints;
  /** Free text, for example "Telefon"; the line of the Anlage EÜR comes with R3 */
  category: string;
  /** An active account of the company the money left; null for cash or a payment kontor does not know */
  accountId: string | null;
  note: string;
}

/* ---------- Draft and checks ---------- */

/** An expense as the form edits it: strings as typed */
export interface ExpenseDraft {
  date: string;
  supplier: string;
  reference: string;
  /** As typed, in the interface language, VAT included */
  gross: string;
  taxTreatment: ExpenseTaxTreatment;
  vatRate: BasisPoints;
  category: string;
  /** The ID of the account, or '' for none */
  accountId: string;
  note: string;
}

export type ExpenseField = keyof ExpenseDraft;
export type ExpenseFieldError = FieldError<ExpenseField>;

/** A new expense starts with today, the default account of the company and a domestic expense at the standard rate */
export const emptyExpenseDraft = (today: string, defaultAccountId: string): ExpenseDraft => ({
  date: today,
  supplier: '',
  reference: '',
  gross: '',
  taxTreatment: 'domestic',
  vatRate: STANDARD_RATE,
  category: '',
  accountId: defaultAccountId,
  note: '',
});

/** The draft of a saved expense, as the form shows it */
export const draftFromExpense = (p: ExpenseProfile, locale: MoneyLocale): ExpenseDraft => ({
  date: p.date,
  supplier: p.supplier,
  reference: p.reference,
  gross: formatDecimal(p.gross, locale),
  taxTreatment: p.taxTreatment,
  vatRate: p.vatRate,
  category: p.category,
  accountId: p.accountId ?? '',
  note: p.note,
});

/**
 * Checks an expense draft against the active accounts of the company. Every problem is reported at once, so that the
 * form can show all of them. The rate is taken from the draft only for a domestic expense; the others get 0.
 */
export function readExpense(d: ExpenseDraft, locale: MoneyLocale, accounts: readonly string[]): Result<ExpenseProfile, ExpenseFieldError[]> {
  const c = new Checker<ExpenseField>();
  if (!isIsoDate(d.date)) c.add('date', 'date');
  const supplier = c.text('supplier', d.supplier, EXPENSE_LIMITS.supplier);
  const reference = c.optionalText('reference', d.reference, EXPENSE_LIMITS.reference);
  const gross = c.price('gross', d.gross, locale, EXPENSE_LIMITS.maxGross);
  if (c.passed('gross') && gross === 0) c.add('gross', 'amountNotPositive');
  const accountId = d.accountId === '' ? null : d.accountId;
  if (accountId !== null && !accounts.includes(accountId)) c.add('accountId', 'accountRemoved');
  const category = c.optionalText('category', d.category, EXPENSE_LIMITS.category);
  const note = c.optionalText('note', d.note, EXPENSE_LIMITS.note);
  const vatRate = d.taxTreatment === 'domestic' ? d.vatRate : ZERO_RATE;
  return c.done(() => ({ date: d.date, supplier, reference, gross, taxTreatment: d.taxTreatment, vatRate, category, accountId, note }));
}

/* ---------- Amounts ---------- */

/** The German VAT inside the gross amount of an expense; 0 for every treatment without German VAT on the receipt */
export function expenseVat(e: Pick<ExpenseProfile, 'gross' | 'taxTreatment' | 'vatRate'>): Cents {
  return e.taxTreatment === 'domestic' ? splitGross(e.gross, e.vatRate).tax : cents(0);
}

/* ---------- Lists ---------- */

/** Does the expense match a search text? Supplier, reference, category and note are searched. */
export function expenseMatches(e: Pick<ExpenseProfile, 'supplier' | 'reference' | 'category' | 'note'>, query: string): boolean {
  const q = query.trim().toLocaleLowerCase('de');
  if (!q) return true;
  return [e.supplier, e.reference, e.category, e.note].some((v) => v.toLocaleLowerCase('de').includes(q));
}
