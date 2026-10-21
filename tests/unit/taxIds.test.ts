import { describe, expect, it } from 'vitest';
import { isPlausibleEuVatId, isPlausibleLeitwegId, isValidGermanVatId, isValidTaxNumber, normalizeVatId } from '../../src/domain/taxIds';

describe('Steuernummer', () => {
  it.each(['12/345/67890', '123/456/78901', '2181508150', '9181081508155', '21 815 08150'])('accepts %s', (n) => expect(isValidTaxNumber(n)).toBe(true));
  it.each(['', '123456789', '12345678901234', '12/345/6789A'])('rejects %s', (n) => expect(isValidTaxNumber(n)).toBe(false));
});

describe('USt-IdNr.', () => {
  // published IDs of large companies, which pass the BZSt check digit procedure
  it.each(['DE136695976', 'DE129273398', 'DE812526315', 'de 136 695 976'])('accepts %s', (id) => expect(isValidGermanVatId(id)).toBe(true));
  it.each(['DE136695977', 'DE13669597', 'ATU12345678', 'DE1366959760', 'DE999999999'])('rejects %s', (id) => expect(isValidGermanVatId(id)).toBe(false));
  it('normalizes', () => expect(normalizeVatId('de 136.695-976')).toBe('DE136695976'));

  it('accepts exactly one check digit for every eight digits', () => {
    for (const base of ['00000000', '12345678', '98765432', '13669597']) {
      const valid = [...'0123456789'].filter((d) => isValidGermanVatId(`DE${base}${d}`));
      expect(valid).toHaveLength(1);
    }
  });
});

describe('EU VAT ID', () => {
  it.each(['ATU12345678', 'FR12345678901', 'EL123456789', 'NL123456789B01', 'XI123456789', 'DE136695976', 'es x1234567 x'])('accepts %s', (id) => expect(isPlausibleEuVatId(id)).toBe(true));
  it.each(['DE136695977', 'GR123456789', 'CHE123456789', 'US123456789', 'AT1', 'FR' + '1'.repeat(13), ''])('rejects %s', (id) => expect(isPlausibleEuVatId(id)).toBe(false));
});

describe('Leitweg-ID', () => {
  it.each(['04011000-12345-34', '991-33333TEST-33', '05-07', '123456789012-' + 'A'.repeat(30) + '-99'])('accepts %s', (id) => expect(isPlausibleLeitwegId(id)).toBe(true));
  it.each(['04011000', '1-12', '04011000-12345-3', '04011000-123 45-34', '0401100012345-34x', '1234567890123-12'])('rejects %s', (id) => expect(isPlausibleLeitwegId(id)).toBe(false));
});
