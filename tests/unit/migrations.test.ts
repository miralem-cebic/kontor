import { describe, expect, it } from 'vitest';
import { classifyError } from '../../src/data/repository';
import { InvalidFileError, migrate, MIGRATIONS, NewerSchemaError, unchanged, upgrade, type Migration } from '../../src/data/migrations';
import { makeCompany, SCHEMA_VERSION } from '../../src/data/schema';
import { sampleProfile } from './fixtures';

const company = () => JSON.parse(JSON.stringify(makeCompany(sampleProfile()))) as Record<string, unknown>;

describe('migrate', () => {
  it('reads the current version', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(migrate('company', company()).schemaVersion).toBe(1);
  });

  it('a file without version counts as version 1', () => {
    const { schemaVersion: _v, ...raw } = company();
    expect(migrate('company', raw).schemaVersion).toBe(1);
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

// Template for the next format change: write the step, test it here with `upgrade(kind, raw, steps, target)`,
// then add it to MIGRATIONS and increase SCHEMA_VERSION.
describe('migration template (version 1 → 2, not in use)', () => {
  const v1ToV2: Migration = {
    from: 1,
    up: (raw) => {
      const defaults = raw['invoiceDefaults'] as Record<string, unknown>;
      return { ...raw, invoiceDefaults: { ...defaults, quotePattern: 'AN-{YYYY}-{NNNN}' } };
    },
  };

  it('runs the step and sets the new version', () => {
    const doc = upgrade('company', company(), [v1ToV2], 2);
    expect(doc['schemaVersion']).toBe(2);
    expect((doc['invoiceDefaults'] as Record<string, unknown>)['quotePattern']).toBe('AN-{YYYY}-{NNNN}');
  });

  it('a kind whose format did not change gets an empty step', () => {
    const raw = company();
    expect(upgrade('company', raw, [unchanged(1)], 2)).toEqual({ ...raw, schemaVersion: 2 });
  });

  it('fails when a step is missing', () => {
    expect(() => upgrade('company', company(), [], 2)).toThrow(InvalidFileError);
  });
});
