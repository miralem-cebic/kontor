import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatIban, IBAN_LENGTHS, ibanCheckDigits, ibanProblem, isValidBic, isValidIban, normalizeIban } from '../../src/domain/iban';
import { fcParams } from './fixtures';

// Examples from the IBAN registry and the banks' published sample IBANs
const VALID = [
  'DE89 3704 0044 0532 0130 00',
  'AT61 1904 3002 3457 3201',
  'CH93 0076 2011 6238 5295 7',
  'GB82 WEST 1234 5698 7654 32',
  'NL91 ABNA 0417 1643 00',
  'BE68 5390 0754 7034',
  'FR14 2004 1010 0505 0001 3M02 606',
];

describe('IBAN', () => {
  it.each(VALID)('accepts %s', (iban) => expect(isValidIban(iban)).toBe(true));

  it('normalizes and formats', () => {
    expect(normalizeIban(' de89 3704-0044 0532 0130 00 ')).toBe('DE89370400440532013000');
    expect(formatIban('DE89370400440532013000')).toBe('DE89 3704 0044 0532 0130 00');
  });

  it.each([
    ['DE89370400440532013001', 'checksum'],
    ['DE8937040044053201300', 'length'],
    ['US12345678901234567890', 'country'],
    ['D189370400440532013000', 'format'],
    ['DE89 3704', 'format'],
    ['', 'format'],
  ])('rejects %s (%s)', (iban, problem) => expect(ibanProblem(iban)).toBe(problem));

  const country = fc.constantFrom(...Object.keys(IBAN_LENGTHS));
  const ibanOf = (c: string, digits: string) => `${c}${ibanCheckDigits(c, digits)}${digits}`;
  const generated = country.chain((c) =>
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: (IBAN_LENGTHS[c] ?? 22) - 4, maxLength: (IBAN_LENGTHS[c] ?? 22) - 4 }).map((d) => ({ c, digits: d.join('') })),
  );

  it('accepts every IBAN with correct check digits', () =>
    fc.assert(fc.property(generated, ({ c, digits }) => isValidIban(ibanOf(c, digits))), fcParams));

  it('detects every single changed digit', () =>
    fc.assert(
      fc.property(generated, fc.nat(), fc.integer({ min: 1, max: 9 }), ({ c, digits }, at, delta) => {
        const i = at % digits.length;
        const changed = digits.slice(0, i) + String((Number(digits[i]) + delta) % 10) + digits.slice(i + 1);
        return !isValidIban(`${c}${ibanCheckDigits(c, digits)}${changed}`);
      }),
      fcParams,
    ));

  it('detects swapped neighbouring digits', () =>
    fc.assert(
      fc.property(generated, fc.nat(), ({ c, digits }, at) => {
        const i = at % (digits.length - 1);
        if (digits[i] === digits[i + 1]) return true;
        const swapped = digits.slice(0, i) + digits[i + 1] + digits[i] + digits.slice(i + 2);
        return !isValidIban(`${c}${ibanCheckDigits(c, digits)}${swapped}`);
      }),
      fcParams,
    ));
});

describe('BIC', () => {
  it.each(['COBADEFFXXX', 'COBADEFF', 'deutdeff500'])('accepts %s', (bic) => expect(isValidBic(bic)).toBe(true));
  it.each(['COBADEF', 'COBADEFFXX', 'C0BADEFF', '12345678'])('rejects %s', (bic) => expect(isValidBic(bic)).toBe(false));
});
