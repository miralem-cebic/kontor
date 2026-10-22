import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { accountKey, draftFromAccount, emptyAccountDraft, readAccount, type AccountDraft } from '../../src/domain/bankAccount';
import { fcParams, sampleAccount } from './fixtures';

const free = () => false;
const problems = (r: ReturnType<typeof readAccount>) => (r.ok ? [] : r.error.map((e) => `${e.field}:${e.problem}`));
const bankDraft = (over: Partial<AccountDraft> = {}): AccountDraft => ({ ...emptyAccountDraft('Erika Mustermann'), iban: 'DE89 3704 0044 0532 0130 00', ...over });
const paypalDraft = (over: Partial<AccountDraft> = {}): AccountDraft => ({ ...emptyAccountDraft(), kind: 'paypal', email: 'erika@example.com', ...over });

describe('readAccount', () => {
  it('a bank account needs holder and IBAN; the name and the BIC are optional', () => {
    expect(problems(readAccount(emptyAccountDraft(), free))).toEqual(['holder:required', 'iban:required']);
    const r = readAccount(bankDraft({ name: '  Geschäftskonto ', bic: 'cobadeffxxx' }), free);
    expect(r.ok && r.value).toEqual({ kind: 'bank', name: 'Geschäftskonto', holder: 'Erika Mustermann', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' });
  });

  it('checks IBAN, BIC and the length of the texts', () => {
    expect(problems(readAccount(bankDraft({ iban: 'DE89 3704 0044 0532 0130 01' }), free))).toEqual(['iban:iban.checksum']);
    expect(problems(readAccount(bankDraft({ iban: 'US12 3456' }), free))).toEqual(['iban:iban.country']);
    expect(problems(readAccount(bankDraft({ bic: 'COBADE' }), free))).toEqual(['bic:bic']);
    expect(problems(readAccount(bankDraft({ name: 'x'.repeat(61), holder: 'x'.repeat(121) }), free))).toEqual(['name:tooLong', 'holder:tooLong']);
  });

  it('a PayPal account needs a valid email address', () => {
    expect(problems(readAccount(paypalDraft({ email: '' }), free))).toEqual(['email:required']);
    expect(problems(readAccount(paypalDraft({ email: 'erika@' }), free))).toEqual(['email:email']);
    const r = readAccount(paypalDraft({ email: ' Erika@Example.com ' }), free);
    expect(r.ok && r.value).toEqual({ kind: 'paypal', name: '', email: 'Erika@Example.com' });
  });

  it('only the fields of the chosen kind count: switching the kind keeps what was typed', () => {
    const typed = bankDraft({ email: 'not checked' });
    expect(readAccount(typed, free).ok).toBe(true);
    const r = readAccount({ ...typed, kind: 'paypal', email: 'erika@example.com' }, free);
    expect(r.ok && r.value).toEqual({ kind: 'paypal', name: '', email: 'erika@example.com' });
  });

  it('the same IBAN or PayPal address twice is refused', () => {
    const keys = new Set(['DE89370400440532013000', 'erika@example.com']);
    const taken = (key: string) => keys.has(key);
    expect(problems(readAccount(bankDraft({ iban: 'de89 3704 0044 0532 0130 00' }), taken))).toEqual(['iban:accountTaken']);
    expect(problems(readAccount(paypalDraft({ email: 'ERIKA@example.com' }), taken))).toEqual(['email:accountTaken']);
    expect(readAccount(bankDraft({ iban: 'AT611904300234573201' }), taken).ok).toBe(true);
  });

  it('an invalid value is reported as such, not as taken', () => {
    const taken = () => true;
    expect(problems(readAccount(bankDraft({ iban: 'DE0012' }), taken))).toEqual(['iban:iban.length']);
    expect(problems(readAccount(paypalDraft({ email: 'x' }), taken))).toEqual(['email:email']);
  });
});

describe('accountKey', () => {
  it('is the IBAN or the PayPal address in lower case', () => {
    expect(accountKey(sampleAccount())).toBe('DE89370400440532013000');
    expect(accountKey({ kind: 'paypal', name: '', email: 'Erika@Example.com' })).toBe('erika@example.com');
  });
});

describe('draft ↔ account', () => {
  it('the draft shows the IBAN in groups of four', () => {
    expect(draftFromAccount(sampleAccount()).iban).toBe('DE89 3704 0044 0532 0130 00');
  });

  it('an account survives the round trip through the draft', () => {
    const paypal = { kind: 'paypal', name: 'Shop', email: 'shop@example.com' } as const;
    for (const account of [sampleAccount(), sampleAccount({ name: '', bic: '' }), paypal]) {
      expect(readAccount(draftFromAccount(account), free)).toEqual({ ok: true, value: account });
    }
  });

  it('reading a draft twice gives the same account (idempotent normalization)', () =>
    fc.assert(
      fc.property(
        fc.record({
          name: fc.string({ maxLength: 60 }),
          iban: fc.constantFrom('de89 3704 0044 0532 0130 00', 'AT61 1904 3002 3457 3201', 'DE89-3704-0044-0532-0130-00'),
          bic: fc.constantFrom('', ' cobadeffxxx ', 'DEUTDEFF'),
        }),
        (over) => {
          const first = readAccount(bankDraft(over), free);
          if (!first.ok) return false;
          const second = readAccount(draftFromAccount(first.value), free);
          return second.ok && JSON.stringify(second.value) === JSON.stringify(first.value);
        },
      ),
      fcParams,
    ));
});
