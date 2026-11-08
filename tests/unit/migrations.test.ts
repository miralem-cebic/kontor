import { describe, expect, it } from 'vitest';
import { classifyError } from '../../src/data/repository';
import { InvalidFileError, MIGRATED_ACCOUNT_ID, migrate, MIGRATIONS, NewerSchemaError, unchanged, upgrade, type Migration } from '../../src/data/migrations';
import { makeContact, makeDunning, makeExpense, makeInvoice, makeItem, makePayment, makePayout, makeQuote, makeQuoteStatus, SCHEMA_VERSION } from '../../src/data/schema';
import type { InvoiceFile } from '../../src/data/types';
import { brandId } from '../../src/data/ids';
import { cents } from '../../src/domain/money';
import { STANDARD_RATE, ZERO_RATE } from '../../src/domain/vat';
import type { IssuedInfo } from '../../src/domain/invoice';
import { sampleCompany, sampleContact, sampleInvoice, sampleIssued, sampleItem, sampleQuote } from './fixtures';

const company = () => JSON.parse(JSON.stringify(sampleCompany())) as Record<string, unknown>;

/** company.json as version 1 of the app wrote it: one bank account */
const companyV1 = (): Record<string, unknown> => ({
  schemaVersion: 1,
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'Muster Design',
  owner: 'Erika Mustermann',
  address: { street: 'Hauptstraße 1', postalCode: '50667', city: 'Köln', country: 'DE' },
  contact: { email: 'erika@example.com', phone: '' },
  logo: null,
  tax: { taxNumber: '12/345/67890', vatId: '', vat: { kind: 'smallBusiness' }, business: { kind: 'freelance' } },
  bank: { holder: 'Erika Mustermann', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' },
  invoiceDefaults: { numberPattern: 'RE-{YYYY}-{NNNN}', paymentTermDays: 14, footer: '' },
  createdAt: '2026-10-01T09:00:00.000Z',
  fieldUpdatedAt: { name: '2026-10-01T09:00:00.000Z', bank: '2026-10-05T12:00:00.000Z' },
});

describe('migrate', () => {
  it('reads the current version', () => {
    expect(SCHEMA_VERSION).toBe(17);
    expect(migrate('company', company()).schemaVersion).toBe(17);
  });

  it('a file without version counts as version 1', () => {
    const { schemaVersion: _v, ...raw } = companyV1();
    expect(migrate('company', raw).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('rejects a newer version, so that an old app never overwrites a newer file', () => {
    const e = (() => {
      try {
        migrate('company', { ...company(), schemaVersion: SCHEMA_VERSION + 1 });
      } catch (x) {
        return x;
      }
    })();
    expect(e).toBeInstanceOf(NewerSchemaError);
    expect(classifyError(e)).toBe('newerSchema');
  });

  it.each([0, -1, 1.5, '1', null])('rejects the schema version %j', (v) => {
    expect(() => migrate('company', { ...company(), schemaVersion: v })).toThrow(InvalidFileError);
  });

  it('every file kind has a step for every version below the current one', () => {
    for (const steps of Object.values(MIGRATIONS)) {
      for (let v = 1; v < SCHEMA_VERSION; v++) expect(steps.some((s) => s.from === v)).toBe(true);
    }
  });
});

describe('version 1 → 2: several bank accounts', () => {
  it('the one bank account becomes the first account and the default', () => {
    const before = companyV1();
    const after = migrate('company', before);
    expect(after.bank).toEqual({
      defaultAccountId: MIGRATED_ACCOUNT_ID,
      accounts: [{ id: MIGRATED_ACCOUNT_ID, kind: 'bank', name: '', holder: 'Erika Mustermann', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', deletedAt: null }],
    });
    // the change time of the field stays: the accounts did not change, only their format
    expect(after.fieldUpdatedAt).toEqual(before['fieldUpdatedAt']);
    const { bank: _b, schemaVersion: _v, ...rest } = before;
    expect(after).toMatchObject(rest);
  });

  it('gives the same account ID on every device that upgrades the same file', () => {
    expect(migrate('company', companyV1()).bank).toEqual(migrate('company', companyV1()).bank);
  });

  it('a broken bank account of version 1 is still refused', () => {
    for (const bank of [null, 'DE89', { holder: 'A' }, { holder: 'A', iban: 'de89 3704', bic: '' }]) {
      expect(() => migrate('company', { ...companyV1(), bank })).toThrow(InvalidFileError);
    }
  });

  it('item and document files came with version 2; one without a version is read like any other file', () => {
    const { schemaVersion: _v, ...item } = JSON.parse(JSON.stringify(makeItem(sampleItem()))) as Record<string, unknown>;
    expect(migrate('item', item)).toEqual({ ...item, schemaVersion: SCHEMA_VERSION });
    const quote = makeQuote(makeContact(sampleContact()).id, sampleQuote());
    const { schemaVersion: _w, ...document } = JSON.parse(JSON.stringify(quote)) as Record<string, unknown>;
    expect(migrate('document', document)).toEqual({ ...document, schemaVersion: SCHEMA_VERSION });
  });

  it('contact files of version 1 stay as they are', () => {
    const raw = { ...JSON.parse(JSON.stringify(makeContact(sampleContact()))), schemaVersion: 1 } as Record<string, unknown>;
    expect(migrate('contact', raw)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
  });
});

describe('version 2 → 3: invoices', () => {
  const asV2 = (file: object) => ({ ...JSON.parse(JSON.stringify(file)), schemaVersion: 2 }) as Record<string, unknown>;

  it('files of version 2 stay as they are', () => {
    const files = { company: asV2(sampleCompany()), contact: asV2(makeContact(sampleContact())), item: asV2(makeItem(sampleItem())), document: asV2(makeQuote(makeContact(sampleContact()).id, sampleQuote())) };
    for (const [kind, raw] of Object.entries(files) as [keyof typeof files, Record<string, unknown>][]) {
      expect(migrate(kind, raw)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
    }
  });

  it('an app that knows only version 2 refuses an invoice file instead of overwriting it', () => {
    const invoice = makeInvoice(makeContact(sampleContact()).id, sampleCompany().bank.defaultAccountId, sampleInvoice(), null);
    expect(() => upgrade('document', JSON.parse(JSON.stringify(invoice)), MIGRATIONS.document, 2)).toThrow(NewerSchemaError);
  });
});

describe('version 3 → 4: issued invoices', () => {
  const invoiceV3 = () => {
    const { issued: _i, cancels: _c, ...raw } = JSON.parse(JSON.stringify(makeInvoice(makeContact(sampleContact()).id, sampleCompany().bank.defaultAccountId, sampleInvoice(), null))) as Record<string, unknown>;
    return { ...raw, schemaVersion: 3 };
  };

  it('a draft invoice of version 3 is not issued', () => {
    const raw = invoiceV3();
    expect(migrate('document', raw)).toEqual({ ...raw, issued: null, cancels: null, schemaVersion: SCHEMA_VERSION });
  });

  it('a quote of version 3 stays as it is', () => {
    const raw = { ...JSON.parse(JSON.stringify(makeQuote(makeContact(sampleContact()).id, sampleQuote()))), schemaVersion: 3 } as Record<string, unknown>;
    expect(migrate('document', raw)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
  });

  it('an app that knows only version 3 refuses a file of version 4, so it never edits an issued invoice', () => {
    expect(() => upgrade('document', { ...invoiceV3(), schemaVersion: 4 }, MIGRATIONS.document, 3)).toThrow(NewerSchemaError);
  });
});

describe('version 4 → 5: cancellation invoices', () => {
  const invoiceV4 = (issued: unknown = null) => {
    const { cancels: _c, ...raw } = JSON.parse(JSON.stringify(makeInvoice(makeContact(sampleContact()).id, sampleCompany().bank.defaultAccountId, sampleInvoice(), null))) as Record<string, unknown>;
    return { ...raw, issued, schemaVersion: 4 };
  };

  it('a draft and an issued invoice of version 4 cancel nothing', () => {
    for (const raw of [invoiceV4(), invoiceV4(JSON.parse(JSON.stringify(sampleIssued())))]) {
      expect(migrate('document', raw)).toEqual({ ...raw, cancels: null, schemaVersion: SCHEMA_VERSION });
    }
  });

  it('quotes, the other kinds of file and range files of version 4 stay as they are', () => {
    const asV4 = (file: object) => ({ ...JSON.parse(JSON.stringify(file)), schemaVersion: 4 }) as Record<string, unknown>;
    const files = {
      company: asV4(sampleCompany()),
      contact: asV4(makeContact(sampleContact())),
      item: asV4(makeItem(sampleItem())),
      document: asV4(makeQuote(makeContact(sampleContact()).id, sampleQuote())),
      numbering: asV4({ schemaVersion: 4, range: 'invoice', counters: [{ key: '2026', last: 1 }], reservations: [] }),
    };
    for (const [kind, raw] of Object.entries(files) as [keyof typeof files, Record<string, unknown>][]) {
      expect(migrate(kind, raw)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
    }
  });

  it('an app that knows only version 4 refuses a file of version 5, so it never shows a cancelled invoice as open', () => {
    expect(() => upgrade('document', { ...invoiceV4(), cancels: null, schemaVersion: 5 }, MIGRATIONS.document, 4)).toThrow(NewerSchemaError);
  });
});

describe('version 5 → 6: quote numbers', () => {
  const asV5 = (file: object) => ({ ...JSON.parse(JSON.stringify(file)), schemaVersion: 5 }) as Record<string, unknown>;
  /** invoiceDefaults as version 5 wrote them: without a quote pattern */
  const withoutQuotePattern = (defaults: unknown) => {
    const { quotePattern: _q, ...rest } = defaults as Record<string, unknown>;
    return rest;
  };
  const companyV5 = () => {
    const raw = asV5(sampleCompany());
    return { ...raw, invoiceDefaults: withoutQuotePattern(raw['invoiceDefaults']) };
  };
  const quoteV5 = () => {
    const { issued: _i, revises: _r, ...raw } = asV5(makeQuote(makeContact(sampleContact()).id, sampleQuote()));
    return raw;
  };

  it('company.json gets the default quote pattern; the change time of the field stays', () => {
    const before = companyV5();
    const after = migrate('company', before);
    expect(after.invoiceDefaults).toMatchObject({ numberPattern: 'RE-{YYYY}-{NNNN}', quotePattern: 'AN-{YYYY}-{NNNN}', paymentTermDays: 14, footer: '' });
    expect(after.fieldUpdatedAt).toEqual(before['fieldUpdatedAt']);
  });

  it('a quote pattern that is there already stays', () => {
    const raw = asV5(sampleCompany({ invoiceDefaults: { numberPattern: 'RE-{YYYY}-{NNNN}', quotePattern: 'A{NNN}', paymentTermDays: 14, footer: '' } }));
    expect(migrate('company', raw).invoiceDefaults.quotePattern).toBe('A{NNN}');
  });

  it('a quote of version 5 is a draft and the first version of itself', () => {
    const raw = quoteV5();
    expect(migrate('document', raw)).toEqual({ ...raw, issued: null, revises: null, schemaVersion: SCHEMA_VERSION });
  });

  it('the company in the snapshot of an issued invoice gets the quote pattern as well, so that it is read like company.json', () => {
    const issued = JSON.parse(JSON.stringify(sampleIssued())) as IssuedInfo;
    const snapshotV5 = { ...issued.snapshot, company: { ...issued.snapshot.company, invoiceDefaults: withoutQuotePattern(issued.snapshot.company.invoiceDefaults) } };
    const raw = asV5({ ...makeInvoice(makeContact(sampleContact()).id, sampleCompany().bank.defaultAccountId, sampleInvoice(), null), issued: { ...issued, snapshot: snapshotV5 } });
    const after = migrate('document', raw);
    expect(after.issued?.snapshot.company.invoiceDefaults.quotePattern).toBe('AN-{YYYY}-{NNNN}');
    // everything else of the issued invoice stays as it was
    expect({ ...after.issued, snapshot: snapshotV5 }).toEqual(raw['issued']);
    // a draft invoice has no snapshot
    const draft = asV5(makeInvoice(makeContact(sampleContact()).id, sampleCompany().bank.defaultAccountId, sampleInvoice(), null));
    expect(migrate('document', draft)).toEqual({ ...draft, schemaVersion: SCHEMA_VERSION });
  });

  it('contacts, items and range files of version 5 stay as they are', () => {
    const files = {
      contact: asV5(makeContact(sampleContact())),
      item: asV5(makeItem(sampleItem())),
      numbering: asV5({ range: 'invoice', counters: [{ key: '2026', last: 1 }], reservations: [] }),
    };
    for (const [kind, raw] of Object.entries(files) as [keyof typeof files, Record<string, unknown>][]) {
      expect(migrate(kind, raw)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
    }
  });

  it('an app that knows only version 5 refuses a file of version 6, so it never edits a finalized quote', () => {
    expect(() => upgrade('document', { ...quoteV5(), issued: null, revises: null, schemaVersion: 6 }, MIGRATIONS.document, 5)).toThrow(NewerSchemaError);
  });
});

/** A file of version 6 of any kind, as the app of version 6 wrote it */
const asV6 = (file: object) => ({ ...JSON.parse(JSON.stringify(file)), schemaVersion: 6 }) as Record<string, unknown>;

describe('version 12 → 13: expenses', () => {
  const expense = makeExpense({
    date: '2026-10-28',
    supplier: 'Telekom',
    reference: '',
    gross: cents(4_999),
    taxTreatment: 'domestic',
    vatRate: STANDARD_RATE,
    category: 'Telefon',
    accountId: sampleCompany().bank.defaultAccountId,
    note: '',
  });

  it('an expense file is read with its checks', () => {
    const raw = JSON.parse(JSON.stringify(expense)) as Record<string, unknown>;
    expect(migrate('expense', raw)).toEqual(expense);
  });

  it('an expense with a tax treatment that is not known is refused', () => {
    const raw = { ...(JSON.parse(JSON.stringify(expense)) as Record<string, unknown>), taxTreatment: 'maybe' };
    expect(() => migrate('expense', raw)).toThrow(InvalidFileError);
  });

  it('the files of the other kinds of version 12 stay as they are', () => {
    const asV12 = (file: object) => ({ ...JSON.parse(JSON.stringify(file)), schemaVersion: 12 }) as Record<string, unknown>;
    const files = {
      company: asV12(sampleCompany()),
      contact: asV12(makeContact(sampleContact())),
      item: asV12(makeItem(sampleItem())),
      numbering: asV12({ range: 'invoice', counters: [{ key: '2026', last: 1 }], reservations: [] }),
    };
    for (const [kind, raw] of Object.entries(files) as [keyof typeof files, Record<string, unknown>][]) {
      expect(migrate(kind, raw)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
    }
  });

  it('an app that knows only version 12 refuses an expense, so it never drops one', () => {
    expect(() => upgrade('expense', { ...JSON.parse(JSON.stringify(expense)), schemaVersion: 13 }, MIGRATIONS.expense, 12)).toThrow(NewerSchemaError);
  });
});

describe('version 13 → 14: the import of contacts and items', () => {
  const asV13 = (file: object) => ({ ...JSON.parse(JSON.stringify(file)), schemaVersion: 13 }) as Record<string, unknown>;

  it('a contact or an item of version 13 was typed in, so it gets no import', () => {
    const contact = asV13(makeContact(sampleContact()));
    delete contact['importBatchId'];
    expect(migrate('contact', contact)).toMatchObject({ importBatchId: null, schemaVersion: SCHEMA_VERSION });
    const item = asV13(makeItem(sampleItem()));
    delete item['importBatchId'];
    expect(migrate('item', item)).toMatchObject({ importBatchId: null, schemaVersion: SCHEMA_VERSION });
  });

  it('a contact from an import keeps its batch', () => {
    const batch = brandId<'ImportBatchId'>('8d7c6b5a-1f2e-4d3c-9b8a-7f6e5d4c3b2a');
    const raw = JSON.parse(JSON.stringify(makeContact(sampleContact(), batch))) as Record<string, unknown>;
    expect(migrate('contact', raw).importBatchId).toBe(batch);
  });

  it('a batch that is not an ID is refused', () => {
    const raw = JSON.parse(JSON.stringify(makeContact(sampleContact()))) as Record<string, unknown>;
    expect(() => migrate('contact', { ...raw, importBatchId: '../x' })).toThrow(InvalidFileError);
  });

  it('the other kinds of version 13 stay as they are', () => {
    const files = {
      company: asV13(sampleCompany()),
      numbering: asV13({ range: 'invoice', counters: [{ key: '2026', last: 1 }], reservations: [] }),
      expense: asV13(makeExpense({ date: '2026-10-28', supplier: 'Telekom', reference: '', gross: cents(4_999), taxTreatment: 'domestic', vatRate: STANDARD_RATE, category: 'Telefon', accountId: null, note: '' })),
    };
    for (const [kind, raw] of Object.entries(files) as [keyof typeof files, Record<string, unknown>][]) {
      expect(migrate(kind, raw)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
    }
  });

  it('an app that knows only version 13 refuses a contact of version 14, so it never drops a batch', () => {
    const raw = JSON.parse(JSON.stringify(makeContact(sampleContact()))) as Record<string, unknown>;
    expect(() => upgrade('contact', { ...raw, schemaVersion: 14 }, MIGRATIONS.contact, 13)).toThrow(NewerSchemaError);
  });
});

describe('version 16 → 17: payouts, income without an invoice', () => {
  const asV16 = (file: object) => ({ ...JSON.parse(JSON.stringify(file)), schemaVersion: 16 }) as Record<string, unknown>;
  const payer = makeContact(sampleContact({ name: 'Apple Distribution International' }));
  const payout = makePayout({
    date: '2026-11-03',
    accountId: sampleCompany().bank.defaultAccountId,
    amount: cents(123_456),
    payerId: payer.id,
    period: '2026-10',
    taxTreatment: 'euB2bNotTaxable',
    vatRate: ZERO_RATE,
    statementUrl: 'https://reportingitc.apple.com/statement/2026-10',
    note: '',
  });
  const raw = (over: Record<string, unknown> = {}) => ({ ...(JSON.parse(JSON.stringify(payout)) as Record<string, unknown>), ...over });

  it('a payout file is read with its checks', () => {
    expect(migrate('payout', raw())).toEqual(payout);
  });

  it('a payout with a tax treatment that is not known is refused', () => {
    expect(() => migrate('payout', raw({ taxTreatment: 'maybe' }))).toThrow(InvalidFileError);
  });

  it('a payout of no cents, with a float or with a bad ID is refused', () => {
    for (const bad of [{ amount: 0 }, { amount: 12.5 }, { amount: -5 }, { payerId: '../x' }, { accountId: '__proto__' }, { id: 'constructor' }, { vatRate: 1234 }]) {
      expect(() => migrate('payout', raw(bad)), JSON.stringify(bad)).toThrow(InvalidFileError);
    }
  });

  it('a statement link is an https link or empty; any other scheme is refused', () => {
    expect(migrate('payout', raw({ statementUrl: '' })).statementUrl).toBe('');
    for (const url of ['http://example.com/s', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'not a link']) {
      expect(() => migrate('payout', raw({ statementUrl: url })), url).toThrow(InvalidFileError);
    }
  });

  it('the month it covers is a month or empty', () => {
    expect(migrate('payout', raw({ period: '' })).period).toBe('');
    expect(() => migrate('payout', raw({ period: '2026-13' }))).toThrow(InvalidFileError);
  });

  it('the files of the other kinds of version 16 stay as they are', () => {
    const files = {
      company: asV16(sampleCompany()),
      contact: asV16(payer),
      item: asV16(makeItem(sampleItem())),
      numbering: asV16({ range: 'invoice', counters: [{ key: '2026', last: 1 }], reservations: [] }),
      expense: asV16(makeExpense({ date: '2026-10-28', supplier: 'Telekom', reference: '', gross: cents(4_999), taxTreatment: 'domestic', vatRate: STANDARD_RATE, category: 'Telefon', accountId: null, note: '' })),
      document: asV16(makeInvoice(payer.id, sampleCompany().bank.defaultAccountId, sampleInvoice(), null)),
    };
    for (const [kind, file] of Object.entries(files) as [keyof typeof files, Record<string, unknown>][]) {
      expect(migrate(kind, file)).toEqual({ ...file, schemaVersion: SCHEMA_VERSION });
    }
  });

  it('an app that knows only version 16 refuses a payout, so it never drops income it does not know', () => {
    expect(() => upgrade('payout', raw(), MIGRATIONS.payout, 16)).toThrow(NewerSchemaError);
  });
});

describe('version 15 → 16: the parts of the footer (F26)', () => {
  const asV15 = (file: object) => ({ ...JSON.parse(JSON.stringify(file)), schemaVersion: 15 }) as Record<string, unknown>;
  const profileWithoutParts = (): Record<string, unknown> => {
    const { footerParts: _p, ...invoiceDefaults } = sampleCompany().invoiceDefaults;
    return { ...asV15(sampleCompany()), invoiceDefaults };
  };

  it('a company of version 15 shows every part of the footer, as its documents did', () => {
    const migrated = migrate('company', profileWithoutParts());
    expect(migrated.invoiceDefaults).toMatchObject({ footerParts: { address: true, phone: true, email: true }, numberPattern: 'RE-{YYYY}-{NNNN}', footer: '' });
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('a choice that is there already stays', () => {
    const raw = asV15(sampleCompany({ invoiceDefaults: { ...sampleCompany().invoiceDefaults, footerParts: { address: true, phone: false, email: true } } }));
    expect(migrate('company', raw).invoiceDefaults.footerParts).toEqual({ address: true, phone: false, email: true });
  });

  it('an issued document of version 15 keeps its company as it was, with every part added to it, and its PDF is not touched', () => {
    const issued = { ...makeInvoice(makeContact(sampleContact()).id, sampleCompany().bank.defaultAccountId, sampleInvoice(), null), issued: sampleIssued('RE-2026-0001') };
    const raw = asV15(issued);
    const stored = raw['issued'] as Record<string, unknown>;
    const withoutParts = { ...raw, issued: { ...stored, snapshot: { ...(stored['snapshot'] as Record<string, unknown>), company: profileWithoutParts() } } };
    const migrated = migrate('document', withoutParts) as InvoiceFile & { issued: IssuedInfo };
    expect(migrated.issued.snapshot.company.invoiceDefaults.footerParts).toEqual({ address: true, phone: true, email: true });
    expect(migrated.issued.pdf).toEqual(issued.issued.pdf);
    expect(migrated.issued.number).toBe('RE-2026-0001');
  });

  it('a draft, the other kinds and every file of version 15 stay as they are', () => {
    const files = {
      contact: asV15(makeContact(sampleContact())),
      item: asV15(makeItem(sampleItem())),
      numbering: asV15({ range: 'invoice', counters: [{ key: '2026', last: 1 }], reservations: [] }),
      expense: asV15(makeExpense({ date: '2026-10-28', supplier: 'Telekom', reference: '', gross: cents(4_999), taxTreatment: 'domestic', vatRate: STANDARD_RATE, category: 'Telefon', accountId: null, note: '' })),
      document: asV15(makeInvoice(makeContact(sampleContact()).id, sampleCompany().bank.defaultAccountId, sampleInvoice(), null)),
    };
    for (const [kind, raw] of Object.entries(files) as [keyof typeof files, Record<string, unknown>][]) {
      expect(migrate(kind, raw)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
    }
  });

  it('an app that knows only version 15 refuses a company with the parts of the footer, so it never drops them', () => {
    expect(() => upgrade('company', { ...sampleCompany(), schemaVersion: 16 }, MIGRATIONS.company, 15)).toThrow(NewerSchemaError);
  });
});

describe('version 14 → 15: receipts of expenses', () => {
  const asV14 = (file: object) => ({ ...JSON.parse(JSON.stringify(file)), schemaVersion: 14 }) as Record<string, unknown>;
  const expenseV14 = (): Record<string, unknown> => {
    const raw = asV14(makeExpense({ date: '2026-10-28', supplier: 'Telekom', reference: '', gross: cents(4_999), taxTreatment: 'domestic', vatRate: STANDARD_RATE, category: 'Telefon', accountId: null, note: '' }));
    delete raw['receipt'];
    return raw;
  };
  const EXPENSE = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const fileReceipt = (over: Record<string, unknown> = {}) => ({ kind: 'file', year: '2026', name: `${EXPENSE}-Telekom.pdf`, type: 'application/pdf', size: 1234, sha256: 'a'.repeat(64), ...over });

  it('an expense of version 14 has no receipt', () => {
    expect(migrate('expense', expenseV14())).toMatchObject({ receipt: null, schemaVersion: SCHEMA_VERSION });
  });

  it('a file receipt is read with its checks', () => {
    expect(migrate('expense', { ...expenseV14(), receipt: fileReceipt() }).receipt).toEqual(fileReceipt());
  });

  it('a file receipt with a name that is not a receipt name, a wrong checksum, an unknown type or a bad year is refused', () => {
    for (const bad of [fileReceipt({ name: '../x.pdf' }), fileReceipt({ sha256: 'xyz' }), fileReceipt({ type: 'text/html' }), fileReceipt({ year: '26' })]) {
      expect(() => migrate('expense', { ...expenseV14(), receipt: bad })).toThrow(InvalidFileError);
    }
  });

  it('a link receipt must be an http or https link', () => {
    expect(migrate('expense', { ...expenseV14(), receipt: { kind: 'link', url: 'https://cloud.example/x.pdf' } }).receipt).toEqual({ kind: 'link', url: 'https://cloud.example/x.pdf' });
    expect(() => migrate('expense', { ...expenseV14(), receipt: { kind: 'link', url: 'javascript:alert(1)' } })).toThrow(InvalidFileError);
  });

  it('the other kinds of version 14 stay as they are', () => {
    const files = {
      company: asV14(sampleCompany()),
      contact: asV14(makeContact(sampleContact())),
      item: asV14(makeItem(sampleItem())),
      numbering: asV14({ range: 'invoice', counters: [{ key: '2026', last: 1 }], reservations: [] }),
    };
    for (const [kind, raw] of Object.entries(files) as [keyof typeof files, Record<string, unknown>][]) {
      expect(migrate(kind, raw)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
    }
  });

  it('an app that knows only version 14 refuses an expense with a receipt, so it never drops one', () => {
    expect(() => upgrade('expense', { ...expenseV14(), receipt: fileReceipt(), schemaVersion: 15 }, MIGRATIONS.expense, 14)).toThrow(NewerSchemaError);
  });
});

describe('version 6 → 7: payments', () => {
  const invoiceId = makeInvoice(makeContact(sampleContact()).id, sampleCompany().bank.defaultAccountId, sampleInvoice(), null).id;
  const payment = makePayment(invoiceId, { date: '2026-10-31', amount: cents(11_900), accountId: sampleCompany().bank.defaultAccountId, note: '' });

  it('a payment file is read with its checks', () => {
    const raw = JSON.parse(JSON.stringify(payment)) as Record<string, unknown>;
    expect(migrate('payment', raw)).toEqual(payment);
  });

  it('the files of the other kinds of version 6 stay as they are', () => {
    const files = {
      company: asV6(sampleCompany()),
      contact: asV6(makeContact(sampleContact())),
      item: asV6(makeItem(sampleItem())),
      document: asV6(makeQuote(makeContact(sampleContact()).id, sampleQuote())),
      numbering: asV6({ range: 'invoice', counters: [{ key: '2026', last: 1 }], reservations: [] }),
    };
    for (const [kind, raw] of Object.entries(files) as [keyof typeof files, Record<string, unknown>][]) {
      expect(migrate(kind, raw)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
    }
  });

  it('an app that knows only version 6 refuses a payment, so it never drops a payment it does not know', () => {
    expect(() => upgrade('payment', { ...JSON.parse(JSON.stringify(payment)), schemaVersion: 7 }, MIGRATIONS.payment, 6)).toThrow(NewerSchemaError);
  });
});

/** A file of version 7 of any kind, as the app of version 7 wrote it */
const asV7 = (file: object) => ({ ...JSON.parse(JSON.stringify(file)), schemaVersion: 7 }) as Record<string, unknown>;

describe('version 7 → 8: dunnings', () => {
  const invoiceId = makeInvoice(makeContact(sampleContact()).id, sampleCompany().bank.defaultAccountId, sampleInvoice(), null).id;
  const dunning = makeDunning(invoiceId, {
    level: 'reminder',
    date: '2026-10-20',
    debtor: 'business',
    open: cents(100_000),
    interestFrom: '2026-10-16',
    interest: cents(144),
    flatFee: cents(4_000),
    fee: cents(0),
    payBy: '2026-11-03',
  });

  it('a dunning file is read with its checks', () => {
    const raw = JSON.parse(JSON.stringify(dunning)) as Record<string, unknown>;
    expect(migrate('dunning', raw)).toEqual(dunning);
  });

  it('the files of the other kinds of version 7 stay as they are', () => {
    const files = {
      company: asV7(sampleCompany()),
      contact: asV7(makeContact(sampleContact())),
      item: asV7(makeItem(sampleItem())),
      document: asV7(makeQuote(makeContact(sampleContact()).id, sampleQuote())),
      payment: asV7(makePayment(invoiceId, { date: '2026-10-31', amount: cents(11_900), accountId: sampleCompany().bank.defaultAccountId, note: '' })),
      numbering: asV7({ range: 'invoice', counters: [{ key: '2026', last: 1 }], reservations: [] }),
    };
    for (const [kind, raw] of Object.entries(files) as [keyof typeof files, Record<string, unknown>][]) {
      expect(migrate(kind, raw)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
    }
  });

  it('an app that knows only version 7 refuses a dunning, so it never drops a letter it does not know', () => {
    expect(() => upgrade('dunning', { ...JSON.parse(JSON.stringify(dunning)), schemaVersion: 8 }, MIGRATIONS.dunning, 7)).toThrow(NewerSchemaError);
  });
});

const asV10 = (file: object) => ({ ...JSON.parse(JSON.stringify(file)), schemaVersion: 10 }) as Record<string, unknown>;

describe('version 10 → 11: decisions of the customer on a quote (F21)', () => {
  const quote = makeQuote(makeContact(sampleContact()).id, sampleQuote());
  const decision = makeQuoteStatus(quote.id, { decision: 'accepted', date: '2026-11-03' });

  it('a decision file is read with its checks', () => {
    expect(migrate('quoteStatus', JSON.parse(JSON.stringify(decision)))).toEqual(decision);
  });

  it('a decision that is neither accepted nor declined is refused', () => {
    expect(() => migrate('quoteStatus', { ...JSON.parse(JSON.stringify(decision)), decision: 'sent' })).toThrow(InvalidFileError);
  });

  it('the files of the other kinds of version 10 stay as they are', () => {
    const files = {
      company: asV10(sampleCompany()),
      contact: asV10(makeContact(sampleContact())),
      item: asV10(makeItem(sampleItem())),
      document: asV10(quote),
      numbering: asV10({ range: 'quote', counters: [{ key: '2026', last: 1 }], reservations: [] }),
    };
    for (const [kind, raw] of Object.entries(files) as [keyof typeof files, Record<string, unknown>][]) {
      expect(migrate(kind, raw)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
    }
  });

  it('an app that knows only version 10 refuses a decision, so it never drops what the customer decided', () => {
    expect(() => upgrade('quoteStatus', { ...JSON.parse(JSON.stringify(decision)), schemaVersion: 11 }, MIGRATIONS.quoteStatus, 10)).toThrow(NewerSchemaError);
  });
});

const asV11 = (file: object) => ({ ...JSON.parse(JSON.stringify(file)), schemaVersion: 11 }) as Record<string, unknown>;

/** A quote or an invoice as version 11 wrote it: neither the document nor its lines have a discount */
const withoutDiscounts = (file: object): Record<string, unknown> => {
  const { discount: _d, ...rest } = asV11(file);
  const lines = (rest['lines'] as Record<string, unknown>[]).map(({ discount: _x, ...line }) => line);
  return { ...rest, lines };
};

describe('version 11 → 12: discounts on lines and on the document (F23)', () => {
  const customerId = makeContact(sampleContact()).id;
  const quote = withoutDiscounts(makeQuote(customerId, sampleQuote()));
  const invoice = withoutDiscounts(makeInvoice(customerId, sampleCompany().bank.defaultAccountId, sampleInvoice(), null));

  it('a quote of version 11 gets no discount, on the document and on each line', () => {
    const migrated = migrate('document', quote);
    expect(migrated).toEqual({
      ...quote,
      schemaVersion: SCHEMA_VERSION,
      discount: { kind: 'none' },
      lines: (quote['lines'] as Record<string, unknown>[]).map((l) => ({ ...l, discount: { kind: 'none' } })),
    });
  });

  it('an issued invoice of version 11 gets no discount, and its snapshot and PDF stay as they are', () => {
    const issued = { ...invoice, issued: sampleIssued() };
    const migrated = migrate('document', issued);
    expect(migrated['issued']).toEqual(JSON.parse(JSON.stringify(sampleIssued())));
    expect(migrated).toMatchObject({ discount: { kind: 'none' } });
    expect((migrated['lines'] as { discount: unknown }[]).every((l) => JSON.stringify(l.discount) === '{"kind":"none"}')).toBe(true);
  });

  it('a discount of a line is read with its checks', () => {
    const withDiscount = (discount: unknown) => ({ ...quote, lines: [{ ...(quote['lines'] as Record<string, unknown>[])[0], discount }, ...(quote['lines'] as unknown[]).slice(1)] });
    expect(() => migrate('document', withDiscount({ kind: 'percent', rate: 1000 }))).not.toThrow();
    expect(() => migrate('document', withDiscount({ kind: 'percent', rate: 0 }))).toThrow(InvalidFileError);
    expect(() => migrate('document', withDiscount({ kind: 'percent', rate: 10_001 }))).toThrow(InvalidFileError);
    expect(() => migrate('document', withDiscount({ kind: 'amount', amount: -5 }))).toThrow(InvalidFileError);
    expect(() => migrate('document', withDiscount({ kind: 'bogus' }))).toThrow(InvalidFileError);
  });

  it('an amount discount is at most its line, and at most the lines of the document', () => {
    const withLine = (discount: unknown) => ({ ...quote, lines: [{ ...(quote['lines'] as Record<string, unknown>[])[0], discount }, ...(quote['lines'] as unknown[]).slice(1)] });
    // the first line of the sample quote is 1.062,50 €, the lines add up to 1.362,50 €
    expect(() => migrate('document', withLine({ kind: 'amount', amount: 106_250 }))).not.toThrow();
    expect(() => migrate('document', withLine({ kind: 'amount', amount: 106_251 }))).toThrow(InvalidFileError);
    expect(() => migrate('document', { ...quote, discount: { kind: 'amount', amount: 136_250 } })).not.toThrow();
    expect(() => migrate('document', { ...quote, discount: { kind: 'amount', amount: 136_251 } })).toThrow(InvalidFileError);
  });

  it('a discount of the document is read with its checks', () => {
    expect(() => migrate('document', { ...quote, discount: { kind: 'amount', amount: 500 } })).not.toThrow();
    expect(() => migrate('document', { ...quote, discount: { kind: 'amount', amount: 0 } })).toThrow(InvalidFileError);
  });

  it('the files of the other kinds of version 11 stay as they are', () => {
    const files = {
      company: asV11(sampleCompany()),
      contact: asV11(makeContact(sampleContact())),
      item: asV11(makeItem(sampleItem())),
      numbering: asV11({ range: 'quote', counters: [{ key: '2026', last: 1 }], reservations: [] }),
      quoteStatus: asV11(makeQuoteStatus(makeQuote(customerId, sampleQuote()).id, { decision: 'accepted', date: '2026-11-03' })),
    };
    for (const [kind, raw] of Object.entries(files) as [keyof typeof files, Record<string, unknown>][]) {
      expect(migrate(kind, raw)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
    }
  });

  it('an app that knows only version 11 refuses a document with discounts, so it never drops one', () => {
    expect(() => upgrade('document', { ...quote, schemaVersion: 12 }, MIGRATIONS.document, 11)).toThrow(NewerSchemaError);
  });
});

const asV9 = (file: object) => ({ ...JSON.parse(JSON.stringify(file)), schemaVersion: 9 }) as Record<string, unknown>;

describe('version 9 → 10: the numbers of contacts and items (F28)', () => {
  const profileWithoutNumberPatterns = (): Record<string, unknown> => {
    const { contactPattern: _c, itemPattern: _i, ...invoiceDefaults } = sampleCompany().invoiceDefaults;
    return { ...asV9(sampleCompany()), invoiceDefaults };
  };

  it('a company of version 9 gets the default patterns of contact and item numbers', () => {
    const migrated = migrate('company', profileWithoutNumberPatterns());
    expect(migrated.invoiceDefaults).toMatchObject({ contactPattern: 'K-{NNNN}', itemPattern: 'A-{NNNN}', numberPattern: 'RE-{YYYY}-{NNNN}' });
  });

  it('a pattern that is there already stays', () => {
    const raw = asV9(sampleCompany({ invoiceDefaults: { numberPattern: 'RE-{NNNN}', quotePattern: 'AN-{NNNN}', contactPattern: 'C{NNN}', itemPattern: 'I{NNN}', paymentTermDays: 14, footer: '' } }));
    expect(migrate('company', raw).invoiceDefaults).toMatchObject({ contactPattern: 'C{NNN}', itemPattern: 'I{NNN}' });
  });

  it('an issued document of version 9 keeps its company as it was, with the default patterns added to it', () => {
    const issued = { ...makeInvoice(makeContact(sampleContact()).id, sampleCompany().bank.defaultAccountId, sampleInvoice(), null), issued: sampleIssued('RE-2026-0001') };
    const raw = asV9(issued) as Record<string, unknown>;
    const withoutPatterns = { ...raw, issued: { ...(raw['issued'] as Record<string, unknown>), snapshot: { ...((raw['issued'] as Record<string, unknown>)['snapshot'] as Record<string, unknown>), company: profileWithoutNumberPatterns() } } };
    const migrated = migrate('document', withoutPatterns) as InvoiceFile & { issued: IssuedInfo };
    expect(migrated.issued.snapshot.company.invoiceDefaults).toMatchObject({ contactPattern: 'K-{NNNN}', itemPattern: 'A-{NNNN}' });
    expect(migrated.issued.pdf).toEqual(issued.issued.pdf);
  });

  it('contacts, items and the other kinds of version 9 stay as they are', () => {
    const files = {
      contact: asV9(makeContact(sampleContact())),
      item: asV9(makeItem(sampleItem())),
      numbering: asV9({ range: 'invoice', counters: [{ key: '2026', last: 1 }], reservations: [] }),
    };
    for (const [kind, raw] of Object.entries(files) as [keyof typeof files, Record<string, unknown>][]) {
      expect(migrate(kind, raw)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
    }
  });

  it('an app that knows only version 9 refuses a company with the patterns of contact numbers, so it never drops them', () => {
    expect(() => upgrade('company', { ...sampleCompany(), schemaVersion: 10 }, MIGRATIONS.company, 9)).toThrow(NewerSchemaError);
  });
});

const asV8 = (file: object) => ({ ...JSON.parse(JSON.stringify(file)), schemaVersion: 8 }) as Record<string, unknown>;

describe('version 8 → 9: the language of the documents (F05)', () => {
  const contact = makeContact(sampleContact());
  const invoice = makeInvoice(contact.id, sampleCompany().bank.defaultAccountId, sampleInvoice(), null);
  /** The customer of an issued document of version 8 has no language yet */
  const withoutCustomerLanguage = (raw: Record<string, unknown>): Record<string, unknown> => {
    const issued = raw['issued'] as Record<string, unknown>;
    const snapshot = issued['snapshot'] as Record<string, unknown>;
    const { language: _language, ...customer } = snapshot['customer'] as Record<string, unknown>;
    return { ...raw, issued: { ...issued, snapshot: { ...snapshot, customer } } };
  };
  const contactV8 = (): Record<string, unknown> => {
    const { language: _language, ...raw } = asV8(contact);
    return raw;
  };

  it('a contact of version 8 is German: its documents were made in German', () => {
    const migrated = migrate('contact', contactV8());
    expect(migrated).toMatchObject({ id: contact.id, name: contact.name, language: 'de', schemaVersion: SCHEMA_VERSION });
  });

  it('a contact with a language of its own keeps it, and an unknown language is refused', () => {
    expect(migrate('contact', { ...contactV8(), language: 'en' })).toMatchObject({ language: 'en' });
    expect(() => migrate('contact', { ...contactV8(), language: 'fr' })).toThrow(InvalidFileError);
  });

  it('an issued document of version 8 says German for its customer, and keeps the rest of its snapshot', () => {
    const issued = { ...invoice, issued: sampleIssued('RE-2026-0001') };
    const migrated = migrate('document', withoutCustomerLanguage(asV8(issued))) as InvoiceFile & { issued: IssuedInfo };
    expect(migrated.issued.snapshot.customer.language).toBe('de');
    expect(migrated.issued.snapshot.customer.name).toBe('Kunde GmbH');
    expect(migrated.issued.pdf).toEqual(issued.issued.pdf);
  });

  it('a draft or a quote of version 8 changes nothing but its version', () => {
    const quote = makeQuote(contact.id, sampleQuote());
    expect(migrate('document', asV8(quote))).toEqual({ ...quote, schemaVersion: SCHEMA_VERSION });
    expect(migrate('document', asV8(invoice))).toEqual({ ...invoice, schemaVersion: SCHEMA_VERSION });
  });

  it('the files of the other kinds of version 8 stay as they are', () => {
    const files = {
      company: asV8(sampleCompany()),
      item: asV8(makeItem(sampleItem())),
      payment: asV8(makePayment(invoice.id, { date: '2026-10-31', amount: cents(11_900), accountId: sampleCompany().bank.defaultAccountId, note: '' })),
      numbering: asV8({ range: 'invoice', counters: [{ key: '2026', last: 1 }], reservations: [] }),
    };
    for (const [kind, raw] of Object.entries(files) as [keyof typeof files, Record<string, unknown>][]) {
      expect(migrate(kind, raw)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
    }
  });

  it('an app that knows only version 8 refuses a contact with a language, so it never drops the language of its documents', () => {
    expect(() => upgrade('contact', { ...contact, schemaVersion: 9 }, MIGRATIONS.contact, 8)).toThrow(NewerSchemaError);
  });
});

// Template for the next format change: write the step, test it here with `upgrade(kind, raw, steps, target)`,
// then add it to MIGRATIONS and increase SCHEMA_VERSION.
describe('migration template (version 17 → 18, not in use)', () => {
  const steps: Migration[] = [
    ...MIGRATIONS.company,
    {
      from: 17,
      up: (raw) => {
        const defaults = raw['invoiceDefaults'] as Record<string, unknown>;
        return { ...raw, invoiceDefaults: { ...defaults, example: ['a', 'b'] } };
      },
    },
  ];

  it('runs the step and sets the new version', () => {
    const doc = upgrade('company', company(), steps, 18);
    expect(doc['schemaVersion']).toBe(18);
    expect((doc['invoiceDefaults'] as Record<string, unknown>)['example']).toEqual(['a', 'b']);
  });

  it('runs every step from an older version', () => {
    const doc = upgrade('company', companyV1(), steps, 18);
    expect((doc['bank'] as Record<string, unknown>)['defaultAccountId']).toBe(MIGRATED_ACCOUNT_ID);
    expect((doc['invoiceDefaults'] as Record<string, unknown>)['quotePattern']).toBe('AN-{YYYY}-{NNNN}');
    expect((doc['invoiceDefaults'] as Record<string, unknown>)['example']).toEqual(['a', 'b']);
  });

  it('a kind whose format did not change gets an empty step', () => {
    const raw = company();
    expect(upgrade('company', raw, [unchanged(17)], 18)).toEqual({ ...raw, schemaVersion: 18 });
  });

  it('fails when a step is missing', () => {
    expect(() => upgrade('company', company(), [], 18)).toThrow(InvalidFileError);
  });
});
