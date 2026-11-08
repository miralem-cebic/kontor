// Payouts (Auszahlungen of platforms): income that arrives without an invoice of kontor, for example the payouts of Apple,
// Google, Stripe or PayPal. kontor works on the cash basis (EÜR, § 11 EStG): the date is the day the money arrived.
// The tax treatment is chosen by the person from the statement of the platform, never guessed from the name of the payer.
// The payout form edits a draft of plain strings; `readPayout` checks it and turns it into a profile.
// Rules of the treatments (an estimate for orientation, not tax advice; the UStVA fields for payouts come with #34):
//   domesticTaxed              German payer, the amount includes German VAT: the income is the net part.
//   euB2bNotTaxable            Payer in another EU state with a VAT ID, service not taxable in Germany (§ 3a Abs. 2 UStG).
//                              The VAT ID of the payer is needed for the Zusammenfassende Meldung.
//                              https://www.gesetze-im-internet.de/ustg_1980/__3a.html
//   thirdCountryB2bNotTaxable  Payer outside the EU, service not taxable in Germany (§ 3a Abs. 2 UStG).
//   smallBusiness              No VAT, whatever the payer (§ 19 UStG). Only for a small business.
//   platformCollectsVat        The platform collects the VAT from the consumers (agency model). How the payout is treated is
//                              an open question (epic #30, question 1): a manual treatment with a warning.
// Except for `domesticTaxed` the whole amount is income.

import type { Result } from '../data/result';
import { Checker, type FieldError } from './check';
import { isIsoDate } from './dates';
import { isHttpsUrl } from './links';
import { cents, formatDecimal, splitGross, subtract, type BasisPoints, type Cents, type MoneyLocale } from './money';
import { isPlausibleEuVatId, normalizeVatId } from './taxIds';
import { STANDARD_RATE, ZERO_RATE } from './vat';

export const PAYOUT_TAX_TREATMENTS = ['domesticTaxed', 'euB2bNotTaxable', 'thirdCountryB2bNotTaxable', 'smallBusiness', 'platformCollectsVat'] as const;
export type PayoutTaxTreatment = (typeof PAYOUT_TAX_TREATMENTS)[number];

export const PAYOUT_LIMITS = {
  note: 500,
  statementUrl: 2_000,
  /** 999,999,999.99 €; far above any real payout, a bound for input and file content */
  maxAmount: 99_999_999_999,
} as const;

/** What a payout is: the content as the form checks it; the record adds its ID, its creation and its deletion */
export interface PayoutProfile {
  /** The day the money arrived (YYYY-MM-DD) */
  date: string;
  /** An active account of the company (bank or PayPal) the money arrived on */
  accountId: string;
  /** What arrived, in euros; more than 0 */
  amount: Cents;
  /** The contact that paid, for example Apple or Google: a customer from the contact list */
  payerId: string;
  /** The month the payout covers (YYYY-MM); empty when not given */
  period: string;
  taxTreatment: PayoutTaxTreatment;
  /** The VAT rate inside the amount; 0 for every treatment but `domesticTaxed` */
  vatRate: BasisPoints;
  /** A link to the statement of the platform (https); empty when none */
  statementUrl: string;
  note: string;
}

/** Does the treatment mean that German VAT is inside the amount? A small business owes no VAT, so it cannot pick it. */
export const payoutImpliesVat = (t: PayoutTaxTreatment): boolean => t === 'domesticTaxed';

/** The treatments a company can pick: a small business none that has VAT inside, a company with regular VAT not the small business one */
export const payoutTreatmentsFor = (smallBusiness: boolean): PayoutTaxTreatment[] =>
  PAYOUT_TAX_TREATMENTS.filter((t) => (smallBusiness ? !payoutImpliesVat(t) : t !== 'smallBusiness'));

/* ---------- Amounts ---------- */

type Amounts = Pick<PayoutProfile, 'amount' | 'taxTreatment' | 'vatRate'>;

/** The German VAT inside the amount; 0 for every treatment but `domesticTaxed` */
export function payoutVat(p: Amounts): Cents {
  return p.taxTreatment === 'domesticTaxed' ? splitGross(p.amount, p.vatRate).tax : cents(0);
}

/** What the payout counts as income: the amount without the VAT inside it; the whole amount for every other treatment */
export const payoutNet = (p: Amounts): Cents => subtract(p.amount, payoutVat(p));

/* ---------- Draft and checks ---------- */

/** A payout as the form edits it: strings as typed */
export interface PayoutDraft {
  date: string;
  /** The ID of the account, or '' for none */
  accountId: string;
  /** As typed, in the interface language */
  amount: string;
  /** The ID of the contact, or '' for none */
  payerId: string;
  /** YYYY-MM or '' */
  period: string;
  /** '' until the person has chosen: the treatment is never guessed */
  taxTreatment: PayoutTaxTreatment | '';
  vatRate: BasisPoints;
  statementUrl: string;
  note: string;
}

export type PayoutField = keyof PayoutDraft;
export type PayoutFieldError = FieldError<PayoutField>;

/** A new payout starts with today and the default account, and without a tax treatment */
export const emptyPayoutDraft = (today: string, defaultAccountId: string): PayoutDraft => ({
  date: today,
  accountId: defaultAccountId,
  amount: '',
  payerId: '',
  period: '',
  taxTreatment: '',
  vatRate: STANDARD_RATE,
  statementUrl: '',
  note: '',
});

/** The draft of a saved payout, as the form shows it */
export const draftFromPayout = (p: PayoutProfile, locale: MoneyLocale): PayoutDraft => ({
  date: p.date,
  accountId: p.accountId,
  amount: formatDecimal(p.amount, locale),
  payerId: p.payerId,
  period: p.period,
  taxTreatment: p.taxTreatment,
  vatRate: p.vatRate === ZERO_RATE ? STANDARD_RATE : p.vatRate,
  statementUrl: p.statementUrl,
  note: p.note,
});

/** What a draft is checked against: the active accounts, the contacts that can pay (with their VAT ID) and the VAT status of the company */
export interface PayoutChecks {
  accounts: readonly string[];
  payers: readonly { id: string; vatId: string }[];
  smallBusiness: boolean;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Has the payer a VAT ID of another EU state than Germany? The treatment of a payer in another EU state needs it. */
const hasForeignEuVatId = (vatId: string): boolean => isPlausibleEuVatId(vatId) && !normalizeVatId(vatId).startsWith('DE');

/**
 * Checks a payout draft. Every problem is reported at once, so that the form can show all of them. The rate is taken from
 * the draft only for `domesticTaxed`; the others get 0.
 */
export function readPayout(d: PayoutDraft, locale: MoneyLocale, against: PayoutChecks): Result<PayoutProfile, PayoutFieldError[]> {
  const c = new Checker<PayoutField>();
  if (!isIsoDate(d.date)) c.add('date', 'date');
  if (!d.accountId) c.add('accountId', 'required');
  else if (!against.accounts.includes(d.accountId)) c.add('accountId', 'accountRemoved');
  const amount = c.price('amount', d.amount, locale, PAYOUT_LIMITS.maxAmount);
  if (c.passed('amount') && amount === 0) c.add('amount', 'amountNotPositive');

  const payer = against.payers.find((p) => p.id === d.payerId);
  if (!d.payerId) c.add('payerId', 'required');
  else if (!payer) c.add('payerId', 'payerRemoved');

  const period = d.period.trim();
  if (period && !MONTH.test(period)) c.add('period', 'month');

  const treatment = c.chosen('taxTreatment', d.taxTreatment === '' ? null : d.taxTreatment);
  if (treatment !== null) {
    if (against.smallBusiness && payoutImpliesVat(treatment)) c.add('taxTreatment', 'vatForSmallBusiness');
    else if (!against.smallBusiness && treatment === 'smallBusiness') c.add('taxTreatment', 'smallBusinessOnly');
    else if (treatment === 'euB2bNotTaxable' && payer && !hasForeignEuVatId(payer.vatId)) c.add('taxTreatment', 'payerVatId');
  }

  const statementUrl = d.statementUrl.trim();
  if (statementUrl && (statementUrl.length > PAYOUT_LIMITS.statementUrl || !isHttpsUrl(statementUrl))) c.add('statementUrl', 'httpsLink');
  const note = c.optionalText('note', d.note, PAYOUT_LIMITS.note);

  return c.done(() => ({
    date: d.date,
    accountId: d.accountId,
    amount,
    payerId: d.payerId,
    period,
    // `done` runs only when no check failed, so the treatment is chosen
    taxTreatment: treatment ?? 'platformCollectsVat',
    vatRate: treatment === 'domesticTaxed' ? d.vatRate : ZERO_RATE,
    statementUrl,
    note,
  }));
}

/* ---------- Lists ---------- */

/** Does the payout match a search text? The payer's name, the month, the note and the statement link are searched. */
export function payoutMatches(p: Pick<PayoutProfile, 'period' | 'note' | 'statementUrl'>, payerName: string, query: string): boolean {
  const q = query.trim().toLocaleLowerCase('de');
  if (!q) return true;
  return [payerName, p.period, p.note, p.statementUrl].some((v) => v.toLocaleLowerCase('de').includes(q));
}
