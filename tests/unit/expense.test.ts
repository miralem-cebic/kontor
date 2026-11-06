import { describe, expect, it } from 'vitest';
import { basisPoints, cents } from '../../src/domain/money';
import { draftFromExpense, emptyExpenseDraft, EXPENSE_LIMITS, expenseMatches, expenseVat, readExpense, type ExpenseDraft, type ExpenseProfile } from '../../src/domain/expense';
import { REDUCED_RATE, STANDARD_RATE, ZERO_RATE } from '../../src/domain/vat';

const TODAY = '2026-11-06';
const ACCOUNTS = ['account-bank', 'account-paypal'];

/** A draft that passes every check against ACCOUNTS */
const draft = (over: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  date: '2026-10-28',
  supplier: 'Büro Schmidt GmbH',
  reference: 'R-4711',
  gross: '119,00',
  taxTreatment: 'domestic',
  vatRate: STANDARD_RATE,
  category: 'Büromaterial',
  accountId: 'account-bank',
  note: 'Toner',
  ...over,
});

const check = (d: ExpenseDraft, locale: 'de' | 'en' = 'de') => readExpense(d, locale, ACCOUNTS);

/** The problems of a failed check as "field:problem", in the order they are reported */
function problems(d: ExpenseDraft, locale: 'de' | 'en' = 'de'): string[] {
  const r = check(d, locale);
  if (r.ok) return [];
  return r.error.map((e) => `${e.field}:${e.problem}`);
}

describe('readExpense', () => {
  it('reads a complete domestic expense with its amount in cents', () => {
    const r = check(draft());
    expect(r).toEqual({
      ok: true,
      value: {
        date: '2026-10-28',
        supplier: 'Büro Schmidt GmbH',
        reference: 'R-4711',
        gross: 11_900,
        taxTreatment: 'domestic',
        vatRate: 1_900,
        category: 'Büromaterial',
        accountId: 'account-bank',
        note: 'Toner',
      },
    });
  });

  it('reads the amount in the language of the form', () => {
    const r = readExpense(draft({ gross: '119.00' }), 'en', ACCOUNTS);
    expect(r.ok && r.value.gross).toBe(11_900);
  });

  it('asks for the date, the supplier and the amount', () => {
    expect(problems(draft({ date: '', supplier: '', gross: '' }))).toEqual(['date:date', 'supplier:required', 'gross:required']);
  });

  it('refuses an amount of 0, a negative amount and text that is not a number', () => {
    expect(problems(draft({ gross: '0,00' }))).toEqual(['gross:amountNotPositive']);
    expect(problems(draft({ gross: '-5,00' }))).toEqual(['gross:priceNegative']);
    expect(problems(draft({ gross: 'abc' }))).toEqual(['gross:price']);
  });

  it('refuses an amount above the largest one a file may hold', () => {
    expect(problems(draft({ gross: '100000000000,00' }))).toEqual(['gross:price']);
  });

  it('refuses an account that was removed, and takes no account when none is chosen', () => {
    expect(problems(draft({ accountId: 'account-gone' }))).toEqual(['accountId:accountRemoved']);
    const r = check(draft({ accountId: '' }));
    expect(r.ok && r.value.accountId).toBe(null);
  });

  it('keeps the rate of a domestic expense, the reduced rate included', () => {
    const r = check(draft({ vatRate: REDUCED_RATE, gross: '107,00' }));
    expect(r.ok && r.value.vatRate).toBe(700);
  });

  it('has no VAT rate for an expense without German VAT, whatever the draft says', () => {
    for (const taxTreatment of ['euReverseCharge', 'thirdCountry', 'noVat'] as const) {
      const r = check(draft({ taxTreatment, vatRate: STANDARD_RATE }));
      expect(r.ok && r.value.vatRate, taxTreatment).toBe(0);
    }
  });

  it('refuses a text that is longer than its limit', () => {
    expect(problems(draft({ supplier: 'x'.repeat(EXPENSE_LIMITS.supplier + 1) }))).toEqual(['supplier:tooLong']);
  });

  it('allows the reference, the category and the note to stay empty', () => {
    const r = check(draft({ reference: '', category: '', note: '' }));
    expect(r.ok && [r.value.reference, r.value.category, r.value.note]).toEqual(['', '', '']);
  });
});

describe('expenseVat', () => {
  it('is the VAT inside the gross amount of a domestic expense', () => {
    expect(expenseVat({ gross: cents(11_900), taxTreatment: 'domestic', vatRate: basisPoints(1_900) })).toBe(1_900);
    expect(expenseVat({ gross: cents(10_700), taxTreatment: 'domestic', vatRate: basisPoints(700) })).toBe(700);
  });

  it('is 0 for a domestic expense at the zero rate and for every expense without German VAT', () => {
    expect(expenseVat({ gross: cents(5_000), taxTreatment: 'domestic', vatRate: ZERO_RATE })).toBe(0);
    expect(expenseVat({ gross: cents(11_900), taxTreatment: 'euReverseCharge', vatRate: ZERO_RATE })).toBe(0);
    expect(expenseVat({ gross: cents(11_900), taxTreatment: 'noVat', vatRate: ZERO_RATE })).toBe(0);
  });
});

describe('expenseMatches', () => {
  const expense: ExpenseProfile = {
    date: '2026-10-28',
    supplier: 'Büro Schmidt GmbH',
    reference: 'R-4711',
    gross: cents(11_900),
    taxTreatment: 'domestic',
    vatRate: basisPoints(1_900),
    category: 'Büromaterial',
    accountId: null,
    note: 'Toner für den Drucker',
  };

  it('matches everything for an empty search', () => {
    expect(expenseMatches(expense, '   ')).toBe(true);
  });

  it('searches supplier, reference, category and note, without case', () => {
    expect(expenseMatches(expense, 'schmidt')).toBe(true);
    expect(expenseMatches(expense, 'r-47')).toBe(true);
    expect(expenseMatches(expense, 'BÜROMATERIAL')).toBe(true);
    expect(expenseMatches(expense, 'drucker')).toBe(true);
    expect(expenseMatches(expense, 'Telekom')).toBe(false);
  });
});

describe('draft', () => {
  it('starts with today, the company default account and a domestic expense at the standard rate', () => {
    const d = emptyExpenseDraft(TODAY, 'account-bank');
    expect(d).toMatchObject({ date: TODAY, gross: '', taxTreatment: 'domestic', vatRate: STANDARD_RATE, accountId: 'account-bank' });
  });

  it('reads back the same expense that it was made from', () => {
    const profile: ExpenseProfile = {
      date: '2026-10-28',
      supplier: 'Telekom',
      reference: '',
      gross: cents(4_999),
      taxTreatment: 'domestic',
      vatRate: basisPoints(1_900),
      category: 'Telefon',
      accountId: 'account-paypal',
      note: '',
    };
    const r = readExpense(draftFromExpense(profile, 'de'), 'de', ACCOUNTS);
    expect(r).toEqual({ ok: true, value: profile });
  });
});
