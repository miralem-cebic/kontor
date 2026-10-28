import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkLogo,
  detectLogoType,
  draftFromProfile,
  emptyDraft,
  logoFileName,
  LOGO_FILE,
  MAX_LOGO_BYTES,
  readProfile,
  readSection,
  SECTION_FIELDS,
  SECTIONS,
  type CompanyDraft,
  type NewCompany,
} from '../../src/domain/company';
import { fcParams, sampleAccount, sampleDraft, sampleProfile } from './fixtures';

/** The year the forms check against; the minimum trade tax multiplier depends on it */
const YEAR = 2026;

const problems = (r: ReturnType<typeof readSection>) => (r.ok ? [] : r.error.map((e) => `${e.field}:${e.problem}`));

/** The draft of the setup assistant for a profile and its first account */
const draftOf = ({ account, ...profile }: NewCompany): CompanyDraft => ({
  ...draftFromProfile({ ...profile, logo: null }),
  bankHolder: account.holder,
  iban: account.iban,
  bic: account.bic,
});

describe('readSection', () => {
  it('an empty draft fails every section with "required"', () => {
    const d = emptyDraft();
    expect(problems(readSection('master', d, YEAR))).toEqual(expect.arrayContaining(['name:required', 'owner:required', 'street:required', 'postalCode:required', 'city:required', 'email:required']));
    expect(problems(readSection('tax', d, YEAR))).toEqual(['taxNumber:taxIdRequired', 'smallBusiness:required', 'businessKind:required']);
    expect(problems(readSection('bank', d, YEAR))).toEqual(['bankHolder:required', 'iban:required']);
    // the invoice defaults are filled in from the start
    expect(readSection('invoice', d, YEAR).ok).toBe(true);
  });

  it('errors only name fields of their own section', () => {
    for (const s of SECTIONS) {
      const r = readSection(s, emptyDraft(), YEAR);
      if (!r.ok) for (const e of r.error) expect(SECTION_FIELDS[s]).toContain(e.field);
    }
  });

  it('checks formats', () => {
    const d = sampleDraft({ email: 'erika@', postalCode: '5066', phone: 'call me' });
    expect(problems(readSection('master', d, YEAR))).toEqual(['postalCode:postalCode', 'email:email', 'phone:phone']);
    expect(problems(readSection('master', sampleDraft({ country: 'Deutschland' }), YEAR))).toEqual(['country:country']);
    expect(problems(readSection('master', sampleDraft({ name: 'x'.repeat(121) }), YEAR))).toEqual(['name:tooLong']);
  });

  it('accepts a foreign postal code outside Germany', () => {
    expect(readSection('master', sampleDraft({ country: 'at', postalCode: '1010' }), YEAR).ok).toBe(true);
    expect(readSection('master', sampleDraft({ country: 'NL', postalCode: '1012 AB' }), YEAR).ok).toBe(true);
  });

  it('regular VAT needs method and period; the extension is dropped for yearly returns', () => {
    const regular = sampleDraft({ smallBusiness: false });
    expect(problems(readSection('tax', regular, YEAR))).toEqual(['vatMethod:required', 'vatPeriod:required']);
    const yearly = readSection('tax', { ...regular, vatMethod: 'cash', vatPeriod: 'yearly', permanentExtension: true }, YEAR);
    expect(yearly.ok && yearly.value.tax.vat).toEqual({ kind: 'regular', method: 'cash', period: 'yearly', permanentExtension: false });
  });

  it('a trade needs municipality and a multiplier of at least the minimum of the year', () => {
    const trade = sampleDraft({ businessKind: 'trade' });
    expect(problems(readSection('tax', trade, YEAR))).toEqual(['municipality:required', 'multiplier:multiplier']);
    expect(problems(readSection('tax', { ...trade, municipality: 'Köln', multiplier: '199' }, YEAR))).toEqual(['multiplier:multiplier']);
    expect(problems(readSection('tax', { ...trade, municipality: 'Köln', multiplier: '4.5' }, YEAR))).toEqual(['multiplier:multiplier']);
    const ok = readSection('tax', { ...trade, municipality: 'Köln', multiplier: '475' }, YEAR);
    expect(ok.ok && ok.value.tax.business).toEqual({ kind: 'trade', municipality: 'Köln', multiplierPercent: 475 });
    // 200 % up to 2026, 280 % from 2027 (§ 16 Abs. 4 Satz 2 GewStG)
    const low = { ...trade, municipality: 'Neuberg', multiplier: '250' };
    expect(readSection('tax', low, 2026).ok).toBe(true);
    expect(problems(readSection('tax', low, 2027))).toEqual(['multiplier:multiplier']);
    expect(readSection('tax', { ...low, multiplier: '280' }, 2027).ok).toBe(true);
  });

  it('a VAT ID alone is enough, and it is checked', () => {
    expect(readSection('tax', sampleDraft({ taxNumber: '', vatId: 'de136695976' }), YEAR).ok).toBe(true);
    expect(problems(readSection('tax', sampleDraft({ vatId: 'DE136695977' }), YEAR))).toEqual(['vatId:vatId']);
  });

  it('reports the IBAN problem and normalizes valid values', () => {
    expect(problems(readSection('bank', sampleDraft({ iban: 'DE89 3704 0044 0532 0130 01' }), YEAR))).toEqual(['iban:iban.checksum']);
    const r = readSection('bank', sampleDraft({ bic: 'cobadeffxxx' }), YEAR);
    expect(r.ok && r.value.account).toEqual({ kind: 'bank', name: '', holder: 'Erika Mustermann', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' });
  });

  it('checks the number pattern and the payment term', () => {
    expect(problems(readSection('invoice', sampleDraft({ numberPattern: 'RE/{NNNN}', paymentTermDays: '366' }), YEAR))).toEqual(['numberPattern:pattern.invalidCharacter', 'paymentTermDays:paymentTerm']);
    expect(problems(readSection('invoice', sampleDraft({ paymentTermDays: '-1' }), YEAR))).toEqual(['paymentTermDays:paymentTerm']);
  });

  it('checks the quote number pattern, which must differ from the invoice pattern', () => {
    expect(emptyDraft().quotePattern).toBe('AN-{YYYY}-{NNNN}');
    const r = readSection('invoice', sampleDraft({ quotePattern: ' A-{YY}-{NNN} ' }), YEAR);
    expect(r.ok && r.value.invoiceDefaults).toEqual({ numberPattern: 'RE-{YYYY}-{NNNN}', quotePattern: 'A-{YY}-{NNN}', paymentTermDays: 14, footer: '' });
    expect(problems(readSection('invoice', sampleDraft({ quotePattern: 'AN {NNNN}' }), YEAR))).toEqual(['quotePattern:pattern.invalidCharacter']);
    expect(problems(readSection('invoice', sampleDraft({ quotePattern: '' }), YEAR))).toEqual(['quotePattern:pattern.empty']);
    expect(problems(readSection('invoice', sampleDraft({ quotePattern: 'RE-{YYYY}-{NNNN}' }), YEAR))).toEqual(['quotePattern:pattern.sameAsInvoice']);
  });
});

describe('draft ↔ profile', () => {
  it('a profile and its first account survive the round trip through the draft', () => {
    const { logo: _logo, ...profile } = sampleProfile();
    const company: NewCompany = { ...profile, account: sampleAccount({ name: '' }) };
    expect(readProfile(draftOf(company), YEAR)).toEqual({ ok: true, value: company });
  });

  it('the draft of a profile leaves the bank fields empty: the settings edit accounts on their own', () => {
    const d = draftFromProfile(sampleProfile());
    expect([d.bankHolder, d.iban, d.bic]).toEqual(['', '', '']);
  });

  it('reading a draft twice gives the same profile (idempotent normalization)', () =>
    fc.assert(
      fc.property(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim() !== ''),
          iban: fc.constantFrom('de89 3704 0044 0532 0130 00', 'AT611904300234573201'),
          vatId: fc.constantFrom('', 'de 136 695 976'),
          smallBusiness: fc.boolean(),
        }),
        (over) => {
          const first = readProfile(sampleDraft({ ...over, vatMethod: 'accrual', vatPeriod: 'monthly' }), YEAR);
          if (!first.ok) return false;
          const second = readProfile(draftOf(first.value), YEAR);
          return second.ok && JSON.stringify(second.value) === JSON.stringify(first.value);
        },
      ),
      fcParams,
    ));
});

describe('logo', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  const svg = (text: string) => new TextEncoder().encode(text);

  it('detects the type by content', () => {
    expect(detectLogoType(png)).toBe('image/png');
    expect(detectLogoType(jpeg)).toBe('image/jpeg');
    expect(detectLogoType(svg('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml');
    expect(detectLogoType(svg('﻿<?xml version="1.0"?>\n<!-- logo -->\n<!DOCTYPE svg>\n<svg>'))).toBe('image/svg+xml');
    expect(detectLogoType(svg('<html><svg>'))).toBeNull();
    expect(detectLogoType(svg('GIF89a'))).toBeNull();
  });

  it('limits the size', () => {
    expect(checkLogo(new Uint8Array())).toEqual({ ok: false, error: 'empty' });
    const big = new Uint8Array(MAX_LOGO_BYTES + 1);
    big.set(png);
    expect(checkLogo(big)).toEqual({ ok: false, error: 'tooLarge' });
    expect(checkLogo(png)).toEqual({ ok: true, value: 'image/png' });
  });

  it('names the file after its hash', () => {
    const name = logoFileName('ab'.repeat(32), 'image/jpeg');
    expect(name).toBe('logo-abababababababab.jpg');
    expect(LOGO_FILE.test(name)).toBe(true);
  });
});
