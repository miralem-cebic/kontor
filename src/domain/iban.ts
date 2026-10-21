// IBAN and BIC checks (ISO 13616, ISO 9362).

/**
 * IBAN length per country, for the countries of the SEPA payment area.
 * Source: SWIFT IBAN Registry, https://www.swift.com/standards/data-standards/iban-international-bank-account-number
 */
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27,
  GB: 22, GI: 23, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27,
  MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27, VA: 22,
};

export type IbanProblem = 'format' | 'country' | 'length' | 'checksum';

/** Removes spaces and turns letters into capitals: "de89 3704…" → "DE893704…" */
export const normalizeIban = (input: string): string => input.replace(/[\s-]/g, '').toUpperCase();

/** Groups of four characters, as printed on invoices: "DE89 3704 0044 0532 0130 00" */
export const formatIban = (iban: string): string => normalizeIban(iban).replace(/(.{4})(?=.)/g, '$1 ');

/** ISO 7064 MOD 97-10 over the rearranged IBAN (letters as numbers, A = 10 … Z = 35), in chunks to stay exact. */
function mod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

/** Why an IBAN is not valid, or null when it is valid. Expects a normalized IBAN. */
export function ibanProblem(iban: string): IbanProblem | null {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return 'format';
  const length = IBAN_LENGTHS[iban.slice(0, 2)];
  if (length === undefined) return 'country';
  if (iban.length !== length) return 'length';
  return mod97(iban) === 1 ? null : 'checksum';
}

export const isValidIban = (iban: string): boolean => ibanProblem(normalizeIban(iban)) === null;

/** The two check digits for a country code and a basic bank account number (used by tests and fixtures). */
export function ibanCheckDigits(country: string, bban: string): string {
  const remainder = mod97(`${country}00${bban}`);
  return String(98 - remainder).padStart(2, '0');
}

/** BIC: bank (4 letters), country (2 letters), location (2), optional branch (3). */
export const isValidBic = (bic: string): boolean => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(bic.trim().toUpperCase());
