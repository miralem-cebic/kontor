// Runtime checks for everything that is read from the company folder, a backup or the browser storage.
// The folder may be shared and written by other devices, so a value is only used after it has passed these checks.
// Hand-written on purpose: the app has no runtime dependencies beyond the UI stack.
//
// The checks are structural (types, known values, lengths) plus what other code relies on for safety:
// names that become file names (logo, invoice number pattern) and IDs that become keys. A semantically wrong
// value that is still safe (an IBAN with a wrong check digit) is accepted here and reported by the forms.

import {
  LIMITS,
  LOGO_EXTENSION,
  LOGO_FILE,
  MAX_TRADE_TAX_MULTIPLIER_PERCENT,
  MIN_TRADE_TAX_MULTIPLIER_PERCENT,
  type BusinessType,
  type InvoiceDefaults,
  type LogoRef,
  type LogoType,
  type TaxSettings,
  type VatMethod,
  type VatPeriod,
  type VatScheme,
} from '../domain/company';
import { ACCOUNT_LIMITS, MAX_ACCOUNTS } from '../domain/bankAccount';
import { TEXT_LIMITS, type Address, type ContactDetails } from '../domain/check';
import { CONTACT_LIMITS, type ContactKind, type ContactRoles } from '../domain/contact';
import { ITEM_LIMITS } from '../domain/item';
import { cents, type BasisPoints, type Cents } from '../domain/money';
import { MAX_PATTERN_LENGTH, patternProblem } from '../domain/numbering';
import { UNITS, type UnitCode } from '../domain/units';
import { isVatRate } from '../domain/vat';
import { observeStamp } from './clock';
import { brandId, type Brand } from './ids';
import { CONTACT_MERGEABLE_FIELDS, ITEM_MERGEABLE_FIELDS, MERGEABLE_FIELDS, type BankAccount, type Banking, type CompanyFile, type ContactFile, type ItemFile } from './types';

export class InvalidRecordError extends Error {
  override name = 'InvalidRecordError';
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path}: ${reason}`);
  }
}

export type Check<T> = (value: unknown, path: string) => T;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** Longer than any value the forms accept, so that a value from another device is not rejected for a few characters */
const MAX_TEXT = 4000;

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * IDs come from file content and may become keys of records. Names that exist on every object
 * (`__proto__`, `constructor`, `toString`, …) are refused, so they can never shadow or pollute a record.
 */
export function isValidId(v: unknown): v is string {
  return typeof v === 'string' && ID_PATTERN.test(v) && !(v in Object.prototype);
}

const fail = (path: string, reason: string): never => {
  throw new InvalidRecordError(path, reason);
};

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'string') return `"${v.slice(0, 40)}"`;
  return typeof v === 'object' ? 'an object' : String(v);
}

/** Branded IDs: the brand is added here, after the check, and nowhere else from file content */
const idOf =
  <B extends string>(): Check<Brand<string, B>> =>
  (v, path) =>
    isValidId(v) ? brandId<B>(v) : fail(path, `expected an ID, got ${describe(v)}`);
const companyId = idOf<'CompanyId'>();
const contactId = idOf<'ContactId'>();
const accountId = idOf<'AccountId'>();
const itemId = idOf<'ItemId'>();

const text =
  (max: number = MAX_TEXT): Check<string> =>
  (v, path) => {
    if (typeof v !== 'string') return fail(path, `expected a string, got ${describe(v)}`);
    return v.length <= max ? v : fail(path, `longer than ${max} characters`);
  };
const num: Check<number> = (v, path) => (typeof v === 'number' && Number.isFinite(v) ? v : fail(path, `expected a number, got ${describe(v)}`));
const int =
  (min: number, max: number): Check<number> =>
  (v, path) =>
    Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : fail(path, `expected a whole number from ${min} to ${max}, got ${describe(v)}`);
const bool: Check<boolean> = (v, path) => (typeof v === 'boolean' ? v : fail(path, `expected a boolean, got ${describe(v)}`));
const dateTime: Check<string> = (v, path) => {
  if (typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v))) {
    observeStamp(v);
    return v;
  }
  return fail(path, `expected an ISO timestamp, got ${describe(v)}`);
};

function oneOf<T extends string>(values: readonly T[]): Check<T> {
  return (v, path) => (typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : fail(path, `unknown value ${describe(v)}`));
}

const nullable =
  <T>(check: Check<T>): Check<T | null> =>
  (v, path) =>
    v === null ? null : check(v, path);

/** A list of at most `max` entries, each of them checked */
const listOf =
  <T>(check: Check<T>, max: number): Check<T[]> =>
  (v, path) => {
    if (!Array.isArray(v)) return fail(path, `expected a list, got ${describe(v)}`);
    if (v.length > max) return fail(path, `more than ${max} entries`);
    return v.map((item: unknown, i) => check(item, `${path}[${i}]`));
  };

/**
 * An object with the given fields. Fields the app does not know are kept, so that they are written back unchanged;
 * a file from a newer format version is refused before it gets here (migrations.ts).
 */
function objectOf<T>(shape: { [K in keyof T]-?: Check<T[K]> }): Check<T> {
  return (v, path) => {
    if (!isRecord(v)) return fail(path, `expected an object, got ${describe(v)}`);
    const out: Record<string, unknown> = { ...v };
    for (const key of Object.keys(shape) as (keyof T & string)[]) {
      out[key] = shape[key](v[key], `${path}.${key}`);
    }
    return out as T;
  };
}

/** A union with a `kind` field: the matching shape is checked */
function variant<T extends { kind: string }>(shapes: { [K in T['kind']]: Check<Extract<T, { kind: K }>> }): Check<T> {
  return (v, path) => {
    if (!isRecord(v)) return fail(path, `expected an object, got ${describe(v)}`);
    const kind = v['kind'];
    if (typeof kind !== 'string' || !Object.hasOwn(shapes, kind)) return fail(`${path}.kind`, `unknown value ${describe(kind)}`);
    return shapes[kind as T['kind']](v, path);
  };
}

const exactly =
  <V extends string>(value: V): Check<V> =>
  (v, path) =>
    v === value ? value : fail(path, `expected "${value}", got ${describe(v)}`);

const address = objectOf<Address>({
  street: text(LIMITS.street),
  postalCode: text(20),
  city: text(LIMITS.city),
  country: (v, path) => (typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : fail(path, `expected a country code, got ${describe(v)}`)),
});

const contactDetails = objectOf<ContactDetails>({ email: text(LIMITS.email), phone: text(LIMITS.phone) });

const logoType = oneOf<LogoType>(['image/png', 'image/jpeg', 'image/svg+xml']);

/** The logo file name becomes a path in the folder: it must match the hash and the type exactly. */
const logo: Check<LogoRef> = (v, path) => {
  const ref = objectOf<LogoRef>({
    file: (f, p) => (typeof f === 'string' && LOGO_FILE.test(f) ? f : fail(p, `expected a logo file name, got ${describe(f)}`)),
    type: logoType,
    sha256: (h, p) => (typeof h === 'string' && SHA256.test(h) ? h : fail(p, `expected a SHA-256 hex digest, got ${describe(h)}`)),
  })(v, path);
  const [, prefix, ext] = LOGO_FILE.exec(ref.file) ?? [];
  if (prefix !== ref.sha256.slice(0, 16) || ext !== LOGO_EXTENSION[ref.type]) fail(`${path}.file`, 'does not match the hash or type');
  return ref;
};

const vatScheme = variant<VatScheme>({
  smallBusiness: objectOf({ kind: exactly('smallBusiness') }),
  regular: objectOf({
    kind: exactly('regular'),
    method: oneOf<VatMethod>(['cash', 'accrual']),
    period: oneOf<VatPeriod>(['monthly', 'quarterly', 'yearly']),
    permanentExtension: bool,
  }),
});

const business = variant<BusinessType>({
  freelance: objectOf({ kind: exactly('freelance') }),
  trade: objectOf({
    kind: exactly('trade'),
    municipality: text(LIMITS.municipality),
    multiplierPercent: int(MIN_TRADE_TAX_MULTIPLIER_PERCENT, MAX_TRADE_TAX_MULTIPLIER_PERCENT),
  }),
});

const tax = objectOf<TaxSettings>({ taxNumber: text(40), vatId: text(20), vat: vatScheme, business });

const bankAccount = variant<BankAccount>({
  bank: objectOf({
    id: accountId,
    kind: exactly('bank'),
    name: text(ACCOUNT_LIMITS.name),
    holder: text(ACCOUNT_LIMITS.holder),
    iban: (v, path) => (typeof v === 'string' && /^[A-Z0-9]{0,34}$/.test(v) ? v : fail(path, `expected an IBAN, got ${describe(v)}`)),
    bic: (v, path) => (typeof v === 'string' && /^[A-Z0-9]{0,11}$/.test(v) ? v : fail(path, `expected a BIC, got ${describe(v)}`)),
    deletedAt: nullable(dateTime),
  }),
  paypal: objectOf({
    id: accountId,
    kind: exactly('paypal'),
    name: text(ACCOUNT_LIMITS.name),
    email: text(LIMITS.email),
    deletedAt: nullable(dateTime),
  }),
});

/** Account IDs are unique, so that a reference finds one account; the default is one of the active accounts */
const bank: Check<Banking> = (v, path) => {
  const b = objectOf<Banking>({ defaultAccountId: accountId, accounts: listOf(bankAccount, MAX_ACCOUNTS) })(v, path);
  const ids = new Set<string>();
  b.accounts.forEach((a, i) => {
    if (ids.has(a.id)) fail(`${path}.accounts[${i}].id`, 'used by another account');
    ids.add(a.id);
  });
  if (!b.accounts.some((a) => a.id === b.defaultAccountId && a.deletedAt === null)) fail(`${path}.defaultAccountId`, 'expected an active account of the list');
  return b;
};

/** The pattern produces file names (documents/issued/<number>.pdf): only valid patterns pass */
const numberPattern: Check<string> = (v, path) =>
  typeof v === 'string' && v.length <= MAX_PATTERN_LENGTH && patternProblem(v) === null ? v : fail(path, `expected a number pattern, got ${describe(v)}`);

const invoiceDefaults = objectOf<InvoiceDefaults>({
  numberPattern,
  paymentTermDays: int(0, LIMITS.maxPaymentTermDays),
  footer: text(LIMITS.footer),
});

/** Only the known fields are kept: the keys come from the file and must not become arbitrary keys of the record. */
const fieldTimestamps =
  <F extends string>(fields: readonly F[]): Check<Partial<Record<F, string>>> =>
  (v, path) => {
    if (!isRecord(v)) return fail(path, `expected an object, got ${describe(v)}`);
    const out: Partial<Record<F, string>> = {};
    for (const field of fields) {
      const value = v[field];
      if (value !== undefined) out[field] = dateTime(value, `${path}.${field}`);
    }
    return out;
  };

export const validateCompany: Check<CompanyFile> = objectOf<CompanyFile>({
  schemaVersion: num,
  id: companyId,
  name: text(LIMITS.name),
  owner: text(LIMITS.owner),
  address,
  contact: contactDetails,
  logo: nullable(logo),
  tax,
  bank,
  invoiceDefaults,
  createdAt: dateTime,
  fieldUpdatedAt: fieldTimestamps(MERGEABLE_FIELDS),
});

const roles = objectOf<ContactRoles>({ customer: bool, supplier: bool });

export const validateContact: Check<ContactFile> = objectOf<ContactFile>({
  schemaVersion: num,
  id: contactId,
  kind: oneOf<ContactKind>(['company', 'person']),
  roles,
  name: text(CONTACT_LIMITS.name),
  nameLine2: text(CONTACT_LIMITS.nameLine2),
  contactPerson: text(CONTACT_LIMITS.contactPerson),
  customerNumber: text(CONTACT_LIMITS.customerNumber),
  address: nullable(address),
  contact: contactDetails,
  vatId: text(CONTACT_LIMITS.vatId),
  leitwegId: text(46),
  orderReference: text(CONTACT_LIMITS.orderReference),
  paymentTermDays: nullable(int(0, TEXT_LIMITS.maxPaymentTermDays)),
  notes: text(CONTACT_LIMITS.notes),
  createdAt: dateTime,
  deletedAt: nullable(dateTime),
  fieldUpdatedAt: fieldTimestamps(CONTACT_MERGEABLE_FIELDS),
});

const vatRate: Check<BasisPoints> = (v, path) => (isVatRate(v) ? v : fail(path, `expected a VAT rate, got ${describe(v)}`));
const netPrice: Check<Cents> = (v, path) => cents(int(0, ITEM_LIMITS.maxNetPrice)(v, path));

export const validateItem: Check<ItemFile> = objectOf<ItemFile>({
  schemaVersion: num,
  id: itemId,
  number: text(ITEM_LIMITS.number),
  name: text(ITEM_LIMITS.name),
  description: text(ITEM_LIMITS.description),
  unit: oneOf<UnitCode>(UNITS),
  netPrice,
  vatRate,
  createdAt: dateTime,
  deletedAt: nullable(dateTime),
  fieldUpdatedAt: fieldTimestamps(ITEM_MERGEABLE_FIELDS),
});
