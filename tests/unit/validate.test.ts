import { describe, expect, it } from 'vitest';
import { InvalidFileError, migrate } from '../../src/data/migrations';
import { makeContact, makeItem, makeQuote } from '../../src/data/schema';
import { brandId } from '../../src/data/ids';
import { isValidId } from '../../src/data/validate';
import { sampleCompany, sampleContact, sampleItem, sampleLine, sampleProfile, sampleQuote } from './fixtures';

/** A company file as it would be read from disk (plain JSON) */
const file = (over: Record<string, unknown> = {}) => ({ ...JSON.parse(JSON.stringify(sampleCompany())), ...over }) as Record<string, unknown>;
const read = (raw: unknown) => migrate('company', raw);

const bankAccount = (over: Record<string, unknown> = {}) => ({ id: 'a1', kind: 'bank', name: '', holder: 'A', iban: 'DE89370400440532013000', bic: '', deletedAt: null, ...over });
const paypal = (over: Record<string, unknown> = {}) => ({ id: 'p1', kind: 'paypal', name: 'PayPal', email: 'erika@example.com', deletedAt: null, ...over });
const banking = (accounts: unknown[], defaultAccountId: unknown = 'a1') => ({ defaultAccountId, accounts });

describe('company.json validation', () => {
  it('accepts a file written by the app', () => {
    const raw = file();
    expect(read(raw)).toEqual(raw);
  });

  it.each([
    ['id', '__proto__'],
    ['id', 'constructor'],
    ['id', '../x'],
    ['id', ''],
    ['name', 42],
    ['name', 'x'.repeat(121)],
    ['createdAt', 'yesterday'],
    ['logo', { file: '../../etc/passwd', type: 'image/png', sha256: 'a'.repeat(64) }],
    ['logo', { file: 'logo-aaaaaaaaaaaaaaaa.png', type: 'image/png', sha256: 'b'.repeat(64) }],
    ['logo', { file: 'logo-aaaaaaaaaaaaaaaa.svg', type: 'image/png', sha256: 'a'.repeat(64) }],
    ['tax', { ...sampleProfile().tax, vat: { kind: 'exempt' } }],
    ['tax', { ...sampleProfile().tax, vat: { kind: 'regular', method: 'cash', period: 'weekly', permanentExtension: false } }],
    ['tax', { ...sampleProfile().tax, business: { kind: 'trade', municipality: 'Köln', multiplierPercent: 150 } }],
    ['tax', { ...sampleProfile().tax, business: { kind: '__proto__' } }],
    // the single account of version 1 in a file of version 2
    ['bank', { holder: 'A', iban: 'DE89370400440532013000', bic: '' }],
    ['bank', banking([])],
    ['bank', banking({ a1: bankAccount() } as unknown as unknown[])],
    ['bank', banking([bankAccount({ iban: 'de89 3704' })])],
    ['bank', banking([bankAccount({ bic: 'cobadeff' })])],
    ['bank', banking([bankAccount({ kind: 'cash' })])],
    ['bank', banking([bankAccount({ id: '__proto__' })], '__proto__')],
    ['bank', banking([bankAccount({ name: 'x'.repeat(61) })])],
    ['bank', banking([bankAccount({ deletedAt: 'soon' })])],
    ['bank', banking([paypal({ email: 42 })], 'p1')],
    // the default must be an active account of the list, and IDs are unique
    ['bank', banking([bankAccount()], 'other')],
    ['bank', banking([bankAccount({ deletedAt: '2026-10-21T10:00:00.000Z' })])],
    ['bank', banking([bankAccount(), paypal({ id: 'a1' })])],
    ['bank', banking(Array.from({ length: 51 }, (_, i) => bankAccount({ id: `a${i + 1}` })))],
    ['invoiceDefaults', { numberPattern: '../{NNNN}', paymentTermDays: 14, footer: '' }],
    ['invoiceDefaults', { numberPattern: 'RE-{NNNN}', paymentTermDays: 14.5, footer: '' }],
    ['fieldUpdatedAt', { name: 'not a date' }],
    ['fieldUpdatedAt', []],
  ])('rejects %s = %j', (field, value) => {
    expect(() => read(file({ [field]: value }))).toThrow(InvalidFileError);
  });

  it('accepts a logo whose name matches its hash and type', () => {
    const logo = { file: 'logo-aaaaaaaaaaaaaaaa.svg', type: 'image/svg+xml', sha256: 'a'.repeat(64) };
    expect(read(file({ logo })).logo).toEqual(logo);
  });

  it('accepts bank and PayPal accounts, removed ones included', () => {
    const bank = banking([bankAccount({ deletedAt: '2026-10-21T10:00:00.000Z' }), paypal(), bankAccount({ id: 'a2', iban: 'AT611904300234573201' })], 'p1');
    expect(read(file({ bank })).bank).toEqual(bank);
  });

  it('accepts a semantically wrong but safe value (reported by the forms, not here)', () => {
    const [account] = read(file({ bank: banking([bankAccount({ iban: 'DE00123' })]) })).bank.accounts;
    expect(account?.kind === 'bank' && account.iban).toBe('DE00123');
  });

  it('keeps only known keys in fieldUpdatedAt', () => {
    const parsed = JSON.parse('{"name":"2026-01-01T00:00:00.000Z","__proto__":"2026-01-01T00:00:00.000Z","other":"2026-01-01T00:00:00.000Z"}') as unknown;
    const c = read(file({ fieldUpdatedAt: parsed }));
    expect(Object.keys(c.fieldUpdatedAt)).toEqual(['name']);
    expect(Object.getPrototypeOf(c.fieldUpdatedAt)).toBe(Object.prototype);
  });

  it('keeps unknown top-level fields, so that they are written back unchanged', () => {
    expect((read(file({ note: 'kept' })) as unknown as Record<string, unknown>)['note']).toBe('kept');
  });

  it('rejects files that are not objects', () => {
    for (const raw of [null, [], 'company', 42]) expect(() => read(raw)).toThrow(InvalidFileError);
  });
});

describe('isValidId', () => {
  it.each(['abc', 'a-b_c', '0f8fad5b-d9cb-469f-a165-70867728950e'])('accepts %s', (id) => expect(isValidId(id)).toBe(true));
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'a b', 'a/b', '', 'x'.repeat(101), 5, null])('rejects %j', (id) => expect(isValidId(id)).toBe(false));
});

describe('contact file validation', () => {
  const contactFile = (over: Record<string, unknown> = {}) => ({ ...JSON.parse(JSON.stringify(makeContact(sampleContact()))), ...over }) as Record<string, unknown>;
  const readContactFile = (raw: unknown) => migrate('contact', raw);

  it('accepts a file written by the app, also without address and payment term', () => {
    const raw = contactFile();
    expect(readContactFile(raw)).toEqual(raw);
    expect(readContactFile(contactFile({ address: null, paymentTermDays: null, deletedAt: '2026-10-21T10:00:00.000Z' })).deletedAt).toBe('2026-10-21T10:00:00.000Z');
  });

  it.each([
    ['id', 'constructor'],
    ['kind', 'robot'],
    ['roles', { customer: 'yes', supplier: false }],
    ['name', 'x'.repeat(121)],
    ['address', { street: 'A', postalCode: '1', city: 'B' }],
    ['paymentTermDays', 14.5],
    ['paymentTermDays', 366],
    ['deletedAt', 'gestern'],
    ['fieldUpdatedAt', { deletedAt: 1 }],
  ])('rejects %s = %j', (field, value) => {
    expect(() => readContactFile(contactFile({ [field]: value }))).toThrow(InvalidFileError);
  });
});

describe('item file validation', () => {
  const itemFile = (over: Record<string, unknown> = {}) => ({ ...JSON.parse(JSON.stringify(makeItem(sampleItem()))), ...over }) as Record<string, unknown>;
  const readItemFile = (raw: unknown) => migrate('item', raw);

  it('accepts a file written by the app, also a deleted item without number and description', () => {
    const raw = itemFile();
    expect(readItemFile(raw)).toEqual(raw);
    expect(readItemFile(itemFile({ number: '', description: '', netPrice: 0, vatRate: 0, deletedAt: '2026-10-21T10:00:00.000Z' })).netPrice).toBe(0);
  });

  it.each([
    ['id', '__proto__'],
    ['name', ''.padEnd(201, 'x')],
    ['description', 7],
    ['unit', 'Stunde'],
    ['unit', 'XYZ'],
    ['netPrice', 85.5],
    ['netPrice', -100],
    ['netPrice', 100_000_000_000],
    ['netPrice', '8500'],
    ['vatRate', 1600],
    ['vatRate', '1900'],
    ['deletedAt', 'gestern'],
    ['fieldUpdatedAt', { netPrice: 'today' }],
  ])('rejects %s = %j', (field, value) => {
    expect(() => readItemFile(itemFile({ [field]: value }))).toThrow(InvalidFileError);
  });
});

describe('document file validation', () => {
  const quoteFile = (over: Record<string, unknown> = {}) =>
    ({ ...JSON.parse(JSON.stringify(makeQuote(brandId<'ContactId'>('0f8fad5b-d9cb-469f-a165-70867728950e'), sampleQuote()))), ...over }) as Record<string, unknown>;
  const readDocument = (raw: unknown) => migrate('document', raw);
  const withLine = (over: Record<string, unknown>) => ({ lines: [{ ...sampleLine(), ...over }] });

  it('accepts a file written by the app, also without lines and deleted', () => {
    const raw = quoteFile();
    expect(readDocument(raw)).toEqual(raw);
    expect(readDocument(quoteFile({ lines: [], deletedAt: '2026-10-21T10:00:00.000Z' })).lines).toEqual([]);
  });

  it('accepts a valid-until date before the quote date (reported by the form, not here)', () => {
    expect(readDocument(quoteFile({ validUntil: '2026-01-01' })).validUntil).toBe('2026-01-01');
  });

  it.each([
    ['kind', 'invoice'],
    ['customerId', '__proto__'],
    ['customerId', null],
    ['date', '22.10.2026'],
    ['date', '2026-02-30'],
    ['validUntil', ''],
    ['subject', 'x'.repeat(201)],
    ['introText', 5],
    ['lines', {}],
    ['lines', Array.from({ length: 201 }, () => sampleLine())],
    ['fieldUpdatedAt', { lines: 'now' }],
  ])('rejects %s = %j', (field, value) => {
    expect(() => readDocument(quoteFile({ [field]: value }))).toThrow(InvalidFileError);
  });

  it.each([
    ['quantity', 0],
    ['quantity', 1.5],
    ['quantity', 1_000_000_000],
    ['unitPrice', -1],
    ['unitPrice', 10.5],
    ['vatRate', 1600],
    ['unit', 'Stunde'],
    ['name', null],
  ])('rejects a line with %s = %j', (field, value) => {
    expect(() => readDocument(quoteFile(withLine({ [field]: value })))).toThrow(InvalidFileError);
  });

  it('rejects a line whose amount is too large, so that every total stays exact', () => {
    expect(() => readDocument(quoteFile(withLine({ quantity: 2000, unitPrice: 99_999_999_999 })))).toThrow(InvalidFileError);
    expect(readDocument(quoteFile(withLine({ quantity: -1000, unitPrice: 99_999_999_999 }))).lines[0]?.quantity).toBe(-1000);
  });
});
