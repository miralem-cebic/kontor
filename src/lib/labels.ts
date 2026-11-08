import type { IssueFailure } from '../app/issue';
import type { PaymentFailure } from '../app/payments';
import type { SendFailure } from '../app/sending';
import type { StorageErrorKind } from '../data/repository';
import type { DunningLevel, DunningProblem } from '../domain/dunning';
import type { DecisionProblem } from '../domain/quoteStatus';
import type { SessionError } from '../app/session';
import type { AccountDetails } from '../domain/bankAccount';
import type { FieldError, FieldProblem } from '../domain/check';
import { MAX_LOGO_BYTES, type LogoProblem } from '../domain/company';
import type { Discount } from '../domain/discount';
import { DOCUMENT_LIMITS } from '../domain/document';
import { formatIban } from '../domain/iban';
import type { IssueProblem, TaxTreatment, TaxTreatmentHint } from '../domain/invoice';
import { formatCents, formatRate } from '../domain/money';
import type { PaymentState } from '../domain/payment';
import type { QuoteProblem } from '../domain/quote';
import type { UnitCode } from '../domain/units';
import { minMultiplierPercent } from '../domain/tax/tradeTax';
import { t, tIn, type Lang, type MessageKey } from '../i18n';
import type { ExpenseTaxTreatment } from '../domain/expense';
import type { PayoutTaxTreatment } from '../domain/payout';

// Texts for codes from the domain and the data layer. Call them at render time, not at module load.

const PROBLEM_KEY: Record<FieldProblem, MessageKey> = {
  required: 'problem.required',
  tooLong: 'problem.tooLong',
  email: 'problem.email',
  phone: 'problem.phone',
  postalCode: 'problem.postalCode',
  country: 'problem.country',
  taxIdRequired: 'problem.taxIdRequired',
  taxNumber: 'problem.taxNumber',
  vatId: 'problem.vatId',
  euVatId: 'problem.euVatId',
  leitwegId: 'problem.leitwegId',
  multiplier: 'problem.multiplier',
  bic: 'problem.bic',
  paymentTerm: 'problem.paymentTerm',
  roleRequired: 'problem.roleRequired',
  numberTaken: 'problem.numberTaken',
  accountTaken: 'problem.accountTaken',
  itemNumberTaken: 'problem.itemNumberTaken',
  price: 'problem.price',
  priceNegative: 'problem.priceNegative',
  quantity: 'problem.quantity',
  lineTooLarge: 'problem.lineTooLarge',
  tooManyLines: 'problem.tooManyLines',
  negativeTotal: 'problem.negativeTotal',
  date: 'problem.date',
  dateInFuture: 'problem.dateInFuture',
  amount: 'problem.amount',
  amountNotPositive: 'problem.amountNotPositive',
  amountTooHigh: 'problem.amountTooHigh',
  percent: 'problem.percent',
  discountTooLarge: 'problem.discountTooLarge',
  accountRemoved: 'problem.accountRemoved',
  feeNegative: 'problem.feeNegative',
  validUntil: 'problem.validUntil',
  periodEnd: 'problem.periodEnd',
  payerRemoved: 'payouts.problemPayerRemoved',
  payerVatId: 'payouts.problemPayerVatId',
  vatForSmallBusiness: 'payouts.problemVatForSmallBusiness',
  smallBusinessOnly: 'payouts.problemSmallBusinessOnly',
  httpsLink: 'payouts.problemHttpsLink',
  month: 'payouts.problemMonth',
  'iban.format': 'problem.ibanFormat',
  'iban.country': 'problem.ibanCountry',
  'iban.length': 'problem.ibanLength',
  'iban.checksum': 'problem.ibanChecksum',
  'pattern.empty': 'problem.patternEmpty',
  'pattern.tooLong': 'problem.patternTooLong',
  'pattern.invalidCharacter': 'problem.patternCharacter',
  'pattern.unknownToken': 'problem.patternToken',
  'pattern.noCounter': 'problem.patternNoCounter',
  'pattern.multipleCounters': 'problem.patternCounters',
  'pattern.sameAsInvoice': 'problem.patternSameAsInvoice',
  'pattern.dateToken': 'problem.patternDate',
};

/** The minimum multiplier is the one of the current year, the year the forms check against */
export const problemText = (p: FieldProblem): string => t(PROBLEM_KEY[p], { min: minMultiplierPercent(new Date().getFullYear()), max: DOCUMENT_LIMITS.lines });

/** The text of the first error of a field, or undefined */
export function fieldError<F extends string>(errors: readonly FieldError<F>[], field: F): string | undefined {
  const e = errors.find((x) => x.field === field);
  return e ? problemText(e.problem) : undefined;
}

const SESSION_ERROR_KEY: Record<SessionError, MessageKey> = {
  permission: 'error.permission',
  notFound: 'error.notFound',
  quota: 'error.quota',
  locked: 'error.locked',
  newerSchema: 'error.newerSchema',
  conflict: 'error.conflict',
  invalid: 'error.invalid',
  other: 'error.other',
  otherCompany: 'error.otherCompany',
  copiedCompany: 'error.copiedCompany',
  noFolder: 'error.noFolder',
};

export const errorText = (e: SessionError): string => t(SESSION_ERROR_KEY[e]);

const LOGO_PROBLEM_KEY: Record<LogoProblem, MessageKey> = {
  empty: 'logo.empty',
  tooLarge: 'logo.tooLarge',
  unsupportedType: 'logo.unsupported',
};

export const logoProblemText = (p: LogoProblem): string => t(LOGO_PROBLEM_KEY[p], { max: `${MAX_LOGO_BYTES / 1_000_000} MB` });

const UNIT_KEY: Record<UnitCode, MessageKey> = {
  H87: 'unit.H87',
  HUR: 'unit.HUR',
  MIN: 'unit.MIN',
  DAY: 'unit.DAY',
  WEE: 'unit.WEE',
  MON: 'unit.MON',
  ANN: 'unit.ANN',
  LS: 'unit.LS',
  KMT: 'unit.KMT',
  MTR: 'unit.MTR',
  MTK: 'unit.MTK',
  MTQ: 'unit.MTQ',
  KGM: 'unit.KGM',
  LTR: 'unit.LTR',
  SET: 'unit.SET',
};

export const unitText = (u: UnitCode): string => t(UNIT_KEY[u]);

/** The name of a unit in a given language, for example on a document */
export const unitTextIn = (lang: Lang, u: UnitCode): string => tIn(lang, UNIT_KEY[u]);

const EXPENSE_TREATMENT_KEY: Record<ExpenseTaxTreatment, MessageKey> = {
  domestic: 'expenses.treatmentDomestic',
  euReverseCharge: 'expenses.treatmentEuReverseCharge',
  thirdCountry: 'expenses.treatmentThirdCountry',
  noVat: 'expenses.treatmentNoVat',
};
const PAYOUT_TREATMENT_KEY: Record<PayoutTaxTreatment, MessageKey> = {
  domesticTaxed: 'payouts.treatmentDomesticTaxed',
  euB2bNotTaxable: 'payouts.treatmentEuB2bNotTaxable',
  thirdCountryB2bNotTaxable: 'payouts.treatmentThirdCountryB2bNotTaxable',
  smallBusiness: 'payouts.treatmentSmallBusiness',
  platformCollectsVat: 'payouts.treatmentPlatformCollectsVat',
};
/** The tax treatment of a payout in words, as the form, the list and the CSV export show it */
export const payoutTreatmentText = (v: PayoutTaxTreatment): string => t(PAYOUT_TREATMENT_KEY[v]);

const PAYOUT_EXPLAIN_KEY: Record<PayoutTaxTreatment, MessageKey> = {
  domesticTaxed: 'payouts.explainDomesticTaxed',
  euB2bNotTaxable: 'payouts.explainEuB2bNotTaxable',
  thirdCountryB2bNotTaxable: 'payouts.explainThirdCountryB2bNotTaxable',
  smallBusiness: 'payouts.explainSmallBusiness',
  platformCollectsVat: 'payouts.explainPlatformCollectsVat',
};
/** One sentence on what a tax treatment of a payout means, ending in "check the document" */
export const payoutTreatmentExplanation = (v: PayoutTaxTreatment): string => t(PAYOUT_EXPLAIN_KEY[v]);

/** The VAT treatment of an expense in words, as the form and the CSV export show it */
export const expenseTreatmentText = (v: ExpenseTaxTreatment): string => t(EXPENSE_TREATMENT_KEY[v]);

/** A discount in words: "10 %" or "20,00 €", or "no discount" */
export const discountText = (d: Discount, lang: Lang): string => {
  switch (d.kind) {
    case 'none':
      return tIn(lang, 'discount.none');
    case 'percent':
      return formatRate(d.rate, lang);
    case 'amount':
      return formatCents(d.amount, lang);
  }
};

/** The name of an account for lists and choices: its own name, or its kind */
export const accountName = (a: AccountDetails): string => a.name || t(a.kind === 'bank' ? 'accounts.kindBank' : 'accounts.kindPaypal');
/** IBAN and holder of a bank account, or the PayPal address */
export const accountDetail = (a: AccountDetails): string => (a.kind === 'bank' ? `${formatIban(a.iban)} · ${a.holder}` : a.email);

const TAX_TREATMENT_KEY: Record<TaxTreatment, { label: MessageKey; hint: MessageKey }> = {
  standard: { label: 'invoices.taxStandard', hint: 'invoices.taxStandardHint' },
  reverseCharge: { label: 'invoices.taxReverseCharge', hint: 'invoices.taxReverseChargeHint' },
  intraCommunitySupply: { label: 'invoices.taxIntraCommunity', hint: 'invoices.taxIntraCommunityHint' },
  notTaxable: { label: 'invoices.taxNotTaxable', hint: 'invoices.taxNotTaxableHint' },
};

export const taxTreatmentText = (v: TaxTreatment): { label: string; hint: string } => ({ label: t(TAX_TREATMENT_KEY[v].label), hint: t(TAX_TREATMENT_KEY[v].hint) });

const TAX_TREATMENT_HINT_KEY: Record<TaxTreatmentHint, MessageKey> = {
  customerAbroad: 'invoices.taxHintAbroad',
  customerInGermany: 'invoices.taxHintInGermany',
  customerInEu: 'invoices.taxHintInEu',
};

export const taxTreatmentHintText = (h: TaxTreatmentHint): string => t(TAX_TREATMENT_HINT_KEY[h]);

const ISSUE_PROBLEM_KEY: Record<IssueProblem, MessageKey> = {
  noCustomer: 'issue.noCustomer',
  noLines: 'issue.noLines',
  customerAddress: 'issue.customerAddress',
  customerVatId: 'issue.customerVatId',
  ownVatId: 'issue.ownVatId',
  accountRemoved: 'issue.accountRemoved',
  smallBusinessLimit: 'smallBusiness.issueLimit',
  smallBusinessPreviousYear: 'smallBusiness.issuePreviousYear',
};

/** `values` fill the placeholders of the small business texts: the crossing `date` and the `limit` of the previous year */
export const issueProblemText = (p: IssueProblem, values?: Record<string, string | number>): string => t(ISSUE_PROBLEM_KEY[p], values);

const QUOTE_PROBLEM_KEY: Record<QuoteProblem, MessageKey> = {
  noCustomer: 'issue.noCustomer',
  noLines: 'issue.noLines',
  expired: 'issue.quoteExpired',
  newerVersion: 'issue.newerVersion',
};

export const quoteProblemText = (p: QuoteProblem): string => t(QUOTE_PROBLEM_KEY[p]);

export function issueFailureText(f: IssueFailure): string {
  switch (f) {
    case 'notReady':
      return t('invoices.issueNotReady');
    case 'numberTaken':
      return t('invoices.issueNumberTaken');
    case 'fileDiffers':
      return t('issue.fileDiffers');
    case 'permission':
    case 'notFound':
    case 'quota':
    case 'locked':
    case 'newerSchema':
    case 'invalid':
    case 'conflict':
    case 'other':
      return t('invoices.issueFailed', { reason: errorText(f) });
  }
}

export function finalizeFailureText(f: IssueFailure): string {
  switch (f) {
    case 'notReady':
      return t('quotes.finalizeNotReady');
    case 'numberTaken':
      return t('quotes.finalizeNumberTaken');
    case 'fileDiffers':
      return t('issue.fileDiffers');
    case 'permission':
    case 'notFound':
    case 'quota':
    case 'locked':
    case 'newerSchema':
    case 'invalid':
    case 'conflict':
    case 'other':
      return t('quotes.finalizeFailed', { reason: errorText(f) });
  }
}

export function cancelFailureText(f: IssueFailure): string {
  switch (f) {
    case 'notReady':
      return t('invoices.cancelNotPossible');
    case 'numberTaken':
      return t('invoices.issueNumberTaken');
    case 'fileDiffers':
      return t('issue.fileDiffers');
    case 'permission':
    case 'notFound':
    case 'quota':
    case 'locked':
    case 'newerSchema':
    case 'invalid':
    case 'conflict':
    case 'other':
      return t('invoices.cancelFailed', { reason: errorText(f) });
  }
}

/** The state of an invoice's payments as a word */
const PAYMENT_STATE_KEY: Record<PaymentState, MessageKey> = {
  open: 'payments.statusOpen',
  partlyPaid: 'payments.statusPartly',
  paid: 'payments.statusPaid',
  cancelled: 'invoices.cancelled',
};

export const paymentStateText = (s: PaymentState): string => t(PAYMENT_STATE_KEY[s]);

/** Why a payment was not recorded or removed; storage failures say what went wrong in the folder */
export function paymentFailureText(f: PaymentFailure): string {
  switch (f) {
    case 'notReady':
      return t('payments.notReady');
    case 'tooHigh':
      return t('payments.tooHigh');
    case 'notPositive':
      return t('problem.amountNotPositive');
    case 'dateInFuture':
      return t('payments.dateInFuture');
    case 'gone':
      return t('payments.gone');
    case 'permission':
    case 'notFound':
    case 'quota':
    case 'locked':
    case 'newerSchema':
    case 'invalid':
    case 'conflict':
    case 'other':
      return t('payments.failed', { reason: errorText(f) });
  }
}

const DUNNING_PROBLEM_KEY: Record<DunningProblem, MessageKey> = {
  cancelled: 'dunning.problem.cancelled',
  notOpen: 'dunning.problem.notOpen',
  notOverdue: 'dunning.problem.notOverdue',
  dateInFuture: 'dunning.problem.dateInFuture',
  dateBeforePrevious: 'dunning.problem.dateBeforePrevious',
  noNextLevel: 'dunning.problem.noNextLevel',
  rateUnknown: 'dunning.problem.rateUnknown',
};

/** The title of a dunning level: the payment reminder, then the dunning levels 1 to 3 */
export const DUNNING_LEVEL_KEY: Record<DunningLevel, MessageKey> = {
  reminder: 'dunning.level.reminder',
  level1: 'dunning.level.level1',
  level2: 'dunning.level.level2',
  level3: 'dunning.level.level3',
};

/** Why a decision on a quote cannot be recorded, as the form tells it (F21) */
const DECISION_PROBLEM_KEY: Record<DecisionProblem, MessageKey> = {
  notFinalized: 'quotes.decisionProblem.notFinalized',
  replaced: 'quotes.decisionProblem.replaced',
  alreadyDecided: 'quotes.decisionProblem.alreadyDecided',
  dateBeforeQuote: 'quotes.decisionProblem.dateBeforeQuote',
  dateInFuture: 'quotes.decisionProblem.dateInFuture',
};

export const quoteDecisionProblemText = (p: DecisionProblem): string => t(DECISION_PROBLEM_KEY[p]);

/** Why a decision was not recorded or removed: no such quote or decision, a date that is not one, or a storage failure */
export function quoteDecisionFailureText(f: 'notReady' | 'date' | StorageErrorKind): string {
  switch (f) {
    case 'notReady':
      return t('quotes.decisionNotReady');
    case 'date':
      return t('quotes.decisionDateInvalid');
    case 'permission':
    case 'notFound':
    case 'quota':
    case 'locked':
    case 'newerSchema':
    case 'invalid':
    case 'conflict':
    case 'other':
      return t('quotes.decisionFailed');
  }
}

/** Why a dunning cannot be planned, as the form tells it */
export const dunningProblemText = (p: DunningProblem): string => t(DUNNING_PROBLEM_KEY[p]);

/** The kind of a dunning failure, for the message */
export type DunningFailureKind = 'notReady' | 'planning' | StorageErrorKind;

/** Why a dunning was not created: the storage failures say what went wrong in the folder */
export function dunningFailureText(f: DunningFailureKind): string {
  switch (f) {
    case 'notReady':
      return t('dunning.notReady');
    case 'planning':
      return t('dunning.planning');
    case 'permission':
    case 'notFound':
    case 'quota':
    case 'locked':
    case 'newerSchema':
    case 'invalid':
    case 'conflict':
    case 'other':
      return t('dunning.failed', { reason: errorText(f) });
  }
}

/** Why a mail was not prepared: the document's state, or the storage failures that say what went wrong in the folder */
export function sendFailureText(f: SendFailure): string {
  switch (f) {
    case 'notReady':
      return t('send.notReady');
    case 'cancelled':
      return t('send.cancelled');
    case 'changed':
      return t('send.changed');
    case 'pdf':
      return t('send.pdfFailed');
    case 'permission':
    case 'notFound':
    case 'quota':
    case 'locked':
    case 'newerSchema':
    case 'invalid':
    case 'conflict':
    case 'other':
      return t('send.failed', { reason: errorText(f) });
  }
}
