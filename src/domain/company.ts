// The company profile: master data, tax settings and invoice defaults, plus the first bank account, which the
// setup assistant asks for (further accounts are added in the settings, see bankAccount.ts).
// The setup assistant and the settings page edit it as a draft of plain strings; `readSection` checks one part
// of the draft and turns it into profile values. Nothing here touches files or the UI.

import { err, ok, type Result } from '../data/result';
import { ACCOUNT_LIMITS, type BankDetails } from './bankAccount';
import { Checker, DEFAULT_COUNTRY, TEXT_LIMITS, type Address, type ContactDetails, type FieldError } from './check';
import { patternProblem, DEFAULT_INVOICE_PATTERN } from './numbering';
import { isValidGermanVatId, isValidTaxNumber, normalizeVatId } from './taxIds';

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

/** The profile of company.json; its bank accounts are part of the file format (data/types.ts) */
export interface CompanyProfile {
  name: string;
  owner: string;
  address: Address;
  contact: ContactDetails;
  logo: LogoRef | null;
  tax: TaxSettings;
  invoiceDefaults: InvoiceDefaults;
}

/* ---------- Limits ---------- */

export const LIMITS = {
  ...TEXT_LIMITS,
  name: 120,
  owner: 120,
  municipality: 80,
  bankHolder: ACCOUNT_LIMITS.holder,
  footer: 1000,
} as const;

/** Lowest multiplier a municipality may set (§ 16 Abs. 4 Satz 2 GewStG) */
export const MIN_TRADE_TAX_MULTIPLIER_PERCENT = 200;
/** Upper bound of the input field (four digits); not a legal limit */
export const MAX_TRADE_TAX_MULTIPLIER_PERCENT = 9999;

/**
 * Where to look up the multiplier of a municipality: the map "Hebesätze der Gemeinden" of the statistical offices of
 * the Federation and the Länder, with the multipliers of every municipality (also in the Regionaldatenbank, table
 * 71231). It may lag behind a change; the municipality's own Hebesatzsatzung is binding. The app cannot load the data
 * itself (no network, ADR 0001), so it links to the source.
 */
export const TRADE_TAX_MULTIPLIER_SOURCE = 'https://www.statistikportal.de/de/karte-hebesaetze';

export const DEFAULT_PAYMENT_TERM_DAYS = 14;

/* ---------- Draft ---------- */

/**
 * What the forms edit. Choices that have tax consequences start unset, so that they are made on purpose.
 * The bank fields are the first account of the setup assistant; the settings edit accounts on their own.
 */
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
    bankHolder: '',
    iban: '',
    bic: '',
    numberPattern: p.invoiceDefaults.numberPattern,
    paymentTermDays: String(p.invoiceDefaults.paymentTermDays),
    footer: p.invoiceDefaults.footer,
  };
}

/* ---------- Checks ---------- */

export type CompanyFieldError = FieldError<DraftField>;

export const SECTIONS = ['master', 'tax', 'bank', 'invoice'] as const;
export type Section = (typeof SECTIONS)[number];

export interface SectionValues {
  master: Pick<CompanyProfile, 'name' | 'owner' | 'address' | 'contact'>;
  tax: Pick<CompanyProfile, 'tax'>;
  /** The first account, which becomes the default for invoices */
  bank: { account: BankDetails };
  invoice: Pick<CompanyProfile, 'invoiceDefaults'>;
}

/** What the setup assistant collects: the profile without the logo, and the first bank account */
export type NewCompany = Omit<CompanyProfile, 'logo'> & SectionValues['bank'];

/** The draft fields that belong to each section (to show the errors of one step) */
export const SECTION_FIELDS: Record<Section, readonly DraftField[]> = {
  master: ['name', 'owner', 'street', 'postalCode', 'city', 'country', 'email', 'phone'],
  tax: ['taxNumber', 'vatId', 'smallBusiness', 'vatMethod', 'vatPeriod', 'permanentExtension', 'businessKind', 'municipality', 'multiplier'],
  bank: ['bankHolder', 'iban', 'bic'],
  invoice: ['numberPattern', 'paymentTermDays', 'footer'],
};

type Read<T> = Result<T, CompanyFieldError[]>;

const ADDRESS_FIELDS = { street: 'street', postalCode: 'postalCode', city: 'city', country: 'country' } as const;

function readMaster(d: CompanyDraft): Read<SectionValues['master']> {
  const c = new Checker<DraftField>();
  const name = c.text('name', d.name, LIMITS.name);
  const owner = c.text('owner', d.owner, LIMITS.owner);
  const address = c.address(ADDRESS_FIELDS, d);
  const email = c.email('email', d.email, true);
  const phone = c.phone('phone', d.phone);
  return c.done(() => ({ name, owner, address, contact: { email, phone } }));
}

function readTax(d: CompanyDraft): Read<SectionValues['tax']> {
  const c = new Checker<DraftField>();
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

function readBank(d: CompanyDraft): Read<SectionValues['bank']> {
  const c = new Checker<DraftField>();
  const holder = c.text('bankHolder', d.bankHolder, LIMITS.bankHolder);
  const iban = c.iban('iban', d.iban);
  const bic = c.bic('bic', d.bic);
  return c.done(() => ({ account: { kind: 'bank', name: '', holder, iban, bic } }));
}

function readInvoice(d: CompanyDraft): Read<SectionValues['invoice']> {
  const c = new Checker<DraftField>();
  const numberPattern = d.numberPattern.trim();
  const problem = patternProblem(numberPattern);
  if (problem) c.add('numberPattern', `pattern.${problem}`);
  const paymentTermDays = c.paymentTerm('paymentTermDays', d.paymentTermDays);
  const footer = c.optionalText('footer', d.footer, LIMITS.footer);
  return c.done(() => ({ invoiceDefaults: { numberPattern, paymentTermDays, footer } }));
}

const READERS: { [S in Section]: (d: CompanyDraft) => Read<SectionValues[S]> } = {
  master: readMaster,
  tax: readTax,
  bank: readBank,
  invoice: readInvoice,
};

/** Checks one section of the draft; the values are returned only when every field of the section is valid. */
export const readSection = <S extends Section>(section: S, draft: CompanyDraft): Read<SectionValues[S]> => READERS[section](draft);

/** Checks all sections; the profile (without logo) and the first account are returned only when every section is valid. */
export function readProfile(draft: CompanyDraft): Read<NewCompany> {
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
