import { describe, expect, it } from 'vitest';
import { byContactName, contactMatches, draftFromContact, emptyContactDraft, readContact } from '../../src/domain/contact';
import { sampleContact, sampleContactDraft } from './fixtures';

const free = () => false;
const problems = (r: ReturnType<typeof readContact>) => (r.ok ? [] : r.error.map((e) => `${e.field}:${e.problem}`));

describe('readContact', () => {
  it('needs a name and a role', () => {
    expect(problems(readContact({ ...emptyContactDraft(), customer: false }, free))).toEqual(['customer:roleRequired', 'name:required']);
  });

  it('a name alone is enough: the address is optional', () => {
    const r = readContact(sampleContactDraft(), free);
    expect(r.ok && r.value).toMatchObject({ name: 'Kunde GmbH', address: null, paymentTermDays: null, roles: { customer: true, supplier: false } });
  });

  it('once part of the address is given, the whole address is required', () => {
    expect(problems(readContact(sampleContactDraft({ city: 'Berlin' }), free))).toEqual(['street:required', 'postalCode:required']);
    expect(problems(readContact(sampleContactDraft({ street: 'Weg 1', postalCode: '1011', city: 'Berlin' }), free))).toEqual(['postalCode:postalCode']);
    const abroad = readContact(sampleContactDraft({ street: 'Graben 1', postalCode: '1010', city: 'Wien', country: 'at' }), free);
    expect(abroad.ok && abroad.value.address).toEqual({ street: 'Graben 1', postalCode: '1010', city: 'Wien', country: 'AT' });
  });

  it('checks EU VAT IDs and normalizes them', () => {
    const r = readContact(sampleContactDraft({ vatId: 'atu 12345678' }), free);
    expect(r.ok && r.value.vatId).toBe('ATU12345678');
    expect(problems(readContact(sampleContactDraft({ vatId: 'DE136695977' }), free))).toEqual(['vatId:euVatId']);
    expect(problems(readContact(sampleContactDraft({ vatId: 'CHE123456789' }), free))).toEqual(['vatId:euVatId']);
  });

  it('checks the structure of a Leitweg-ID', () => {
    expect(readContact(sampleContactDraft({ leitwegId: '04011000-12345-34' }), free).ok).toBe(true);
    expect(readContact(sampleContactDraft({ leitwegId: '991-33333TEST-33' }), free).ok).toBe(true);
    expect(problems(readContact(sampleContactDraft({ leitwegId: '04011000' }), free))).toEqual(['leitwegId:leitwegId']);
    expect(problems(readContact(sampleContactDraft({ leitwegId: '0401-12 34-34' }), free))).toEqual(['leitwegId:leitwegId']);
  });

  it('a customer number must be unique', () => {
    const taken = (n: string) => n === 'K-1001';
    expect(problems(readContact(sampleContactDraft({ customerNumber: ' K-1001 ' }), taken))).toEqual(['customerNumber:numberTaken']);
    expect(readContact(sampleContactDraft({ customerNumber: 'K-1002' }), taken).ok).toBe(true);
  });

  it('an empty payment term means the company default; otherwise 0 to 365 days', () => {
    const r = readContact(sampleContactDraft({ paymentTermDays: '30' }), free);
    expect(r.ok && r.value.paymentTermDays).toBe(30);
    expect(problems(readContact(sampleContactDraft({ paymentTermDays: '400' }), free))).toEqual(['paymentTermDays:paymentTerm']);
  });

  it('a private person has no contact person', () => {
    const r = readContact(sampleContactDraft({ kind: 'person', contactPerson: 'left over' }), free);
    expect(r.ok && r.value.contactPerson).toBe('');
  });

  it('a private person has no VAT ID, Leitweg-ID or order number, and they are not checked', () => {
    const draft = sampleContactDraft({ kind: 'person', vatId: 'not an id', leitwegId: 'x', orderReference: 'PO-1' });
    const r = readContact(draft, free);
    expect(r.ok && [r.value.vatId, r.value.leitwegId, r.value.orderReference]).toEqual(['', '', '']);
  });

  it('a profile survives the round trip through the draft', () => {
    const p = sampleContact();
    expect(readContact(draftFromContact(p), free)).toEqual({ ok: true, value: p });
    const minimal = sampleContact({ address: null, paymentTermDays: null, vatId: '', contactPerson: '' });
    expect(readContact(draftFromContact(minimal), free)).toEqual({ ok: true, value: minimal });
  });
});

describe('contact lists', () => {
  it('search covers name, second line, contact person, number, city and email', () => {
    const c = sampleContact();
    for (const q of ['kunde', 'EINKAUF', 'max', 'k-10', 'berlin', 'kunde.example', '']) expect(contactMatches(c, q)).toBe(true);
    expect(contactMatches(c, 'hamburg')).toBe(false);
  });

  it('sorts by name, ignoring case and accents', () => {
    expect(['Zeta', 'älter', 'Beta', 'alpha'].map((name) => ({ name })).sort(byContactName).map((x) => x.name)).toEqual(['alpha', 'älter', 'Beta', 'Zeta']);
  });
});
