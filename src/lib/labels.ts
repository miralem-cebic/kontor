import type { SessionError } from '../app/session';
import type { AccountDetails } from '../domain/bankAccount';
import type { FieldError, FieldProblem } from '../domain/check';
import { MIN_TRADE_TAX_MULTIPLIER_PERCENT, MAX_LOGO_BYTES, type LogoProblem } from '../domain/company';
import { DOCUMENT_LIMITS } from '../domain/document';
import { formatIban } from '../domain/iban';
import type { IssueProblem, TaxTreatment, TaxTreatmentHint } from '../domain/invoice';
import type { UnitCode } from '../domain/units';
import { t, type MessageKey } from '../i18n';

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
  validUntil: 'problem.validUntil',
  periodEnd: 'problem.periodEnd',
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
};

export const problemText = (p: FieldProblem): string => t(PROBLEM_KEY[p], { min: MIN_TRADE_TAX_MULTIPLIER_PERCENT, max: DOCUMENT_LIMITS.lines });

/** The text of the first error of a field, or undefined */
export function fieldError<F extends string>(errors: readonly FieldError<F>[], field: F): string | undefined {
  const e = errors.find((x) => x.field === field);
  return e ? problemText(e.problem) : undefined;
}

const SESSION_ERROR_KEY: Record<SessionError, MessageKey> = {
  permission: 'error.permission',
  notFound: 'error.notFound',
  quota: 'error.quota',
  newerSchema: 'error.newerSchema',
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
};

export const issueProblemText = (p: IssueProblem): string => t(ISSUE_PROBLEM_KEY[p]);
