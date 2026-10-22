import type { SessionError } from '../app/session';
import type { FieldError, FieldProblem } from '../domain/check';
import { MIN_TRADE_TAX_MULTIPLIER_PERCENT, MAX_LOGO_BYTES, type LogoProblem } from '../domain/company';
import { DOCUMENT_LIMITS } from '../domain/document';
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
