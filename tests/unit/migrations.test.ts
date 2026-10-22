import { describe, expect, it } from 'vitest';
import { classifyError } from '../../src/data/repository';
import { InvalidFileError, MIGRATED_ACCOUNT_ID, migrate, MIGRATIONS, NewerSchemaError, unchanged, upgrade, type Migration } from '../../src/data/migrations';
import { makeContact, makeItem, SCHEMA_VERSION } from '../../src/data/schema';
import { sampleCompany, sampleContact, sampleItem } from './fixtures';

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
    expect(SCHEMA_VERSION).toBe(2);
    expect(migrate('company', company()).schemaVersion).toBe(2);
  });

  it('a file without version counts as version 1', () => {
    const { schemaVersion: _v, ...raw } = companyV1();
    expect(migrate('company', raw).schemaVersion).toBe(2);
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

  it('item files came with version 2; one without a version is read like any other file', () => {
    const { schemaVersion: _v, ...raw } = JSON.parse(JSON.stringify(makeItem(sampleItem()))) as Record<string, unknown>;
    expect(migrate('item', raw)).toEqual({ ...raw, schemaVersion: 2 });
  });

  it('contact files of version 1 stay as they are', () => {
    const raw = { ...JSON.parse(JSON.stringify(makeContact(sampleContact()))), schemaVersion: 1 } as Record<string, unknown>;
    expect(migrate('contact', raw)).toEqual({ ...raw, schemaVersion: 2 });
  });
});

// Template for the next format change: write the step, test it here with `upgrade(kind, raw, steps, target)`,
// then add it to MIGRATIONS and increase SCHEMA_VERSION.
describe('migration template (version 2 → 3, not in use)', () => {
  const steps: Migration[] = [
    ...MIGRATIONS.company,
    {
      from: 2,
      up: (raw) => {
        const defaults = raw['invoiceDefaults'] as Record<string, unknown>;
        return { ...raw, invoiceDefaults: { ...defaults, quotePattern: 'AN-{YYYY}-{NNNN}' } };
      },
    },
  ];

  it('runs the step and sets the new version', () => {
    const doc = upgrade('company', company(), steps, 3);
    expect(doc['schemaVersion']).toBe(3);
    expect((doc['invoiceDefaults'] as Record<string, unknown>)['quotePattern']).toBe('AN-{YYYY}-{NNNN}');
  });

  it('runs every step from an older version', () => {
    const doc = upgrade('company', companyV1(), steps, 3);
    expect((doc['bank'] as Record<string, unknown>)['defaultAccountId']).toBe(MIGRATED_ACCOUNT_ID);
    expect((doc['invoiceDefaults'] as Record<string, unknown>)['quotePattern']).toBe('AN-{YYYY}-{NNNN}');
  });

  it('a kind whose format did not change gets an empty step', () => {
    const raw = company();
    expect(upgrade('company', raw, [unchanged(2)], 3)).toEqual({ ...raw, schemaVersion: 3 });
  });

  it('fails when a step is missing', () => {
    expect(() => upgrade('company', company(), [], 3)).toThrow(InvalidFileError);
  });
});
