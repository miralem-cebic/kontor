import type { CompanyDraft, CompanyProfile } from '../../src/domain/company';
import { emptyDraft } from '../../src/domain/company';
import { emptyContactDraft, type ContactDraft, type ContactProfile } from '../../src/domain/contact';

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
  bank: { holder: 'Erika Mustermann', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' },
  invoiceDefaults: { numberPattern: 'RE-{YYYY}-{NNNN}', paymentTermDays: 14, footer: '' },
  ...over,
});

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
