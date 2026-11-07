import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { basisPoints, cents } from '../../src/domain/money';
import {
  draftFromPayout,
  emptyPayoutDraft,
  PAYOUT_LIMITS,
  PAYOUT_TAX_TREATMENTS,
  payoutImpliesVat,
  payoutMatches,
  payoutNet,
  payoutTreatmentsFor,
  payoutVat,
  readPayout,
  type PayoutChecks,
  type PayoutDraft,
  type PayoutProfile,
} from '../../src/domain/payout';
import { REDUCED_RATE, STANDARD_RATE, ZERO_RATE } from '../../src/domain/vat';
import { fcParams as params } from './fixtures';

const TODAY = '2026-11-07';

/** Apple Distribution International in Ireland, a payer with a VAT ID of another EU state */
const IRISH = { id: 'payer-ie', vatId: 'IE9700053D' };
/** A German payer with a valid German VAT ID */
const GERMAN = { id: 'payer-de', vatId: 'DE136695976' };
/** A payer outside the EU, no VAT ID */
const AMERICAN = { id: 'payer-us', vatId: '' };

const regular: PayoutChecks = { accounts: ['account-bank', 'account-paypal'], payers: [IRISH, GERMAN, AMERICAN], smallBusiness: false };
const small: PayoutChecks = { ...regular, smallBusiness: true };

/** A draft that passes every check of a regular company */
const draft = (over: Partial<PayoutDraft> = {}): PayoutDraft => ({
  date: '2026-11-03',
  accountId: 'account-bank',
  amount: '1.234,56',
  payerId: IRISH.id,
  period: '2026-10',
  taxTreatment: 'euB2bNotTaxable',
  vatRate: STANDARD_RATE,
  statementUrl: 'https://reportingitc.apple.com/statement/2026-10',
  note: 'Oktober',
  ...over,
});

const check = (d: PayoutDraft, against: PayoutChecks = regular, locale: 'de' | 'en' = 'de') => readPayout(d, locale, against);

/** The problems of a failed check as "field:problem", in the order they are reported */
function problems(d: PayoutDraft, against: PayoutChecks = regular): string[] {
  const r = check(d, against);
  return r.ok ? [] : r.error.map((e) => `${e.field}:${e.problem}`);
}

describe('readPayout', () => {
  it('reads a complete payout with its amount in cents', () => {
    expect(check(draft())).toEqual({
      ok: true,
      value: {
        date: '2026-11-03',
        accountId: 'account-bank',
        amount: 123_456,
        payerId: 'payer-ie',
        period: '2026-10',
        taxTreatment: 'euB2bNotTaxable',
        vatRate: 0,
        statementUrl: 'https://reportingitc.apple.com/statement/2026-10',
        note: 'Oktober',
      },
    });
  });

  it('reads the amount in the language of the form', () => {
    const r = readPayout(draft({ amount: '1,234.56' }), 'en', regular);
    expect(r.ok && r.value.amount).toBe(123_456);
  });

  it('asks for the date, the account, the amount, the payer and the tax treatment', () => {
    expect(problems(draft({ date: '', accountId: '', amount: '', payerId: '', taxTreatment: '' }))).toEqual([
      'date:date',
      'accountId:required',
      'amount:required',
      'payerId:required',
      'taxTreatment:required',
    ]);
  });

  it('never guesses the tax treatment: an empty choice is refused', () => {
    expect(problems(draft({ taxTreatment: '' }))).toEqual(['taxTreatment:required']);
  });

  it('refuses an amount of 0, a negative amount and text that is not a number', () => {
    expect(problems(draft({ amount: '0,00' }))).toEqual(['amount:amountNotPositive']);
    expect(problems(draft({ amount: '-5,00' }))).toEqual(['amount:priceNegative']);
    expect(problems(draft({ amount: 'abc' }))).toEqual(['amount:price']);
    expect(problems(draft({ amount: '1000000000,00' }))).toEqual(['amount:price']);
  });

  it('refuses an account that was removed', () => {
    expect(problems(draft({ accountId: 'account-gone' }))).toEqual(['accountId:accountRemoved']);
  });

  it('refuses a payer that is not among the contacts offered', () => {
    expect(problems(draft({ payerId: 'payer-gone' }))).toEqual(['payerId:payerRemoved']);
  });

  it('the month it covers is optional, and must be a month when given', () => {
    const r = check(draft({ period: '' }));
    expect(r.ok && r.value.period).toBe('');
    expect(problems(draft({ period: '2026-13' }))).toEqual(['period:month']);
    expect(problems(draft({ period: '2026-1' }))).toEqual(['period:month']);
    expect(problems(draft({ period: 'Oktober' }))).toEqual(['period:month']);
  });

  it('refuses a text that is longer than its limit', () => {
    expect(problems(draft({ note: 'x'.repeat(PAYOUT_LIMITS.note + 1) }))).toEqual(['note:tooLong']);
  });
});

describe('the statement link', () => {
  it('may stay empty', () => {
    const r = check(draft({ statementUrl: '' }));
    expect(r.ok && r.value.statementUrl).toBe('');
  });

  it('is an https link, and nothing else', () => {
    for (const url of ['http://example.com/s', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://example.com/s', 'example.com/s', 'mailto:a@b.de']) {
      expect(problems(draft({ statementUrl: url })), url).toEqual(['statementUrl:httpsLink']);
    }
  });

  it('is trimmed and not longer than the limit', () => {
    const r = check(draft({ statementUrl: '  https://example.com/s  ' }));
    expect(r.ok && r.value.statementUrl).toBe('https://example.com/s');
    expect(problems(draft({ statementUrl: `https://example.com/${'a'.repeat(PAYOUT_LIMITS.statementUrl)}` }))).toEqual(['statementUrl:httpsLink']);
  });
});

describe('one payout with each tax treatment', () => {
  const read = (over: Partial<PayoutDraft>, against = regular): PayoutProfile => {
    const r = check(draft(over), against);
    if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.error)}`);
    return r.value;
  };

  it('domesticTaxed: German payer, the VAT rate of the draft is kept', () => {
    const p = read({ taxTreatment: 'domesticTaxed', payerId: GERMAN.id, amount: '119,00', vatRate: STANDARD_RATE });
    expect(p).toMatchObject({ taxTreatment: 'domesticTaxed', vatRate: 1_900, amount: 11_900 });
    expect(payoutVat(p)).toBe(1_900);
    expect(payoutNet(p)).toBe(10_000);
    expect(read({ taxTreatment: 'domesticTaxed', payerId: GERMAN.id, amount: '107,00', vatRate: REDUCED_RATE }).vatRate).toBe(700);
  });

  it('euB2bNotTaxable: the payer has a VAT ID of another EU state; the whole amount is income', () => {
    const p = read({ taxTreatment: 'euB2bNotTaxable', vatRate: STANDARD_RATE });
    expect(p.vatRate).toBe(0);
    expect(payoutVat(p)).toBe(0);
    expect(payoutNet(p)).toBe(p.amount);
  });

  it('thirdCountryB2bNotTaxable: no VAT ID needed; the whole amount is income', () => {
    const p = read({ taxTreatment: 'thirdCountryB2bNotTaxable', payerId: AMERICAN.id, vatRate: STANDARD_RATE });
    expect(p.vatRate).toBe(0);
    expect(payoutNet(p)).toBe(p.amount);
  });

  it('smallBusiness: only for a small business; the whole amount is income', () => {
    const p = read({ taxTreatment: 'smallBusiness', payerId: GERMAN.id, vatRate: STANDARD_RATE }, small);
    expect(p.vatRate).toBe(0);
    expect(payoutNet(p)).toBe(p.amount);
  });

  it('platformCollectsVat: a manual treatment, the whole amount is income', () => {
    const p = read({ taxTreatment: 'platformCollectsVat', vatRate: STANDARD_RATE });
    expect(p.vatRate).toBe(0);
    expect(payoutVat(p)).toBe(0);
    expect(payoutNet(p)).toBe(p.amount);
  });
});

describe('euB2bNotTaxable needs the VAT ID of the payer', () => {
  it('refuses a payer without a VAT ID', () => {
    expect(problems(draft({ payerId: AMERICAN.id }))).toEqual(['taxTreatment:payerVatId']);
  });

  it('refuses a VAT ID that is not plausible', () => {
    const against = { ...regular, payers: [{ id: IRISH.id, vatId: 'IE' }] };
    expect(problems(draft(), against)).toEqual(['taxTreatment:payerVatId']);
  });

  it('refuses a German VAT ID: a German payer is not in another EU state', () => {
    expect(problems(draft({ payerId: GERMAN.id }))).toEqual(['taxTreatment:payerVatId']);
  });

  it('accepts a VAT ID written with spaces and in small letters', () => {
    const against = { ...regular, payers: [{ id: IRISH.id, vatId: 'ie 9700053d' }] };
    expect(problems(draft(), against)).toEqual([]);
  });

  it('does not ask a second question while the payer is missing', () => {
    expect(problems(draft({ payerId: '' }))).toEqual(['payerId:required']);
  });

  it('the other treatments do not need a VAT ID', () => {
    for (const taxTreatment of ['thirdCountryB2bNotTaxable', 'platformCollectsVat'] as const) {
      expect(problems(draft({ taxTreatment, payerId: AMERICAN.id })), taxTreatment).toEqual([]);
    }
  });
});

describe('a small business and a company with regular VAT', () => {
  it('a small business cannot pick the treatment that has German VAT in it', () => {
    expect(problems(draft({ taxTreatment: 'domesticTaxed', payerId: GERMAN.id }), small)).toEqual(['taxTreatment:vatForSmallBusiness']);
  });

  it('a small business can pick every other treatment', () => {
    for (const taxTreatment of ['euB2bNotTaxable', 'thirdCountryB2bNotTaxable', 'smallBusiness', 'platformCollectsVat'] as const) {
      expect(problems(draft({ taxTreatment }), small), taxTreatment).toEqual([]);
    }
  });

  it('a company with regular VAT cannot pick the small business treatment', () => {
    expect(problems(draft({ taxTreatment: 'smallBusiness' }))).toEqual(['taxTreatment:smallBusinessOnly']);
  });

  it('offers a small business no treatment with VAT, and a regular company no small business treatment', () => {
    expect(payoutTreatmentsFor(true)).toEqual(['euB2bNotTaxable', 'thirdCountryB2bNotTaxable', 'smallBusiness', 'platformCollectsVat']);
    expect(payoutTreatmentsFor(false)).toEqual(['domesticTaxed', 'euB2bNotTaxable', 'thirdCountryB2bNotTaxable', 'platformCollectsVat']);
    for (const t of payoutTreatmentsFor(true)) expect(payoutImpliesVat(t), t).toBe(false);
  });

  it('only the domestic treatment implies VAT', () => {
    expect(PAYOUT_TAX_TREATMENTS.filter(payoutImpliesVat)).toEqual(['domesticTaxed']);
  });
});

describe('payoutVat and payoutNet', () => {
  it('split the amount of a domestic payout; the VAT is rounded once', () => {
    const p = { amount: cents(1_000), taxTreatment: 'domesticTaxed' as const, vatRate: basisPoints(1_900) };
    expect(payoutVat(p)).toBe(160);
    expect(payoutNet(p)).toBe(840);
  });

  it('a domestic payout at the zero rate has no VAT in it', () => {
    expect(payoutVat({ amount: cents(5_000), taxTreatment: 'domesticTaxed', vatRate: ZERO_RATE })).toBe(0);
  });

  it('net and VAT always add up to the amount (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: PAYOUT_LIMITS.maxAmount }), fc.constantFrom(...PAYOUT_TAX_TREATMENTS), fc.constantFrom(1_900, 700, 0), (amount, taxTreatment, rate) => {
        const p = { amount: cents(amount), taxTreatment, vatRate: basisPoints(rate) };
        expect(payoutNet(p) + payoutVat(p)).toBe(amount);
        expect(payoutNet(p)).toBeGreaterThan(0 - 1);
        if (taxTreatment !== 'domesticTaxed') expect(payoutNet(p)).toBe(amount);
      }),
      params,
    );
  });
});

describe('payoutMatches', () => {
  const payout = { note: 'Oktober 2026', period: '2026-10', statementUrl: '' };

  it('matches everything for an empty search', () => {
    expect(payoutMatches(payout, 'Apple', '   ')).toBe(true);
  });

  it('searches the payer, the month and the note, without case', () => {
    expect(payoutMatches(payout, 'Apple Distribution', 'apple')).toBe(true);
    expect(payoutMatches(payout, 'Apple', '2026-10')).toBe(true);
    expect(payoutMatches(payout, 'Apple', 'OKTOBER')).toBe(true);
    expect(payoutMatches(payout, 'Apple', 'google')).toBe(false);
  });
});

describe('draft', () => {
  it('starts with today and the default account, and without a tax treatment', () => {
    expect(emptyPayoutDraft(TODAY, 'account-bank')).toEqual({
      date: TODAY,
      accountId: 'account-bank',
      amount: '',
      payerId: '',
      period: '',
      taxTreatment: '',
      vatRate: STANDARD_RATE,
      statementUrl: '',
      note: '',
    });
  });

  it('reads back the same payout that it was made from', () => {
    const profile: PayoutProfile = {
      date: '2026-11-03',
      accountId: 'account-paypal',
      amount: cents(11_900),
      payerId: GERMAN.id,
      period: '2026-10',
      taxTreatment: 'domesticTaxed',
      vatRate: basisPoints(1_900),
      statementUrl: '',
      note: '',
    };
    expect(readPayout(draftFromPayout(profile, 'de'), 'de', regular)).toEqual({ ok: true, value: profile });
  });
});
