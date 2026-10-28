import { describe, expect, it } from 'vitest';
import { classifyError } from '../../src/data/repository';
import { InvalidFileError, MIGRATED_ACCOUNT_ID, migrate, MIGRATIONS, NewerSchemaError, unchanged, upgrade, type Migration } from '../../src/data/migrations';
import { makeContact, makeInvoice, makeItem, makeQuote, SCHEMA_VERSION } from '../../src/data/schema';
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
    expect(SCHEMA_VERSION).toBe(6);
    expect(migrate('company', company()).schemaVersion).toBe(6);
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
    const { issued: _i, ...raw } = asV5(makeQuote(makeContact(sampleContact()).id, sampleQuote()));
    return raw;
  };

  it('company.json gets the default quote pattern; the change time of the field stays', () => {
    const before = companyV5();
    const after = migrate('company', before);
    expect(after.invoiceDefaults).toEqual({ numberPattern: 'RE-{YYYY}-{NNNN}', quotePattern: 'AN-{YYYY}-{NNNN}', paymentTermDays: 14, footer: '' });
    expect(after.fieldUpdatedAt).toEqual(before['fieldUpdatedAt']);
  });

  it('a quote pattern that is there already stays', () => {
    const raw = asV5(sampleCompany({ invoiceDefaults: { numberPattern: 'RE-{YYYY}-{NNNN}', quotePattern: 'A{NNN}', paymentTermDays: 14, footer: '' } }));
    expect(migrate('company', raw).invoiceDefaults.quotePattern).toBe('A{NNN}');
  });

  it('a quote of version 5 is a draft', () => {
    const raw = quoteV5();
    expect(migrate('document', raw)).toEqual({ ...raw, issued: null, schemaVersion: SCHEMA_VERSION });
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
    expect(() => upgrade('document', { ...quoteV5(), issued: null, schemaVersion: 6 }, MIGRATIONS.document, 5)).toThrow(NewerSchemaError);
  });
});

// Template for the next format change: write the step, test it here with `upgrade(kind, raw, steps, target)`,
// then add it to MIGRATIONS and increase SCHEMA_VERSION.
describe('migration template (version 6 → 7, not in use)', () => {
  const steps: Migration[] = [
    ...MIGRATIONS.company,
    {
      from: 6,
      up: (raw) => {
        const defaults = raw['invoiceDefaults'] as Record<string, unknown>;
        return { ...raw, invoiceDefaults: { ...defaults, footerParts: ['address', 'contact', 'tax', 'bank'] } };
      },
    },
  ];

  it('runs the step and sets the new version', () => {
    const doc = upgrade('company', company(), steps, 7);
    expect(doc['schemaVersion']).toBe(7);
    expect((doc['invoiceDefaults'] as Record<string, unknown>)['footerParts']).toEqual(['address', 'contact', 'tax', 'bank']);
  });

  it('runs every step from an older version', () => {
    const doc = upgrade('company', companyV1(), steps, 7);
    expect((doc['bank'] as Record<string, unknown>)['defaultAccountId']).toBe(MIGRATED_ACCOUNT_ID);
    expect((doc['invoiceDefaults'] as Record<string, unknown>)['quotePattern']).toBe('AN-{YYYY}-{NNNN}');
    expect((doc['invoiceDefaults'] as Record<string, unknown>)['footerParts']).toEqual(['address', 'contact', 'tax', 'bank']);
  });

  it('a kind whose format did not change gets an empty step', () => {
    const raw = company();
    expect(upgrade('company', raw, [unchanged(6)], 7)).toEqual({ ...raw, schemaVersion: 7 });
  });

  it('fails when a step is missing', () => {
    expect(() => upgrade('company', company(), [], 7)).toThrow(InvalidFileError);
  });
});
