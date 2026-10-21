import { describe, expect, it } from 'vitest';
import { InvalidFileError, migrate } from '../../src/data/migrations';
import { makeCompany } from '../../src/data/schema';
import { isValidId } from '../../src/data/validate';
import { sampleProfile } from './fixtures';

/** A company file as it would be read from disk (plain JSON) */
const file = (over: Record<string, unknown> = {}) => ({ ...JSON.parse(JSON.stringify(makeCompany(sampleProfile()))), ...over }) as Record<string, unknown>;
const read = (raw: unknown) => migrate('company', raw);

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
    ['bank', { holder: 'A', iban: 'de89 3704', bic: '' }],
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

  it('accepts a semantically wrong but safe value (reported by the forms, not here)', () => {
    expect(read(file({ bank: { holder: 'A', iban: 'DE00123', bic: '' } })).bank.iban).toBe('DE00123');
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
