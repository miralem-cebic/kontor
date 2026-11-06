import { describe, expect, it } from 'vitest';
import { cents } from '../../src/domain/money';
import { batchesOf, planContactRows, planItemRows, readContactRow, readItemRow, parseKind, parseRoles, parseUnit, parseVatRate, suggestMapping, type ContactRowValues, type ItemRowValues } from '../../src/domain/import';
import { STANDARD_RATE, ZERO_RATE, REDUCED_RATE } from '../../src/domain/vat';

const labelOf = (code: string) => (code === 'HUR' ? 'Stunde' : code);

const emptyContact = (over: Partial<ContactRowValues> = {}): ContactRowValues => ({
  name: 'Kunde GmbH',
  customerNumber: '',
  kind: '',
  roles: '',
  email: '',
  phone: '',
  street: '',
  postalCode: '',
  city: '',
  country: '',
  vatId: '',
  leitwegId: '',
  notes: '',
  ...over,
});

const emptyItem = (over: Partial<ItemRowValues> = {}): ItemRowValues => ({
  number: '',
  name: 'Webdesign',
  description: '',
  unit: '',
  netPrice: '85,50',
  vatRate: '',
  ...over,
});

describe('suggestMapping', () => {
  it('finds the columns of an export of this app, in German', () => {
    const header = ['Kundennummer', 'Art', 'Rollen', 'Name', 'Straße', 'PLZ', 'Ort', 'E-Mail', 'Telefon', 'USt-IdNr.', 'Notizen'];
    expect(suggestMapping('contacts', header)).toEqual({ customerNumber: 0, kind: 1, roles: 2, name: 3, street: 4, postalCode: 5, city: 6, email: 7, phone: 8, vatId: 9, notes: 10 });
  });

  it('maps items and never uses a column twice', () => {
    expect(suggestMapping('items', ['Artikelnummer', 'Bezeichnung', 'Einheit', 'Nettopreis', 'USt-Satz', 'Bezeichnung'])).toEqual({ number: 0, name: 1, unit: 2, netPrice: 3, vatRate: 4 });
  });

  it('leaves a field unmapped when no column fits it', () => {
    expect(suggestMapping('contacts', ['Irgendwas'])).toEqual({});
  });
});

describe('parseKind and parseRoles', () => {
  it('reads the kind of a contact in German and English, an empty kind is a company', () => {
    expect(parseKind('')).toBe('company');
    expect(parseKind('Firma')).toBe('company');
    expect(parseKind('Privatperson')).toBe('person');
    expect(parseKind('person')).toBe('person');
    expect(parseKind('Verein')).toBeNull();
  });

  it('reads the roles: an empty value is a customer, both words are both roles', () => {
    expect(parseRoles('')).toEqual({ customer: true, supplier: false });
    expect(parseRoles('Kunde')).toEqual({ customer: true, supplier: false });
    expect(parseRoles('Lieferant')).toEqual({ customer: false, supplier: true });
    expect(parseRoles('Kunde und Lieferant')).toEqual({ customer: true, supplier: true });
    expect(parseRoles('Chef')).toBeNull();
  });
});

describe('parseVatRate and parseUnit', () => {
  it('reads a rate in its usual forms, and only the rates the app offers', () => {
    expect(parseVatRate('19')).toBe(STANDARD_RATE);
    expect(parseVatRate('19 %')).toBe(STANDARD_RATE);
    expect(parseVatRate('7,0')).toBe(REDUCED_RATE);
    expect(parseVatRate('0')).toBe(ZERO_RATE);
    expect(parseVatRate('')).toBe(STANDARD_RATE);
    expect(parseVatRate('5')).toBeNull();
    expect(parseVatRate('abc')).toBeNull();
  });

  it('reads a unit by its code or by its label, and an empty unit is the default', () => {
    expect(parseUnit('HUR', labelOf)).toBe('HUR');
    expect(parseUnit('hur', labelOf)).toBe('HUR');
    expect(parseUnit('Stunde', labelOf)).toBe('HUR');
    expect(parseUnit('Schachtel', labelOf)).toBeNull();
    expect(parseUnit('', labelOf)).toBe('H87');
  });
});

describe('readContactRow', () => {
  const free = () => false;

  it('makes a contact with its roles and address from a row', () => {
    const r = readContactRow(emptyContact({ roles: 'Kunde und Lieferant', email: 'buchhaltung@kunde.example', street: 'Hauptstraße 1', postalCode: '50667', city: 'Köln' }), free);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ kind: 'company', roles: { customer: true, supplier: true }, name: 'Kunde GmbH', address: { street: 'Hauptstraße 1', postalCode: '50667', city: 'Köln', country: 'DE' } });
  });

  it('reports the problems of the row with the field they belong to', () => {
    const r = readContactRow(emptyContact({ name: '', email: 'kein-mail', kind: 'Verein' }), free);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toEqual(
      expect.arrayContaining([
        { field: 'name', problem: 'required' },
        { field: 'email', problem: 'email' },
        { field: 'kind', problem: 'kindUnknown' },
      ]),
    );
  });

  it('refuses a customer number that another contact has', () => {
    const r = readContactRow(emptyContact({ customerNumber: 'K-0001' }), (n) => n === 'K-0001');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toEqual([{ field: 'customerNumber', problem: 'numberTaken' }]);
  });
});

describe('readItemRow', () => {
  const free = () => false;

  it('reads the price in euros with a decimal comma (de) or a decimal point (en)', () => {
    const de = readItemRow(emptyItem({ netPrice: '85,50', unit: 'Stunde' }), 'de', labelOf, free);
    const en = readItemRow(emptyItem({ netPrice: '85.50', unit: 'HUR' }), 'en', labelOf, free);
    expect(de.ok && de.value).toMatchObject({ netPrice: cents(8_550), unit: 'HUR', vatRate: STANDARD_RATE });
    expect(en.ok && en.value.netPrice).toBe(8_550);
  });

  it('reports a price that is not a number and a unit that is not known', () => {
    const r = readItemRow(emptyItem({ netPrice: 'abc', unit: 'Schachtel' }), 'de', labelOf, free);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toEqual(
      expect.arrayContaining([
        { field: 'netPrice', problem: 'price' },
        { field: 'unit', problem: 'unitUnknown' },
      ]),
    );
  });
});

describe('planContactRows', () => {
  const mapping = { name: 0, customerNumber: 1, email: 2 } as const;

  it('gives a row without a customer number the next free one of the pattern, and counts each number once', () => {
    const rows = [
      ['Kunde A', '', 'a@example.de'],
      ['Kunde B', '', 'b@example.de'],
      ['Kunde C', 'K-0002', 'c@example.de'],
    ];
    const plan = planContactRows(rows, mapping, 'K-{NNNN}', ['K-0001']);
    expect(plan.map((p) => (p.outcome.ok ? p.outcome.value.customerNumber : null))).toEqual(['K-0002', 'K-0003', null]);
    expect(plan[2]?.outcome).toMatchObject({ ok: false, error: [{ field: 'customerNumber', problem: 'numberTaken' }] });
    expect(plan.map((p) => p.line)).toEqual([2, 3, 4]);
  });

  it('a row that fails does not use up a number', () => {
    const rows = [
      ['', '', 'kein-mail'],
      ['Kunde B', '', ''],
    ];
    const plan = planContactRows(rows, mapping, 'K-{NNNN}', []);
    expect(plan[0]?.outcome.ok).toBe(false);
    expect(plan[1]?.outcome.ok && plan[1].outcome.value.customerNumber).toBe('K-0001');
  });

  it('reports the problems of each row with their field, and keeps the rows that are fine', () => {
    const plan = planContactRows([['Kunde A', '', ''], ['', '', '']], mapping, null, []);
    expect(plan[0]?.outcome.ok).toBe(true);
    expect(plan[1]?.outcome).toMatchObject({ ok: false, error: [{ field: 'name', problem: 'required' }] });
  });
});

describe('planItemRows', () => {
  it('reads the prices in the decimal style of the file and numbers the items from the pattern', () => {
    const mapping = { name: 0, netPrice: 1 } as const;
    const plan = planItemRows([['Webdesign', '85,50'], ['Hosting', 'x']], mapping, 'A-{NNNN}', [], 'de', labelOf);
    expect(plan[0]?.outcome.ok && plan[0].outcome.value).toMatchObject({ number: 'A-0001', netPrice: 8_550 });
    expect(plan[1]?.outcome).toMatchObject({ ok: false, error: [{ field: 'netPrice', problem: 'price' }] });
  });
});

describe('batchesOf', () => {
  it('lists the imports that still have records, newest first, with how many records each has', () => {
    const records = [
      { importBatchId: 'b1', createdAt: '2026-11-01T10:00:00.000Z', deletedAt: null },
      { importBatchId: 'b1', createdAt: '2026-11-01T10:00:01.000Z', deletedAt: null },
      { importBatchId: 'b2', createdAt: '2026-11-05T09:00:00.000Z', deletedAt: null },
      { importBatchId: 'b2', createdAt: '2026-11-05T09:00:00.000Z', deletedAt: '2026-11-06T08:00:00.000Z' },
      { importBatchId: null, createdAt: '2026-11-02T10:00:00.000Z', deletedAt: null },
    ];
    expect(batchesOf(records)).toEqual([
      { id: 'b2', count: 1, createdAt: '2026-11-05T09:00:00.000Z' },
      { id: 'b1', count: 2, createdAt: '2026-11-01T10:00:00.000Z' },
    ]);
  });
});
