// The company profile: master data, tax settings, bank account and invoice defaults.
// The setup assistant and the settings page edit it as a draft of plain strings; `readSection` checks one part
// of the draft and turns it into profile values. Nothing here touches files or the UI.

import { err, ok, type Result } from '../data/result';
import { ibanProblem, isValidBic, normalizeIban, type IbanProblem } from './iban';
import { patternProblem, DEFAULT_INVOICE_PATTERN, type PatternProblem } from './numbering';
import { isValidGermanVatId, isValidTaxNumber, normalizeVatId } from './taxIds';

export interface Address {
  street: string;
  postalCode: string;
  city: string;
  /** ISO 3166-1 alpha-2, for example "DE" */
  country: string;
}

export interface Contact {
  email: string;
  /** Empty when not given */
  phone: string;
}

/** Ist-Versteuerung (cash, § 20 UStG) or Soll-Versteuerung (accrual, § 16 UStG) */
export type VatMethod = 'cash' | 'accrual';
/** Period of the advance VAT return (Umsatzsteuer-Voranmeldung, § 18 UStG) */
export type VatPeriod = 'monthly' | 'quarterly' | 'yearly';

export type VatScheme =
  /** Kleinunternehmer (§ 19 UStG): no VAT on invoices, no advance returns */
  | { kind: 'smallBusiness' }
  /** permanentExtension: Dauerfristverlängerung (§ 46 UStDV), only for monthly or quarterly returns */
  | { kind: 'regular'; method: VatMethod; period: VatPeriod; permanentExtension: boolean };

export type BusinessType =
  /** Freiberufliche Tätigkeit (§ 18 EStG): no trade tax */
  | { kind: 'freelance' }
  /** Gewerbe: trade tax with the multiplier (Hebesatz) of the municipality, in percent */
  | { kind: 'trade'; municipality: string; multiplierPercent: number };

export interface TaxSettings {
  /** Steuernummer as typed (state format); empty when only a VAT ID is given */
  taxNumber: string;
  /** USt-IdNr., normalized ("DE…"); empty when not given */
  vatId: string;
  vat: VatScheme;
  business: BusinessType;
}

export interface BankAccount {
  holder: string;
  /** Normalized: capitals, no spaces */
  iban: string;
  /** Empty when not given (optional within SEPA) */
  bic: string;
}

export interface InvoiceDefaults {
  numberPattern: string;
  paymentTermDays: number;
  footer: string;
}

export type LogoType = 'image/png' | 'image/jpeg' | 'image/svg+xml';

/** A logo stored in the company folder under assets/<file>. The file name contains the start of its hash. */
export interface LogoRef {
  file: string;
  type: LogoType;
  /** SHA-256 of the file content, hex */
  sha256: string;
}

export interface CompanyProfile {
  name: string;
  owner: string;
  address: Address;
  contact: Contact;
  logo: LogoRef | null;
  tax: TaxSettings;
  bank: BankAccount;
  invoiceDefaults: InvoiceDefaults;
}

/* ---------- Limits ---------- */

export const LIMITS = {
  name: 120,
  owner: 120,
  street: 120,
  city: 80,
  email: 254,
  phone: 40,
  municipality: 80,
  bankHolder: 120,
  footer: 1000,
  maxPaymentTermDays: 365,
} as const;

/** Lowest multiplier a municipality may set (§ 16 Abs. 4 Satz 2 GewStG) */
export const MIN_TRADE_TAX_MULTIPLIER_PERCENT = 200;
/** Upper bound of the input field (four digits); not a legal limit */
export const MAX_TRADE_TAX_MULTIPLIER_PERCENT = 9999;

export const DEFAULT_PAYMENT_TERM_DAYS = 14;
export const DEFAULT_COUNTRY = 'DE';

/* ---------- Draft ---------- */

/** What the forms edit. Choices that have tax consequences start unset, so that they are made on purpose. */
export interface CompanyDraft {
  name: string;
  owner: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  taxNumber: string;
  vatId: string;
  smallBusiness: boolean | null;
  vatMethod: VatMethod | null;
  vatPeriod: VatPeriod | null;
  permanentExtension: boolean;
  businessKind: BusinessType['kind'] | null;
  municipality: string;
  multiplier: string;
  bankHolder: string;
  iban: string;
  bic: string;
  numberPattern: string;
  paymentTermDays: string;
  footer: string;
}

export type DraftField = keyof CompanyDraft;

export const emptyDraft = (): CompanyDraft => ({
  name: '',
  owner: '',
  street: '',
  postalCode: '',
  city: '',
  country: DEFAULT_COUNTRY,
  email: '',
  phone: '',
  taxNumber: '',
  vatId: '',
  smallBusiness: null,
  vatMethod: null,
  vatPeriod: null,
  permanentExtension: false,
  businessKind: null,
  municipality: '',
  multiplier: '',
  bankHolder: '',
  iban: '',
  bic: '',
  numberPattern: DEFAULT_INVOICE_PATTERN,
  paymentTermDays: String(DEFAULT_PAYMENT_TERM_DAYS),
  footer: '',
});

export function draftFromProfile(p: CompanyProfile): CompanyDraft {
  const vat = p.tax.vat;
  const business = p.tax.business;
  return {
    name: p.name,
    owner: p.owner,
    street: p.address.street,
    postalCode: p.address.postalCode,
    city: p.address.city,
    country: p.address.country,
    email: p.contact.email,
    phone: p.contact.phone,
    taxNumber: p.tax.taxNumber,
    vatId: p.tax.vatId,
    smallBusiness: vat.kind === 'smallBusiness',
    vatMethod: vat.kind === 'regular' ? vat.method : null,
    vatPeriod: vat.kind === 'regular' ? vat.period : null,
    permanentExtension: vat.kind === 'regular' && vat.permanentExtension,
    businessKind: business.kind,
    municipality: business.kind === 'trade' ? business.municipality : '',
    multiplier: business.kind === 'trade' ? String(business.multiplierPercent) : '',
    bankHolder: p.bank.holder,
    iban: p.bank.iban,
    bic: p.bank.bic,
    numberPattern: p.invoiceDefaults.numberPattern,
    paymentTermDays: String(p.invoiceDefaults.paymentTermDays),
    footer: p.invoiceDefaults.footer,
  };
}

/* ---------- Checks ---------- */

export type FieldProblem =
  | 'required'
  | 'tooLong'
  | 'email'
  | 'phone'
  | 'postalCode'
  | 'country'
  | 'taxIdRequired'
  | 'taxNumber'
  | 'vatId'
  | 'multiplier'
  | 'bic'
  | 'paymentTerm'
  | `iban.${IbanProblem}`
  | `pattern.${PatternProblem}`;

export interface FieldError {
  field: DraftField;
  problem: FieldProblem;
}

export const SECTIONS = ['master', 'tax', 'bank', 'invoice'] as const;
export type Section = (typeof SECTIONS)[number];

export interface SectionValues {
  master: Pick<CompanyProfile, 'name' | 'owner' | 'address' | 'contact'>;
  tax: Pick<CompanyProfile, 'tax'>;
  bank: Pick<CompanyProfile, 'bank'>;
  invoice: Pick<CompanyProfile, 'invoiceDefaults'>;
}

/** The draft fields that belong to each section (to show the errors of one step) */
export const SECTION_FIELDS: Record<Section, readonly DraftField[]> = {
  master: ['name', 'owner', 'street', 'postalCode', 'city', 'country', 'email', 'phone'],
  tax: ['taxNumber', 'vatId', 'smallBusiness', 'vatMethod', 'vatPeriod', 'permanentExtension', 'businessKind', 'municipality', 'multiplier'],
  bank: ['bankHolder', 'iban', 'bic'],
  invoice: ['numberPattern', 'paymentTermDays', 'footer'],
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+()/ -]+$/;
const GERMAN_POSTAL_CODE = /^\d{5}$/;
const OTHER_POSTAL_CODE = /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/;

class Checker {
  readonly errors: FieldError[] = [];

  add(field: DraftField, problem: FieldProblem) {
    this.errors.push({ field, problem });
  }

  /** A required text: trimmed, not empty, not longer than `max` */
  text(field: DraftField, value: string, max: number): string {
    const v = value.trim();
    if (!v) this.add(field, 'required');
    else if (v.length > max) this.add(field, 'tooLong');
    return v;
  }

  /** An optional text: trimmed, not longer than `max` */
  optionalText(field: DraftField, value: string, max: number): string {
    const v = value.trim();
    if (v.length > max) this.add(field, 'tooLong');
    return v;
  }

  /** A choice that must have been made */
  chosen<T>(field: DraftField, value: T | null): T | null {
    if (value === null) this.add(field, 'required');
    return value;
  }

  done<T>(value: () => T): Result<T, FieldError[]> {
    return this.errors.length ? err(this.errors) : ok(value());
  }
}

function readMaster(d: CompanyDraft): Result<SectionValues['master'], FieldError[]> {
  const c = new Checker();
  const name = c.text('name', d.name, LIMITS.name);
  const owner = c.text('owner', d.owner, LIMITS.owner);
  const street = c.text('street', d.street, LIMITS.street);
  const city = c.text('city', d.city, LIMITS.city);
  const country = d.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) c.add('country', 'country');
  const postalCode = d.postalCode.trim();
  if (!postalCode) c.add('postalCode', 'required');
  else if (!(country === 'DE' ? GERMAN_POSTAL_CODE : OTHER_POSTAL_CODE).test(postalCode)) c.add('postalCode', 'postalCode');
  const email = c.text('email', d.email, LIMITS.email);
  if (email && email.length <= LIMITS.email && !EMAIL.test(email)) c.add('email', 'email');
  const phone = c.optionalText('phone', d.phone, LIMITS.phone);
  if (phone && phone.length <= LIMITS.phone && !PHONE.test(phone)) c.add('phone', 'phone');
  return c.done(() => ({ name, owner, address: { street, postalCode, city, country }, contact: { email, phone } }));
}

function readTax(d: CompanyDraft): Result<SectionValues['tax'], FieldError[]> {
  const c = new Checker();
  const taxNumber = d.taxNumber.trim();
  const vatId = normalizeVatId(d.vatId);
  if (!taxNumber && !vatId) c.add('taxNumber', 'taxIdRequired');
  if (taxNumber && !isValidTaxNumber(taxNumber)) c.add('taxNumber', 'taxNumber');
  if (vatId && !isValidGermanVatId(vatId)) c.add('vatId', 'vatId');

  const small = c.chosen('smallBusiness', d.smallBusiness);
  const method = small === false ? c.chosen('vatMethod', d.vatMethod) : null;
  const period = small === false ? c.chosen('vatPeriod', d.vatPeriod) : null;

  const kind = c.chosen('businessKind', d.businessKind);
  let municipality = '';
  let multiplier = 0;
  if (kind === 'trade') {
    municipality = c.text('municipality', d.municipality, LIMITS.municipality);
    multiplier = Number(d.multiplier.trim());
    if (!/^\d+$/.test(d.multiplier.trim()) || multiplier < MIN_TRADE_TAX_MULTIPLIER_PERCENT || multiplier > MAX_TRADE_TAX_MULTIPLIER_PERCENT) {
      c.add('multiplier', 'multiplier');
    }
  }

  return c.done(() => {
    const vat: VatScheme =
      small || method === null || period === null
        ? { kind: 'smallBusiness' }
        : { kind: 'regular', method, period, permanentExtension: period !== 'yearly' && d.permanentExtension };
    const business: BusinessType = kind === 'trade' ? { kind: 'trade', municipality, multiplierPercent: multiplier } : { kind: 'freelance' };
    return { tax: { taxNumber, vatId, vat, business } };
  });
}

function readBank(d: CompanyDraft): Result<SectionValues['bank'], FieldError[]> {
  const c = new Checker();
  const holder = c.text('bankHolder', d.bankHolder, LIMITS.bankHolder);
  const iban = normalizeIban(d.iban);
  if (!iban) c.add('iban', 'required');
  else {
    const problem = ibanProblem(iban);
    if (problem) c.add('iban', `iban.${problem}`);
  }
  const bic = d.bic.trim().toUpperCase();
  if (bic && !isValidBic(bic)) c.add('bic', 'bic');
  return c.done(() => ({ bank: { holder, iban, bic } }));
}

function readInvoice(d: CompanyDraft): Result<SectionValues['invoice'], FieldError[]> {
  const c = new Checker();
  const numberPattern = d.numberPattern.trim();
  const problem = patternProblem(numberPattern);
  if (problem) c.add('numberPattern', `pattern.${problem}`);
  const term = d.paymentTermDays.trim();
  const paymentTermDays = Number(term);
  if (!/^\d+$/.test(term) || paymentTermDays > LIMITS.maxPaymentTermDays) c.add('paymentTermDays', 'paymentTerm');
  const footer = c.optionalText('footer', d.footer, LIMITS.footer);
  return c.done(() => ({ invoiceDefaults: { numberPattern, paymentTermDays, footer } }));
}

const READERS: { [S in Section]: (d: CompanyDraft) => Result<SectionValues[S], FieldError[]> } = {
  master: readMaster,
  tax: readTax,
  bank: readBank,
  invoice: readInvoice,
};

/** Checks one section of the draft; the values are returned only when every field of the section is valid. */
export const readSection = <S extends Section>(section: S, draft: CompanyDraft): Result<SectionValues[S], FieldError[]> => READERS[section](draft);

/** Checks all sections; the profile (without logo) is returned only when every section is valid. */
export function readProfile(draft: CompanyDraft): Result<Omit<CompanyProfile, 'logo'>, FieldError[]> {
  const master = readMaster(draft);
  const tax = readTax(draft);
  const bank = readBank(draft);
  const invoice = readInvoice(draft);
  if (master.ok && tax.ok && bank.ok && invoice.ok) return ok({ ...master.value, ...tax.value, ...bank.value, ...invoice.value });
  return err([master, tax, bank, invoice].flatMap((r) => (r.ok ? [] : r.error)));
}

/* ---------- Logo ---------- */

export const MAX_LOGO_BYTES = 1_000_000;
export const LOGO_EXTENSION: Record<LogoType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' };
/** Name of a logo file in assets/: "logo-" and the first 16 hex digits of its SHA-256 */
export const LOGO_FILE = /^logo-([0-9a-f]{16})\.(png|jpg|svg)$/;

export type LogoProblem = 'empty' | 'tooLarge' | 'unsupportedType';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const SVG_START = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i;
const SNIFF_BYTES = 2048;

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((b, i) => bytes[i] === b);

/** The type of an image by its content, not by its file name: PNG, JPEG or SVG. */
export function detectLogoType(bytes: Uint8Array): LogoType | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, SNIFF_BYTES));
  return SVG_START.test(head) ? 'image/svg+xml' : null;
}

export function checkLogo(bytes: Uint8Array): Result<LogoType, LogoProblem> {
  if (bytes.length === 0) return err('empty');
  if (bytes.length > MAX_LOGO_BYTES) return err('tooLarge');
  const type = detectLogoType(bytes);
  return type ? ok(type) : err('unsupportedType');
}

export const logoFileName = (sha256: string, type: LogoType): string => `logo-${sha256.slice(0, 16)}.${LOGO_EXTENSION[type]}`;
