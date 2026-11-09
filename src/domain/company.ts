// The company profile: master data, tax settings and invoice defaults, plus the first bank account, which the
// setup assistant asks for (further accounts are added in the settings, see bankAccount.ts).
// The setup assistant and the settings page edit it as a draft of plain strings; `readSection` checks one part
// of the draft and turns it into profile values. Nothing here touches files or the UI.

import { err, ok, type Result } from '../data/result';
import { ACCOUNT_LIMITS, type BankDetails } from './bankAccount';
import { Checker, DEFAULT_COUNTRY, TEXT_LIMITS, type Address, type ContactDetails, type FieldError } from './check';
import { counterOnlyProblem, patternProblem, DEFAULT_CONTACT_PATTERN, DEFAULT_INVOICE_PATTERN, DEFAULT_ITEM_PATTERN, DEFAULT_QUOTE_PATTERN } from './numbering';
import { minMultiplierPercent } from './tax/tradeTax';
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

/**
 * The parts of the footer of a document that can be left out (F26). The tax number or VAT ID and the account stay: § 14
 * UStG asks for the tax number, and the request for payment points to the account below.
 */
export const FOOTER_PARTS = ['address', 'phone', 'email'] as const;
export type FooterPart = (typeof FOOTER_PARTS)[number];
/** Which parts the footer shows */
export type FooterParts = Record<FooterPart, boolean>;
export const DEFAULT_FOOTER_PARTS: FooterParts = { address: true, phone: true, email: true };

export interface InvoiceDefaults {
  numberPattern: string;
  /** The pattern of quote numbers, given when a quote is finalized; it differs from `numberPattern` */
  quotePattern: string;
  /** The pattern of the number a new contact starts with (customer or supplier number); a counter only, no date (F28) */
  contactPattern: string;
  /** The pattern of the number a new item starts with; a counter only, no date (F28) */
  itemPattern: string;
  paymentTermDays: number;
  footer: string;
  /** Which parts of the master data the footer shows (F26) */
  footerParts: FooterParts;
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
  quotePattern: string;
  contactPattern: string;
  itemPattern: string;
  paymentTermDays: string;
  footer: string;
  footerParts: FooterParts;
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
  quotePattern: DEFAULT_QUOTE_PATTERN,
  contactPattern: DEFAULT_CONTACT_PATTERN,
  itemPattern: DEFAULT_ITEM_PATTERN,
  paymentTermDays: String(DEFAULT_PAYMENT_TERM_DAYS),
  footer: '',
  footerParts: { ...DEFAULT_FOOTER_PARTS },
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
    quotePattern: p.invoiceDefaults.quotePattern,
    contactPattern: p.invoiceDefaults.contactPattern,
    itemPattern: p.invoiceDefaults.itemPattern,
    paymentTermDays: String(p.invoiceDefaults.paymentTermDays),
    footer: p.invoiceDefaults.footer,
    footerParts: { ...p.invoiceDefaults.footerParts },
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
  invoice: ['numberPattern', 'quotePattern', 'contactPattern', 'itemPattern', 'paymentTermDays', 'footer', 'footerParts'],
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

/** The multiplier must reach the legal minimum of `year`, the current year */
function readTax(d: CompanyDraft, year: number): Read<SectionValues['tax']> {
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
    if (!/^\d+$/.test(d.multiplier.trim()) || multiplier < minMultiplierPercent(year) || multiplier > MAX_TRADE_TAX_MULTIPLIER_PERCENT) {
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
  const quotePattern = d.quotePattern.trim();
  const quoteProblem = patternProblem(quotePattern);
  if (quoteProblem) c.add('quotePattern', `pattern.${quoteProblem}`);
  else if (quotePattern === numberPattern) c.add('quotePattern', 'pattern.sameAsInvoice');
  const contactPattern = d.contactPattern.trim();
  const contactProblem = counterOnlyProblem(contactPattern);
  if (contactProblem) c.add('contactPattern', `pattern.${contactProblem}`);
  const itemPattern = d.itemPattern.trim();
  const itemProblem = counterOnlyProblem(itemPattern);
  if (itemProblem) c.add('itemPattern', `pattern.${itemProblem}`);
  const paymentTermDays = c.paymentTerm('paymentTermDays', d.paymentTermDays);
  const footer = c.optionalText('footer', d.footer, LIMITS.footer);
  return c.done(() => ({ invoiceDefaults: { numberPattern, quotePattern, contactPattern, itemPattern, paymentTermDays, footer, footerParts: { ...d.footerParts } } }));
}

const READERS: { [S in Section]: (d: CompanyDraft, year: number) => Read<SectionValues[S]> } = {
  master: readMaster,
  tax: readTax,
  bank: readBank,
  invoice: readInvoice,
};

/**
 * Checks one section of the draft; the values are returned only when every field of the section is valid. `year` is
 * the current year: the legal minimum of the trade tax multiplier depends on it.
 */
export const readSection = <S extends Section>(section: S, draft: CompanyDraft, year: number): Read<SectionValues[S]> => READERS[section](draft, year);

/** Checks all sections; the profile (without logo) and the first account are returned only when every section is valid. */
export function readProfile(draft: CompanyDraft, year: number): Read<NewCompany> {
  const master = readMaster(draft);
  const tax = readTax(draft, year);
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

/**
 * The largest logo in pixels, read from the header before the picture is decoded (#78). The logo box of a document
 * (55 × 24 mm) needs about 1300 × 570 pixels at 600 dpi; a small file can declare far more and fill the memory.
 */
export const MAX_LOGO_SIDE = 10_000;
export const MAX_LOGO_PIXELS = 25_000_000;

/** `dimensions`: larger in pixels than allowed, or a PNG or JPEG whose size cannot be read from its header */
export type LogoProblem = 'empty' | 'tooLarge' | 'unsupportedType' | 'dimensions';

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

/** A JPEG marker that starts a frame header with the size: SOF0 to SOF15 without DHT (C4), JPG (C8) and DAC (CC) */
const isFrameMarker = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/**
 * The size of a PNG (its IHDR chunk) or of a JPEG (its frame header), read from the bytes without decoding the picture.
 * Null when the header cannot be found; an SVG has no size in pixels.
 */
export function logoDimensions(bytes: Uint8Array, type: LogoType): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 'image/png') {
    // signature (8), chunk length (4), "IHDR" (4), width (4), height (4)
    if (bytes.length < 24 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (type !== 'image/jpeg') return null;
  let at = 2; // after SOI
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] as number;
    // fill bytes, and the markers without a length
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    // the image data or its end before a frame header: no size
    if (marker === 0xda || marker === 0xd9) return null;
    const length = view.getUint16(at + 2);
    if (isFrameMarker(marker)) return at + 9 <= bytes.length ? { width: view.getUint16(at + 7), height: view.getUint16(at + 5) } : null;
    at += 2 + length;
  }
  return null;
}

export function checkLogo(bytes: Uint8Array): Result<LogoType, LogoProblem> {
  if (bytes.length === 0) return err('empty');
  if (bytes.length > MAX_LOGO_BYTES) return err('tooLarge');
  const type = detectLogoType(bytes);
  if (!type) return err('unsupportedType');
  if (type === 'image/svg+xml') return ok(type);
  const size = logoDimensions(bytes, type);
  if (!size || size.width === 0 || size.height === 0 || size.width > MAX_LOGO_SIDE || size.height > MAX_LOGO_SIDE || size.width * size.height > MAX_LOGO_PIXELS) return err('dimensions');
  return ok(type);
}

/** Why a logo file of the folder is not used: `changed` when it is not the file company.json names (another hash or type) */
export type StoredLogoProblem = LogoProblem | 'changed';

/**
 * Checks a logo read from the folder before it is shown or printed (#78): it must be the file company.json names (its
 * SHA-256, computed by the caller, and its type) and pass the checks of an upload. Another file under the same name
 * (a shared folder, a sync conflict) is not used.
 */
export function checkStoredLogo(bytes: Uint8Array, sha256: string, ref: LogoRef): Result<LogoType, StoredLogoProblem> {
  if (sha256 !== ref.sha256) return err('changed');
  const checked = checkLogo(bytes);
  if (!checked.ok) return checked;
  return checked.value === ref.type ? checked : err('changed');
}

export const logoFileName = (sha256: string, type: LogoType): string => `logo-${sha256.slice(0, 16)}.${LOGO_EXTENSION[type]}`;
