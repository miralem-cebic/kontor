import type { BankDetails } from '../../src/domain/bankAccount';
import type { CompanyDraft, CompanyProfile } from '../../src/domain/company';
import { emptyDraft } from '../../src/domain/company';
import { emptyContactDraft, type ContactDraft, type ContactProfile } from '../../src/domain/contact';
import type { DocumentLine } from '../../src/domain/document';
import type { InvoiceContent } from '../../src/domain/invoice';
import type { ItemProfile } from '../../src/domain/item';
import { basisPoints, cents, quantity } from '../../src/domain/money';
import type { QuoteContent } from '../../src/domain/quote';
import { makeCompany } from '../../src/data/schema';
import type { CompanyFile } from '../../src/data/types';

/** Property tests: a fixed seed in CI (repeatable), random locally. FC_SEED repeats a failing run, FC_RUNS runs more cases. */
export const fcParams = {
  ...(process.env['FC_SEED'] ? { seed: Number(process.env['FC_SEED']) } : process.env['CI'] ? { seed: 42 } : {}),
  numRuns: Number(process.env['FC_RUNS'] ?? 200),
};

/** A complete, valid profile (regular VAT, trade) */
export const sampleProfile = (over: Partial<CompanyProfile> = {}): CompanyProfile => ({
  name: 'Muster Design',
  owner: 'Erika Mustermann',
  address: { street: 'Hauptstraße 1', postalCode: '50667', city: 'Köln', country: 'DE' },
  contact: { email: 'erika@example.com', phone: '+49 221 123456' },
  logo: null,
  tax: {
    taxNumber: '12/345/67890',
    vatId: 'DE136695976',
    vat: { kind: 'regular', method: 'accrual', period: 'quarterly', permanentExtension: true },
    business: { kind: 'trade', municipality: 'Köln', multiplierPercent: 475 },
  },
  invoiceDefaults: { numberPattern: 'RE-{YYYY}-{NNNN}', paymentTermDays: 14, footer: '' },
  ...over,
});

/** A valid bank account */
export const sampleAccount = (over: Partial<BankDetails> = {}): BankDetails => ({
  kind: 'bank',
  name: 'Geschäftskonto',
  holder: 'Erika Mustermann',
  iban: 'DE89370400440532013000',
  bic: 'COBADEFFXXX',
  ...over,
});

/** A new company file with the sample profile and the sample account as its default */
export const sampleCompany = (over: Partial<CompanyProfile> = {}): CompanyFile => makeCompany(sampleProfile(over), sampleAccount());

/** A draft that passes every section */
export const sampleDraft = (over: Partial<CompanyDraft> = {}): CompanyDraft => ({
  ...emptyDraft(),
  name: 'Muster Design',
  owner: 'Erika Mustermann',
  street: 'Hauptstraße 1',
  postalCode: '50667',
  city: 'Köln',
  email: 'erika@example.com',
  taxNumber: '12/345/67890',
  smallBusiness: true,
  businessKind: 'freelance',
  bankHolder: 'Erika Mustermann',
  iban: 'DE89 3704 0044 0532 0130 00',
  ...over,
});

/** A business customer with everything filled in */
export const sampleContact = (over: Partial<ContactProfile> = {}): ContactProfile => ({
  kind: 'company',
  roles: { customer: true, supplier: false },
  name: 'Kunde GmbH',
  nameLine2: 'Einkauf',
  contactPerson: 'Max Muster',
  customerNumber: 'K-1001',
  address: { street: 'Ringstraße 5', postalCode: '10115', city: 'Berlin', country: 'DE' },
  contact: { email: 'einkauf@kunde.example', phone: '' },
  vatId: 'DE136695976',
  leitwegId: '',
  orderReference: 'PO-4711',
  paymentTermDays: 30,
  notes: '',
  ...over,
});

export const sampleContactDraft = (over: Partial<ContactDraft> = {}): ContactDraft => ({ ...emptyContactDraft(), name: 'Kunde GmbH', ...over });

/** An hourly service of the catalogue */
export const sampleItem = (over: Partial<ItemProfile> = {}): ItemProfile => ({
  number: 'L-100',
  name: 'Webdesign',
  description: 'Gestaltung und Umsetzung\nnach Aufwand',
  unit: 'HUR',
  netPrice: cents(8500),
  vatRate: basisPoints(1900),
  ...over,
});

/** A line of 12.5 hours at 85 € and 19 % */
export const sampleLine = (over: Partial<DocumentLine> = {}): DocumentLine => ({
  name: 'Webdesign',
  description: '',
  quantity: quantity(12_500),
  unit: 'HUR',
  unitPrice: cents(8500),
  vatRate: basisPoints(1900),
  ...over,
});

/** A quote with one line at 19 % and one at 7 % */
export const sampleQuote = (over: Partial<QuoteContent> = {}): QuoteContent => ({
  date: '2026-10-22',
  validUntil: '2026-11-21',
  subject: 'Website-Relaunch',
  introText: 'Sehr geehrte Damen und Herren,',
  closingText: '',
  lines: [sampleLine(), sampleLine({ name: 'Lektorat', quantity: quantity(1000), unit: 'LS', unitPrice: cents(30000), vatRate: basisPoints(700) })],
  ...over,
});

/** An invoice with the lines of the sample quote, for a service in October 2026, due in 14 days */
export const sampleInvoice = (over: Partial<InvoiceContent> = {}): InvoiceContent => ({
  date: '2026-10-31',
  service: { kind: 'period', start: '2026-10-01', end: '2026-10-31' },
  paymentTermDays: 14,
  taxTreatment: 'standard',
  orderReference: 'PO-4711',
  leitwegId: '',
  subject: 'Website-Relaunch',
  introText: '',
  closingText: 'Vielen Dank für Ihren Auftrag.',
  lines: sampleQuote().lines,
  ...over,
});

/** localStorage stand-in for unit tests (Node has none) */
export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}
